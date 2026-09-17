import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sendMessengerTextMessage,
  sendMessengerMediaMessage,
  sendMessengerGenericTemplate,
  type QuickReplyOption,
  type GenericCardElement,
} from '@/lib/messenger/messenger-api';

export class SendMessengerMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessengerMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessengerMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  quickReplies?: QuickReplyOption[];
  elements?: GenericCardElement[];
  replyToMessageId?: string | null;
}

export interface SendMessengerMessageResult {
  messageId: string; // Internal DB UUID
  messengerMessageId: string; // Meta message_id
}

export async function sendMessengerMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessengerMessageParams
): Promise<SendMessengerMessageResult> {
  const { conversationId, messageType, contentText, mediaUrl, quickReplies, elements } = params;

  if (!conversationId) {
    throw new SendMessengerMessageError('bad_request', 'conversation_id is required', 400);
  }

  // Fetch conversation + contact
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .single();

  if (convError || !conversation) {
    throw new SendMessengerMessageError('not_found', 'Conversation not found', 404);
  }

  const psid = conversation.contact?.psid || conversation.psid;
  if (!psid) {
    throw new SendMessengerMessageError(
      'bad_request',
      'Contact does not have a valid Messenger PSID',
      400
    );
  }

  // Fetch messenger config for account or user
  let pageId = process.env.META_PAGE_ID || '';
  let pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN || '';

  const { data: config } = await db
    .from('messenger_config')
    .select('*')
    .or(`user_id.eq.${accountId},user_id.eq.${conversation.user_id}`)
    .maybeSingle();

  if (config?.page_id && config?.access_token) {
    pageId = config.page_id;
    try {
      pageAccessToken = decrypt(config.access_token);
    } catch {
      pageAccessToken = config.access_token;
    }
  }

  if (!pageId || !pageAccessToken) {
    throw new SendMessengerMessageError(
      'messenger_not_configured',
      'Facebook Page ID and Page Access Token not configured. Please complete settings.',
      400
    );
  }

  // Determine messaging window & tag
  // Standard 24h window: messaging_type = 'RESPONSE'
  // Outside 24h window up to 7 days: messaging_type = 'MESSAGE_TAG', tag = 'HUMAN_AGENT'
  const lastInboundAt = conversation.last_inbound_at
    ? new Date(conversation.last_inbound_at).getTime()
    : 0;

  const now = Date.now();
  const msSinceInbound = now - lastInboundAt;
  const isWithin24h = msSinceInbound <= 24 * 60 * 60 * 1000;
  const isWithin7Days = msSinceInbound <= 7 * 24 * 60 * 60 * 1000;

  let messagingType: 'RESPONSE' | 'MESSAGE_TAG' = 'RESPONSE';
  let tag: string | undefined;

  if (!isWithin24h) {
    if (isWithin7Days) {
      messagingType = 'MESSAGE_TAG';
      tag = 'HUMAN_AGENT';
    } else {
      console.warn(
        `[messenger-send] Conversation ${conversationId} is outside 7-day window. Attempting HUMAN_AGENT tag send.`
      );
      messagingType = 'MESSAGE_TAG';
      tag = 'HUMAN_AGENT';
    }
  }

  let messengerMsgId = '';

  try {
    if (messageType === 'text') {
      const res = await sendMessengerTextMessage({
        pageId,
        pageAccessToken,
        psid,
        text: contentText || '',
        messagingType,
        tag,
        quickReplies,
      });
      messengerMsgId = res.messageId;
    } else if (['image', 'video', 'audio', 'file'].includes(messageType)) {
      const res = await sendMessengerMediaMessage({
        pageId,
        pageAccessToken,
        psid,
        kind: messageType as 'image' | 'video' | 'audio' | 'file',
        mediaUrl: mediaUrl || '',
        messagingType,
        tag,
      });
      messengerMsgId = res.messageId;
    } else if (messageType === 'template' || messageType === 'generic') {
      if (elements && elements.length > 0) {
        const res = await sendMessengerGenericTemplate({
          pageId,
          pageAccessToken,
          psid,
          elements,
          messagingType,
          tag,
        });
        messengerMsgId = res.messageId;
      } else {
        const res = await sendMessengerTextMessage({
          pageId,
          pageAccessToken,
          psid,
          text: contentText || '',
          messagingType,
          tag,
          quickReplies,
        });
        messengerMsgId = res.messageId;
      }
    } else {
      const res = await sendMessengerTextMessage({
        pageId,
        pageAccessToken,
        psid,
        text: contentText || `[${messageType}]`,
        messagingType,
        tag,
      });
      messengerMsgId = res.messageId;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new SendMessengerMessageError('messenger_api_error', `Meta API Error: ${errMsg}`, 502);
  }

  // Persist outbound message in DB
  const { data: inserted, error: dbErr } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: messageType,
      content_text: contentText || (elements ? elements[0]?.title : `[${messageType}]`),
      media_url: mediaUrl || null,
      message_id: messengerMsgId,
      status: 'sent',
    })
    .select()
    .single();

  if (dbErr) {
    console.error('Failed to insert outbound messenger message:', dbErr);
    throw new SendMessengerMessageError('db_error', `DB Insert Error: ${dbErr.message}`, 500);
  }

  const nowIso = new Date().toISOString();
  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', conversationId);

  return { messageId: inserted.id, messengerMessageId: messengerMsgId };
}
