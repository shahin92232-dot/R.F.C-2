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
  AlertTriangle,
  RotateCcw,
  MessageSquare,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';

const MASKED_TOKEN = '••••••••••••••••';
type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';

export function MessengerConfig() {
  const t = useTranslations('Settings.whatsapp');
  const supabase = createClient();
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [pageInfo, setPageInfo] = useState<{ id?: string; name?: string } | null>(null);

  const [phoneNumberId, setPhoneNumberId] = useState(''); // Facebook Page ID
  const [appId, setAppId] = useState(''); // Facebook App ID
  const [wabaId, setWabaId] = useState(''); // Meta App Secret
  const [accessToken, setAccessToken] = useState(''); // Page Access Token
  const [verifyToken, setVerifyToken] = useState(''); // Webhook Verify Token
  const [tokenEdited, setTokenEdited] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);
  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/messenger/webhook` : '';

  const fetchConfig = useCallback(async (acctId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', acctId)
        .maybeSingle();

      if (error) console.error('Failed to load config row:', error);

      if (data) {
        setPhoneNumberId(data.phone_number_id || '');
        setAppId(data.business_account_id || data.app_id || '');
        setWabaId(data.waba_id || '');
        setAccessToken(MASKED_TOKEN);
        setVerifyToken('');
        setTokenEdited(false);
      } else {
        setPhoneNumberId('');
        setAppId('');
        setWabaId('');
        setAccessToken('');
        setVerifyToken('');
        setTokenEdited(false);
      }

      if (data) {
        try {
          const res = await fetch('/api/messenger/config', { method: 'GET' });
          const payload = await res.json();

          if (payload.connected) {
            setConnectionStatus('connected');
            setStatusMessage('');
            setPageInfo(payload.page_info || payload.phone_info || null);
          } else {
            setConnectionStatus('disconnected');
            setStatusMessage(payload.message || '');
            setPageInfo(null);
          }
        } catch (err) {
          console.error('Messenger health check failed:', err);
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
        setStatusMessage('');
        setPageInfo(null);
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error('Failed to load Messenger configuration');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleSave() {
    if (!phoneNumberId.trim()) {
      toast.error('Facebook Page ID is required');
      return;
    }

    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        phone_number_id: phoneNumberId.trim(),
        app_id: appId.trim() || null,
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || undefined,
      };

      // Only send access_token to the server if the user actually typed it in.
      // If the field still shows the masked placeholder, omit it so the server
      // keeps the previously-encrypted token.
      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      }

      const res = await fetch('/api/messenger/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to save configuration');
        setSaving(false);
        return;
      }

      toast.success(
        data.phone_info?.verified_name
          ? `Connected to Facebook Page: ${data.phone_info.verified_name}`
          : 'Facebook Messenger connected successfully'
      );

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/messenger/config', { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setStatusMessage('');
        setPageInfo(payload.page_info || payload.phone_info || null);
        toast.success(
          payload.page_info?.name || payload.phone_info?.verified_name
            ? `Connected to ${payload.page_info?.name || payload.phone_info?.verified_name}`
            : 'Meta Graph API connection verified'
        );
      } else {
        setConnectionStatus('disconnected');
        setStatusMessage(payload.message || '');
        setPageInfo(null);
        toast.error(payload.message || 'API connection failed');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('Connection test failed');
    } finally {
      setTesting(false);
    }
  }

  async function handleReset() {
    if (!confirm('This will delete the current Messenger configuration. Continue?')) {
      return;
    }

    try {
      setResetting(true);
      const res = await fetch('/api/messenger/config', { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to reset configuration');
        return;
      }

      toast.success('Messenger configuration cleared');
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setTokenEdited(false);
      setConnectionStatus('disconnected');
      setStatusMessage('');
      setPageInfo(null);
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Failed to reset configuration');
    } finally {
      setResetting(false);
    }
  }

  function handleCopyWebhookUrl() {
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
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Facebook Messenger Connection"
        description="Connect your Meta Facebook Page for R.F.C Messenger CRM. Credentials, webhook, and setup steps live here."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Main config form */}
        <div className="space-y-6">
          {/* Connection Status */}
          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              {connectionStatus === 'connected' ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <AlertTitle className="text-foreground mb-0">
                {connectionStatus === 'connected' ? 'Facebook Page Connected' : 'Not Connected'}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground mt-1 text-sm">
              {connectionStatus === 'connected'
                ? `Connected to Meta Messenger Platform${pageInfo?.name ? `: ${pageInfo.name}` : ''}. Webhooks are active.`
                : statusMessage || 'Configure your Facebook Page credentials below to connect R.F.C Messenger CRM.'}
            </AlertDescription>
          </Alert>

          {/* API Credentials Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Facebook Messenger API Credentials</CardTitle>
              <CardDescription className="text-muted-foreground">
                Enter your Meta Facebook Page credentials.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Facebook Page ID</Label>
                <Input
                  placeholder="e.g. 109238472938475"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Facebook App Secret (For Webhooks)</Label>
                <Input
                  placeholder="e.g. 9a8b7c6d5e4f..."
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Page Access Token</Label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    placeholder="Enter your Facebook Page Access Token"
                    value={accessToken}
                    onChange={(e) => {
                      setAccessToken(e.target.value);
                      setTokenEdited(true);
                    }}
                    onFocus={() => {
                      if (accessToken === MASKED_TOKEN) {
                        setAccessToken('');
                        setTokenEdited(true);
                      }
                    }}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {!tokenEdited && accessToken === MASKED_TOKEN && (
                  <p className="text-xs text-muted-foreground">
                    Token is hidden for security. Re-enter it to update configuration.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Webhook Verify Token</Label>
                <Input
                  placeholder="Create a custom verify token"
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  A custom string you set in Meta Messenger webhook settings.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-4">
                <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground">
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" />
                      Saving...
                    </>
                  ) : (
                    'Save Configuration'
                  )}
                </Button>
                <Button
                  onClick={handleTestConnection}
                  disabled={testing}
                  variant="outline"
                  className="border-border text-foreground hover:bg-muted"
                >
                  {testing ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <Zap className="size-4 mr-2" />
                      Test API Connection
                    </>
                  )}
                </Button>
                {connectionStatus === 'connected' && (
                  <Button
                    onClick={handleReset}
                    disabled={resetting}
                    variant="ghost"
                    className="text-red-400 hover:bg-red-950/20 hover:text-red-300 ml-auto"
                  >
                    <RotateCcw className="size-4 mr-1" />
                    Reset
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Webhook Configuration Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Messenger Webhook Configuration</CardTitle>
              <CardDescription className="text-muted-foreground">
                Use this URL as your Messenger webhook callback in Meta App Dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Webhook Callback URL</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={webhookUrl}
                    className="bg-muted border-border text-foreground font-mono text-xs"
                  />
                  <Button
                    type="button"
                    onClick={handleCopyWebhookUrl}
                    variant="outline"
                    className="shrink-0 border-border text-foreground hover:bg-muted"
                  >
                    <Copy className="size-4 mr-1" />
                    Copy
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Sidebar: Meta Setup Guide */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">Setup Instructions</CardTitle>
              <CardDescription className="text-muted-foreground text-xs">
                Follow these steps to connect your Facebook Page to R.F.C Messenger CRM.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion defaultValue={['step-1']} className="w-full">
                <AccordionItem value="step-1" className="border-border">
                  <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline">
                    1. Create or Select Facebook Page
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1.5 pt-1">
                    <p>• Create or use an existing Facebook Page for R.F.C.</p>
                    <p>• Open developers.facebook.com and create a Meta App.</p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="step-2" className="border-border">
                  <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline">
                    2. Add Messenger Product
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1.5 pt-1">
                    <p>• In App Dashboard, add the Messenger product.</p>
                    <p>• Generate a Page Access Token for your Facebook Page.</p>
                    <p>• Copy Page ID and Page Access Token.</p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="step-3" className="border-border">
                  <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline">
                    3. Configure Webhooks
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1.5 pt-1">
                    <p>• Paste your Callback URL and Verify Token in Meta App Dashboard &gt; Messenger &gt; Webhooks.</p>
                    <p>• Subscribe to <code>messages</code> and <code>messaging_postbacks</code> fields.</p>
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
                  Meta Messenger API Documentation
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
