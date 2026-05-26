'use client';

import { useState } from 'react';
import { WorkspacePartner, PartnerMaterial, PARTNER_STATUSES, getStatusStyle, getStatusLabel } from './types';
import { grants } from '@/lib/api';

interface Props {
  grantId: string;
  partners: WorkspacePartner[];
  onRefresh: () => void;
}

const MATERIAL_TYPES = [
  'letter_of_support', 'budget', 'budget_justification', 'cv_biosketch',
  'institutional_profile', 'signature', 'scope_of_work', 'data_access_letter',
  'ethics_approval', 'commitment_letter', 'logo', 'partner_description', 'other',
];

const MATERIAL_STATUS_COLORS: Record<string, string> = {
  not_requested: 'bg-gray-100 text-gray-500',
  requested: 'bg-blue-100 text-blue-700',
  received: 'bg-teal-100 text-teal-700',
  needs_revision: 'bg-orange-100 text-orange-700',
  complete: 'bg-green-100 text-green-700',
  waived: 'bg-gray-100 text-gray-400',
};

export default function PartnerTracker({ grantId, partners, onRefresh }: Props) {
  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [expandedPartners, setExpandedPartners] = useState<Set<string>>(new Set());
  const [materialForms, setMaterialForms] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [partnerForm, setPartnerForm] = useState({ institution_name: '', contact_person: '', email: '', role: '' });
  const [materialForm, setMaterialForm] = useState<Record<string, { material_type: string; title: string; due_date: string }>>({});

  const toggleExpand = (id: string) => {
    setExpandedPartners((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCreatePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await grants.createWorkspacePartner(grantId, partnerForm);
      setPartnerForm({ institution_name: '', contact_person: '', email: '', role: '' });
      setShowPartnerForm(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (partner: WorkspacePartner, status: string) => {
    await grants.updateWorkspacePartner(grantId, partner.id, { status });
    onRefresh();
  };

  const handleDeletePartner = async (partner: WorkspacePartner) => {
    if (!confirm(`Remove partner "${partner.institution_name}"?`)) return;
    await grants.deleteWorkspacePartner(grantId, partner.id);
    onRefresh();
  };

  const handleAddMaterial = async (partnerId: string) => {
    const form = materialForm[partnerId];
    if (!form?.title) return;
    await grants.addPartnerMaterial(grantId, partnerId, { ...form, due_date: form.due_date || null });
    setMaterialForms((f) => ({ ...f, [partnerId]: false }));
    setMaterialForm((f) => ({ ...f, [partnerId]: { material_type: 'letter_of_support', title: '', due_date: '' } }));
    onRefresh();
  };

  const handleMaterialStatusChange = async (partner: WorkspacePartner, material: PartnerMaterial, status: string) => {
    await grants.updatePartnerMaterial(grantId, partner.id, material.id, { status });
    onRefresh();
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">Partner Materials Tracker</h2>
        <button
          onClick={() => setShowPartnerForm(true)}
          className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          + Add Partner
        </button>
      </div>

      {showPartnerForm && (
        <form onSubmit={handleCreatePartner} className="bg-indigo-50 rounded-xl border border-indigo-100 p-4 space-y-3">
          <input
            required
            placeholder="Institution name"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={partnerForm.institution_name}
            onChange={(e) => setPartnerForm((f) => ({ ...f, institution_name: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Contact person"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={partnerForm.contact_person}
              onChange={(e) => setPartnerForm((f) => ({ ...f, contact_person: e.target.value }))}
            />
            <input
              type="email"
              placeholder="Email"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={partnerForm.email}
              onChange={(e) => setPartnerForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <input
            placeholder="Role in proposal"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={partnerForm.role}
            onChange={(e) => setPartnerForm((f) => ({ ...f, role: e.target.value }))}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowPartnerForm(false)} className="text-xs text-gray-500">Cancel</button>
            <button type="submit" disabled={saving} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Partner'}
            </button>
          </div>
        </form>
      )}

      {partners.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No partners added yet. Track required partner documents and letters here.
        </div>
      ) : (
        <div className="space-y-3">
          {partners.map((partner) => (
            <div key={partner.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => toggleExpand(partner.id)} className="text-gray-400 text-xs w-4">
                  {expandedPartners.has(partner.id) ? '▾' : '▸'}
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800">{partner.institution_name}</span>
                    <select
                      value={partner.status}
                      onChange={(e) => handleStatusChange(partner, e.target.value)}
                      className={`text-xs px-2 py-0.5 rounded-full border-0 ${getStatusStyle(PARTNER_STATUSES, partner.status)}`}
                    >
                      {PARTNER_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-3 mt-0.5">
                    {partner.contact_person && <span className="text-xs text-gray-400">{partner.contact_person}</span>}
                    {partner.email && <a href={`mailto:${partner.email}`} className="text-xs text-indigo-500 hover:underline">{partner.email}</a>}
                    {partner.role && <span className="text-xs text-gray-400">{partner.role}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{partner.materials.length} materials</span>
                  <button onClick={() => handleDeletePartner(partner)} className="text-xs text-red-400 hover:text-red-600">×</button>
                </div>
              </div>

              {expandedPartners.has(partner.id) && (
                <div className="border-t border-gray-100 px-4 pb-3">
                  {partner.materials.length > 0 && (
                    <div className="space-y-1.5 mt-3">
                      {partner.materials.map((m) => (
                        <div key={m.id} className="flex items-center gap-3">
                          <span className="text-xs text-gray-600 flex-1">{m.title}</span>
                          <span className="text-xs text-gray-400">{m.material_type.replace(/_/g, ' ')}</span>
                          {m.due_date && <span className="text-xs text-gray-400">{m.due_date}</span>}
                          <select
                            value={m.status}
                            onChange={(e) => handleMaterialStatusChange(partner, m, e.target.value)}
                            className={`text-xs px-2 py-0.5 rounded-full border-0 ${MATERIAL_STATUS_COLORS[m.status] ?? 'bg-gray-100 text-gray-500'}`}
                          >
                            {['not_requested', 'requested', 'received', 'needs_revision', 'complete', 'waived'].map((s) => (
                              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                          {m.linked_file_url && (
                            <a href={m.linked_file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline">
                              File
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {materialForms[partner.id] ? (
                    <div className="mt-3 flex gap-2 items-end">
                      <select
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                        value={materialForm[partner.id]?.material_type ?? 'letter_of_support'}
                        onChange={(e) => setMaterialForm((f) => ({ ...f, [partner.id]: { ...f[partner.id], material_type: e.target.value } }))}
                      >
                        {MATERIAL_TYPES.map((t) => (
                          <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                      <input
                        placeholder="Title"
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                        value={materialForm[partner.id]?.title ?? ''}
                        onChange={(e) => setMaterialForm((f) => ({ ...f, [partner.id]: { ...f[partner.id], title: e.target.value } }))}
                      />
                      <input
                        type="date"
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                        value={materialForm[partner.id]?.due_date ?? ''}
                        onChange={(e) => setMaterialForm((f) => ({ ...f, [partner.id]: { ...f[partner.id], due_date: e.target.value } }))}
                      />
                      <button onClick={() => handleAddMaterial(partner.id)} className="text-xs px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg">Add</button>
                      <button onClick={() => setMaterialForms((f) => ({ ...f, [partner.id]: false }))} className="text-xs text-gray-400">×</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setMaterialForms((f) => ({ ...f, [partner.id]: true }));
                        setMaterialForm((f) => ({ ...f, [partner.id]: { material_type: 'letter_of_support', title: '', due_date: '' } }));
                      }}
                      className="mt-2 text-xs text-indigo-500 hover:underline"
                    >
                      + Add material
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
