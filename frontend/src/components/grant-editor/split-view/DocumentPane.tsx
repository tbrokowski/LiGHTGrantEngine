'use client';

import { useState, useRef, useEffect } from 'react';
import {
  X, Plus, FileText, Lightbulb, LayoutList, Globe,
  FilePlus, FileSearch, ChevronDown, Columns2,
} from 'lucide-react';
import SingleDocEditor from '../SingleDocEditor';
import SkeletonEditor from '../SkeletonEditor';
import IdeaPhase from '../phases/IdeaPhase';
import SkeletonPhase from '../phases/SkeletonPhase';
import WebBrowserPane from './WebBrowserPane';
import NewDocumentPane from './NewDocumentPane';
import { useWorkspace } from '../WorkspaceContext';
import type { PanelConfig, PanelTab, PanelTabType } from './types';
import type { SkeletonSection } from '../SkeletonEditor';

interface DocumentPaneProps {
  panel: PanelConfig;
  onPanelChange: (updated: PanelConfig) => void;
  canClose: boolean;
  onClose: () => void;
  grantId: string;
  hasEditorPanel: boolean;
  onAddPanel: () => void;
}

const TAB_META: Record<PanelTabType, { icon: React.ReactNode; label: string }> = {
  editor: { icon: <FileText className="w-3 h-3" />, label: 'Draft Editor' },
  idea: { icon: <Lightbulb className="w-3 h-3" />, label: 'Idea' },
  skeleton: { icon: <LayoutList className="w-3 h-3" />, label: 'Skeleton' },
  'call-doc': { icon: <FileSearch className="w-3 h-3" />, label: 'Call Requirements' },
  'workspace-file': { icon: <FileText className="w-3 h-3" />, label: 'File' },
  'new-document': { icon: <FilePlus className="w-3 h-3" />, label: 'New Document' },
  browser: { icon: <Globe className="w-3 h-3" />, label: 'Browser' },
};

export default function DocumentPane({
  panel,
  onPanelChange,
  canClose,
  onClose,
  grantId,
  hasEditorPanel,
  onAddPanel,
}: DocumentPaneProps) {
  const workspace = useWorkspace();
  const [showTabPicker, setShowTabPicker] = useState(false);
  // Fixed position for the dropdown (escapes overflow-x-auto clip)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId) ?? panel.tabs[0];

  // Open picker at fixed viewport position to escape overflow clipping
  const openPicker = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPickerPos({ top: rect.bottom + 2, left: rect.left });
    setShowTabPicker(true);
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
            onIdeaChange={workspace.onIdeaChange}
            onCallAnalysis={workspace.onCallAnalysis}
            onGenerateSkeleton={workspace.onGenerateSkeleton}
            generating={workspace.generatingSkeleton}
            googleDocId={workspace.googleDocId}
            googleDocUrl={workspace.docUrl || null}
            googleDocLastSynced={workspace.lastSynced || null}
            onDocLinked={workspace.onDocLinked}
            onDocPulled={workspace.onDocPulled}
          />
        );

      case 'skeleton': {
        const skeletonData = workspace.skeleton as {
          sections?: SkeletonSection[];
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
            draftProgress={workspace.draftProgress}
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
        const src = activeTab.meta?.fileUrl;
        if (!src) {
          return (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400 italic">
              No file URL available.
            </div>
          );
        }
        const embedSrc = src.includes('docs.google.com')
          ? src.replace('/edit', '/preview').replace('/view', '/preview')
          : src;
        return (
          <iframe
            src={embedSrc}
            className="flex-1 w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            title={activeTab.label}
          />
        );
      }

      case 'new-document':
        return (
          <NewDocumentPane
            grantId={grantId}
            docId={activeTab.id}
            label={activeTab.label}
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
      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center bg-gray-50 border-b border-gray-200 min-h-[32px] overflow-x-auto">
        {panel.tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-gray-200 shrink-0 select-none transition-colors ${
              tab.id === panel.activeTabId
                ? 'bg-white text-gray-800 font-medium'
                : 'text-gray-500 hover:bg-white/60'
            }`}
          >
            <span className="flex-shrink-0">{TAB_META[tab.type].icon}</span>
            <span className="max-w-[110px] truncate">{tab.label}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 -mr-0.5 hover:text-red-500 transition-opacity"
              title="Close tab"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Add tab button — fixed-position dropdown escapes overflow-x-auto */}
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

      {/* Tab picker — fixed to viewport so it escapes overflow clipping */}
      {showTabPicker && pickerPos && (
        <div
          ref={pickerRef}
          className="fixed z-[9999] w-48 rounded-lg border border-gray-200 bg-white shadow-lg py-1"
          style={{ top: pickerPos.top, left: pickerPos.left }}
        >
          {addableTypes.map(({ type, label }) => (
            <button
              key={type}
              onClick={() => addTab(type, label)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="flex-shrink-0 text-gray-400">{TAB_META[type].icon}</span>
              {label}
            </button>
          ))}
          {addableTypes.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400 italic">All tab types are already open.</p>
          )}
        </div>
      )}

      {/* Removed old skeleton content — used useWorkspace() */}
      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
}
