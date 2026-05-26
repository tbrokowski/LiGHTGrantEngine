'use client';

import { useState, useRef, useEffect } from 'react';
import { grants } from '@/lib/api';

const STATUS_GROUPS = [
  {
    label: 'Pipeline',
    items: [
      { value: 'scoping', label: 'Scoping' },
      { value: 'go_no_go_pending', label: 'Go / No-Go Pending' },
      { value: 'concept_note_drafting', label: 'Concept Note Drafting' },
      { value: 'full_proposal_drafting', label: 'Full Proposal Drafting' },
      { value: 'budget_drafting', label: 'Budget Drafting' },
      { value: 'partner_confirmation', label: 'Partner Confirmation' },
    ],
  },
  {
    label: 'Review',
    items: [
      { value: 'internal_review', label: 'Internal Review' },
      { value: 'pi_review', label: 'PI Review' },
      { value: 'institutional_approval', label: 'Institutional Approval' },
      { value: 'ready_for_submission', label: 'Ready for Submission' },
    ],
  },
  {
    label: 'Submitted',
    items: [
      { value: 'submitted', label: 'Submitted' },
      { value: 'under_review', label: 'Under Review' },
    ],
  },
  {
    label: 'Concluded',
    items: [
      { value: 'awarded', label: 'Awarded' },
      { value: 'rejected', label: 'Rejected' },
      { value: 'deferred', label: 'Deferred' },
      { value: 'withdrawn', label: 'Withdrawn' },
      { value: 'closed', label: 'Closed' },
    ],
  },
];

const STATUS_STYLES: Record<string, { badge: string; dot: string }> = {
  scoping:                  { badge: 'bg-gray-100 text-gray-700',        dot: 'bg-gray-400' },
  go_no_go_pending:         { badge: 'bg-amber-50 text-amber-700',       dot: 'bg-amber-400' },
  concept_note_drafting:    { badge: 'bg-sky-50 text-sky-700',           dot: 'bg-sky-400' },
  full_proposal_drafting:   { badge: 'bg-blue-50 text-blue-700',         dot: 'bg-blue-500' },
  budget_drafting:          { badge: 'bg-violet-50 text-violet-700',     dot: 'bg-violet-400' },
  partner_confirmation:     { badge: 'bg-orange-50 text-orange-700',     dot: 'bg-orange-400' },
  internal_review:          { badge: 'bg-purple-50 text-purple-700',     dot: 'bg-purple-500' },
  pi_review:                { badge: 'bg-fuchsia-50 text-fuchsia-700',   dot: 'bg-fuchsia-400' },
  institutional_approval:   { badge: 'bg-teal-50 text-teal-700',         dot: 'bg-teal-400' },
  ready_for_submission:     { badge: 'bg-lime-50 text-lime-700',         dot: 'bg-lime-500' },
  submitted:                { badge: 'bg-green-50 text-green-700',       dot: 'bg-green-500' },
  under_review:             { badge: 'bg-cyan-50 text-cyan-700',         dot: 'bg-cyan-500' },
  awarded:                  { badge: 'bg-emerald-50 text-emerald-700',   dot: 'bg-emerald-500' },
  rejected:                 { badge: 'bg-red-50 text-red-700',           dot: 'bg-red-500' },
  deferred:                 { badge: 'bg-yellow-50 text-yellow-700',     dot: 'bg-yellow-400' },
  withdrawn:                { badge: 'bg-gray-100 text-gray-500',        dot: 'bg-gray-400' },
  closed:                   { badge: 'bg-gray-100 text-gray-400',        dot: 'bg-gray-300' },
};

function getStyle(status: string) {
  return STATUS_STYLES[status] ?? { badge: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };
}

function getLabel(status: string): string {
  for (const group of STATUS_GROUPS) {
    const found = group.items.find((i) => i.value === status);
    if (found) return found.label;
  }
  return status.replace(/_/g, ' ');
}

interface Props {
  grantId: string;
  status: string;
  onStatusChange: (newStatus: string) => void;
  readOnly?: boolean;
}

export default function StatusDropdown({ grantId, status, onStatusChange, readOnly = false }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = async (newStatus: string) => {
    if (readOnly || newStatus === status) { setOpen(false); return; }
    setSaving(true);
    setOpen(false);
    onStatusChange(newStatus); // optimistic
    try {
      await grants.update(grantId, { status: newStatus });
    } catch {
      onStatusChange(status); // revert on error
    } finally {
      setSaving(false);
    }
  };

  const style = getStyle(status);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !readOnly && setOpen((o) => !o)}
        disabled={saving || readOnly}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-opacity ${style.badge} ${saving ? 'opacity-60' : readOnly ? 'cursor-default' : 'hover:opacity-80 cursor-pointer'} select-none`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
        {getLabel(status)}
        <svg className="w-3 h-3 opacity-60" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 8L2 4h8L6 8z" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-lg w-64 py-1 overflow-hidden">
          {STATUS_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {group.label}
              </p>
              {group.items.map((item) => {
                const s = getStyle(item.value);
                const isActive = item.value === status;
                return (
                  <button
                    key={item.value}
                    onClick={() => handleSelect(item.value)}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors ${
                      isActive ? 'bg-gray-50 font-medium' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                    <span className="text-gray-800">{item.label}</span>
                    {isActive && (
                      <svg className="w-3.5 h-3.5 ml-auto text-indigo-600" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l3.5 3.5L13 4.5" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
