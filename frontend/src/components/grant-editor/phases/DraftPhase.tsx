'use client';

import { useState } from 'react';
import AIChatPanel from '../AIChatPanel';
import ReviewPanel from '../ReviewPanel';
import CitationsPanel from '../CitationsPanel';
import ContextChips from '../ContextChips';
import SplitViewLayout from '../split-view/SplitViewLayout';
import type { PanelConfig } from '../split-view/types';

interface Citation {
  id?: string;
  formatted_citation?: string;
  source_type?: string;
  url?: string;
  claim_text?: string;
}

interface DraftPhaseProps {
  grantId: string;
  documentHtml: string;
  callRequirements: string;
  grantIdea: string;
  skeleton: Record<string, unknown>;
  selectedText: string;
  activeSection: string;
  contextChips: string[];
  reviewReport: Record<string, unknown> | null;
  reviewLoading: boolean;
  citations: Citation[];
  showReview: boolean;
  showCitations: boolean;
  googleDocUrl?: string | null;
  onDocumentChange: (html: string, words: number, headings: string[]) => void;
  onSelectionChange: (text: string) => void;
  onActiveSectionChange: (section: string) => void;
  onRunReview: () => void;
  onCitationsUpdate: (citations: Citation[]) => void;
  onInsertText: (text: string) => void;
  getDocumentContext: () => string;
  onToggleReview: () => void;
  onToggleCitations: () => void;
}

const DEFAULT_PANELS: PanelConfig[] = [
  {
    id: 'main',
    tabs: [{ id: 'editor-main', type: 'editor', label: 'Draft' }],
    activeTabId: 'editor-main',
  },
];

export default function DraftPhase({
  grantId,
  documentHtml,
  callRequirements,
  grantIdea,
  skeleton,
  selectedText,
  activeSection,
  contextChips,
  reviewReport,
  reviewLoading,
  citations,
  showReview,
  showCitations,
  googleDocUrl,
  onDocumentChange,
  onSelectionChange,
  onActiveSectionChange,
  onRunReview,
  onCitationsUpdate,
  onInsertText,
  getDocumentContext,
  onToggleReview,
  onToggleCitations,
}: DraftPhaseProps) {
  const [panels, setPanels] = useState<PanelConfig[]>(DEFAULT_PANELS);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content area — split view */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Sub-toolbar: Review / Citations toggles */}
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-gray-200 bg-white">
          <button
            onClick={onToggleReview}
            className={`text-xs px-2.5 py-1 rounded-lg border ${
              showReview
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            Review
          </button>
          <button
            onClick={onToggleCitations}
            className={`text-xs px-2.5 py-1 rounded-lg border ${
              showCitations
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            Citations
          </button>
          {activeSection && (
            <span className="text-[10px] text-gray-400 ml-auto">
              Active: {activeSection}
            </span>
          )}
        </div>

        {/* Split view panels */}
        <div className="flex flex-1 overflow-hidden">
          <SplitViewLayout
            grantId={grantId}
            panels={panels}
            onPanelsChange={setPanels}
            documentHtml={documentHtml}
            onDocumentChange={onDocumentChange}
            onSelectionChange={onSelectionChange}
            onActiveSectionChange={onActiveSectionChange}
            grantIdea={grantIdea}
            skeleton={skeleton}
            callRequirements={callRequirements}
            onInsertText={onInsertText}
          />
        </div>
      </div>

      {/* AI Chat sidebar — fixed width, always visible */}
      <div className="flex-shrink-0 w-[380px] flex border-l border-gray-200">
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <ContextChips chips={contextChips} />
          <AIChatPanel
            grantId={grantId}
            selectedText={selectedText}
            activeSection={activeSection}
            writingPhase="draft"
            getDocumentContext={getDocumentContext}
            onInsertText={onInsertText}
            callRequirements={callRequirements}
            useWritingStudio
            googleDocUrl={googleDocUrl}
          />
        </div>
        {showReview && (
          <div className="w-64 flex-shrink-0">
            <ReviewPanel
              grantId={grantId}
              report={reviewReport}
              loading={reviewLoading}
              onRunReview={onRunReview}
              documentContext={getDocumentContext()}
            />
          </div>
        )}
        {showCitations && (
          <div className="w-56 flex-shrink-0">
            <CitationsPanel
              grantId={grantId}
              citations={citations}
              onCitationsUpdate={onCitationsUpdate}
              activeSection={activeSection}
            />
          </div>
        )}
      </div>
    </div>
  );
}
