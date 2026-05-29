'use client';

import { useCallback, useEffect, useState } from 'react';
import { finance } from '@/lib/api';
import type { ExpenditureRow, GrantLedgerResponse, LedgerCategoryRow } from '../types';

interface Props {
  grantId: string;
  currency?: string;
  isEditor: boolean;
  onRefresh: () => void;
}

export default function ExpenditureLog({ grantId, currency = 'USD', isEditor, onRefresh }: Props) {
  const [items, setItems] = useState<ExpenditureRow[]>([]);
  const [categories, setCategories] = useState<LedgerCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    amount: '',
    vendor: '',
    description: '',
    category_id: '',
    expense_date: new Date().toISOString().slice(0, 10),
    receipt_url: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([finance.listExpenditures(grantId), finance.getLedger(grantId)])
      .then(([expRes, ledgerRes]) => {
        setItems(expRes.data);
        setCategories((ledgerRes.data as GrantLedgerResponse).categories);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [grantId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) return;
    try {
      await finance.createExpenditure(grantId, {
        amount,
        currency,
        vendor: form.vendor || null,
        description: form.description || null,
        category_id: form.category_id || null,
        expense_date: form.expense_date,
        receipt_url: form.receipt_url || null,
      });
      setShowForm(false);
      setForm({ amount: '', vendor: '', description: '', category_id: '', expense_date: new Date().toISOString().slice(0, 10), receipt_url: '' });
      load();
      onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(msg || 'Failed to record expenditure.');
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-sm text-gray-400">Loading expenditures…</div>;
  }

  return (
    <div className="space-y-4">
      {isEditor && (
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
        >
          {showForm ? 'Cancel' : 'Record expenditure'}
        </button>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              step="0.01"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              placeholder={`Amount (${currency})`}
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              required
            />
            <input
              type="date"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.expense_date}
              onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))}
            />
          </div>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Vendor"
            value={form.vendor}
            onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
          />
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={form.category_id}
            onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
          >
            <option value="">Category (optional)</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <textarea
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
            rows={2}
            placeholder="Description"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          />
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Receipt URL"
            value={form.receipt_url}
            onChange={e => setForm(f => ({ ...f, receipt_url: e.target.value }))}
          />
          <button type="submit" className="text-xs px-4 py-2 bg-emerald-600 text-white rounded-lg">Save</button>
        </form>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 border-b">
              <th className="text-left py-2 px-3">Date</th>
              <th className="text-left py-2 px-3">Description</th>
              <th className="text-left py-2 px-3">Vendor</th>
              <th className="text-right py-2 px-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={4} className="py-8 text-center text-gray-400">No expenditures recorded.</td></tr>
            ) : (
              items.map(e => (
                <tr key={e.id} className="border-b border-gray-50">
                  <td className="py-2 px-3 text-gray-600">{e.expense_date || '—'}</td>
                  <td className="py-2 px-3">{e.description || e.vendor || '—'}</td>
                  <td className="py-2 px-3 text-gray-500">{e.vendor || '—'}</td>
                  <td className="py-2 px-3 text-right font-medium tabular-nums">
                    {e.currency} {e.amount.toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
