'use client';

import { useCallback, useEffect, useState } from 'react';
import { finance } from '@/lib/api';
import type { FundRequestRow, GrantLedgerResponse, LedgerCategoryRow } from '../types';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  under_review: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  paid: 'bg-indigo-100 text-indigo-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

interface Props {
  grantId: string;
  currency?: string;
  isEditor: boolean;
  onLedgerChange: () => void;
}

export default function FundRequestPanel({ grantId, currency = 'USD', isEditor, onLedgerChange }: Props) {
  const [requests, setRequests] = useState<FundRequestRow[]>([]);
  const [categories, setCategories] = useState<LedgerCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', vendor: '', amount: '', category_id: '' });
  const [compliance, setCompliance] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      finance.listFundRequests(grantId),
      finance.getLedger(grantId),
    ])
      .then(([reqRes, ledgerRes]) => {
        setRequests(reqRes.data);
        setCategories((ledgerRes.data as GrantLedgerResponse).categories);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [grantId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!form.title || isNaN(amount) || amount <= 0) return;
    setSaving(true);
    try {
      const body = {
        title: form.title,
        description: form.description || null,
        vendor: form.vendor || null,
        amount,
        currency,
        category_id: form.category_id || null,
      };
      const comp = await finance.aiCompliance(grantId, body);
      setCompliance(comp.data);
      if (comp.data.approved === false && (comp.data.issues as unknown[])?.length) {
        const proceed = confirm(
          `Compliance check flagged issues. Submit anyway?\n${(comp.data.issues as { message: string }[]).map(i => i.message).join('\n')}`
        );
        if (!proceed) {
          setSaving(false);
          return;
        }
      }
      await finance.createFundRequest(grantId, body);
      setShowForm(false);
      setForm({ title: '', description: '', vendor: '', amount: '', category_id: '' });
      setCompliance(null);
      load();
      onLedgerChange();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(msg || 'Failed to submit request.');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await finance.approveFundRequest(grantId, id);
      load();
      onLedgerChange();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(msg || 'Approval failed.');
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt('Rejection reason (optional):');
    try {
      await finance.rejectFundRequest(grantId, id, reason || undefined);
      load();
      onLedgerChange();
    } catch {
      alert('Rejection failed.');
    }
  };

  const handleMarkPaid = async (id: string) => {
    try {
      await finance.updateFundRequest(grantId, id, { status: 'paid' });
      load();
      onLedgerChange();
    } catch {
      alert('Failed to mark as paid.');
    }
  };

  const suggestCategory = async () => {
    if (!form.title) return;
    try {
      const res = await finance.aiCategorize(grantId, {
        title: form.title,
        description: form.description,
        vendor: form.vendor,
        amount: parseFloat(form.amount) || 0,
      });
      if (res.data.category_id) {
        setForm(f => ({ ...f, category_id: res.data.category_id as string }));
      }
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-sm text-gray-400">Loading requests…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-600">{requests.length} fund request{requests.length !== 1 ? 's' : ''}</p>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
        >
          {showForm ? 'Cancel' : 'New request'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 space-y-3">
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Title *"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            required
          />
          <textarea
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
            rows={2}
            placeholder="Description"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              placeholder="Vendor"
              value={form.vendor}
              onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
            />
            <input
              type="number"
              step="0.01"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              placeholder={`Amount (${currency}) *`}
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              required
            />
          </div>
          <div className="flex gap-2">
            <select
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.category_id}
              onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
            >
              <option value="">Select category</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} (avail. {c.available_amount.toLocaleString()})
                </option>
              ))}
            </select>
            <button type="button" onClick={suggestCategory} className="text-xs px-2 py-1 border border-gray-200 rounded-lg hover:bg-white">
              AI suggest
            </button>
          </div>
          {compliance && (
            <p className="text-xs text-indigo-600">Compliance score: {String(compliance.score ?? '—')}</p>
          )}
          <button type="submit" disabled={saving} className="text-xs px-4 py-2 bg-emerald-600 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Submitting…' : 'Submit for approval'}
          </button>
        </form>
      )}

      <div className="space-y-2">
        {requests.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No fund requests yet.</p>
        ) : (
          requests.map(r => {
            const cat = categories.find(c => c.id === r.category_id);
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">{r.title}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {r.currency} {r.amount.toLocaleString()}
                      {cat && <> · {cat.name}</>}
                      {r.vendor && <> · {r.vendor}</>}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_STYLES[r.status] ?? STATUS_STYLES.pending}`}>
                    {r.status.replace('_', ' ')}
                  </span>
                </div>
                {isEditor && (r.status === 'pending' || r.status === 'under_review') && (
                  <div className="flex gap-2 mt-3">
                    <button type="button" onClick={() => handleApprove(r.id)} className="text-xs px-3 py-1 bg-emerald-600 text-white rounded-lg">
                      Approve
                    </button>
                    <button type="button" onClick={() => handleReject(r.id)} className="text-xs px-3 py-1 border border-red-200 text-red-600 rounded-lg">
                      Reject
                    </button>
                  </div>
                )}
                {isEditor && r.status === 'approved' && (
                  <button type="button" onClick={() => handleMarkPaid(r.id)} className="text-xs px-3 py-1 mt-3 border border-indigo-200 text-indigo-600 rounded-lg">
                    Mark paid
                  </button>
                )}
                {r.rejection_reason && (
                  <p className="text-xs text-red-600 mt-2">{r.rejection_reason}</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
