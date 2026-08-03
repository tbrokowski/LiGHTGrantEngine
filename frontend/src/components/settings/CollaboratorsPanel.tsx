'use client';
import { useState, useEffect, useCallback } from 'react';
import { organizations } from '@/lib/api';

interface CollaboratorGrant {
  id: string;
  title: string;
  role: string;
}

interface Collaborator {
  email: string;
  name: string | null;
  user_id: string | null;
  status: string;
  grants: CollaboratorGrant[];
}

function initials(name: string | null, email: string): string {
  if (name) return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return email[0].toUpperCase();
}

/** Org-settings view of outside guests — people with grant-only access who are
 *  not core organization members — with the grant(s) each is on. */
export function CollaboratorsPanel({ institutionId }: { institutionId: string }) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await organizations.collaborators(institutionId);
      setCollaborators(res.data);
    } catch { setCollaborators([]); } finally { setLoading(false); }
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">Collaborators</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          Outside guests invited to individual grants. They have access to their grant(s) only and are not organization members.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : collaborators.length === 0 ? (
        <p className="text-sm text-gray-400">No outside collaborators. Guests appear here when they’re invited to a grant by email.</p>
      ) : (
        <div className="space-y-2">
          {collaborators.map(c => (
            <div key={c.email} className="flex items-start gap-3 px-4 py-3 border border-gray-200 rounded-xl">
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-sm font-semibold text-amber-700 shrink-0">
                {initials(c.name, c.email)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {c.name && <span className="text-sm font-medium text-gray-900">{c.name}</span>}
                  <span className="text-sm text-gray-500 truncate">{c.email}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">Guest</span>
                  {!c.user_id && <span className="text-xs text-amber-600 italic">not yet registered</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className="text-xs text-gray-400">On:</span>
                  {c.grants.map(g => (
                    <span key={g.id} className="text-xs px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-600">
                      {g.title} <span className="text-gray-400">· {g.role}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
