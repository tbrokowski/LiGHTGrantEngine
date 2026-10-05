'use client';
import { useEffect, useRef, useState } from 'react';
import { organizations, MyOrganization } from '@/lib/api';

// Every organization the user belongs to: switch between them, leave one, or
// join another with an access code from that organization's admin.

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  grant_lead: 'Grant Lead',
  operations_manager: 'Operations Manager',
  reviewer: 'Reviewer',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

function errorDetail(err: unknown, fallback: string) {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

// Switching changes what every page shows, so reload rather than patch state.
function reloadInto(path = '/settings?tab=organizations') {
  window.location.assign(path);
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-base)',
  color: 'var(--ink-primary)',
  fontSize: '12px',
  fontWeight: 500,
  padding: '4px 10px',
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--accent-primary)',
  borderColor: 'var(--accent-primary)',
  color: 'var(--ink-inverse)',
  fontSize: '13px',
  padding: '6px 14px',
};

export function OrganizationsPanel() {
  const [orgs, setOrgs] = useState<MyOrganization[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);

  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    organizations.mine()
      .then(res => setOrgs(res.data))
      .catch(() => setLoadError('Could not load your organizations.'));
  }, []);

  useEffect(() => {
    if (joining) codeInput.current?.focus();
  }, [joining]);

  async function handleSwitch(id: string) {
    setBusyId(id);
    setRowError(null);
    try {
      await organizations.switchTo(id);
      reloadInto();
    } catch (err) {
      setRowError({ id, message: errorDetail(err, 'Could not switch organization.') });
      setBusyId(null);
    }
  }

  async function handleLeave(id: string) {
    setBusyId(id);
    setRowError(null);
    try {
      await organizations.leave(id);
      reloadInto();
    } catch (err) {
      setRowError({ id, message: errorDetail(err, 'Could not leave organization.') });
      setBusyId(null);
      setConfirmLeaveId(null);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.replace(/\s+/g, '').toUpperCase();
    if (trimmed.length !== 6) {
      setJoinError('Access codes are 6 characters.');
      return;
    }
    setJoinBusy(true);
    setJoinError('');
    try {
      await organizations.joinByCode(trimmed);
      reloadInto();
    } catch (err) {
      setJoinError(errorDetail(err, 'Could not join with that code.'));
      setJoinBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-end justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Your organizations</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            You see one organization at a time. Switch to work in another.
          </p>
        </div>
        {!joining && (
          <button type="button" onClick={() => setJoining(true)} style={primaryButtonStyle}>
            Join an organization
          </button>
        )}
      </div>

      {joining && (
        <form
          onSubmit={handleJoin}
          className="mb-6 py-4"
          style={{ borderTop: '1px solid var(--rule-subtle)', borderBottom: '1px solid var(--rule-subtle)' }}
        >
          <label htmlFor="org-access-code" className="ledger-label block mb-2">Access code</label>
          <p className="text-xs mb-3" style={{ color: 'var(--ink-muted)' }}>
            Ask an admin of the organization for its 6-character code. Codes last 72 hours.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              id="org-access-code"
              ref={codeInput}
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="ABC123"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(joinError)}
              className="font-mono tabular-nums tracking-[0.3em] uppercase"
              style={{
                width: '9.5rem',
                border: '1px solid var(--rule-strong)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-sunken)',
                color: 'var(--ink-primary)',
                fontSize: '16px',
                padding: '6px 10px',
                outline: 'none',
              }}
            />
            <button type="submit" disabled={joinBusy || code.length !== 6} style={{ ...primaryButtonStyle, opacity: joinBusy || code.length !== 6 ? 0.5 : 1 }}>
              {joinBusy ? 'Joining…' : 'Join'}
            </button>
            <button
              type="button"
              onClick={() => { setJoining(false); setCode(''); setJoinError(''); }}
              className="text-xs px-2 py-1"
              style={{ color: 'var(--ink-muted)' }}
            >
              Cancel
            </button>
          </div>
          {joinError && (
            <p role="alert" className="text-xs mt-2" style={{ color: 'var(--state-danger)' }}>{joinError}</p>
          )}
        </form>
      )}

      {loadError && <p className="text-sm" style={{ color: 'var(--state-danger)' }}>{loadError}</p>}
      {!orgs && !loadError && <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>}
      {orgs && orgs.length === 0 && (
        <p className="text-sm py-3" style={{ color: 'var(--ink-muted)', borderTop: '1px solid var(--rule-subtle)' }}>
          You&apos;re not in any organization yet. Join one with an access code.
        </p>
      )}

      {orgs && orgs.length > 0 && (
        <div style={{ borderTop: '1px solid var(--rule-subtle)' }}>
          {orgs.map(org => {
            const isAdmin = org.institution_role === 'admin' || org.role === 'admin';
            const busy = busyId === org.institution_id;
            const confirming = confirmLeaveId === org.institution_id;
            return (
              <div key={org.institution_id} className="py-3" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--ink-primary)' }}>
                        {org.name}
                      </span>
                      {org.is_active && (
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5"
                          style={{ background: 'var(--state-success-bg)', color: 'var(--state-success)', borderRadius: 'var(--radius-xs)' }}
                        >
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                      {org.is_personal ? 'Personal workspace' : (
                        <>
                          {isAdmin ? 'Admin' : ROLE_LABELS[org.role] ?? org.role}
                          {' · '}
                          <span className="font-mono tabular-nums">{org.member_count}</span>
                          {org.member_count === 1 ? ' member' : ' members'}
                        </>
                      )}
                    </div>
                  </div>

                  {!confirming && (
                    <div className="flex items-center gap-2 shrink-0">
                      {!org.is_active && (
                        <button type="button" disabled={busy} onClick={() => handleSwitch(org.institution_id)} style={buttonStyle}>
                          {busy ? 'Switching…' : 'Switch'}
                        </button>
                      )}
                      {!org.is_personal && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => { setConfirmLeaveId(org.institution_id); setRowError(null); }}
                          className="text-xs px-2 py-1"
                          style={{ color: 'var(--ink-muted)' }}
                        >
                          Leave
                        </button>
                      )}
                    </div>
                  )}

                  {confirming && (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>Leave {org.name}?</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleLeave(org.institution_id)}
                        style={{ ...buttonStyle, color: 'var(--state-danger)', borderColor: 'var(--state-danger)' }}
                      >
                        {busy ? 'Leaving…' : 'Leave'}
                      </button>
                      <button type="button" onClick={() => setConfirmLeaveId(null)} className="text-xs px-2 py-1" style={{ color: 'var(--ink-muted)' }}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                {rowError?.id === org.institution_id && (
                  <p role="alert" className="text-xs mt-2" style={{ color: 'var(--state-danger)' }}>{rowError.message}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
