import { convert } from 'html-to-text';
import { Email } from 'postal-mime';
import type { APIChannelBase, ChannelType } from 'discord-api-types/v10';

import { MailBoxService } from '../services/mailbox.service';
import { SendMailService } from '../services/sendmail.service';

import { MailBox, MailParamsBase } from '../types/mailbox';

export const email = async (message: ForwardableEmailMessage, env: Env) => {
	const mailBoxService = new MailBoxService(env);
	const sendMailService = new SendMailService(env);

	if (env.FORWARD_TO_ADDRESS) {
		console.log(`[Email Workers] Forwarding ${message.headers.get('Message-ID')} to -> ${env.FORWARD_TO_ADDRESS}`);
		await message.forward(env.FORWARD_TO_ADDRESS);
	}

	const email = await mailBoxService.parseMail(message.raw);
	const emailText: string | undefined = email.text || (email.html && convert(email.html)) || undefined;
	if (!emailText) return message.setReject('Invalid email payload');

	if (isReplyEmail(email, env)) {
		await handleReplyEmail(email, emailText, message, env, mailBoxService);
	} else {
		await handleNewEmail(email, emailText, message, env, mailBoxService, sendMailService);
	}
};

const isReplyEmail = (email: Email, env: Env): boolean => {
	return email.subject ? email.subject?.includes(`[${env.EMAIL_PREFIX}] #`) && email.subject?.includes(':') : false;
};

const handleReplyEmail = async (
	email: Email,
	emailText: string,

	message: ForwardableEmailMessage,
	env: Env,

	mailBoxService: MailBoxService,
) => {
	if (!email.subject) return message.setReject('Invalid email payload');

	const ticketId = email.subject.split(`[${env.EMAIL_PREFIX}] #`)[1].split(':')[0].trim();
	const ticket = await env.DB.prepare('SELECT * FROM Tickets WHERE Id = ?').bind(ticketId).first<MailBox>();
	if (!ticket) return message.setReject('Invalid email payload');

	const formData = mailBoxService.generateMessageRequestBody(
		email,
		emailText.split('## 회신을 보내실 경우 이 줄 위에 내용을 입력해 주세요 ##')[0],
		message,
	);

	const sendUpdateMessage = await fetch(`https://discord.com/api/v10/channels/${ticket.ThreadId}/messages`, {
		method: 'POST',
		body: formData,
		headers: {
			Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN,
		},
	});

	console.log(`[Reply Handler] Discord Response -> ${await sendUpdateMessage.text()}`);

	if (!sendUpdateMessage.ok) {
		console.error(`[Reply Handler] Discord Notification Failed -> (${sendUpdateMessage.status}) ${sendUpdateMessage.statusText}`);
	}
};

const handleNewEmail = async (
	email: Email,
	emailText: string,

	message: ForwardableEmailMessage,
	env: Env,

	mailBoxService: MailBoxService,
	sendMailService: SendMailService,
) => {
	const ticketId = mailBoxService._createTicketId();
	const appliedTags = getAppliedTags(message, env);

	const formData = mailBoxService.generateRequestBody(email, emailText, ticketId, message, appliedTags);
	const createNewPost = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/threads`, {
		method: 'POST',
		body: formData,
		headers: {
			Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN,
		},
	});

	const postResponse = await createNewPost.json<APIChannelBase<ChannelType.PublicThread>>();
	console.log(`[New Handler] Discord Response: ${JSON.stringify(postResponse)}`);

	if (!createNewPost.ok) {
		console.error(`[New Handler] Discord Notification Failed: (${createNewPost.status}) ${createNewPost.statusText}`);
	} else {
		await env.DB.prepare('INSERT INTO Tickets (Id, ThreadId, Subject, Author, Receiver) VALUES (?, ?, ?, ?, ?)')
			.bind(ticketId, postResponse.id, email.subject ?? '(제목 없음)', email.from.address, message.to)
			.run();

		console.log(`[New Handler] Ticket Created: ${ticketId}`);

		const mailParams: MailParamsBase = {
			id: ticketId,
			subject: email.subject ?? '(제목 없음)',
		};

		await sendMailService.replyMail(message, mailParams);
	}
};

const getAppliedTags = (message: ForwardableEmailMessage, env: Env): string[] => {
	const appliedTags: string[] = [];

	console.log(`[Tag Handler] Checking for tags in ${message.to}`);

	if (env.TLD_TAG) {
		const tld = `@${message.to.split('@')[1]}` as keyof typeof env.TLD_TAG;
		console.log(`[Tag Handler] Checking for TLD Tag: ${tld}`);

		if (env.TLD_TAG[tld]) {
			appliedTags.push(env.TLD_TAG[tld]);
			console.log(`[Tag Handler] Found TLD Tag: ${env.TLD_TAG[tld]}`);
		}
	}

	if (env.ADDRESS_TAG) {
		const address = `${message.to.split('@')[0]}@` as keyof typeof env.ADDRESS_TAG;
		console.log(`[Tag Handler] Checking for Address Tag: ${address}`);

		if (env.ADDRESS_TAG[address]) {
			appliedTags.push(env.ADDRESS_TAG[address]);
			console.log(`[Tag Handler] Found Address Tag: ${env.ADDRESS_TAG[address]}`);
		}
	}

	return appliedTags;
};
