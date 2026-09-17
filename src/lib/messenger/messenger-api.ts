// ============================================================
// Meta Messenger Platform Graph API Client (v25.0)
// Real production implementation for Facebook Messenger CRM
// ============================================================

const MESSENGER_API_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${MESSENGER_API_VERSION}`;

export interface MessengerSendResult {
  messageId: string;
  recipientId: string;
}

export interface MessengerErrorEnvelope {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export class MessengerApiError extends Error {
  readonly code: number | null;
  readonly subcode: number | null;
  readonly type: string | null;
  readonly fbtraceId: string | null;
  readonly httpStatus: number;

  constructor(
    message: string,
    fields: {
      code?: number | null;
      subcode?: number | null;
      type?: string | null;
      fbtraceId?: string | null;
      httpStatus: number;
    }
  ) {
    super(message);
    this.name = 'MessengerApiError';
    this.code = fields.code ?? null;
    this.subcode = fields.subcode ?? null;
    this.type = fields.type ?? null;
    this.fbtraceId = fields.fbtraceId ?? null;
    this.httpStatus = fields.httpStatus;
  }
}

async function readMessengerError(response: Response, fallback: string): Promise<MessengerApiError> {
  let message = fallback;
  let envelope: MessengerErrorEnvelope['error'] | undefined;
  try {
    const data = (await response.json()) as MessengerErrorEnvelope;
    envelope = data.error;
    if (envelope?.message) message = envelope.message;
  } catch {
    // Non-JSON response
  }
  return new MessengerApiError(message, {
    code: typeof envelope?.code === 'number' ? envelope.code : null,
    subcode: typeof envelope?.error_subcode === 'number' ? envelope.error_subcode : null,
    type: envelope?.type ?? null,
    fbtraceId: envelope?.fbtrace_id ?? null,
    httpStatus: response.status,
  });
}

async function throwMessengerError(response: Response, fallback: string): Promise<never> {
  throw await readMessengerError(response, fallback);
}

// ------------------------------------------------------------
// Attachment Upload API
// ------------------------------------------------------------

export interface UploadAttachmentArgs {
  pageId: string;
  pageAccessToken: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  url: string;
  isReusable?: boolean;
}

export async function uploadMessengerAttachment(args: UploadAttachmentArgs): Promise<string> {
  const { pageId, pageAccessToken, kind, url, isReusable = true } = args;
  const endpoint = `${GRAPH_BASE}/${pageId}/message_attachments`;

  const payload = {
    message: {
      attachment: {
        type: kind,
        payload: {
          url,
          is_reusable: isReusable,
        },
      },
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwMessengerError(response, `Attachment upload failed: ${response.status}`);
  }

  const data = (await response.json()) as { attachment_id: string };
  return data.attachment_id;
}

// ------------------------------------------------------------
// Outbound Messages (Send API)
// ------------------------------------------------------------

export type MessagingType = 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';

export interface QuickReplyOption {
  title: string;
  payload?: string;
  imageUrl?: string;
}

export interface GenericCardElement {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttons?: Array<{
    type: 'postback' | 'web_url';
    title: string;
    payload?: string;
    url?: string;
  }>;
}

export interface SendMessengerTextMessageArgs {
  pageId: string;
  pageAccessToken: string;
  psid: string;
  text: string;
  messagingType?: MessagingType;
  tag?: string;
  quickReplies?: QuickReplyOption[];
  personaId?: string;
}

export async function sendMessengerTextMessage(
  args: SendMessengerTextMessageArgs
): Promise<MessengerSendResult> {
  const {
    pageId,
    pageAccessToken,
    psid,
    text,
    messagingType = 'RESPONSE',
    tag,
    quickReplies,
    personaId,
  } = args;

  const endpoint = `${GRAPH_BASE}/${pageId}/messages`;

  const messagePayload: Record<string, unknown> = { text };

  if (quickReplies && quickReplies.length > 0) {
    messagePayload.quick_replies = quickReplies.map((qr) => ({
      content_type: 'text',
      title: qr.title,
      payload: qr.payload || qr.title,
      image_url: qr.imageUrl || undefined,
    }));
  }

  const body: Record<string, unknown> = {
    recipient: { id: psid },
    messaging_type: messagingType,
    message: messagePayload,
  };

  if (messagingType === 'MESSAGE_TAG' && tag) {
    body.tag = tag;
  }

  if (personaId) {
    body.persona_id = personaId;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    await throwMessengerError(response, `Send text message failed: ${response.status}`);
  }

  const data = (await response.json()) as { message_id: string; recipient_id: string };
  return { messageId: data.message_id, recipientId: data.recipient_id };
}

export interface SendMessengerMediaMessageArgs {
  pageId: string;
  pageAccessToken: string;
  psid: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  mediaUrl: string;
  messagingType?: MessagingType;
  tag?: string;
}

export async function sendMessengerMediaMessage(
  args: SendMessengerMediaMessageArgs
): Promise<MessengerSendResult> {
  const { pageId, pageAccessToken, psid, kind, mediaUrl, messagingType = 'RESPONSE', tag } = args;

  // Upload attachment first to get attachment_id
  let attachmentId: string;
  try {
    attachmentId = await uploadMessengerAttachment({
      pageId,
      pageAccessToken,
      kind,
      url: mediaUrl,
    });
  } catch {
    // Fallback: direct URL send if upload API is restricted
    attachmentId = '';
  }

  const endpoint = `${GRAPH_BASE}/${pageId}/messages`;

  const attachmentPayload = attachmentId
    ? { attachment_id: attachmentId }
    : { url: mediaUrl, is_reusable: true };

  const body: Record<string, unknown> = {
    recipient: { id: psid },
    messaging_type: messagingType,
    message: {
      attachment: {
        type: kind,
        payload: attachmentPayload,
      },
    },
  };

  if (messagingType === 'MESSAGE_TAG' && tag) {
    body.tag = tag;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    await throwMessengerError(response, `Send media message failed: ${response.status}`);
  }

  const data = (await response.json()) as { message_id: string; recipient_id: string };
  return { messageId: data.message_id, recipientId: data.recipient_id };
}

export interface SendMessengerGenericTemplateArgs {
  pageId: string;
  pageAccessToken: string;
  psid: string;
  elements: GenericCardElement[];
  messagingType?: MessagingType;
  tag?: string;
}

export async function sendMessengerGenericTemplate(
  args: SendMessengerGenericTemplateArgs
): Promise<MessengerSendResult> {
  const { pageId, pageAccessToken, psid, elements, messagingType = 'RESPONSE', tag } = args;
  const endpoint = `${GRAPH_BASE}/${pageId}/messages`;

  const body: Record<string, unknown> = {
    recipient: { id: psid },
    messaging_type: messagingType,
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: elements.map((el) => ({
            title: el.title,
            subtitle: el.subtitle,
            image_url: el.imageUrl,
            buttons: el.buttons?.map((b) =>
              b.type === 'web_url'
                ? { type: 'web_url', title: b.title, url: b.url }
                : { type: 'postback', title: b.title, payload: b.payload }
            ),
          })),
        },
      },
    },
  };

  if (messagingType === 'MESSAGE_TAG' && tag) {
    body.tag = tag;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    await throwMessengerError(response, `Send generic template failed: ${response.status}`);
  }

  const data = (await response.json()) as { message_id: string; recipient_id: string };
  return { messageId: data.message_id, recipientId: data.recipient_id };
}

// ------------------------------------------------------------
// User Profile API (fetch contact name & picture from PSID)
// ------------------------------------------------------------

export interface MessengerUserProfile {
  id: string;
  first_name?: string;
  last_name?: string;
  profile_pic?: string;
}

export async function fetchMessengerUserProfile(
  psid: string,
  pageAccessToken: string
): Promise<MessengerUserProfile | null> {
  const endpoint = `${GRAPH_BASE}/${psid}?fields=first_name,last_name,profile_pic&access_token=${pageAccessToken}`;
  try {
    const response = await fetch(endpoint);
    if (!response.ok) return null;
    return (await response.json()) as MessengerUserProfile;
  } catch {
    return null;
  }
}
