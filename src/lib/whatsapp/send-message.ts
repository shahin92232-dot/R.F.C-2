import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMessengerMessageToConversation } from '@/lib/messenger/send-messenger-message';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateParams?: string[];
  templateMessageParams?: unknown;
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export interface SendMessageResult {
  messageId: string;
  whatsappMessageId: string;
}

export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText, mediaUrl } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);
  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const messengerRes = await sendMessengerMessageToConversation(db, accountId, {
    conversationId: params.conversationId,
    messageType: params.messageType,
    contentText: params.contentText,
    mediaUrl: params.mediaUrl,
    replyToMessageId: params.replyToMessageId,
  });

  return {
    messageId: messengerRes.messageId,
    whatsappMessageId: messengerRes.messengerMessageId,
  };
}
