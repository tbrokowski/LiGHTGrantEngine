'use client';
import { useEffect, useState, useCallback } from 'react';
import { apiKeys } from '@/lib/api';

interface KeyRow { provider: string; label: string | null; masked: string; created_at: string | null }
interface UsageRow { provider: string; model: string; prompt_tokens: number; completion_tokens: number; cost_cents: number; calls: number }
interface Usage { by_model: UsageRow[]; total_cents: number; budget_cents: number; used_cents: number }

const PROVIDER_LABELS: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic (Claude)', google: 'Google (Gemini)' };

export function ModelsPanel() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [catalog, setCatalog] = useState<{ providers: string[]; models: Record<string, string[]> } | null>(null);
  const [provider, setProvider] = useState('anthropic');
  const [keyVal, setKeyVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const [k, u, c] = await Promise.all([apiKeys.list(), apiKeys.usage(), apiKeys.catalog()]);
      setKeys(k.data); setUsage(u.data); setCatalog(c.data);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!keyVal.trim()) return;
    setSaving(true); setMsg('');
    try {
      await apiKeys.save({ provider, key: keyVal.trim() });
      setKeyVal(''); setMsg(`Saved your ${PROVIDER_LABELS[provider] ?? provider} key.`);
      await load();
    } catch { setMsg('Could not save the key.'); } finally { setSaving(false); }
  }
  async function remove(p: string) {
    if (!confirm(`Remove your ${PROVIDER_LABELS[p] ?? p} key?`)) return;
    await apiKeys.remove(p); await load();
  }

  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

  return (
    <div className="space-y-6">
      {/* API keys */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-gray-900">Your API keys</h3>
        <p className="text-sm text-gray-500 mt-0.5 mb-4">
          Add your own OpenAI, Anthropic (Claude), or Google (Gemini) key. When you run grant writing, your key is used for that provider (kept encrypted; never shown again).
        </p>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Provider</label>
            <select value={provider} onChange={e => setProvider(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2.5 py-2 bg-white">
              {(catalog?.providers ?? ['openai', 'anthropic', 'google']).map(p => (
                <option key={p} value={p}>{PROVIDER_LABELS[p] ?? p}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-gray-500 mb-1">API key</label>
            <input type="password" value={keyVal} onChange={e => setKeyVal(e.target.value)} placeholder="sk-… / claude-… / AIza…"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
          </div>
          <button onClick={save} disabled={saving || !keyVal.trim()}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save key'}
          </button>
        </div>
        {msg && <p className="text-xs text-green-600 mb-2">{msg}</p>}
        {keys.length === 0 ? (
          <p className="text-sm text-gray-400">No personal keys yet — grant writing uses the system keys.</p>
        ) : (
          <div className="space-y-1.5">
            {keys.map(k => (
              <div key={k.provider} className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg">
                <span className="text-sm text-gray-700">{PROVIDER_LABELS[k.provider] ?? k.provider}
                  <span className="text-gray-400 ml-2 font-mono text-xs">{k.masked}</span></span>
                <button onClick={() => remove(k.provider)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
              </div>
            ))}
          </div>
        )}
        {catalog && (
          <p className="text-[11px] text-gray-400 mt-3">
            Available models — {Object.entries(catalog.models).map(([p, ms]) => `${PROVIDER_LABELS[p] ?? p}: ${ms.join(', ')}`).join(' · ')}.
            Which model each writing role uses is set in config (per-agent).
          </p>
        )}
      </div>

      {/* Usage */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900">Grant-writing usage</h3>
          {usage && (
            <span className="text-sm text-gray-500">
              Last 30 days: <span className="font-semibold text-gray-800">{dollars(usage.total_cents)}</span>
              {usage.budget_cents > 0 && <> · budget {dollars(usage.used_cents)} / {dollars(usage.budget_cents)}</>}
            </span>
          )}
        </div>
        {!usage || usage.by_model.length === 0 ? (
          <p className="text-sm text-gray-400">No usage recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="py-1.5">Provider</th><th>Model</th><th className="text-right">Calls</th>
                <th className="text-right">Prompt</th><th className="text-right">Completion</th><th className="text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.by_model.map((r, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5">{PROVIDER_LABELS[r.provider] ?? r.provider}</td>
                  <td className="text-gray-600">{r.model}</td>
                  <td className="text-right tabular-nums">{r.calls}</td>
                  <td className="text-right tabular-nums text-gray-500">{r.prompt_tokens.toLocaleString()}</td>
                  <td className="text-right tabular-nums text-gray-500">{r.completion_tokens.toLocaleString()}</td>
                  <td className="text-right tabular-nums font-medium">{dollars(r.cost_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
