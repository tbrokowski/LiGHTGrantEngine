'use client';
import { useState } from 'react';
import { auth, users } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { clearAuthSession, setAuthSession } from '@/lib/auth-cookie';

// My Profile: name, sign-in email, password, sign out, and deleting the account.
// Each section saves on its own — email and password need the current password.

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  grant_lead: 'Grant Lead',
  operations_manager: 'Operations Manager',
  reviewer: 'Reviewer',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

const MIN_PASSWORD = 8;

function errorDetail(err: unknown, fallback: string) {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-sunken)',
  color: 'var(--ink-primary)',
  fontSize: '14px',
  padding: '7px 10px',
  outline: 'none',
};

const primaryButton: React.CSSProperties = {
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-primary)',
  color: 'var(--ink-inverse)',
  fontSize: '13px',
  fontWeight: 500,
  padding: '6px 14px',
};

const secondaryButton: React.CSSProperties = {
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-base)',
  color: 'var(--ink-primary)',
  fontSize: '13px',
  fontWeight: 500,
  padding: '6px 14px',
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="py-6" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>{title}</h3>
      {description && <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

function Status({ error, success }: { error: string; success: string }) {
  if (error) return <p role="alert" className="text-xs" style={{ color: 'var(--state-danger)' }}>{error}</p>;
  if (success) return <p role="status" className="text-xs" style={{ color: 'var(--state-success)' }}>{success}</p>;
  return null;
}

export function ProfilePanel() {
  const { user, refresh } = useAuth();
  if (!user) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</p>;
  return (
    <div className="max-w-md">
      <div className="flex items-center gap-3 pb-6">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm"
          style={{ background: 'var(--accent-secondary)', color: 'var(--ink-secondary)' }}
        >
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>{user.name}</div>
          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {user.institution_role === 'admin' ? 'Admin' : ROLE_LABELS[user.role] ?? user.role}
          </div>
        </div>
      </div>
      <NameSection userId={user.id} initialName={user.name} onSaved={refresh} />
      <EmailSection email={user.email} verified={user.email_verified} hasPassword={user.has_password} onSaved={refresh} />
      <PasswordSection email={user.email} hasPassword={user.has_password} />
      <Section title="Sign out">
        <button
          type="button"
          onClick={() => { clearAuthSession(); window.location.href = '/login'; }}
          style={secondaryButton}
        >
          Sign out
        </button>
      </Section>
      <DeleteAccountSection hasPassword={user.has_password} />
    </div>
  );
}

function NameSection({ userId, initialName, onSaved }: { userId: string; initialName: string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!name.trim()) { setError('Name can’t be empty.'); return; }
    setSaving(true);
    try {
      await users.update(userId, { name: name.trim() });
      await onSaved();
      setSuccess('Name updated.');
    } catch (err) {
      setError(errorDetail(err, 'Could not update your name.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Name">
      <form onSubmit={save} className="space-y-3">
        <Field id="profile-name" label="Full name">
          <input id="profile-name" type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="name" style={inputStyle} />
        </Field>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving || name.trim() === initialName} style={{ ...primaryButton, opacity: saving || name.trim() === initialName ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save name'}
          </button>
          <Status error={error} success={success} />
        </div>
      </form>
    </Section>
  );
}

function EmailSection({ email, verified, hasPassword, onSaved }: {
  email: string; verified: boolean; hasPassword: boolean; onSaved: () => Promise<void>;
}) {
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await auth.changeEmail(newEmail.trim(), password);
      setSuccess(`Email changed. We sent a verification link to ${newEmail.trim()}.`);
      setNewEmail('');
      setPassword('');
      await onSaved();
    } catch (err) {
      setError(errorDetail(err, 'Could not change your email.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Email" description="The address you sign in with. A new address has to be verified.">
      <p className="text-sm mb-4" style={{ color: 'var(--ink-primary)' }}>
        {email}
        <span className="text-xs ml-2" style={{ color: verified ? 'var(--state-success)' : 'var(--state-warning)' }}>
          {verified ? 'Verified' : 'Not verified'}
        </span>
      </p>
      <form onSubmit={save} className="space-y-3">
        <Field id="profile-new-email" label="New email">
          <input id="profile-new-email" type="email" required value={newEmail} onChange={e => setNewEmail(e.target.value)} autoComplete="email" style={inputStyle} />
        </Field>
        {hasPassword && (
          <Field id="profile-email-password" label="Current password">
            <input id="profile-email-password" type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" style={inputStyle} />
          </Field>
        )}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving || !newEmail.trim()} style={{ ...primaryButton, opacity: saving || !newEmail.trim() ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Change email'}
          </button>
          <Status error={error} success={success} />
        </div>
      </form>
    </Section>
  );
}

function PasswordSection({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (next.length < MIN_PASSWORD) { setError(`New password must be at least ${MIN_PASSWORD} characters.`); return; }
    if (next !== confirm) { setError('New passwords don’t match.'); return; }
    setSaving(true);
    try {
      const res = await auth.changePassword(current, next);
      setAuthSession(res.data.access_token); // other sessions are now signed out; keep this one
      setSuccess('Password changed. You’ve been signed out everywhere else.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(errorDetail(err, 'Could not change your password.'));
    } finally {
      setSaving(false);
    }
  }

  async function sendSetLink() {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await auth.forgotPassword(email);
      setSuccess(`We sent a link to ${email} to set a password.`);
    } catch {
      setError('Could not send the email. Try again in a minute.');
    } finally {
      setSaving(false);
    }
  }

  if (!hasPassword) {
    return (
      <Section title="Password" description="You sign in with Google and don’t have a password yet.">
        <div className="flex items-center gap-3">
          <button type="button" onClick={sendSetLink} disabled={saving} style={secondaryButton}>
            {saving ? 'Sending…' : 'Email me a link to set one'}
          </button>
          <Status error={error} success={success} />
        </div>
      </Section>
    );
  }

  return (
    <Section title="Password" description="Changing it signs you out on every other device.">
      <form onSubmit={save} className="space-y-3">
        <Field id="profile-current-password" label="Current password">
          <input id="profile-current-password" type="password" required value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" style={inputStyle} />
        </Field>
        <Field id="profile-new-password" label={`New password (at least ${MIN_PASSWORD} characters)`}>
          <input id="profile-new-password" type="password" required value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" style={inputStyle} />
        </Field>
        <Field id="profile-confirm-password" label="Confirm new password">
          <input id="profile-confirm-password" type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" style={inputStyle} />
        </Field>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} style={{ ...primaryButton, opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Change password'}
          </button>
          <Status error={error} success={success} />
        </div>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          Forgot it? <button type="button" onClick={sendSetLink} className="underline">Email me a reset link</button>
        </p>
      </form>
    </Section>
  );
}

function DeleteAccountSection({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const ready = confirmText.trim().toUpperCase() === 'DELETE' && (!hasPassword || password.length > 0);

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setDeleting(true);
    setError('');
    try {
      await users.deleteMe(confirmText.trim(), hasPassword ? password : undefined);
      clearAuthSession();
      window.location.href = '/login';
    } catch (err) {
      setError(errorDetail(err, 'Could not delete your account.'));
      setDeleting(false);
    }
  }

  return (
    <section className="py-6" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--state-danger)' }}>Delete account</h3>
      <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
        Removes your name, email, password and connected accounts, and takes you out of every organization.
        Grants, comments and other work you shared with an organization stay with it, marked “Deleted user”.
        You can sign up again later with the same email, as a new account.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4"
          style={{ ...secondaryButton, color: 'var(--state-danger)', borderColor: 'var(--state-danger)' }}
        >
          Delete my account…
        </button>
      ) : (
        <form
          onSubmit={handleDelete}
          className="mt-4 p-4 space-y-3"
          style={{ background: 'var(--state-danger-bg)', borderRadius: 'var(--radius-sm)' }}
        >
          <Field id="delete-confirm" label="Type DELETE to confirm">
            <input
              id="delete-confirm"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              style={inputStyle}
            />
          </Field>
          {hasPassword && (
            <Field id="delete-password" label="Password">
              <input id="delete-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" style={inputStyle} />
            </Field>
          )}
          {error && <p role="alert" className="text-xs" style={{ color: 'var(--state-danger)' }}>{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!ready || deleting}
              style={{ ...primaryButton, background: 'var(--state-danger)', opacity: !ready || deleting ? 0.5 : 1 }}
            >
              {deleting ? 'Deleting…' : 'Permanently delete account'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setConfirmText(''); setPassword(''); setError(''); }}
              className="text-xs px-2 py-1"
              style={{ color: 'var(--ink-muted)' }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
