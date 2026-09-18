import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';
import { fetchMessengerUserProfile } from '@/lib/messenger/messenger-api';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

export const maxDuration = 60;

// Lazy initialized Supabase Admin Client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

export interface MessengerMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload: string };
    attachments?: Array<{
      type: 'image' | 'video' | 'audio' | 'file' | 'location' | 'fallback';
      payload: { url?: string; title?: string; lat?: number; long?: number };
    }>;
    reply_to?: { mid: string };
  };
  postback?: {
    title: string;
    payload: string;
    referral?: { ref?: string; source?: string };
  };
  delivery?: {
    mids?: string[];
    watermark: number;
  };
  read?: {
    watermark: number;
  };
}

export interface MessengerWebhookEntry {
  id: string; // Page ID
  time: number;
  messaging: MessengerMessagingEvent[];
}

// GET - Webhook verification handshake
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('hub.mode');
    const challenge = searchParams.get('hub.challenge');
    const verifyToken = searchParams.get('hub.verify_token');

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      );
    }

    // Check env verification token first
    const envVerifyToken = process.env.META_VERIFY_TOKEN;
    if (envVerifyToken && verifyToken === envVerifyToken) {
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Check database messenger_config
    const { data: configs } = await supabaseAdmin()
      .from('messenger_config')
      .select('id, verify_token');

    let matched = false;
    if (configs) {
      for (const config of configs) {
        if (config.verify_token === verifyToken) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    );
  } catch (error) {
    console.error('Error in Messenger webhook GET verification:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Receive Messenger events
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[messenger-webhook] invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: { object?: string; entry?: MessengerWebhookEntry[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.object !== 'page' || !body.entry) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  after(async () => {
    try {
      await processMessengerWebhook(body.entry!);
    } catch (error) {
      console.error('Error processing Messenger webhook:', error);
    }
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

async function processMessengerWebhook(entries: MessengerWebhookEntry[]) {
  for (const entry of entries) {
    const pageId = entry.id;

    // Lookup messenger_config by page_id
    const { data: config } = await supabaseAdmin()
      .from('messenger_config')
      .select('*')
      .eq('page_id', pageId)
      .maybeSingle();

    for (const event of entry.messaging || []) {
      await handleMessagingEvent(event, pageId, config);
    }
  }
}

async function handleMessagingEvent(
  event: MessengerMessagingEvent,
  pageId: string,
  config: any
) {
  const senderPsid = event.sender?.id;
  const recipientId = event.recipient?.id;

  if (!senderPsid || !recipientId) return;

  // Determine user/account context
  const accountId = config?.account_id || config?.user_id;
  const userId = config?.user_id;
  const pageAccessToken = config?.access_token || process.env.META_PAGE_ACCESS_TOKEN;

  // 1. Delivery Receipts
  if (event.delivery) {
    for (const mid of event.delivery.mids || []) {
      await supabaseAdmin()
        .from('messages')
        .update({ status: 'delivered' })
        .eq('message_id', mid);
    }
    return;
  }

  // 2. Read Receipts
  if (event.read) {
    // Read receipts update status in conversation
    return;
  }

  // 3. Message Echoes (messages sent by Page)
  if (event.message?.is_echo) {
    return;
  }

  // 4. Inbound Message or Postback
  const isPostback = !!event.postback;
  const isMessage = !!event.message;

  if (!isPostback && !isMessage) return;

  // Find or create Contact by PSID
  const contact = await findOrCreateMessengerContact({
    psid: senderPsid,
    userId,
    pageAccessToken,
  });

  if (!contact) return;

  // Find or create Conversation
  const conversation = await findOrCreateMessengerConversation({
    contactId: contact.id,
    userId,
    psid: senderPsid,
  });

  if (!conversation) return;

  // Extract content
  let contentText = '';
  let contentType = 'text';
  let mediaUrl: string | null = null;
  const messageId = event.message?.mid || `pb_${event.timestamp}_${senderPsid}`;

  if (isPostback) {
    contentText = event.postback?.title || event.postback?.payload || 'Postback';
    contentType = 'interactive';
  } else if (event.message) {
    if (event.message.quick_reply) {
      contentText = event.message.quick_reply.payload || event.message.text || '';
      contentType = 'interactive';
    } else if (event.message.text) {
      contentText = event.message.text;
      contentType = 'text';
    } else if (event.message.attachments && event.message.attachments.length > 0) {
      const att = event.message.attachments[0];
      contentType = att.type === 'fallback' ? 'text' : att.type;
      mediaUrl = att.payload?.url || null;
      contentText = att.payload?.title || `[${contentType}]`;
    }
  }

  // Insert inbound message into DB
  const { data: insertedMsg, error: msgError } = await supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: contentType,
      content_text: contentText,
      media_url: mediaUrl,
      message_id: messageId,
      status: 'sent',
    })
    .select()
    .single();

  if (msgError) {
    console.error('Error inserting inbound Messenger message:', msgError);
    return;
  }

  const nowIso = new Date().toISOString();

  // Update conversation last_message, unread_count, and last_inbound_at (24-hour window)
  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText,
      last_message_at: nowIso,
      last_inbound_at: nowIso,
      unread_count: (conversation.unread_count || 0) + 1,
      status: 'open',
      updated_at: nowIso,
    })
    .eq('id', conversation.id);

  // Dispatch webhooks & automations
  if (accountId) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
      message_id: insertedMsg.id,
      conversation_id: conversation.id,
      contact_id: contact.id,
      psid: senderPsid,
      content_text: contentText,
    });

    // Run Automations Engine
    void runAutomationsForTrigger({
      triggerType: 'new_message_received',
      accountId,
      contactId: contact.id,
      context: {
        conversation_id: conversation.id,
        message_text: contentText,
      }
    });

    // Run Flows Engine
    void dispatchInboundToFlows({
      accountId,
      userId: userId || '00000000-0000-0000-0000-000000000000',
      contactId: contact.id,
      conversationId: conversation.id,
      isFirstInboundMessage: (conversation.unread_count || 0) === 0,
      message: isPostback ? {
          kind: 'interactive_reply',
          reply_id: event.postback!.payload,
          reply_title: event.postback!.title,
          meta_message_id: messageId
      } : event.message?.quick_reply ? {
          kind: 'interactive_reply',
          reply_id: event.message.quick_reply.payload,
          reply_title: event.message.text || '',
          meta_message_id: messageId
      } : {
          kind: 'text',
          text: contentText,
          meta_message_id: messageId
      }
    });

    // Run AI Auto-Reply Assistant
    void dispatchInboundToAiReply({
      accountId,
      contactId: contact.id,
      configOwnerUserId: userId || '00000000-0000-0000-0000-000000000000',
      conversationId: conversation.id,
      inboundMessageId: messageId,
    });
  }
}

