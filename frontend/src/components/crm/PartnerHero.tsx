'use client';
import { useState } from 'react';
import {
  Zap, RefreshCw, ExternalLink, Linkedin, Globe, Mail, Phone, MapPin,
  GraduationCap, Calendar, Link2, ChevronDown, Plus, CheckSquare,
} from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';
import OwnerSelect from './OwnerSelect';

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  prospect: { label: 'Prospect', color: 'bg-gray-100 text-gray-600' },
  qualified: { label: 'Qualified', color: 'bg-blue-50 text-blue-700' },
  engaged: { label: 'Engaged', color: 'bg-indigo-50 text-indigo-700' },
  collaborating: { label: 'Collaborating', color: 'bg-green-50 text-green-700' },
  alumni: { label: 'Alumni', color: 'bg-amber-50 text-amber-700' },
};

const STATUS_CONFIG: Record<string, string> = {
  active: 'bg-green-50 text-green-700 border-green-200',
  prospect: 'bg-amber-50 text-amber-700 border-amber-200',
  inactive: 'bg-gray-100 text-gray-500 border-gray-200',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  prospect: 'Prospect',
  inactive: 'Inactive',
};

interface PartnerHeroProps {
  partner: {
    id: string;
    name: string;
    title?: string;
    organization?: string;
    department?: string;
    country?: string;
    city?: string;
    email?: string;
    phone?: string;
    linkedin_url?: string;
    website?: string;
    status: string;
    relationship_stage: string;
    h_index?: number;
    orcid?: string;
    tags: string[];
    project_types: string[];
    enrichment_status: string;
    last_enriched_at?: string;
    org_info?: { id: string; name: string; org_type: string } | null;
    owner_id?: string | null;
    owner_name?: string | null;
    task_count?: number;
  };
  onEnrich: () => void;
  onLogInteraction: () => void;
  onScheduleMeeting: () => void;
  onDraftEmail: () => void;
  onAddToGrant: () => void;
  onStageChange: (stage: string) => void;
  onOwnerChange?: (ownerId: string | null, ownerName: string | null) => void;
  onAddTask?: () => void;
}

function InitialsAvatar({ name, size = 'lg' }: { name: string; size?: 'sm' | 'lg' }) {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  const colors = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-cyan-500'];
  const color = colors[(name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % colors.length];
  const cls = size === 'lg' ? 'w-16 h-16 text-xl' : 'w-8 h-8 text-sm';
  return (
    <div className={`${cls} ${color} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}>
      {initials}
    </div>
  );
}

export { InitialsAvatar };

export default function PartnerHero({
  partner, onEnrich, onLogInteraction, onScheduleMeeting, onDraftEmail, onAddToGrant, onStageChange,
  onOwnerChange, onAddTask,
}: PartnerHeroProps) {
  const [enriching, setEnriching] = useState(false);
  const [showStageMenu, setShowStageMenu] = useState(false);

  const stage = STAGE_CONFIG[partner.relationship_stage] || STAGE_CONFIG.prospect;
  const statusCls = STATUS_CONFIG[partner.status] || STATUS_CONFIG.inactive;
  const statusLabel = STATUS_LABELS[partner.status] || partner.status;

  async function handleEnrich() {
    setEnriching(true);
    try {
      await partnersApi.enrich(partner.id);
      onEnrich();
    } finally {
      setEnriching(false);
    }
  }

  const location = [partner.city, partner.country].filter(Boolean).join(', ');

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Top bar */}
      <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between text-xs">
        <span className="text-gray-400">
          {partner.enrichment_status === 'done' && partner.last_enriched_at
            ? `Enriched ${new Date(partner.last_enriched_at).toLocaleDateString()}`
            : partner.enrichment_status === 'pending'
            ? 'Enriching profile…'
            : 'Profile not enriched'}
        </span>
        <button
          onClick={handleEnrich}
          disabled={enriching || partner.enrichment_status === 'pending'}
          className="flex items-center gap-1 text-blue-600 hover:text-blue-800 disabled:opacity-40 font-medium"
        >
          <RefreshCw className={`w-3 h-3 ${enriching ? 'animate-spin' : ''}`} />
          {enriching ? 'Enriching…' : 'Enrich Now'}
        </button>
      </div>

      <div className="p-5">
        {/* Name + avatar */}
        <div className="flex items-start gap-4 mb-4">
          <InitialsAvatar name={partner.name} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-gray-900">{partner.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusCls}`}>
                {statusLabel}
              </span>
              {partner.h_index != null && (
                <span className="flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                  <GraduationCap className="w-3 h-3" />h-index {partner.h_index}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-600 mt-0.5">
              {[partner.title, partner.department, partner.organization].filter(Boolean).join(' · ')}
            </div>
            {location && (
              <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                <MapPin className="w-3 h-3" />
                {location}
              </div>
            )}
            {/* Owner + task count row */}
            <div className="flex items-center gap-3 mt-2">
              {onOwnerChange && (
                <OwnerSelect
                  ownerId={partner.owner_id}
                  ownerName={partner.owner_name}
                  onChange={onOwnerChange}
                />
              )}
              {(partner.task_count ?? 0) > 0 && (
                <span className="flex items-center gap-1 text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full border border-orange-100">
                  <CheckSquare className="w-3 h-3" />
                  {partner.task_count} task{partner.task_count !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {/* Stage picker */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowStageMenu(!showStageMenu)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 ${stage.color}`}
            >
              {stage.label}
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {showStageMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1 min-w-[160px]">
                {Object.entries(STAGE_CONFIG).map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => { onStageChange(key); setShowStageMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${key === partner.relationship_stage ? 'font-semibold' : ''}`}
                  >
                    {cfg.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Contact info row */}
        <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-4">
          {partner.email && (
            <a href={`mailto:${partner.email}`} className="flex items-center gap-1 hover:text-blue-600">
              <Mail className="w-3 h-3" />{partner.email}
            </a>
          )}
          {partner.phone && (
            <a href={`tel:${partner.phone}`} className="flex items-center gap-1 hover:text-gray-700">
              <Phone className="w-3 h-3" />{partner.phone}
            </a>
          )}
          {partner.linkedin_url && (
            <a href={partner.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-blue-600">
              <Linkedin className="w-3 h-3" />LinkedIn
            </a>
          )}
          {partner.website && (
            <a href={partner.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-blue-600">
              <Globe className="w-3 h-3" />Website
            </a>
          )}
          {partner.orcid && (
            <a href={`https://orcid.org/${partner.orcid}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-green-600 text-green-700">
              <ExternalLink className="w-3 h-3" />ORCID
            </a>
          )}
        </div>

        {/* Tags */}
        {(partner.tags.length > 0 || partner.project_types.length > 0) && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {partner.tags.slice(0, 6).map(t => (
              <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{t}</span>
            ))}
            {partner.project_types.slice(0, 3).map(t => (
              <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">{t}</span>
            ))}
          </div>
        )}

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
          <button onClick={onLogInteraction}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 font-medium">
            <Plus className="w-3 h-3" />Log Interaction
          </button>
          <button onClick={onScheduleMeeting}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
            <Calendar className="w-3 h-3" />Schedule Meeting
          </button>
          <button onClick={onDraftEmail}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
            <Zap className="w-3 h-3 text-amber-500" />Draft Email
          </button>
          <button onClick={onAddToGrant}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
            <Link2 className="w-3 h-3" />Add to Grant
          </button>
          {onAddTask && (
            <button onClick={onAddTask}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
              <CheckSquare className="w-3 h-3" />Add Task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
