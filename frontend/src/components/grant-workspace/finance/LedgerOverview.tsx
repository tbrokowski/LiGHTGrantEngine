'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { Download, Upload } from 'lucide-react';
import { finance } from '@/lib/api';
import type { GrantLedgerResponse } from '../types';

interface Props {
  grantId: string;
  grantTitle: string;
  isEditor: boolean;
  onRefresh: () => void;
}

export default function LedgerOverview({ grantId, grantTitle, isEditor, onRefresh }: Props) {
  const [data, setData] = useState<GrantLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [variance, setVariance] = useState<Record<string, unknown> | null>(null);
  const [varianceLoading, setVarianceLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    finance.getLedger(grantId)
      .then(r => setData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [grantId]);

  useEffect(() => { load(); }, [load, onRefresh]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      await finance.importSpreadsheet(grantId, file);
      load();
      onRefresh();
    } catch {
      alert('Import failed. Check file format.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleExport = async () => {
    const res = await finance.exportCsv(grantId);
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget_vs_actual_${grantId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runVariance = async () => {
    setVarianceLoading(true);
    try {
      const res = await finance.aiVariance(grantId);
      setVariance(res.data);
    } catch {
      alert('Variance analysis failed.');
    } finally {
      setVarianceLoading(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-sm text-gray-400">Loading ledger…</div>;
  }

  if (!data) {
    return <div className="py-12 text-center text-sm text-gray-400">Could not load ledger.</div>;
  }

  const { ledger, categories, summary } = data;
  const currency = ledger.currency || 'USD';
  const chartData = categories.map(c => ({
    name: c.name.length > 12 ? `${c.name.slice(0, 12)}…` : c.name,
    fullName: c.name,
    approved: c.approved_amount,
    committed: c.committed_amount,
    spent: c.spent_amount,
  }));

  const barColor = (pct: number) => (pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#10b981');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">Total Awarded</p>
          <p className="text-lg font-bold text-gray-900 mt-1">
            {ledger.total_awarded != null
              ? `${currency} ${ledger.total_awarded.toLocaleString()}`
              : '—'}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">Approved (categories)</p>
          <p className="text-lg font-bold text-gray-900 mt-1">{currency} {summary.total_approved.toLocaleString()}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500">Spent + Committed</p>
          <p className="text-lg font-bold text-gray-900 mt-1">
            {currency} {(summary.total_spent + summary.total_committed).toLocaleString()}
          </p>
        </div>
        <div className={`rounded-xl p-4 border ${
          summary.utilization_pct >= 100 ? 'bg-red-50 border-red-200' :
          summary.utilization_pct >= 80 ? 'bg-amber-50 border-amber-200' :
          'bg-emerald-50 border-emerald-200'
        }`}>
          <p className="text-xs text-gray-500">Available</p>
          <p className="text-lg font-bold mt-1">{currency} {summary.total_available.toLocaleString()}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{summary.utilization_pct}% utilized</p>
        </div>
      </div>

      {isEditor && (
        <div className="flex flex-wrap gap-2">
          <label className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 cursor-pointer flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" />
            {importing ? 'Importing…' : 'Import budget spreadsheet'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} disabled={importing} />
          </label>
          <button type="button" onClick={handleExport} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button type="button" onClick={runVariance} disabled={varianceLoading} className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {varianceLoading ? 'Analyzing…' : 'AI variance analysis'}
          </button>
        </div>
      )}

      {variance && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-sm">
          <p className="font-medium text-indigo-800 mb-1">Variance insights</p>
          <p className="text-indigo-700 text-xs">{(variance.summary as string) || JSON.stringify(variance)}</p>
        </div>
      )}

      {categories.length > 0 ? (
        <>
          <div className="bg-white border border-gray-200 rounded-xl p-4 h-72">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Budget vs actual by category</p>
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => v.toLocaleString()} labelFormatter={(_, p) => (p?.[0]?.payload as { fullName?: string })?.fullName} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="approved" name="Approved" fill="#94a3b8" radius={[2, 2, 0, 0]} />
                <Bar dataKey="committed" name="Committed" fill="#fbbf24" radius={[2, 2, 0, 0]} />
                <Bar dataKey="spent" name="Spent" radius={[2, 2, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={barColor(categories[i]?.utilization_pct ?? 0)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                  <th className="text-left py-2 px-3 font-medium">Category</th>
                  <th className="text-right py-2 px-3 font-medium">Approved</th>
                  <th className="text-right py-2 px-3 font-medium">Committed</th>
                  <th className="text-right py-2 px-3 font-medium">Spent</th>
                  <th className="text-right py-2 px-3 font-medium">Available</th>
                  <th className="text-right py-2 px-3 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2 px-3 font-medium text-gray-800">{c.name}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{c.approved_amount.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-amber-700">{c.committed_amount.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{c.spent_amount.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-emerald-700">{c.available_amount.toLocaleString()}</td>
                    <td className={`py-2 px-3 text-right tabular-nums font-medium ${
                      c.utilization_pct >= 100 ? 'text-red-600' : c.utilization_pct >= 80 ? 'text-amber-600' : 'text-gray-600'
                    }`}>
                      {c.utilization_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="text-center py-12 text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl">
          No budget categories yet. Import a funder-approved spreadsheet to get started.
        </div>
      )}
    </div>
  );
}
