'use client';

import { useState, useCallback, useEffect } from 'react';
import PartnerTracker from './PartnerTracker';
import SectionTracker from './SectionTracker';
import ActivityFeed from './ActivityFeed';
import SuggestedPartners from '@/components/crm/SuggestedPartners';
import type { WorkspacePartner, WorkspaceSection, ActivityEntry } from './types';
import { grants } from '@/lib/api';

type MoreView = 'partners' | 'sections' | 'activity';

const VIEWS: { id: MoreView; label: string }[] = [
  { id: 'partners', label: 'Partners' },
  { id: 'sections', label: 'Sections' },
  { id: 'activity', label: 'Activity' },
];

interface Props {
  grantId: string;
  onOpenEditor: () => void;
}

export default function MoreTab({ grantId, onOpenEditor }: Props) {
  const [view, setView] = useState<MoreView>('partners');

  const [partners, setPartners] = useState<WorkspacePartner[]>([]);
  const [sections, setSections] = useState<WorkspaceSection[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const [loaded, setLoaded] = useState<Set<MoreView>>(new Set());

  const fetchPartners = useCallback(() => {
    grants.listWorkspacePartners(grantId).then((r) => setPartners(r.data)).catch(console.error);
  }, [grantId]);

  const fetchSections = useCallback(() => {
    grants.listWorkspaceSections(grantId).then((r) => setSections(r.data)).catch(console.error);
  }, [grantId]);

  const fetchActivity = useCallback(() => {
    setActivityLoading(true);
    grants.getActivity(grantId).then((r) => setActivity(r.data)).catch(console.error).finally(() => setActivityLoading(false));
  }, [grantId]);

  useEffect(() => {
    if (loaded.has(view)) return;
    setLoaded((prev) => new Set([...prev, view]));
    if (view === 'partners') fetchPartners();
    if (view === 'sections') fetchSections();
    if (view === 'activity') fetchActivity();
  }, [view, loaded, fetchPartners, fetchSections, fetchActivity]);

  return (
    <div className="flex flex-col h-full">
      {/* Secondary nav */}
      <div className="px-4 pt-3 pb-0 border-b border-gray-100 bg-white flex items-center gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === v.id
                ? 'bg-indigo-600 text-white'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === 'partners' && (
          <div className="p-4 space-y-6">
            <PartnerTracker grantId={grantId} partners={partners} onRefresh={fetchPartners} />
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 px-1">AI Partner Suggestions</h3>
              <SuggestedPartners entityType="grant" entityId={grantId} />
            </div>
          </div>
        )}

        {view === 'sections' && (
          <SectionTracker
            grantId={grantId}
            sections={sections}
            onRefresh={fetchSections}
            onOpenEditor={onOpenEditor}
          />
        )}

        {view === 'activity' && (
          <ActivityFeed entries={activity} loading={activityLoading} />
        )}
      </div>
    </div>
  );
}
