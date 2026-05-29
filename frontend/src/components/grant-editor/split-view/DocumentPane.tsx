'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Plus, FileText, Lightbulb, LayoutList, Globe,
  FilePlus, FileSearch, ChevronDown, Columns2,
  CloudUpload, CloudDownload, Check, Loader2, Link2, ExternalLink,
  MessageCircle, AlertTriangle, AlertCircle,
} from 'lucide-react';
import SingleDocEditor from '../SingleDocEditor';
import IdeaPhase from '../phases/IdeaPhase';
import SkeletonPhase from '../phases/SkeletonPhase';
import WebBrowserPane from './WebBrowserPane';
import NewDocumentPane from './NewDocumentPane';
import CommentsPanel from '../CommentsPanel';
import { useWorkspace } from '../WorkspaceContext';
import { grants, api } from '@/lib/api';
import type { PanelConfig, PanelTab, PanelTabType } from './types';

interface DocumentPaneProps {
  panel: PanelConfig;
  onPanelChange: (updated: PanelConfig) => void;
  canClose: boolean;
  onClose: () => void;
  grantId: string;
  hasEditorPanel: boolean;
  onAddPanel: () => void;
  onMoveTabToPanel: (tabId: string, sourcePanelId: string, targetPanelId: string) => void;
}

const TAB_META: Record<PanelTabType, { icon: React.ReactNode; label: string }> = {
  editor:           { icon: <FileText className="w-3 h-3" />, label: 'Draft Editor' },
  idea:             { icon: <Lightbulb className="w-3 h-3" />, label: 'Idea' },
  skeleton:         { icon: <LayoutList className="w-3 h-3" />, label: 'Skeleton' },
  'call-doc':       { icon: <FileSearch className="w-3 h-3" />, label: 'Call Requirements' },
  'workspace-file': { icon: <FileText className="w-3 h-3" />, label: 'File' },
  'new-document':   { icon: <FilePlus className="w-3 h-3" />, label: 'New Document' },
  browser:          { icon: <Globe className="w-3 h-3" />, label: 'Browser' },
};

