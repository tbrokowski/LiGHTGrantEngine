'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { grants, grantWriting, streamDraftGeneration } from '@/lib/api';
import IdeaPhase from './phases/IdeaPhase';
import SkeletonPhase from './phases/SkeletonPhase';
import DraftPhase from './phases/DraftPhase';
import type { SkeletonSection } from './SkeletonEditor';
import {
  CloudUpload, CloudDownload, ExternalLink, Check, Loader2,
  AlertCircle, FileText, Lightbulb, LayoutList, PenLine,
} from 'lucide-react';

type WritingPhase = 'idea' | 'skeleton' | 'draft';

interface GrantDetail {
  id: string;
  title: string;
  funder: string | null;
  call_requirements: string | null;
  editor_sections: Record<string, unknown>;
  editor_document?: string | null;
  google_doc_id?: string | null;
  google_doc_url?: string | null;
  google_doc_last_synced?: string | null;
  grant_idea?: string | null;
  call_analysis?: Record<string, unknown>;
  proposal_skeleton?: Record<string, unknown>;
  style_profile?: Record<string, unknown>;
  writing_phase?: string;
  last_review?: Record<string, unknown>;
}

interface GrantEditorProps {
  grant: GrantDetail;
  onGrantUpdate: () => void;
  onHeadingsChange?: (headings: string[]) => void;
}

type SyncState = 'idle' | 'pushing' | 'pulling' | 'creating' | 'success' | 'error';

const PHASE_TABS: { id: WritingPhase; label: string; icon: React.ReactNode }[] = [
  { id: 'idea', label: 'Idea', icon: <Lightbulb className="w-3.5 h-3.5" /> },
  { id: 'skeleton', label: 'Skeleton', icon: <LayoutList className="w-3.5 h-3.5" /> },
  { id: 'draft', label: 'Draft & Review', icon: <PenLine className="w-3.5 h-3.5" /> },
];

