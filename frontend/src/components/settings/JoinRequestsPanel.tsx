'use client';
import { useEffect, useState } from 'react';
import { organizations } from '@/lib/api';

interface JoinRequest {
  id: string;
  user_id: string | null;
  email: string;
  name: string;
  message: string | null;
  status: string;
  created_at: string | null;
}

export function JoinRequestsPanel({ institutionId }: { institutionId: string }) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await organizations.joinRequests(institutionId);
      setRequests(res.data);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [institutionId]);

  const pending = requests.filter(r => r.status === 'pending');

  async function approve(id: string) {
    setProcessingId(id);
    try {
      await organizations.approveRequest(institutionId, id);
      setRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r));
    } catch {
      alert('Failed to approve request.');
    } finally {
      setProcessingId(null);
    }
  }

  async function reject(id: string) {
    setProcessingId(id);
    try {
      await organizations.rejectRequest(institutionId, id);
      setRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'rejected' } : r));
    } catch {
      alert('Failed to reject request.');
    } finally {
      setProcessingId(null);
    }
  }

  if (loading) return <div className="text-sm text-gray-500 py-4">Loading requests…</div>;

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">
        Join Requests
        {pending.length > 0 && (
          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            {pending.length} pending
          </span>
        )}
      </h3>

      {requests.length === 0 ? (
        <div className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">
          No join requests yet.
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(req => (
            <div
              key={req.id}
              className={`border rounded-lg p-4 ${
                req.status === 'pending'
                  ? 'border-amber-200 bg-amber-50'
                  : req.status === 'approved'
                  ? 'border-green-200 bg-green-50'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-900">{req.name}</div>
                  <div className="text-xs text-gray-500">{req.email}</div>
                  {req.message && (
                    <p className="mt-1.5 text-xs text-gray-600 italic">&ldquo;{req.message}&rdquo;</p>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    {req.created_at ? new Date(req.created_at).toLocaleDateString() : ''}
                    {' · '}
                    <span className={`font-medium ${
                      req.status === 'approved' ? 'text-green-600' :
                      req.status === 'rejected' ? 'text-gray-500' : 'text-amber-600'
                    }`}>
                      {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                    </span>
                  </div>
                </div>
                {req.status === 'pending' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => approve(req.id)}
                      disabled={processingId === req.id}
                      className="px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-md transition disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => reject(req.id)}
                      disabled={processingId === req.id}
                      className="px-3 py-1.5 text-xs font-medium bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded-md transition disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
