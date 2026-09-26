'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Mail } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';
import PartnerForm, { PartnerFormData } from '@/components/crm/PartnerForm';
import CommandPalette from '@/components/crm/CommandPalette';
import AddFromEmailsModal from '@/components/crm/AddFromEmailsModal';
import NewTaskModal from '@/components/crm/NewTaskModal';
import GroupFormModal from '@/components/crm/GroupFormModal';
import AddToGroupModal from '@/components/crm/AddToGroupModal';
import CrmModal from '@/components/crm/CrmModal';
import { btnOutline } from '@/components/crm/crmUi';
import { MyTasksCard } from '@/components/crm/home/HomeCards';
import PeoplePanel from '@/components/crm/home/PeoplePanel';
import GroupsPanel from '@/components/crm/home/GroupsPanel';

type Modal =
  | null
  | { kind: 'palette' }
  | { kind: 'emails' }
  | { kind: 'task' }
  | { kind: 'person' }
  | { kind: 'group'; partnerIds?: string[] }
  | { kind: 'addToGroup'; partnerIds: string[] };

function PartnersHome() {
  const router = useRouter();
  const [counts, setCounts] = useState<{ people: number; groups: number } | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadCounts = useCallback(() => { partnersApi.home().then(r => setCounts(r.data.counts)).catch(() => {}); }, []);
  useEffect(() => { loadCounts(); }, [loadCounts, refreshKey]);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setModal(m => m?.kind === 'palette' ? null : { kind: 'palette' }); return; }
      const el = e.target as HTMLElement;
      if (e.key === 't' && !e.metaKey && !e.ctrlKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        setModal({ kind: 'task' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function createPerson(data: PartnerFormData) {
    const res = await partnersApi.create(data as unknown as Record<string, unknown>);
    setModal(null);
    if (res.data?.id) router.push(`/partners/${res.data.id}`);
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try { await partnersApi.importCsv(file); refresh(); } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-base)' }}>
      <header className="px-7 py-4 flex items-center justify-between gap-4 shrink-0" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>Partners</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {counts ? <><span className="mono-data">{counts.people}</span> people · <span className="mono-data">{counts.groups}</span> groups</> : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setModal({ kind: 'palette' })}
            className="hidden md:flex items-center gap-2.5 h-9 px-3 w-72 text-[13px]"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)', color: 'var(--ink-muted)' }}>
            <Search className="w-3.5 h-3.5" />
            <span className="flex-1 text-left">Jump to a person, group, task…</span>
            <kbd className="mono-data text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-sunken)' }}>⌘K</kbd>
          </button>
          <button type="button" onClick={() => setModal({ kind: 'emails' })} className="flex items-center gap-2 h-9 px-3.5 text-[13px] font-medium" style={btnOutline}
            title="Paste a list of emails — each contact is looked up online and their profile filled in">
            <Mail className="w-3.5 h-3.5" /><span className="hidden sm:inline">Add from emails</span>
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-5 flex flex-col gap-5">
        <MyTasksCard refreshKey={refreshKey} onNewTask={() => setModal({ kind: 'task' })} onChanged={() => {}} />

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:h-[760px] shrink-0">
          <div className="lg:col-span-7 min-h-0 flex flex-col">
            <PeoplePanel
              refreshKey={refreshKey}
              importing={importing}
              onImport={() => fileRef.current?.click()}
              onAddPerson={() => setModal({ kind: 'person' })}
              onAddToGroup={ids => setModal({ kind: 'addToGroup', partnerIds: ids })}
              onChanged={refresh}
            />
          </div>
          <div className="lg:col-span-5 min-h-0 flex flex-col">
            <GroupsPanel refreshKey={refreshKey} onNewGroup={() => setModal({ kind: 'group' })} />
          </div>
        </section>
      </div>

      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} />

      {modal?.kind === 'palette' && <CommandPalette onClose={() => setModal(null)} onNewPartner={() => setModal({ kind: 'person' })} />}
      {modal?.kind === 'emails' && <AddFromEmailsModal onClose={() => setModal(null)} onChanged={refresh} />}
      {modal?.kind === 'task' && <NewTaskModal onClose={() => setModal(null)} onCreated={refresh} />}
      {modal?.kind === 'group' && (
        <GroupFormModal
          partnerIds={modal.partnerIds}
          onClose={() => setModal(null)}
          onSaved={id => router.push(`/partners/groups/${id}${modal.partnerIds?.length ? '' : '?add=1'}`)}
        />
      )}
      {modal?.kind === 'addToGroup' && (
        <AddToGroupModal
          partnerIds={modal.partnerIds}
          onClose={() => setModal(null)}
          onDone={refresh}
          onNewGroup={() => setModal({ kind: 'group', partnerIds: modal.partnerIds })}
        />
      )}
      {modal?.kind === 'person' && (
        <CrmModal title="New partner" onClose={() => setModal(null)} width="max-w-2xl">
          <div className="px-6 py-5">
            <PartnerForm onSubmit={createPerson} onCancel={() => setModal(null)} submitLabel="Create partner" />
          </div>
        </CrmModal>
      )}
    </div>
  );
}

export default function PartnersPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24 text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>}>
      <PartnersHome />
    </Suspense>
  );
}
