'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';

// Mask used for already-saved secret fields
const MASKED = '••••••••••••••••';

type Status = 'connected' | 'disconnected' | 'unknown';

interface SavedConfig {
  pageId: string;
  appSecretSaved: boolean;
  accessTokenSaved: boolean;
  verifyTokenSaved: boolean;
  pageName?: string;
}

export function MessengerConfig() {
  const { accountId, loading: authLoading, profileLoading } = useAuth();

  // -- UI loading states --
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);

  // -- Connection status --
  const [status, setStatus] = useState<Status>('unknown');
  const [statusMsg, setStatusMsg] = useState('');
  const [pageName, setPageName] = useState('');

  // -- Form field values (plaintext while the user is editing) --
  const [pageId, setPageId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');

  // -- Track which secret fields already have a saved (masked) value --
  const [saved, setSaved] = useState<SavedConfig | null>(null);

  // -- Track which secret fields the user has touched this session --
  const [appSecretEdited, setAppSecretEdited] = useState(false);
  const [accessTokenEdited, setAccessTokenEdited] = useState(false);
  const [verifyTokenEdited, setVerifyTokenEdited] = useState(false);

  // -- Eye toggles for secret fields --
  const [showAppSecret, setShowAppSecret] = useState(false);
  const [showAccessToken, setShowAccessToken] = useState(false);

  const loadedRef = useRef<string | null>(null);
  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/messenger/webhook`
      : '';

  /** Load config from the database via the API. */
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/messenger/config', { cache: 'no-store' });
      const data = await res.json();

      if (data.saved_config) {
        const cfg: SavedConfig = data.saved_config;
        setSaved(cfg);
        setPageId(cfg.pageId || '');
        setAppSecret('');
        setAccessToken('');
        setVerifyToken('');
        setAppSecretEdited(false);
        setAccessTokenEdited(false);
        setVerifyTokenEdited(false);
      } else {
        setSaved(null);
        setPageId('');
        setAppSecret('');
        setAccessToken('');
        setVerifyToken('');
        setAppSecretEdited(false);
        setAccessTokenEdited(false);
        setVerifyTokenEdited(false);
      }

      if (data.connected) {
        setStatus('connected');
        setStatusMsg('');
        setPageName(data.page_info?.name || '');
      } else {
        setStatus('disconnected');
        setStatusMsg(data.message || '');
        setPageName('');
      }
    } catch {
      setStatus('disconnected');
      setStatusMsg('Failed to load Messenger configuration.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!accountId) {
      setLoading(false);
      return;
    }
    if (loadedRef.current === accountId) return;
    loadedRef.current = accountId;
    fetchConfig();
  }, [authLoading, profileLoading, accountId, fetchConfig]);

  /** Save configuration — only sends fields that were actually edited. */
  async function handleSave() {
    const trimmedPageId = pageId.trim();
    if (!trimmedPageId) {
      toast.error('Facebook Page ID is required.');
      return;
    }

    // For first-time setup, access token is required.
    if (!saved && !accessToken.trim()) {
      toast.error('Page Access Token is required for the initial setup.');
      return;
    }

    const payload: Record<string, string> = {
      phone_number_id: trimmedPageId,
    };

    if (accessTokenEdited && accessToken.trim()) {
      payload.access_token = accessToken.trim();
    }
    if (appSecretEdited && appSecret.trim()) {
      payload.waba_id = appSecret.trim(); // stored in waba_id column for now
    }
    if (verifyTokenEdited && verifyToken.trim()) {
      payload.verify_token = verifyToken.trim();
    }

    try {
      setSaving(true);
      const res = await fetch('/api/messenger/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to save configuration.');
        return;
      }

      toast.success(
        data.phone_info?.verified_name
          ? `Connected to ${data.phone_info.verified_name}`
          : 'Messenger configuration saved successfully.'
      );
      await fetchConfig();
    } catch {
      toast.error('Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  }

  /** Test the current API connection against Meta Graph API. */
  async function handleTest() {
    try {
      setTesting(true);
      const res = await fetch('/api/messenger/config', { cache: 'no-store' });
      const data = await res.json();

      if (data.connected) {
        setStatus('connected');
        setStatusMsg('');
        setPageName(data.page_info?.name || '');
        toast.success(`Connected to ${data.page_info?.name || 'your Facebook Page'}`);
      } else {
        setStatus('disconnected');
        setStatusMsg(data.message || '');
        toast.error(data.message || 'Connection test failed.');
      }
    } catch {
      setStatus('disconnected');
      toast.error('Connection test failed.');
    } finally {
      setTesting(false);
    }
  }

  /** Delete configuration from database. */
  async function handleReset() {
    if (!confirm('This will permanently delete the Messenger configuration. Continue?')) return;

    try {
      setResetting(true);
      const res = await fetch('/api/messenger/config', { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to reset configuration.');
        return;
      }

      toast.success('Messenger configuration cleared.');
      setSaved(null);
      setPageId('');
      setAppSecret('');
      setAccessToken('');
      setVerifyToken('');
      setStatus('disconnected');
      setStatusMsg('');
      setPageName('');
    } catch {
      toast.error('Failed to reset configuration.');
    } finally {
      setResetting(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied to clipboard');
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="Facebook Messenger Connection"
          description="Connect your Meta Facebook Page for R.F.C Messenger CRM."
        />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200 space-y-6">
      <SettingsPanelHead
        title="Facebook Messenger Connection"
        description="Connect your Meta Facebook Page to receive and reply to customer messages inside R.F.C."
      />

      {/* ---- Connection Status Banner ---- */}
      <Alert className={status === 'connected' ? 'border-green-700/40 bg-green-950/20' : 'border-border bg-card'}>
        <div className="flex items-center gap-2">
          {status === 'connected' ? (
            <CheckCircle2 className="size-4 text-green-500" />
          ) : status === 'unknown' ? (
            <AlertTriangle className="size-4 text-yellow-500" />
          ) : (
            <XCircle className="size-4 text-red-500" />
          )}
          <AlertTitle className="mb-0 text-foreground">
            {status === 'connected'
              ? `Connected${pageName ? ` — ${pageName}` : ''}`
              : 'Not Connected'}
          </AlertTitle>
          {status === 'connected' && (
            <Badge variant="outline" className="ml-auto text-green-400 border-green-700/50 text-xs">
              Live
            </Badge>
          )}
        </div>
        <AlertDescription className="mt-1 text-sm text-muted-foreground">
          {status === 'connected'
            ? 'Webhooks are active. Incoming Messenger messages will appear in your Inbox.'
            : statusMsg || 'Enter your credentials below to connect R.F.C to your Facebook Page.'}
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* ---- Left: Credentials Form ---- */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Messenger API Credentials</CardTitle>
              <CardDescription className="text-muted-foreground">
                Enter your Facebook Page credentials from the Meta Developer Dashboard.
                Secret fields show <code className="text-xs">••••</code> when already saved — leave them blank to keep the existing value.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Facebook Page ID */}
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Facebook Page ID <span className="text-red-400">*</span></Label>
                <Input
                  placeholder="e.g. 109238472938475"
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Found in your Facebook Page settings or Meta Developer App Dashboard.
                </p>
              </div>

              {/* App Secret */}
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">
                  Facebook App Secret{' '}
                  <span className="text-xs text-muted-foreground font-normal">(for webhook signature verification)</span>
                </Label>
                <div className="relative">
                  <Input
                    type={showAppSecret ? 'text' : 'password'}
                    placeholder={saved?.appSecretSaved && !appSecretEdited ? MASKED : 'e.g. 9a8b7c6d5e4f...'}
                    value={appSecret}
                    onChange={(e) => { setAppSecret(e.target.value); setAppSecretEdited(true); }}
                    onFocus={() => { if (saved?.appSecretSaved) setAppSecretEdited(true); }}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAppSecret(!showAppSecret)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showAppSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {saved?.appSecretSaved && !appSecretEdited ? (
                  <p className="text-xs text-green-500">✅ App Secret is saved.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Found in Meta App Dashboard → App Settings → Basic.
                  </p>
                )}
              </div>

              {/* Page Access Token */}
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">
                  Page Access Token <span className="text-red-400">*</span>
                </Label>
                <div className="relative">
                  <Input
                    type={showAccessToken ? 'text' : 'password'}
                    placeholder={saved?.accessTokenSaved && !accessTokenEdited ? MASKED : 'Enter your Page Access Token'}
                    value={accessToken}
                    onChange={(e) => { setAccessToken(e.target.value); setAccessTokenEdited(true); }}
                    onFocus={() => { if (saved?.accessTokenSaved) setAccessTokenEdited(true); }}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAccessToken(!showAccessToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showAccessToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {saved?.accessTokenSaved && !accessTokenEdited ? (
                  <p className="text-xs text-green-500">✅ Access Token is saved. Only re-enter to update it.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Generate in Meta App Dashboard → Messenger → API Settings.
                  </p>
                )}
              </div>

              {/* Webhook Verify Token */}
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Webhook Verify Token</Label>
                <Input
                  placeholder={saved?.verifyTokenSaved && !verifyTokenEdited ? MASKED : 'Create a custom verify token, e.g. mySecret123'}
                  value={verifyToken}
                  onChange={(e) => { setVerifyToken(e.target.value); setVerifyTokenEdited(true); }}
                  onFocus={() => { if (saved?.verifyTokenSaved) setVerifyTokenEdited(true); }}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                {saved?.verifyTokenSaved && !verifyTokenEdited ? (
                  <p className="text-xs text-green-500">✅ Verify Token is saved. Use the same value in Meta Webhook settings.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    A secret string you define — enter the exact same value in the Meta Webhook callback setup.
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground">
                  {saving ? <><Loader2 className="size-4 animate-spin mr-2" />Saving…</> : 'Save Configuration'}
                </Button>
                <Button onClick={handleTest} disabled={testing} variant="outline" className="border-border text-foreground hover:bg-muted">
                  {testing ? <><Loader2 className="size-4 animate-spin mr-2" />Testing…</> : <><Zap className="size-4 mr-2" />Test Connection</>}
                </Button>
                {saved && (
                  <Button
                    onClick={handleReset}
                    disabled={resetting}
                    variant="ghost"
                    className="text-red-400 hover:bg-red-950/20 hover:text-red-300 ml-auto"
                  >
                    <RotateCcw className="size-4 mr-1.5" />
                    Reset
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Webhook URL Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Webhook Callback URL</CardTitle>
              <CardDescription className="text-muted-foreground">
                Paste this URL into the Meta App Dashboard → Messenger → Webhooks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={webhookUrl}
                  className="bg-muted border-border text-foreground font-mono text-xs"
                />
                <Button type="button" onClick={handleCopy} variant="outline" className="shrink-0 border-border text-foreground hover:bg-muted">
                  <Copy className="size-4 mr-1" />
                  Copy
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ---- Right Sidebar: Setup Guide ---- */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-sm">Setup Guide</CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion multiple defaultValue={['step-1']} className="w-full">
                <AccordionItem value="step-1" className="border-border">
                  <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline">
                    1. Create a Meta App
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1.5 pt-1">
                    <p>• Go to <strong>developers.facebook.com</strong> → My Apps → Create App.</p>
                    <p>• Choose <strong>Business</strong> app type.</p>
                    <p>• Add the <strong>Messenger</strong> product to your app.</p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="step-2" className="border-border">
                  <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline">
                    2. Get Your Credentials
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1.5 pt-1">
                    <p>• <strong>Page ID:</strong> Facebook Page → About → Page ID.</p>
                    <p>• <strong>App Secret:</strong> App Dashboard → Settings → Basic.</p>
                    <p>• <strong>Page Access Token:</strong> Messenger → API Settings → Generate token for your Page.</p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="step-3" className="border-border">
                  <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline">
                    3. Save & Configure Webhook
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1.5 pt-1">
                    <p>• Fill in the fields on the left and click <strong>Save Configuration</strong> first.</p>
                    <p>• Then go to Messenger → Webhooks in Meta Dashboard.</p>
                    <p>• Paste the <strong>Callback URL</strong> and your <strong>Verify Token</strong>.</p>
                    <p>• Click <strong>Verify and Save</strong>.</p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="step-4" className="border-border">
                  <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline">
                    4. Subscribe to Events
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1.5 pt-1">
                    <p>• After webhook verification, click <strong>Add Subscriptions</strong>.</p>
                    <p>• Select your Page and subscribe to:</p>
                    <p>&nbsp;&nbsp;– <code>messages</code></p>
                    <p>&nbsp;&nbsp;– <code>messaging_postbacks</code></p>
                    <p>• Messages will now appear in the R.F.C Inbox in real-time! 🎉</p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="mt-4 pt-4 border-t border-border">
                <a
                  href="https://developers.facebook.com/docs/messenger-platform"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  Meta Messenger API Docs
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