export default function GrantEditor({ grant, onGrantUpdate, onHeadingsChange }: GrantEditorProps) {
  const [phase, setPhase] = useState<WritingPhase>((grant.writing_phase as WritingPhase) || 'idea');
  const [grantIdea, setGrantIdea] = useState(grant.grant_idea || '');
  const [callAnalysis, setCallAnalysis] = useState<Record<string, unknown>>(grant.call_analysis || {});
  const [skeleton, setSkeleton] = useState<Record<string, unknown>>(grant.proposal_skeleton || {});
  const [documentHtml, setDocumentHtml] = useState(grant.editor_document || '');
  const [callRequirements, setCallRequirements] = useState(grant.call_requirements || '');
  const [selectedText, setSelectedText] = useState('');
  const [activeSection, setActiveSection] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [headings, setHeadings] = useState<string[]>([]);

  const [generatingSkeleton, setGeneratingSkeleton] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftProgress, setDraftProgress] = useState<{ section: string; index: number; total: number } | null>(null);

  const [reviewReport, setReviewReport] = useState<Record<string, unknown> | null>(grant.last_review || null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [citations, setCitations] = useState<Array<{ id?: string; formatted_citation?: string; source_type?: string; url?: string; claim_text?: string }>>([]);
  const [showReview, setShowReview] = useState(false);
  const [showCitations, setShowCitations] = useState(false);
  const [contextChips, setContextChips] = useState<string[]>([]);

  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState('');
  const [docLinked, setDocLinked] = useState(!!grant.google_doc_id);
  const [docUrl, setDocUrl] = useState(grant.google_doc_url || '');
  const [lastSynced, setLastSynced] = useState(grant.google_doc_last_synced || '');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ideaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    grantWriting.status(grant.id).then((res) => {
      const d = res.data;
      if (d.grant_idea) setGrantIdea(d.grant_idea);
      if (d.call_analysis) setCallAnalysis(d.call_analysis);
      if (d.proposal_skeleton) setSkeleton(d.proposal_skeleton);
      if (d.last_review) setReviewReport(d.last_review);
      if (d.writing_phase) setPhase(d.writing_phase as WritingPhase);
    }).catch(() => {});
    grantWriting.listCitations(grant.id).then((res) => setCitations(res.data)).catch(() => {});
  }, [grant.id]);

  const getDocumentContext = useCallback(() => documentHtml.replace(/<[^>]+>/g, ' ').trim(), [documentHtml]);

  const handleDocumentChange = useCallback((html: string, words: number, heads: string[]) => {
    setDocumentHtml(html);
    setWordCount(words);
    setHeadings(heads);
    onHeadingsChange?.(heads);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await grants.saveDocument(grant.id, html, true);
      } catch (e) {
        console.error('Auto-save failed', e);
      }
    }, 1500);
  }, [grant.id, onHeadingsChange]);

  const handleIdeaChange = (idea: string) => {
    setGrantIdea(idea);
    if (ideaTimer.current) clearTimeout(ideaTimer.current);
    ideaTimer.current = setTimeout(async () => {
      try {
        await grantWriting.saveIdea(grant.id, { grant_idea: idea, writing_phase: 'idea' });
      } catch { /* ignore */ }
    }, 1000);
  };

  const handleGenerateSkeleton = async () => {
    setGeneratingSkeleton(true);
    try {
      await grantWriting.saveIdea(grant.id, { grant_idea: grantIdea, writing_phase: 'idea' });
      const res = await grantWriting.generateSkeleton(grant.id);
      setSkeleton(res.data.proposal_skeleton || {});
      setPhase('skeleton');
      onGrantUpdate();
    } finally {
      setGeneratingSkeleton(false);
    }
  };

  const handleSkeletonChange = async (updated: Record<string, unknown>) => {
    setSkeleton(updated);
    try {
      await grantWriting.updateSkeleton(grant.id, { proposal_skeleton: updated, writing_phase: 'skeleton' });
    } catch { /* ignore */ }
  };

  const handleGenerateDraft = () => {
    setGeneratingDraft(true);
    setDraftProgress(null);
    streamDraftGeneration(
      grant.id,
      (event) => {
        if (event.event === 'section_start') {
          setDraftProgress({
            section: String(event.section),
            index: Number(event.index),
            total: Number(event.total),
          });
        }
        if (event.event === 'section_complete') {
          setDraftProgress({
            section: String(event.section),
            index: Number(event.index),
            total: Number(event.total),
          });
        }
        if (event.event === 'draft_complete' && event.document_html) {
          setDocumentHtml(String(event.document_html));
          setPhase('draft');
        }
      },
      () => {
        setGeneratingDraft(false);
        setDraftProgress(null);
        onGrantUpdate();
      },
      (err) => {
        console.error('Draft generation failed', err);
        setGeneratingDraft(false);
        setDraftProgress(null);
      },
    );
  };

  const handleRunReview = async () => {
    setReviewLoading(true);
    try {
      const res = await grantWriting.runReview(grant.id);
      setReviewReport(res.data);
      setShowReview(true);
    } finally {
      setReviewLoading(false);
    }
  };

  const insertIntoSection = (text: string) => {
    if (!activeSection) {
      setDocumentHtml((prev) => prev + `<p>${text}</p>`);
      return;
    }
    const regex = new RegExp(`(<h2[^>]*>${activeSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h2>)([\\s\\S]*?)(?=<h2|$)`, 'i');
    const match = documentHtml.match(regex);
    if (match) {
      const updated = documentHtml.replace(regex, `$1\n<p>${text}</p>$2`);
      setDocumentHtml(updated);
    } else {
      setDocumentHtml((prev) => prev + `<p>${text}</p>`);
    }
  };

  const extractError = (e: unknown): string => {
    const detail = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
    return detail || (e as { message?: string }).message || 'An unexpected error occurred';
  };

  const handlePush = async () => {
    setSyncState('pushing');
    setSyncError('');
    try {
      await grants.saveDocument(grant.id, documentHtml, false);
      const res = await grants.pushToGoogleDoc(grant.id);
      setLastSynced(res.data.last_synced);
      setSyncState('success');
      setTimeout(() => setSyncState('idle'), 3000);
    } catch (e: unknown) {
      setSyncError(extractError(e));
      setSyncState('error');
    }
  };

  const handlePull = async () => {
    setSyncState('pulling');
    setSyncError('');
    try {
      const res = await grants.pullFromGoogleDoc(grant.id);
      setDocumentHtml(res.data.content_html);
      setSyncState('success');
      onGrantUpdate();
      setTimeout(() => setSyncState('idle'), 3000);
    } catch (e: unknown) {
      setSyncError(extractError(e));
      setSyncState('error');
    }
  };

  const syncBusy = syncState === 'pushing' || syncState === 'pulling';

  useEffect(() => {
    const chips: string[] = [];
    if (callAnalysis && Object.keys(callAnalysis).length) chips.push('Call req');
    if (activeSection) chips.push(activeSection);
    if (grant.style_profile && Object.keys(grant.style_profile).length) chips.push('Style profile');
    setContextChips(chips);
  }, [callAnalysis, activeSection, grant.style_profile]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Phase navigation + toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
        <div className="flex items-center gap-1">
          {PHASE_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setPhase(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                phase === tab.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{wordCount.toLocaleString()} words</span>
          {phase === 'draft' && docLinked && (
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1">
              <FileText className="w-3.5 h-3.5 text-blue-500" />
              <a href={docUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                Google Doc
              </a>
              <button onClick={handlePush} disabled={syncBusy} className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40">
                {syncState === 'pushing' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CloudUpload className="w-3 h-3" />}
              </button>
              <button onClick={handlePull} disabled={syncBusy} className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40">
                {syncState === 'pulling' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CloudDownload className="w-3 h-3" />}
              </button>
              {syncState === 'success' && <Check className="w-3.5 h-3.5 text-green-500" />}
            </div>
          )}
        </div>
      </div>

      {syncState === 'error' && syncError && (
        <div className="flex-shrink-0 flex items-center gap-2 bg-red-50 border-b border-red-200 px-4 py-2 text-xs text-red-600">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {syncError}
          <button onClick={() => { setSyncState('idle'); setSyncError(''); }} className="ml-auto">×</button>
        </div>
      )}

      {/* Phase content */}
      <div className="flex-1 overflow-hidden flex">
        {phase === 'idea' && (
          <IdeaPhase
            grantId={grant.id}
            grantIdea={grantIdea}
            callAnalysis={callAnalysis}
            onIdeaChange={handleIdeaChange}
            onCallAnalysis={(analysis, requirements) => {
              setCallAnalysis(analysis);
              if (requirements) setCallRequirements(requirements);
            }}
            onGenerateSkeleton={handleGenerateSkeleton}
            generating={generatingSkeleton}
          />
        )}

        {phase === 'skeleton' && (
          <SkeletonPhase
            skeleton={skeleton as { sections?: SkeletonSection[]; title_suggestion?: string; narrative_arc?: string; key_messages?: string[] }}
            onSkeletonChange={handleSkeletonChange}
            onGenerateDraft={handleGenerateDraft}
            generating={generatingDraft}
            draftProgress={draftProgress}
          />
        )}

        {phase === 'draft' && (
          <DraftPhase
            grantId={grant.id}
            documentHtml={documentHtml}
            callRequirements={callRequirements}
            selectedText={selectedText}
            activeSection={activeSection}
            contextChips={contextChips}
            reviewReport={reviewReport}
            reviewLoading={reviewLoading}
            citations={citations}
            showReview={showReview}
            showCitations={showCitations}
            googleDocUrl={grant.google_doc_url}
            onDocumentChange={handleDocumentChange}
            onSelectionChange={setSelectedText}
            onActiveSectionChange={setActiveSection}
            onRunReview={handleRunReview}
            onCitationsUpdate={setCitations}
            onInsertText={insertIntoSection}
            getDocumentContext={getDocumentContext}
            onToggleReview={() => setShowReview(!showReview)}
            onToggleCitations={() => setShowCitations(!showCitations)}
          />
        )}
      </div>
    </div>
  );
}