// Color coding: Draft=indigo (matches AI), Idea=amber, Skeleton=blue, new-doc=teal
const TAB_COLORS: Record<PanelTabType, { active: string; inactive: string; dot: string }> = {
  editor:           { active: 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500',  inactive: 'text-gray-500 hover:bg-indigo-50/40',  dot: 'bg-indigo-400' },
  idea:             { active: 'bg-amber-50 text-amber-700 border-b-2 border-amber-400',    inactive: 'text-gray-500 hover:bg-amber-50/40',   dot: 'bg-amber-400' },
  skeleton:         { active: 'bg-blue-50 text-blue-700 border-b-2 border-blue-400',       inactive: 'text-gray-500 hover:bg-blue-50/40',    dot: 'bg-blue-400' },
  'new-document':   { active: 'bg-teal-50 text-teal-700 border-b-2 border-teal-400',      inactive: 'text-gray-500 hover:bg-teal-50/40',    dot: 'bg-teal-400' },
  browser:          { active: 'bg-gray-100 text-gray-700',                                  inactive: 'text-gray-500 hover:bg-gray-50',       dot: 'bg-gray-400' },
  'call-doc':       { active: 'bg-gray-100 text-gray-700',                                  inactive: 'text-gray-500 hover:bg-gray-50',       dot: 'bg-gray-400' },
  'workspace-file': { active: 'bg-gray-100 text-gray-700',                                  inactive: 'text-gray-500 hover:bg-gray-50',       dot: 'bg-gray-400' },
};

interface WorkspaceFile {
  id: string;
  file_name: string;
  file_url: string;
  file_category?: string;
}

export default function DocumentPane({
  panel,
  onPanelChange,
  canClose,
  onClose,
  grantId,
  hasEditorPanel,
  onAddPanel,
  onMoveTabToPanel,
}: DocumentPaneProps) {
  const workspace = useWorkspace();
  const [showTabPicker, setShowTabPicker] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [dragOverPanel, setDragOverPanel] = useState(false);
  // Resolved presigned URL and metadata for workspace-file tabs
  const [resolvedFileUrl, setResolvedFileUrl] = useState<string | null>(null);
  const [resolvedFileName, setResolvedFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId) ?? panel.tabs[0];

  // Notify GrantEditor which phase/document is currently visible so AI context stays in sync
  useEffect(() => {
    if (!activeTab) return;
    if (activeTab.type === 'idea' || activeTab.type === 'skeleton') {
      workspace.onPhaseContextChange(activeTab.type);
    } else if (activeTab.type === 'editor') {
      workspace.onPhaseContextChange('editor');
      workspace.onActiveDocChange(workspace.documentHtml, 'Draft');
    } else if (activeTab.type === 'new-document') {
      workspace.onPhaseContextChange('editor'); // falls through to activeDocHtml in getDocumentContext
      // actual content seeded by NewDocumentPane on mount via onActiveDocChange
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.type, activeTab?.id]);

  // Resolve presigned URL when a workspace-file tab is active
  useEffect(() => {
    if (activeTab?.type !== 'workspace-file') {
      setResolvedFileUrl(null);
      setResolvedFileName(null);
      setFileError('');
      return;
    }
    const raw = activeTab.meta?.fileUrl ?? '';
    if (!raw) { setResolvedFileUrl(null); return; }
    // Internal /content endpoints return JSON {"url": presigned, "file_name": "..."} — resolve it.
    // Normalise to a path (strip host) so axios always routes to the FastAPI base.
    if (raw.includes('/content')) {
      let apiPath = raw;
      try {
        apiPath = new URL(raw).pathname; // strip host → /api/v1/documents/{id}/content
      } catch { /* already a relative path */ }
      // Strip /api/v1 prefix — axios baseURL already includes it.
      apiPath = apiPath.replace(/^\/api\/v1/, '');
      setFileError('');
      api.get<{ url?: string; text?: string; file_name?: string }>(apiPath)
        .then((res) => {
          if (res.data.url) {
            setResolvedFileUrl(res.data.url);
            setResolvedFileName(res.data.file_name ?? null);
          } else {
            setFileError('File binary not available. The document may only contain parsed text.');
          }
        })
        .catch(() => setFileError('Could not load file — it may have been deleted or moved.'));
    } else {
      setResolvedFileUrl(raw);
    }
  }, [activeTab?.id, activeTab?.meta?.fileUrl, activeTab?.type]);

  // Open picker at fixed viewport position to escape overflow clipping
  const openPicker = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPickerPos({ top: rect.bottom + 2, left: rect.left });
    setShowTabPicker(true);
    setFilesLoading(true);
    grants.listFiles(grantId)
      .then((res) => setWorkspaceFiles(res.data ?? []))
      .catch(() => setWorkspaceFiles([]))
      .finally(() => setFilesLoading(false));
  };

  // Close picker on outside click or Escape
  useEffect(() => {
    if (!showTabPicker) return;
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') { setShowTabPicker(false); setPickerPos(null); }
        return;
      }
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setShowTabPicker(false);
        setPickerPos(null);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handler);
    };
  }, [showTabPicker]);

  const setActiveTab = (tabId: string) => onPanelChange({ ...panel, activeTabId: tabId });

  const closeTab = (tabId: string) => {
    if (panel.tabs.length === 1) { onClose(); return; }
    const remaining = panel.tabs.filter((t) => t.id !== tabId);
    onPanelChange({
      ...panel,
      tabs: remaining,
      activeTabId: panel.activeTabId === tabId ? remaining[remaining.length - 1].id : panel.activeTabId,
    });
  };

  const addTab = (type: PanelTabType, label: string, meta?: PanelTab['meta']) => {
    const newTab: PanelTab = { id: `tab-${Date.now()}`, type, label, meta };
    onPanelChange({ ...panel, tabs: [...panel.tabs, newTab], activeTabId: newTab.id });
    setShowTabPicker(false);
    setPickerPos(null);
  };

  const startRename = (tab: PanelTab) => {
    if (tab.type !== 'new-document') return;
    setRenamingTabId(tab.id);
    setRenameValue(tab.label);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const commitRename = () => {
    if (!renamingTabId) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      onPanelChange({
        ...panel,
        tabs: panel.tabs.map((t) => t.id === renamingTabId ? { ...t, label: trimmed } : t),
      });
    }
    setRenamingTabId(null);
  };

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────
  const handleTabDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    e.dataTransfer.setData('tab-drag', JSON.stringify({ tabId, sourcePanelId: panel.id }));
    e.dataTransfer.effectAllowed = 'move';
  }, [panel.id]);

  const handleTabBarDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('tab-drag')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPanel(true);
  }, []);

  const handleTabBarDragLeave = useCallback(() => setDragOverPanel(false), []);

  const handleTabBarDrop = useCallback((e: React.DragEvent) => {
    setDragOverPanel(false);
    try {
      const raw = e.dataTransfer.getData('tab-drag');
      if (!raw) return;
      const { tabId, sourcePanelId } = JSON.parse(raw) as { tabId: string; sourcePanelId: string };
      if (sourcePanelId === panel.id) return;
      e.preventDefault();
      onMoveTabToPanel(tabId, sourcePanelId, panel.id);
    } catch { /* ignore */ }
  }, [panel.id, onMoveTabToPanel]);

  const addableTypes: Array<{ type: PanelTabType; label: string }> = [
    ...(hasEditorPanel ? [] : [{ type: 'editor' as PanelTabType, label: 'Draft Editor' }]),
    { type: 'idea', label: 'Idea' },
    { type: 'skeleton', label: 'Skeleton' },
    { type: 'call-doc', label: 'Call Requirements' },
    { type: 'new-document', label: 'New Document' },
    { type: 'browser', label: 'Web Browser' },
  ];

  const renderContent = () => {
    if (!activeTab) return null;

    switch (activeTab.type) {
      case 'editor':
        return (
          <SingleDocEditor
            documentHtml={workspace.documentHtml}
            onDocumentChange={workspace.onDocumentChange}
            onSelectionChange={workspace.onSelectionChange}
            onActiveSectionChange={workspace.onActiveSectionChange}
          />
        );

      case 'idea':
        return (
          <IdeaPhase
            grantId={grantId}
            grantIdea={workspace.grantIdea}
            callAnalysis={workspace.callAnalysis}
            callRequirementsText={workspace.callRequirements}
            callAnalysisStatus={workspace.callAnalysisStatus}
            onCallAnalysisStatusChange={workspace.onCallAnalysisStatusChange}
            resumeCallAnalysis={workspace.resumeCallAnalysis}
            onIdeaChange={workspace.onIdeaChange}
            onCallAnalysis={workspace.onCallAnalysis}
            onGenerateSkeleton={workspace.onGenerateSkeleton}
            generating={workspace.generatingSkeleton}
            skeletonSteps={workspace.skeletonSteps}
            skeletonError={workspace.skeletonError}
            googleDocId={workspace.googleDocId}
            googleDocUrl={workspace.docUrl || null}
            googleDocLastSynced={workspace.lastSynced || null}
            onDocLinked={workspace.onDocLinked}
            onDocPulled={workspace.onDocPulled}
            onSelectionChange={workspace.onSelectionChange}
          />
        );

      case 'skeleton': {
        const skeletonData = workspace.skeleton as {
          raw_text?: string;
          flagged_sections?: string[];
          title_suggestion?: string;
          narrative_arc?: string;
          key_messages?: string[];
        };
        return (
          <SkeletonPhase
            skeleton={skeletonData}
            onSkeletonChange={workspace.onSkeletonChange}
            onGenerateDraft={workspace.onGenerateDraft}
            generating={workspace.generatingDraft}
            draftSteps={workspace.draftSteps}
            draftError={workspace.draftError}
            onSelectionChange={workspace.onSelectionChange}
            metaAgentEvents={workspace.metaAgentEvents}
            agentQuestions={workspace.agentQuestions}
            coherenceResult={workspace.coherenceResult}
            onAnswerAgentQuestion={workspace.onAnswerAgentQuestion}
            onSkipAgentQuestion={workspace.onSkipAgentQuestion}
            onRefineDraft={workspace.onRefineDraft}
            wordCountWarnings={workspace.wordCountWarnings}
            missingSections={workspace.missingSections}
            overviewFigureUrl={workspace.overviewFigureUrl}
            overviewFigureAlt={workspace.overviewFigureAlt}
            generatingFigure={workspace.generatingFigure}
            onGenerateFigure={workspace.onGenerateFigure}
          />
        );
      }

      case 'call-doc':
        return (
          <div className="flex-1 overflow-auto p-5">
            {workspace.callRequirements ? (
              <pre className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">
                {workspace.callRequirements}
              </pre>
            ) : (
              <p className="text-sm text-gray-400 italic">
                No call requirements uploaded yet. Open the Idea panel to upload a call document.
              </p>
            )}
          </div>
        );

      case 'workspace-file': {
        const rawSrc = activeTab.meta?.fileUrl;
        const src = resolvedFileUrl ?? rawSrc;

        if (!src && !fileError) {
          return (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400 italic">
              No file URL available.
            </div>
          );
        }

        // Error state (resolution failed)
        if (fileError) {
          return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
              <AlertCircle className="w-10 h-10 text-red-300" />
              <p className="text-sm text-gray-500">{fileError}</p>
              {rawSrc && (
                <a href={rawSrc} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
                  Try opening directly
                </a>
              )}
            </div>
          );
        }

        // Still resolving presigned URL
        if (!resolvedFileUrl && rawSrc?.includes('/content')) {
          return (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          );
        }

        // Detect PDF by resolved filename (most reliable) or URL pattern fallback
        const lowerName = (resolvedFileName ?? activeTab.label ?? '').toLowerCase();
        const lowerSrc = (src ?? '').toLowerCase();
        const isPdf =
          lowerName.endsWith('.pdf') ||
          lowerSrc.includes('.pdf') ||
          lowerSrc.includes('application%2Fpdf') ||
          lowerSrc.includes('content-type=pdf');
        const isGoogleDoc = (src ?? '').includes('docs.google.com') || (src ?? '').includes('drive.google.com');

        if (isPdf && src) {
          // Use native browser PDF rendering via iframe — no external services needed.
          // The presigned URL already carries ResponseContentDisposition: inline so the
          // browser renders it rather than downloading.
          return (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-shrink-0 flex items-center justify-between px-3 py-1 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                <span className="truncate max-w-[300px]">{resolvedFileName ?? activeTab.label}</span>
                <a href={src} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-indigo-600 hover:underline flex-shrink-0">
                  <ExternalLink className="w-3 h-3" />
                  Open / Download
                </a>
              </div>
              <iframe
                src={src}
                className="flex-1 w-full h-full border-0"
                title={resolvedFileName ?? activeTab.label}
              />
            </div>
          );
        }

        const embedSrc = isGoogleDoc && src
          ? src.replace('/edit', '/preview').replace('/view', '/preview')
          : (src ?? '');

        return (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-shrink-0 flex items-center justify-between px-3 py-1 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
              <span className="truncate max-w-[300px]">{activeTab.label}</span>
              <a href={rawSrc ?? src ?? ''} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-indigo-600 hover:underline flex-shrink-0">
                <ExternalLink className="w-3 h-3" />
                Open
              </a>
            </div>
            <iframe src={embedSrc} className="flex-1 w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              title={activeTab.label} />
          </div>
        );
      }

      case 'new-document':
        return (
          <NewDocumentPane
            key={activeTab.id}
            grantId={grantId}
            docId={activeTab.id}
            label={activeTab.label}
            onSelectionChange={workspace.onSelectionChange}
            onActiveDocChange={workspace.onActiveDocChange}
          />
        );

      case 'browser':
        return <WebBrowserPane onInsertText={workspace.onInsertText} />;

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden border-r border-gray-200 last:border-r-0">
      {/* Tab bar — also acts as drop zone for inter-panel tab dragging */}
      <div
        className={`flex-shrink-0 flex items-center bg-gray-50 border-b border-gray-200 min-h-[32px] overflow-x-auto transition-colors ${
          dragOverPanel ? 'bg-indigo-50 border-indigo-300' : ''
        }`}
        onDragOver={handleTabBarDragOver}
        onDragLeave={handleTabBarDragLeave}
        onDrop={handleTabBarDrop}
      >
        {panel.tabs.map((tab) => {
          const isActive = tab.id === panel.activeTabId;
          const colors = TAB_COLORS[tab.type];
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => handleTabDragStart(e, tab.id)}
              onClick={() => setActiveTab(tab.id)}
              onDoubleClick={() => startRename(tab)}
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-gray-200 shrink-0 select-none transition-colors ${
                isActive ? colors.active : colors.inactive
              }`}
            >
              {/* Color dot */}
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />
              <span className="flex-shrink-0">{TAB_META[tab.type].icon}</span>
              {renamingTabId === tab.id ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenamingTabId(null);
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="max-w-[110px] bg-transparent border-b border-indigo-400 outline-none text-xs"
                />
              ) : (
                <span
                  className="max-w-[110px] truncate"
                  title={tab.type === 'new-document' ? 'Double-click to rename' : undefined}
                >
                  {tab.label}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 -mr-0.5 hover:text-red-500 transition-opacity"
                title="Close tab"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* Drag hint when dragging over */}
        {dragOverPanel && (
          <div className="flex items-center px-2 py-1 text-[10px] text-indigo-500 font-medium pointer-events-none">
            Drop to move here
          </div>
        )}

        {/* Add tab button */}
        <button
          ref={triggerRef}
          onClick={openPicker}
          className="flex items-center gap-0.5 px-2 py-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
          title="Add tab"
        >
          <Plus className="w-3.5 h-3.5" />
          <ChevronDown className="w-2.5 h-2.5" />
        </button>

        {/* Add panel (split view) */}
        <button
          onClick={onAddPanel}
          className="flex items-center px-2 py-1.5 text-gray-400 hover:text-indigo-600 hover:bg-gray-100 transition-colors flex-shrink-0 ml-auto"
          title="Add panel"
        >
          <Columns2 className="w-3.5 h-3.5" />
        </button>

        {/* Close panel */}
        {canClose && (
          <button
            onClick={onClose}
            className="flex-shrink-0 px-2 py-1.5 text-gray-400 hover:text-red-500 transition-colors"
            title="Close panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Tab picker — fixed to viewport */}
      {showTabPicker && pickerPos && (
        <div
          ref={pickerRef}
          className="fixed z-[9999] w-52 rounded-lg border border-gray-200 bg-white shadow-lg py-1 max-h-80 overflow-y-auto"
          style={{ top: pickerPos.top, left: pickerPos.left }}
        >
          {addableTypes.map(({ type, label }) => (
            <button
              key={type}
              onClick={() => addTab(type, label)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${TAB_COLORS[type].dot}`} />
              <span className="flex-shrink-0 text-gray-400">{TAB_META[type].icon}</span>
              {label}
            </button>
          ))}
          {addableTypes.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400 italic">All tab types are already open.</p>
          )}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <p className="px-3 py-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide">
              From Files
            </p>
            {filesLoading && (
              <p className="px-3 py-2 text-xs text-gray-400 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading…
              </p>
            )}
            {!filesLoading && workspaceFiles.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400 italic">No files in workspace.</p>
            )}
            {!filesLoading && workspaceFiles.map((f) => (
              <button
                key={f.id}
                onClick={() => addTab('workspace-file', f.file_name, { fileUrl: f.file_url })}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <span className="flex-shrink-0 text-gray-400"><FileText className="w-3 h-3" /></span>
                <span className="truncate max-w-[160px]">{f.file_name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Google Docs + Comments sub-toolbar — editor tab */}
      {activeTab?.type === 'editor' && (
        <GoogleDocsSubToolbar
          grantId={grantId}
          docLinked={workspace.docLinked}
          docUrl={workspace.docUrl}
          syncState={workspace.syncState}
          syncError={workspace.syncError}
          wordCount={workspace.wordCount}
          charCount={workspace.documentHtml.replace(/<[^>]+>/g, '').length}
          remoteChangePending={workspace.remoteChangePending}
          onDocLinked={workspace.onDocLinked}
          onUnlink={workspace.onUnlinkDoc}
          onPushToDoc={workspace.onPushToDoc}
          onPullFromDoc={workspace.onPullFromDoc}
          onDismissRemoteChange={workspace.onDismissRemoteChange}
          commentsOpen={commentsOpen}
          onToggleComments={() => setCommentsOpen((v) => !v)}
        />
      )}

      {/* Comments sub-toolbar for new-document tabs */}
      {activeTab?.type === 'new-document' && (
        <div className="flex-shrink-0 flex items-center justify-end gap-2 px-3 py-1 border-b border-gray-100 bg-gray-50">
          <button
            onClick={() => setCommentsOpen((v) => !v)}
            title={commentsOpen ? 'Hide Comments' : 'Show Comments'}
            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors ${
              commentsOpen ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:text-indigo-600 hover:bg-gray-100'
            }`}
          >
            <MessageCircle className="w-3 h-3" />
            Comments
          </button>
        </div>
      )}

      {/* Content area + inline comments sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-hidden">
          {renderContent()}
        </div>
        {commentsOpen && (activeTab?.type === 'editor' || activeTab?.type === 'new-document') && (
          <div className="w-64 flex-shrink-0 border-l border-gray-200 overflow-hidden">
            <CommentsPanel
              grantId={grantId}
              documentId={activeTab.type === 'editor' ? 'draft' : activeTab.id}
              onClose={() => setCommentsOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Google Docs sub-toolbar ────────────────────────────────────────────────────
interface GoogleDocsSubToolbarProps {
  grantId: string;
  docLinked: boolean;
  docUrl: string;
  syncState: import('../WorkspaceContext').SyncState;
  syncError: string;
  wordCount: number;
  charCount: number;
  remoteChangePending: boolean;
  onDocLinked: (docId: string, url: string) => void;
  onUnlink: () => void;
  onPushToDoc: () => void;
  onPullFromDoc: () => void;
  onDismissRemoteChange: () => void;
  commentsOpen: boolean;
  onToggleComments: () => void;
}

function GoogleDocsSubToolbar({
  grantId, docLinked, docUrl, syncState, wordCount, charCount,
  remoteChangePending, onDocLinked, onUnlink, onPushToDoc, onPullFromDoc,
  onDismissRemoteChange, commentsOpen, onToggleComments,
}: GoogleDocsSubToolbarProps) {
  const [linkMode, setLinkMode] = useState<'none' | 'link-input'>('none');
  const [linkUrl, setLinkUrl] = useState('');
  const [linking, setLinking] = useState(false);
  const syncBusy = syncState === 'pushing' || syncState === 'pulling';

  const handleCreate = async () => {
    setLinking(true);
    try {
      const res = await grants.createGoogleDoc(grantId);
      onDocLinked(res.data.doc_id, res.data.doc_url);
    } finally {
      setLinking(false);
    }
  };

  const handleLink = async () => {
    if (!linkUrl.trim()) return;
    setLinking(true);
    try {
      const res = await grants.linkGoogleDoc(grantId, linkUrl.trim());
      onDocLinked(res.data.doc_id, res.data.doc_url);
      setLinkMode('none');
      setLinkUrl('');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="flex-shrink-0 flex flex-col border-b border-gray-100 bg-gray-50 text-xs">
      {/* Remote change conflict banner */}
      {remoteChangePending && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            Remote changes detected in Google Doc — your local edits take priority.
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => { onPullFromDoc(); onDismissRemoteChange(); }}
              disabled={syncBusy}
              className="px-2 py-0.5 rounded bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-40 text-[10px] font-medium"
            >
              Pull & overwrite
            </button>
            <button
              onClick={onDismissRemoteChange}
              className="px-2 py-0.5 rounded border border-amber-300 text-amber-700 hover:bg-amber-100 text-[10px]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main toolbar row */}
      <div className="flex items-center justify-between gap-2 px-3 py-1">
        {/* Left: Google Doc status */}
        <div className="flex items-center gap-2 min-w-0">
          {docLinked ? (
            <>
              <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              <a
                href={docUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline flex items-center gap-0.5 truncate max-w-[140px]"
              >
                Google Doc <ExternalLink className="w-2.5 h-2.5 inline ml-0.5" />
              </a>
              {syncState === 'pushing' && (
                <span className="flex items-center gap-1 text-gray-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Syncing…
                </span>
              )}
              {syncState === 'pulling' && (
                <span className="flex items-center gap-1 text-gray-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Pulling…
                </span>
              )}
              {syncState === 'success' && (
                <span className="flex items-center gap-1 text-green-600">
                  <Check className="w-3 h-3" /> Synced
                </span>
              )}
              <button onClick={onPushToDoc} disabled={syncBusy} title="Push to Google Doc"
                className="text-gray-400 hover:text-gray-700 disabled:opacity-40">
                <CloudUpload className="w-3.5 h-3.5" />
              </button>
              <button onClick={onPullFromDoc} disabled={syncBusy} title="Pull from Google Doc"
                className="text-gray-400 hover:text-gray-700 disabled:opacity-40">
                <CloudDownload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={async () => { await grants.unlinkGoogleDoc(grantId); onUnlink(); }}
                title="Unlink Google Doc"
                className="text-gray-300 hover:text-red-400 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </>
          ) : linkMode === 'link-input' ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleLink();
                  if (e.key === 'Escape') setLinkMode('none');
                }}
                placeholder="Paste Google Doc URL…"
                className="border border-gray-200 rounded px-1.5 py-0.5 text-xs w-48 outline-none focus:border-indigo-400"
              />
              <button onClick={() => void handleLink()} disabled={linking || !linkUrl.trim()}
                className="text-indigo-600 hover:text-indigo-800 disabled:opacity-40">
                {linking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              </button>
              <button onClick={() => setLinkMode('none')} className="text-gray-400 hover:text-gray-600">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => void handleCreate()} disabled={linking}
                className="flex items-center gap-1 text-gray-500 hover:text-indigo-600 disabled:opacity-40">
                {linking ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                Create Google Doc
              </button>
              <span className="text-gray-300">|</span>
              <button onClick={() => setLinkMode('link-input')}
                className="flex items-center gap-1 text-gray-500 hover:text-indigo-600">
                <Link2 className="w-3 h-3" />
                Link existing
              </button>
            </div>
          )}
        </div>

        {/* Right: word/char count + comments toggle */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-gray-400">
            {wordCount.toLocaleString()} words · {charCount.toLocaleString()} chars
          </span>
          <button
            onClick={onToggleComments}
            title={commentsOpen ? 'Hide Comments' : 'Show Comments'}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
              commentsOpen ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:text-indigo-600 hover:bg-gray-100'
            }`}
          >
            <MessageCircle className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
