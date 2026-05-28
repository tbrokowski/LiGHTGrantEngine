'use client';

import { createContext, useContext } from 'react';

export type SyncState = 'idle' | 'pushing' | 'pulling' | 'creating' | 'success' | 'error';

export interface WorkspaceCitation {
  id?: string;
  formatted_citation?: string;
  source_type?: string;
  url?: string;
  claim_text?: string;
}

export interface WorkspaceContextType {
  // Grant identity
  grantId: string;
  grantTitle: string;

  // Content state
  grantIdea: string;
  callAnalysis: Record<string, unknown>;
  skeleton: Record<string, unknown>;
  documentHtml: string;
  callRequirements: string;

  // Selection / cursor
  selectedText: string;
  activeSection: string;

  // Generation state
  generatingSkeleton: boolean;
  generatingDraft: boolean;
  draftProgress: { section: string; index: number; total: number } | null;

  // Review
  reviewReport: Record<string, unknown> | null;
  reviewLoading: boolean;
  citations: WorkspaceCitation[];

  // Google Docs sync
  syncState: SyncState;
  syncError: string;
  docLinked: boolean;
  docUrl: string;
  lastSynced: string;
  googleDocId: string | null;
  remoteChangePending: boolean;

  // Word / char counts
  wordCount: number;

  // Active document context for AI
  activeDocLabel: string;
  onActiveDocChange: (html: string, label: string) => void;

  // Actions
  onIdeaChange: (idea: string) => void;
  onCallAnalysis: (analysis: Record<string, unknown>, requirements?: string) => void;
  onGenerateSkeleton: () => void;
  onSkeletonChange: (skeleton: Record<string, unknown>) => void;
  onGenerateDraft: () => void;
  onDocumentChange: (html: string, words: number, headings: string[]) => void;
  onSelectionChange: (text: string) => void;
  onActiveSectionChange: (section: string) => void;
  onPhaseContextChange: (phase: string) => void;
  onInsertText: (text: string) => void;
  onDocLinked: (docId: string, docUrl: string) => void;
  onUnlinkDoc: () => void;
  onDocPulled: (html: string) => void;
  onRunReview: () => void;
  onCitationsUpdate: (citations: WorkspaceCitation[]) => void;
  onPushToDoc: () => void;
  onPullFromDoc: () => void;
  onDismissRemoteChange: () => void;
  getDocumentContext: () => string;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function useWorkspace(): WorkspaceContextType {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceContext.Provider');
  return ctx;
}

export default WorkspaceContext;
