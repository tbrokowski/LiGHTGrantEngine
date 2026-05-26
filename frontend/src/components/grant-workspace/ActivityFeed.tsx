'use client';

import {
  CheckSquare, Pencil, Trash2, Flag, Square, ClipboardList,
  FileText, Paperclip, Users, DollarSign, BarChart2,
  type LucideIcon,
} from 'lucide-react';
import { ActivityEntry } from './types';

interface Props {
  entries: ActivityEntry[];
  loading?: boolean;
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  task_created: CheckSquare,
  task_updated: Pencil,
  task_deleted: Trash2,
  milestone_created: Flag,
  milestone_updated: Flag,
  checklist_item_created: Square,
  checklist_item_completed: CheckSquare,
  checklist_generated: ClipboardList,
  section_created: FileText,
  section_updated: FileText,
  file_added: Paperclip,
  partner_added: Users,
  partner_updated: Users,
  budget_updated: DollarSign,
  gantt_generated: BarChart2,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ActivityFeed({ entries, loading }: Props) {
  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="w-8 h-8 bg-gray-100 rounded-full animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-gray-100 rounded animate-pulse w-3/4" />
              <div className="h-2 bg-gray-100 rounded animate-pulse w-1/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="p-6 text-center text-gray-400 text-sm py-16">
        No activity recorded yet. Actions in this workspace will appear here.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-1">
      <h2 className="text-base font-semibold text-gray-800 mb-4">Activity</h2>
      <div className="relative">
        <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-100" />
        <div className="space-y-4">
          {entries.map((entry) => {
            const Icon = ACTION_ICONS[entry.action];
            return (
              <div key={entry.id} className="flex gap-3 relative">
                <div className="w-8 h-8 bg-white border border-gray-200 rounded-full flex items-center justify-center shrink-0 z-10">
                  {Icon ? (
                    <Icon className="w-3.5 h-3.5 text-gray-500" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-300 block" />
                  )}
                </div>
                <div className="flex-1 pb-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm text-gray-800">
                      {entry.description ?? entry.action.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {entry.entity_type && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                        {entry.entity_type.replace(/_/g, ' ')}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">{timeAgo(entry.timestamp)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