async function findOrCreateMessengerContact(params: {
  psid: string;
  userId?: string;
  pageAccessToken?: string;
}) {
  const { psid, userId, pageAccessToken } = params;

  // Lookup existing contact by PSID
  const { data: existing } = await supabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('psid', psid)
    .maybeSingle();

  if (existing) return existing;

  // Fetch Facebook Profile details if token available
  let name = `Messenger User (${psid.slice(-4)})`;
  let avatarUrl: string | undefined;

  if (pageAccessToken) {
    const profile = await fetchMessengerUserProfile(psid, pageAccessToken);
    if (profile) {
      if (profile.first_name || profile.last_name) {
        name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
      }
      if (profile.profile_pic) {
        avatarUrl = profile.profile_pic;
      }
    }
  }

  // Create new contact
  const { data: created, error } = await supabaseAdmin()
    .from('contacts')
    .insert({
      user_id: userId || '00000000-0000-0000-0000-000000000000',
      psid,
      name,
      avatar_url: avatarUrl,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating contact for PSID:', psid, error);
    return null;
  }

  return created;
}

async function findOrCreateMessengerConversation(params: {
  contactId: string;
  userId?: string;
  psid: string;
}) {
  const { contactId, userId, psid } = params;

  const { data: existing } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('contact_id', contactId)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await supabaseAdmin()
    .from('conversations')
    .insert({
      user_id: userId || '00000000-0000-0000-0000-000000000000',
      contact_id: contactId,
      psid,
      status: 'open',
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating conversation for contactId:', contactId, error);
    return null;
  }

  return created;
}
