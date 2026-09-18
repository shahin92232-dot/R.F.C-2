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
      .from('messenger_config')
      .select('*')
      .or(`account_id.eq.${accountId},user_id.eq.${user.id}`)
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
      return NextResponse.json({
        connected: false,
        reason: 'token_corrupted',
        needs_reset: true,
        message: 'Page Access Token decryption failed. Please reset and re-enter.',
        saved_config: {
          pageId: config.page_id,
          appSecretSaved: !!config.app_secret,
          accessTokenSaved: false,
          verifyTokenSaved: !!config.verify_token,
        },
      });
    }

    // Ping Meta Graph API to verify Facebook Page Access Token
    const pageId = config.page_id;
    const graphRes = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}?fields=id,name,access_token&access_token=${pageAccessToken}`
    );

    if (!graphRes.ok) {
      const errData = await graphRes.json().catch(() => ({}));
      return NextResponse.json({
        connected: false,
        reason: 'meta_api_error',
        message: errData.error?.message || 'Meta Graph API validation failed',
        meta: errData.error || null,
        saved_config: {
          pageId: config.page_id,
          appSecretSaved: !!config.app_secret,
          accessTokenSaved: !!config.access_token,
          verifyTokenSaved: !!config.verify_token,
          pageName: config.page_name,
        },
      });
    }

    const pageData = await graphRes.json();
    return NextResponse.json({
      connected: true,
      page_info: { id: pageData.id, name: pageData.name },
      phone_info: { verified_name: pageData.name },
      verify_token_saved: !!config.verify_token,
      saved_config: {
        pageId: config.page_id,
        appSecretSaved: !!config.app_secret,
        accessTokenSaved: !!config.access_token,
        verifyTokenSaved: !!config.verify_token,
        pageName: pageData.name,
      },
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
    const pageId = (phone_number_id || '').trim();
    const appSecretInput = (waba_id || '').trim();

    if (!pageId) {
      return NextResponse.json(
        { error: 'Facebook Page ID is required' },
        { status: 400 }
      );
    }

    // Check if there is already a saved config for this account
    const { data: existing } = await supabase
      .from('messenger_config')
      .select('id')
      .or(`account_id.eq.${accountId},user_id.eq.${user.id}`)
      .maybeSingle();

    // First-time setup requires the access token
    if (!access_token && !existing) {
      return NextResponse.json(
        { error: 'Facebook Page ID and Page Access Token are required for initial setup.' },
        { status: 400 }
      );
    }

    let pageData: { name?: string } = {};
    const baseRow: Record<string, unknown> = {
      page_id: pageId,
      updated_at: new Date().toISOString(),
    };

    if (appSecretInput) {
      baseRow.app_secret = appSecretInput;
    }

    // Only verify & encrypt a new access token if one was supplied
    if (access_token && access_token.trim()) {
      const graphRes = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}?fields=id,name&access_token=${access_token.trim()}`
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

      pageData = await graphRes.json();
      baseRow.page_name = pageData.name || null;
      baseRow.access_token = encrypt(access_token.trim());
      baseRow.status = 'connected';
      baseRow.connected_at = new Date().toISOString();
    }

    // Only overwrite verify_token if a new one was explicitly provided
    if (verify_token && verify_token.trim()) {
      baseRow.verify_token = encrypt(verify_token.trim());
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('messenger_config')
        .update(baseRow)
        .eq('id', existing.id);

      if (updateError) {
        console.error('Error updating messenger_config:', updateError);
        return NextResponse.json({ error: 'Failed to update Messenger configuration' }, { status: 500 });
      }
    } else {
      const { error: insertError } = await supabase
        .from('messenger_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          status: 'connected',
          connected_at: new Date().toISOString(),
          ...baseRow,
        });

      if (insertError) {
        console.error('Error inserting messenger_config:', insertError);
        return NextResponse.json({ error: 'Failed to save Messenger configuration' }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      registered: true,
      phone_info: { verified_name: pageData.name || '' },
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
      .from('messenger_config')
      .delete()
      .or(`account_id.eq.${accountId},user_id.eq.${user.id}`);

    if (error) {
      return NextResponse.json({ error: 'Failed to reset configuration' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/messenger/config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
