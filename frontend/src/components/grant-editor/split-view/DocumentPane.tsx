'use client';

import { useState, useRef, useEffect } from 'react';
import {
  X, Plus, FileText, Lightbulb, LayoutList, Globe,
  FilePlus, FileSearch, ChevronDown,
} from 'lucide-react';
import SingleDocEditor from '../SingleDocEditor';
import SkeletonEditor from '../SkeletonEditor';
import WebBrowserPane from './WebBrowserPane';
import NewDocumentPane from './NewDocumentPane';
import type { PanelConfig, PanelTab, PanelTabType } from './types';
import type { SkeletonSection } from '../SkeletonEditor';

interface DocumentPaneProps {
  panel: PanelConfig;
  onPanelChange: (updated: PanelConfig) => void;
  canClose: boolean;
  onClose: () => void;
  grantId: string;
  documentHtml: string;
  onDocumentChange: (html: string, words: number, headings: string[]) => void;
  onSelectionChange: (text: string) => void;
  onActiveSectionChange: (section: string) => void;
  grantIdea: string;
  skeletonSections: SkeletonSection[];
  callRequirements: string;
  onInsertText: (text: string) => void;
  hasEditorPanel: boolean;
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
  documentHtml,
  onDocumentChange,
  onSelectionChange,
  onActiveSectionChange,
  grantIdea,
  skeletonSections,
  callRequirements,
  onInsertText,
  hasEditorPanel,
}: DocumentPaneProps) {
  const [showTabPicker, setShowTabPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId) ?? panel.tabs[0];

  // Close picker on outside click
  useEffect(() => {
    if (!showTabPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowTabPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTabPicker]);

  const setActiveTab = (tabId: string) =>
    onPanelChange({ ...panel, activeTabId: tabId });

  const closeTab = (tabId: string) => {
    if (panel.tabs.length === 1) {
      onClose();
      return;
    }
    const remaining = panel.tabs.filter((t) => t.id !== tabId);
    onPanelChange({
      ...panel,
      tabs: remaining,
      activeTabId:
        panel.activeTabId === tabId
          ? remaining[remaining.length - 1].id
          : panel.activeTabId,
    });
  };

  const addTab = (type: PanelTabType, label: string, meta?: PanelTab['meta']) => {
    const newTab: PanelTab = { id: `tab-${Date.now()}`, type, label, meta };
    onPanelChange({
      ...panel,
      tabs: [...panel.tabs, newTab],
      activeTabId: newTab.id,
    });
    setShowTabPicker(false);
  };

  // Tab types the user can add (editor only allowed if no panel already has one)
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
            documentHtml={documentHtml}
            onDocumentChange={onDocumentChange}
            onSelectionChange={onSelectionChange}
            onActiveSectionChange={onActiveSectionChange}
          />
        );

      case 'idea':
        return (
          <div className="flex-1 overflow-auto p-5">
            {grantIdea ? (
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {grantIdea}
              </p>
            ) : (
              <p className="text-sm text-gray-400 italic">
                No idea content yet. Switch to the Idea phase to add your grant idea.
              </p>
            )}
          </div>
        );

      case 'skeleton':
        return (
          <div className="flex-1 overflow-auto">
            {skeletonSections.length ? (
              <SkeletonEditor sections={skeletonSections} onChange={() => {}} />
            ) : (
              <div className="p-5 text-sm text-gray-400 italic">
                No skeleton generated yet. Switch to the Skeleton phase first.
              </div>
            )}
          </div>
        );

      case 'call-doc':
        return (
          <div className="flex-1 overflow-auto p-5">
            {callRequirements ? (
              <pre className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">
                {callRequirements}
              </pre>
            ) : (
              <p className="text-sm text-gray-400 italic">
                No call requirements uploaded yet. Upload a call document in the Idea phase.
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
        // Google Docs: use embed URL
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
        return <WebBrowserPane onInsertText={onInsertText} />;

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
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 -mr-0.5 hover:text-red-500 transition-opacity"
              title="Close tab"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Add tab */}
        <div ref={pickerRef} className="relative flex-shrink-0">
          <button
            onClick={() => setShowTabPicker((v) => !v)}
            className="flex items-center gap-0.5 px-2 py-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Add tab"
          >
            <Plus className="w-3.5 h-3.5" />
            <ChevronDown className="w-2.5 h-2.5" />
          </button>

          {showTabPicker && (
            <div className="absolute top-full left-0 z-50 mt-0.5 w-48 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
              {addableTypes.map(({ type, label }) => (
                <button
                  key={type}
                  onClick={() => addTab(type, label)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <span className="flex-shrink-0 text-gray-400">
                    {TAB_META[type].icon}
                  </span>
                  {label}
                </button>
              ))}
              {addableTypes.length === 0 && (
                <p className="px-3 py-2 text-xs text-gray-400 italic">
                  All tab types are already open.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Close panel */}
        {canClose && (
          <button
            onClick={onClose}
            className="ml-auto flex-shrink-0 px-2 py-1.5 text-gray-400 hover:text-red-500 transition-colors"
            title="Close panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
}
