'use client';

import { useRef, useState, useCallback } from 'react';
import { AlertTriangle, BarChart2 } from 'lucide-react';
import { BudgetTracker, BudgetLineItem, BUDGET_STATUSES, getStatusStyle, getStatusLabel } from './types';
import { grants } from '@/lib/api';

function exportBudgetCSV(items: BudgetLineItem[], currency: string, grantTitle?: string) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Category', 'Description', 'Qty', 'Unit Cost', 'Total', 'Call Requirement', 'Compliance Note'];
  const rows = items.map((i) => [
    esc(i.category),
    esc(i.description),
    esc(i.quantity),
    esc(i.unit_cost),
    esc(i.total),
    esc(i.call_requirement_ref),
    esc(i.compliance_note),
  ]);
  const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `budget_${(grantTitle ?? 'grant').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${currency}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  grantId: string;
  budget: BudgetTracker | null;
  onRefresh: () => void;
  grantTitle?: string;
}

const BUDGET_CHECKLIST = [
  'Budget cap verified',
  'Personnel costs entered',
  'Partner budgets entered',
  'Indirect costs checked',
  'Equipment costs justified',
  'Travel costs justified',
  'Subaward rules checked',
  'Budget justification drafted',
  'Budget matches narrative',
  'Final budget approved',
];

export default function BudgetPanel({ grantId, budget, onRefresh, grantTitle }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<BudgetTracker>>({});

  // Spreadsheet import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [lineItems, setLineItems] = useState<BudgetLineItem[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // AI generation state
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [aiLineItems, setAiLineItems] = useState<BudgetLineItem[] | null>(null);
  const [complianceSummary, setComplianceSummary] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await grants.generateBudgetLineItems(grantId);
      setAiLineItems(res.data.items ?? []);
      setComplianceSummary(res.data.compliance_summary ?? null);
    } catch {
      setGenerateError('Could not generate budget. Ensure call requirements are present.');
    } finally {
      setGenerating(false);
    }
  }, [grantId]);

  const startEdit = () => {
    setForm(budget ?? {});
    setEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await grants.updateBudget(grantId, form as Record<string, unknown>);
      setEditing(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof BudgetTracker, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setParseError(null);
    setLineItems(null);
    try {
      const res = await grants.parseBudgetSpreadsheet(grantId, file);
      setLineItems(res.data.items as BudgetLineItem[]);
    } catch {
      setParseError('Could not parse the spreadsheet. Check the file format and try again.');
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const lineItemsTotal = lineItems
    ? lineItems.reduce((sum, item) => sum + (item.total ?? 0), 0)
    : null;

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">Budget Tracker</h2>
        <button
          onClick={startEdit}
          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
        >
          {budget ? 'Edit' : 'Set Up Budget'}
        </button>
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="bg-indigo-50 rounded-xl border border-indigo-100 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Requested Amount</label>
              <input
                type="number"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.requested_amount ?? ''}
                onChange={(e) => set('requested_amount', e.target.value ? parseFloat(e.target.value) : null)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Maximum Allowed</label>
              <input
                type="number"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.maximum_amount ?? ''}
                onChange={(e) => set('maximum_amount', e.target.value ? parseFloat(e.target.value) : null)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Currency</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.currency ?? 'USD'}
                onChange={(e) => set('currency', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.status ?? 'not_started'}
                onChange={(e) => set('status', e.target.value)}
              >
                {BUDGET_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Budget Spreadsheet URL</label>
            <input
              type="url"
              placeholder="https://..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.spreadsheet_url ?? ''}
              onChange={(e) => set('spreadsheet_url', e.target.value || null)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Budget Justification URL</label>
            <input
              type="url"
              placeholder="https://..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.justification_url ?? ''}
              onChange={(e) => set('justification_url', e.target.value || null)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Indirect Cost Rule</label>
            <textarea
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
              value={form.indirect_cost_rule ?? ''}
              onChange={(e) => set('indirect_cost_rule', e.target.value || null)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.cost_share_required ?? false}
              onChange={(e) => set('cost_share_required', e.target.checked)}
            />
            Cost-share required
          </label>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
              value={form.notes ?? ''}
              onChange={(e) => set('notes', e.target.value || null)}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500">Cancel</button>
            <button type="submit" disabled={saving} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : budget ? (
        <div className="space-y-4">
          {/* Status card */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500">Status</p>
              <span className={`inline-flex items-center mt-1 px-2.5 py-1 rounded-full text-xs font-medium ${getStatusStyle(BUDGET_STATUSES, budget.status)}`}>
                {getStatusLabel(BUDGET_STATUSES, budget.status)}
              </span>
            </div>
            {budget.requested_amount != null && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs text-gray-500">Requested</p>
                <p className="text-lg font-bold text-gray-800 mt-1">
                  {budget.currency} {budget.requested_amount.toLocaleString()}
                </p>
              </div>
            )}
            {budget.maximum_amount != null && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs text-gray-500">Maximum Allowed</p>
                <p className="text-lg font-bold text-gray-800 mt-1">
                  {budget.currency} {budget.maximum_amount.toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {/* Links */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-medium text-gray-700">Budget Documents</h3>
            {budget.spreadsheet_url ? (
              <a href={budget.spreadsheet_url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline flex items-center gap-1.5">
                <BarChart2 className="w-3.5 h-3.5" /> Budget Spreadsheet
              </a>
            ) : (
              <p className="text-sm text-gray-400">No spreadsheet linked</p>
            )}
            {budget.justification_url && (
              <a href={budget.justification_url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline flex items-center gap-1">
                📄 Budget Justification
              </a>
            )}
          </div>

          {/* Details */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            {budget.indirect_cost_rule && (
              <div>
                <p className="text-xs font-medium text-gray-500">Indirect Cost Rule</p>
                <p className="text-sm text-gray-700 mt-0.5">{budget.indirect_cost_rule}</p>
              </div>
            )}
            {budget.cost_share_required && (
              <p className="text-sm text-orange-600 font-medium flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Cost-share required</p>
            )}
            {budget.notes && (
              <div>
                <p className="text-xs font-medium text-gray-500">Notes</p>
                <p className="text-sm text-gray-700 mt-0.5">{budget.notes}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400 text-sm">
          No budget information added yet.
        </div>
      )}

      {/* Budget checklist */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Budget Checklist</h3>
        <div className="space-y-1">
          {BUDGET_CHECKLIST.map((item) => (
            <label key={item} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-gray-900">
              <input type="checkbox" className="rounded" />
              {item}
            </label>
          ))}
        </div>
      </div>

      {/* AI Budget Generation */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Generate from Call</h3>
            <p className="text-xs text-gray-400 mt-0.5">AI builds line items from call requirements and task effort</p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {generating ? (
              <>
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3m0 12v3M3 12h3m12 0h3" />
                </svg>
                Generating…
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 1v6M8 9v6M1 8h6M9 8h6" />
                </svg>
                Generate Budget
              </>
            )}
          </button>
        </div>

        {generateError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {generateError}
          </p>
        )}

        {aiLineItems && aiLineItems.length > 0 && (
          <div className="space-y-2">
            {complianceSummary && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                <p className="text-xs font-medium text-indigo-700 mb-0.5">Compliance Summary</p>
                <p className="text-xs text-indigo-600">{complianceSummary}</p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {aiLineItems.length} line item{aiLineItems.length !== 1 ? 's' : ''} generated
                {' · '}Total: {budget?.currency ?? 'USD'}{' '}
                {aiLineItems.reduce((s, i) => s + (i.total ?? 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <button
                onClick={() => exportBudgetCSV(aiLineItems, budget?.currency ?? 'USD', grantTitle)}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" />
                </svg>
                Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Category</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Description</th>
                    <th className="text-right py-1.5 px-2 font-medium text-gray-500">Qty</th>
                    <th className="text-right py-1.5 px-2 font-medium text-gray-500">Unit Cost</th>
                    <th className="text-right py-1.5 px-2 font-medium text-gray-500">Total</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Call Requirement</th>
                  </tr>
                </thead>
                <tbody>
                  {aiLineItems.map((item, i) => (
                    <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? '' : 'bg-gray-50'}`}>
                      <td className="py-1.5 px-2 text-gray-500 font-medium">{item.category ?? '—'}</td>
                      <td className="py-1.5 px-2 text-gray-700">
                        {item.description}
                        {item.compliance_note && (
                          <p className="text-[10px] text-indigo-500 mt-0.5">{item.compliance_note}</p>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right text-gray-600">{item.quantity ?? '—'}</td>
                      <td className="py-1.5 px-2 text-right text-gray-600">
                        {item.unit_cost != null ? item.unit_cost.toLocaleString() : '—'}
                      </td>
                      <td className="py-1.5 px-2 text-right font-semibold text-gray-800">
                        {item.total != null ? item.total.toLocaleString() : '—'}
                      </td>
                      <td className="py-1.5 px-2 text-gray-400 max-w-[160px]">
                        {item.call_requirement_ref ? (
                          <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                            {item.call_requirement_ref}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 font-semibold">
                    <td colSpan={4} className="py-1.5 px-2 text-gray-700">Grand Total</td>
                    <td className="py-1.5 px-2 text-right text-gray-900">
                      {aiLineItems.reduce((s, i) => s + (i.total ?? 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {aiLineItems && aiLineItems.length === 0 && (
          <p className="text-xs text-gray-400">No line items generated. Ensure call requirements are uploaded under Grant Editor → Call Analysis.</p>
        )}
      </div>

      {/* Spreadsheet import */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Import from Spreadsheet</h3>
          <div className="flex items-center gap-2">
            {parsing && <span className="text-xs text-gray-400">Parsing…</span>}
            <label className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 cursor-pointer">
              {lineItems ? 'Re-import' : 'Import XLSX / CSV'}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileChange}
                disabled={parsing}
              />
            </label>
          </div>
        </div>

        {parseError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {parseError}
          </p>
        )}

        {lineItems && lineItems.length === 0 && (
          <p className="text-xs text-gray-400">No line items found. Check that the file has a header row.</p>
        )}

        {lineItems && lineItems.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {lineItems.length} line item{lineItems.length !== 1 ? 's' : ''} parsed
                {lineItemsTotal ? ` · Total: ${budget?.currency ?? 'USD'} ${lineItemsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
              </p>
              <button
                onClick={() => exportBudgetCSV(lineItems, budget?.currency ?? 'USD', grantTitle)}
                className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" />
                </svg>
                Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Description</th>
                    <th className="text-left py-1.5 px-2 font-medium text-gray-500">Category</th>
                    <th className="text-right py-1.5 px-2 font-medium text-gray-500">Qty</th>
                    <th className="text-right py-1.5 px-2 font-medium text-gray-500">Unit Cost</th>
                    <th className="text-right py-1.5 px-2 font-medium text-gray-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
                      <td className="py-1.5 px-2 text-gray-700">{item.description}</td>
                      <td className="py-1.5 px-2 text-gray-500">{item.category ?? '—'}</td>
                      <td className="py-1.5 px-2 text-right text-gray-600">{item.quantity ?? '—'}</td>
                      <td className="py-1.5 px-2 text-right text-gray-600">
                        {item.unit_cost != null ? item.unit_cost.toLocaleString() : '—'}
                      </td>
                      <td className="py-1.5 px-2 text-right font-medium text-gray-800">
                        {item.total != null ? item.total.toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {lineItemsTotal != null && (
                  <tfoot>
                    <tr className="border-t border-gray-200 font-semibold">
                      <td colSpan={4} className="py-1.5 px-2 text-gray-700">Grand Total</td>
                      <td className="py-1.5 px-2 text-right text-gray-900">
                        {lineItemsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {lineItemsTotal != null && (
              <button
                onClick={() => {
                  set('requested_amount', lineItemsTotal);
                  setEditing(true);
                }}
                className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                Use total ({budget?.currency ?? 'USD'} {lineItemsTotal.toLocaleString()}) as Requested Amount
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
