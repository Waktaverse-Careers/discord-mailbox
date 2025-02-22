/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Share command metadata from a common spot to be used for both runtime and registration.
 */

import { APIInteraction, InteractionResponseType, MessageFlags, ComponentType, APIInteractionResponse } from 'discord-api-types/v10';

export const replyCommand = {
	name: 'reply',
	description: '메일 답변을 전송합니다.',
	execute: async (interaction: APIInteraction, env: Env): Promise<APIInteractionResponse> => {
		if (!interaction.channel?.name?.split('#')[1]?.split(':')[0]) {
			return {
				type: InteractionResponseType.ChannelMessageWithSource,
				data: {
					content: ':warning: 메일함 채널이 아닙니다.',
					flags: MessageFlags.Ephemeral,
				},
			};
		}

		return {
			type: InteractionResponseType.Modal,
			data: {
				title: '문의 답변 보내기',
				custom_id: 'reply',
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.TextInput,
								custom_id: 'content',
								label: '답변 내용',
								style: 2,
								min_length: 1,
								max_length: 4000,
								placeholder: '답변 내용을 입력해주세요.',
								required: true,
							},
						],
					},
				],
			},
		};
	},
};
