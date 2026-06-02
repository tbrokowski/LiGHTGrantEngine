'use client';

import { useCallback, useEffect, useState } from 'react';
import { finance } from '@/lib/api';

interface Props {
  grantId: string;
  isEditor: boolean;
}

export default function SlackSetupPanel({ grantId, isEditor }: Props) {
  const [config, setConfig] = useState<{
    slack_channel_id: string;
    slack_channel_name?: string;
    is_active: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channelId, setChannelId] = useState('');
  const [channelName, setChannelName] = useState('');

  const load = useCallback(() => {
    finance.getSlackConfig(grantId)
      .then(r => {
        const c = r.data;
        setConfig(c);
        if (c) {
          setChannelId(c.slack_channel_id || '');
          setChannelName(c.slack_channel_name || '');
        }
      })
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, [grantId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelId.trim()) return;
    setSaving(true);
    try {
      await finance.upsertSlackConfig(grantId, {
        slack_channel_id: channelId.trim(),
        slack_channel_name: channelName.trim() || null,
        is_active: true,
      });
      load();
    } catch {
      alert('Failed to save Slack config.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-8 text-sm text-gray-400 text-center">Loading…</div>;
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-medium mb-2">Slack setup</p>
        <ol className="list-decimal list-inside space-y-1 text-xs text-blue-700">
          <li>Create a Slack App at api.slack.com with Bot Token and Signing Secret</li>
          <li>Set Interactivity URL to your API: <code className="bg-blue-100 px-1 rounded">/api/v1/slack/interactive</code></li>
          <li>Add <code className="bg-blue-100 px-1 rounded">SLACK_BOT_TOKEN</code> and <code className="bg-blue-100 px-1 rounded">SLACK_SIGNING_SECRET</code> to server env</li>
          <li>Invite the bot to your channel and paste the channel ID below</li>
        </ol>
      </div>

      {config?.is_active && (
        <p className="text-sm text-emerald-700">
          Linked to {config.slack_channel_name || config.slack_channel_id}
        </p>
      )}

      {isEditor ? (
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Slack Channel ID</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
              placeholder="C0123456789"
              value={channelId}
              onChange={e => setChannelId(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Channel name (display)</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              placeholder="#grant-finance"
              value={channelName}
              onChange={e => setChannelName(e.target.value)}
            />
          </div>
          <button type="submit" disabled={saving} className="text-xs px-4 py-2 bg-emerald-600 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Slack link'}
          </button>
        </form>
      ) : (
        <p className="text-sm text-gray-500">Only editors can configure Slack.</p>
      )}
    </div>
  );
}
