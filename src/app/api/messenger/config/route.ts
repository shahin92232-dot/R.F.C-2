import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.account_id) return null;
  return data.account_id as string;
}

/**
 * GET /api/messenger/config
 * Validates stored Facebook Messenger credentials against Meta Graph API.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { connected: false, reason: 'no_account', message: 'Profile not linked to an account.' },
        { status: 200 }
      );
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, waba_id, access_token, verify_token, status')
      .eq('account_id', accountId)
      .maybeSingle();

    if (configError || !config) {
      return NextResponse.json(
        { connected: false, reason: 'no_config', message: 'No Facebook Messenger configuration saved.' },
        { status: 200 }
      );
    }

    let pageAccessToken: string;
    try {
      pageAccessToken = decrypt(config.access_token);
    } catch {
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message: 'Page Access Token decryption failed. Please reset and re-enter.',
        },
        { status: 200 }
      );
    }

    // Ping Meta Graph API to verify Facebook Page Access Token
    const pageId = config.phone_number_id;
    const graphRes = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}?fields=id,name,access_token&access_token=${pageAccessToken}`
    );

    if (!graphRes.ok) {
      const errData = await graphRes.json().catch(() => ({}));
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: errData.error?.message || 'Meta Graph API validation failed',
          meta: errData.error || null,
        },
        { status: 200 }
      );
    }

    const pageData = await graphRes.json();
    return NextResponse.json({
      connected: true,
      page_info: { id: pageData.id, name: pageData.name },
      phone_info: { verified_name: pageData.name },
    });
  } catch (error) {
    console.error('Error in GET /api/messenger/config:', error);
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/messenger/config
 * Verifies & saves Facebook Messenger credentials (Page ID, Page Access Token, Verify Token, App Secret).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json({ error: 'Profile not linked to an account.' }, { status: 403 });
    }

    const body = await request.json();
    const { phone_number_id, app_id, waba_id, access_token, verify_token } = body;

    if (!phone_number_id || !access_token) {
      return NextResponse.json(
        { error: 'Facebook Page ID and Page Access Token are required' },
        { status: 400 }
      );
    }

    // Verify Page ID & Token with Meta Graph API
    const graphRes = await fetch(
      `https://graph.facebook.com/v21.0/${phone_number_id.trim()}?fields=id,name&access_token=${access_token.trim()}`
    );

    if (!graphRes.ok) {
      const errData = await graphRes.json().catch(() => ({}));
      return NextResponse.json(
        {
          error: errData.error?.message || 'Failed to verify Facebook Page credentials with Meta Graph API',
          meta: errData.error || null,
        },
        { status: 400 }
      );
    }

    const pageData = await graphRes.json();

    // Encrypt token
    const encryptedAccessToken = encrypt(access_token.trim());
    const baseRow: any = {
      phone_number_id: phone_number_id.trim(),
      waba_id: waba_id ? waba_id.trim() : null,
      access_token: encryptedAccessToken,
      status: 'connected',
      connected_at: new Date().toISOString(),
      registered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (verify_token) {
      baseRow.verify_token = encrypt(verify_token.trim());
    }

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('account_id', accountId);

      if (updateError) {
        return NextResponse.json({ error: 'Failed to update Messenger configuration' }, { status: 500 });
      }
    } else {
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          ...baseRow,
        });

      if (insertError) {
        return NextResponse.json({ error: 'Failed to save Messenger configuration' }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      registered: true,
      phone_info: { verified_name: pageData.name },
    });
  } catch (error) {
    console.error('Error in POST /api/messenger/config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/messenger/config
 * Resets Facebook Messenger configuration.
 */
export async function DELETE() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json({ error: 'Profile not linked to an account.' }, { status: 403 });
    }

    const { error } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId);

    if (error) {
      return NextResponse.json({ error: 'Failed to reset configuration' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/messenger/config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
