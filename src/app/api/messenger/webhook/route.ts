import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';
import { decrypt } from '@/lib/whatsapp/encryption';
import { fetchMessengerUserProfile } from '@/lib/messenger/messenger-api';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

export const maxDuration = 60;

// Lazy initialized Supabase Admin Client using SUPABASE_SERVICE_ROLE_KEY to bypass RLS completely
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

    // 1. Check environment variable first
    const envVerifyToken = process.env.META_VERIFY_TOKEN;
    if (envVerifyToken && verifyToken === envVerifyToken) {
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // 2. Check messenger_config table primary
    const { data: mConfigs } = await supabaseAdmin()
      .from('messenger_config')
      .select('id, verify_token');

    let matched = false;
    if (mConfigs) {
      for (const config of mConfigs) {
        if (!config.verify_token) continue;
        let tokenPlain = config.verify_token;
        try {
          tokenPlain = decrypt(config.verify_token);
        } catch {
          // fallback to plaintext
        }
        if (tokenPlain === verifyToken || config.verify_token === verifyToken) {
          matched = true;
          break;
        }
      }
    }

    // 3. Check whatsapp_config table fallback
    if (!matched) {
      const { data: wConfigs } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('id, verify_token');
      if (wConfigs) {
        for (const config of wConfigs) {
          if (!config.verify_token) continue;
          let tokenPlain = config.verify_token;
          try {
            tokenPlain = decrypt(config.verify_token);
          } catch {
            // fallback
          }
          if (tokenPlain === verifyToken || config.verify_token === verifyToken) {
            matched = true;
            break;
          }
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
    console.error('[messenger-webhook] Error in GET verification:', error);
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

  let body: { object?: string; entry?: MessengerWebhookEntry[] };
  try {
    body = JSON.parse(rawBody);
    console.log("INCOMING MESSENGER WEBHOOK PAYLOAD:", JSON.stringify(body, null, 2));
  } catch (err) {
    console.error('[messenger-webhook] Error parsing raw JSON body:', err);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // FIRST STEP: Instantly dump raw incoming payload to `webhook_events` table
  try {
    const isMsg = !!body.entry?.[0]?.messaging?.[0]?.message;
    const isPb = !!body.entry?.[0]?.messaging?.[0]?.postback;
    const eventType = isMsg ? 'message' : (isPb ? 'postback' : 'raw_webhook');

    await supabaseAdmin()
      .from('webhook_events')
      .insert({
        provider: 'messenger',
        event_type: eventType,
        payload: body,
        status: 'received',
      });
    console.log('[messenger-webhook] Logged raw payload into webhook_events table');
  } catch (logErr) {
    console.error('[messenger-webhook] Failed to write raw payload to webhook_events:', logErr);
    // Non-blocking: continue processing even if raw payload logging fails
  }

  // Lookup App Secret for signature verification
  let customSecret: string | null = null;
  const pageId = body.entry?.[0]?.id;

  if (pageId) {
    try {
      const { data: mConfig } = await supabaseAdmin()
        .from('messenger_config')
        .select('app_secret')
        .eq('page_id', pageId)
        .maybeSingle();

      if (mConfig?.app_secret) {
        try {
          customSecret = decrypt(mConfig.app_secret);
        } catch {
          customSecret = mConfig.app_secret;
        }
      } else {
        const { data: wConfig } = await supabaseAdmin()
          .from('whatsapp_config')
          .select('waba_id')
          .eq('phone_number_id', pageId)
          .maybeSingle();
        if (wConfig?.waba_id) customSecret = wConfig.waba_id;
      }
    } catch (err) {
      console.error('[messenger-webhook] Error looking up app secret:', err);
    }
  }

  if (!verifyMetaWebhookSignature(rawBody, signature, customSecret)) {
    console.warn('[messenger-webhook] Invalid Meta webhook signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  if (body.object !== 'page' || !body.entry) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  try {
    console.log('[messenger-webhook] Processing webhook payload for page:', pageId);
    await processMessengerWebhook(body.entry!);
  } catch (error) {
    console.error('[messenger-webhook] Unhandled error during webhook processing:', error);
  }

  return NextResponse.json({ status: 'ok' }, { status: 200 });
}

async function processMessengerWebhook(entries: MessengerWebhookEntry[]) {
  for (const entry of entries) {
    const pageId = entry.id;

    // Lookup configuration primary from messenger_config, fallback to whatsapp_config
    let config: any = null;
    try {
      const { data: mConfig, error: mErr } = await supabaseAdmin()
        .from('messenger_config')
        .select('*')
        .eq('page_id', pageId)
        .maybeSingle();

      if (mErr) {
        console.error('[messenger-webhook] Error querying messenger_config:', mErr);
      }

      if (mConfig) {
        config = { ...mConfig };
        if (mConfig.access_token) {
          try {
            config.access_token = decrypt(mConfig.access_token);
          } catch {
            config.access_token = mConfig.access_token;
          }
        }
      } else {
        const { data: wConfig } = await supabaseAdmin()
          .from('whatsapp_config')
          .select('*')
          .eq('phone_number_id', pageId)
          .maybeSingle();

        if (wConfig) {
          config = { ...wConfig };
          if (wConfig.access_token) {
            try {
              config.access_token = decrypt(wConfig.access_token);
            } catch {
              config.access_token = wConfig.access_token;
            }
          }
        }
      }
    } catch (configErr) {
      console.error('[messenger-webhook] Exception fetching config:', configErr);
    }

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
    try {
      for (const mid of event.delivery.mids || []) {
        await supabaseAdmin()
          .from('messages')
          .update({ status: 'delivered' })
          .eq('message_id', mid);
      }
    } catch (err) {
      console.error('[messenger-webhook] Error updating delivery receipt:', err);
    }
    return;
  }

  // 2. Read Receipts
  if (event.read) {
    return;
  }

  // 3. Inbound Message, Postback, or Admin Echo Message
  const isPostback = !!event.postback;
  const isMessage = !!event.message;
  const isEcho = !!event.message?.is_echo;

  if (isEcho) {
    console.log("IS_ECHO EVENT DETECTED:", JSON.stringify(event.message, null, 2));
  }

  // For echoes, sender.id is Page ID and recipient.id is Customer PSID.
  // For incoming customer messages, sender.id is Customer PSID and recipient.id is Page ID.
  const customerPsid = isEcho ? recipientId : senderPsid;

  // Determine message direction
  const configuredPageId = config?.page_id || pageId;
  const isFromCustomer = !isEcho && (senderPsid !== configuredPageId);
  const senderType = isFromCustomer ? 'customer' : 'agent';
  const direction = isFromCustomer ? 'inbound' : 'outbound';

  // Find or create Contact by PSID (Customer PSID)
  const contact = await findOrCreateMessengerContact({
    psid: customerPsid,
    userId,
    accountId,
    pageAccessToken,
  });

  if (!contact) {
    console.error('[messenger-webhook] Failed to find or create contact for PSID:', customerPsid);
    return;
  }

  // Find or create Conversation
  const conversation = await findOrCreateMessengerConversation({
    contactId: contact.id,
    userId,
    accountId,
    psid: customerPsid,
  });

  if (!conversation) {
    console.error('[messenger-webhook] Failed to find or create conversation for contactId:', contact.id);
    return;
  }

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

  // Insert message into DB with explicit directional flags
  let insertedMsg: any = null;
  try {
    const { data: newMsg, error: msgError } = await supabaseAdmin()
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        account_id: accountId,
        sender_type: senderType,
        is_from_customer: isFromCustomer,
        direction: direction,
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        message_id: messageId,
        status: 'sent',
      })
      .select()
      .single();

    if (msgError) {
      console.error('[messenger-webhook] DB Error inserting message:', msgError);
      return;
    }
    insertedMsg = newMsg;
  } catch (err) {
    console.error('[messenger-webhook] Exception inserting message:', err);
    return;
  }

  const nowIso = new Date().toISOString();

  // Update conversation last_message, unread_count, and last_inbound_at / last_customer_message_at
  try {
    const updatePayload: any = {
      last_message_text: contentText,
      last_message_at: nowIso,
      updated_at: nowIso,
    };

    if (isFromCustomer) {
      updatePayload.last_inbound_at = nowIso;
      updatePayload.last_customer_message_at = nowIso;
      updatePayload.unread_count = (conversation.unread_count || 0) + 1;
      updatePayload.status = 'open';
    }

    const { error: convUpdateErr } = await supabaseAdmin()
      .from('conversations')
      .update(updatePayload)
      .eq('id', conversation.id);

    if (convUpdateErr) {
      console.error('[messenger-webhook] DB Error updating conversation:', convUpdateErr);
    }
  } catch (err) {
    console.error('[messenger-webhook] Exception updating conversation:', err);
  }

  // Dispatch webhooks & automations
  if (accountId && insertedMsg) {
    try {
      await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
        message_id: insertedMsg.id,
        conversation_id: conversation.id,
        contact_id: contact.id,
        psid: senderPsid,
        content_text: contentText,
      });
    } catch (err) {
      console.error('[messenger-webhook] Error dispatching webhook event:', err);
    }

    // Run Automations Engine
    try {
      void runAutomationsForTrigger({
        triggerType: 'new_message_received',
        accountId,
        contactId: contact.id,
        context: {
          conversation_id: conversation.id,
          message_text: contentText,
        }
      });
    } catch (err) {
      console.error('[messenger-webhook] Error running automations:', err);
    }

    // Run Flows Engine
    try {
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
    } catch (err) {
      console.error('[messenger-webhook] Error dispatching flows:', err);
    }

    // Run AI Auto-Reply Assistant
    try {
      void dispatchInboundToAiReply({
        accountId,
        contactId: contact.id,
        configOwnerUserId: userId || '00000000-0000-0000-0000-000000000000',
        conversationId: conversation.id,
        inboundMessageId: messageId,
      });
    } catch (err) {
      console.error('[messenger-webhook] Error dispatching AI auto-reply:', err);
    }
  }
}

async function findOrCreateMessengerContact(params: {
  psid: string;
  userId?: string;
  accountId?: string;
  pageAccessToken?: string;
}) {
  const { psid, userId, pageAccessToken } = params;

  // Lookup existing contact by PSID
  try {
    const { data: existing } = await supabaseAdmin()
      .from('contacts')
      .select('*')
      .eq('psid', psid)
      .maybeSingle();

    if (existing) return existing;
  } catch (err) {
    console.error('[messenger-webhook] Error looking up contact by PSID:', err);
  }

  // Fetch Facebook Profile details if token available
  let name = `Messenger User (${psid.slice(-4)})`;
  let avatarUrl: string | undefined;

  if (pageAccessToken) {
    try {
      const profile = await fetchMessengerUserProfile(psid, pageAccessToken);
      if (profile) {
        if (profile.first_name || profile.last_name) {
          name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
        }
        if (profile.profile_pic) {
          avatarUrl = profile.profile_pic;
        }
      }
    } catch (profileErr) {
      console.error('[messenger-webhook] Error fetching user profile from Meta Graph API:', profileErr);
    }
  }

  // Create new contact
  try {
    const { data: created, error } = await supabaseAdmin()
      .from('contacts')
      .insert({
        user_id: userId || '00000000-0000-0000-0000-000000000000',
        account_id: params.accountId,
        psid,
        name,
        avatar_url: avatarUrl,
      })
      .select()
      .single();

    if (error) {
      console.error('[messenger-webhook] DB Error inserting contact:', error);
      return null;
    }
    return created;
  } catch (err) {
    console.error('[messenger-webhook] Exception in findOrCreateMessengerContact:', err);
    return null;
  }
}

async function findOrCreateMessengerConversation(params: {
  contactId: string;
  userId?: string;
  accountId?: string;
  psid: string;
}) {
  const { contactId, userId, psid } = params;

  try {
    const { data: existing } = await supabaseAdmin()
      .from('conversations')
      .select('*')
      .eq('contact_id', contactId)
      .maybeSingle();

    if (existing) return existing;
  } catch (err) {
    console.error('[messenger-webhook] Error looking up conversation:', err);
  }

  try {
    const { data: created, error } = await supabaseAdmin()
      .from('conversations')
      .insert({
        user_id: userId || '00000000-0000-0000-0000-000000000000',
        account_id: params.accountId,
        contact_id: contactId,
        psid,
        status: 'open',
      })
      .select()
      .single();

    if (error) {
      console.error('[messenger-webhook] DB Error creating conversation:', error);
      return null;
    }

    return created;
  } catch (err) {
    console.error('[messenger-webhook] Exception in findOrCreateMessengerConversation:', err);
    return null;
  }
}
