'use client';

import { createContext, useContext } from 'react';
import type { MetaAgentEvent, AgentQuestion } from './MetaAgentPanel';

export type SyncState = 'idle' | 'pushing' | 'pulling' | 'creating' | 'success' | 'error';

export interface WorkspaceCitation {
  id?: string;
  formatted_citation?: string;
  source_type?: string;
  url?: string;
  claim_text?: string;
}

export interface CoherenceResult {
  overall: string;
  issues: Array<{ section: string; issue: string; severity: string }>;
  strengths: string[];
}

export interface WorkspaceContextType {
  // Grant identity
  grantId: string;
  grantTitle: string;

  // Content state
  grantIdea: string;
  callAnalysis: Record<string, unknown>;
  callIntelligence: Record<string, unknown>;
  skeleton: Record<string, unknown>;
  documentHtml: string;
  callRequirements: string;
  callAnalysisStatus?: 'idle' | 'running' | 'completed' | 'failed';
  resumeCallAnalysis?: boolean;
  onCallAnalysisStatusChange?: (status: 'idle' | 'running' | 'completed' | 'failed', error?: string | null) => void;

  // Selection / cursor
  selectedText: string;
  activeSection: string;

  // Generation state
  generatingSkeleton: boolean;
  skeletonSteps: import('@/lib/callAnalysisStore').AIThinkingStepData[] | null;
  skeletonError: string | null;
  generatingDraft: boolean;
  draftSteps: import('@/lib/callAnalysisStore').AIThinkingStepData[] | null;
  draftError: string | null;
  draftExecutionPlan: Record<string, unknown> | null;
  wordCountWarnings: Record<string, { word_limit: number; actual: number; overage: number }>;
  missingSections: string[];

  // Figure generation
  overviewFigureUrl: string | null;
  overviewFigureAlt: string | null;
  generatingFigure: boolean;
  onGenerateFigure: (customInstructions?: string) => void;

  // Meta-agent state
  metaAgentEvents: MetaAgentEvent[];
  agentQuestions: AgentQuestion[];
  coherenceResult: CoherenceResult | null;

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
  onGenerateSkeleton: (constraints?: import('./phases/IdeaPhase').SkeletonConstraints) => void;
  onSkeletonChange: (skeleton: Record<string, unknown>) => void;
  onGenerateDraft: (flaggedSections?: string[]) => void;
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
  onAnswerAgentQuestion: (questionId: string, answer: string) => void;
  onSkipAgentQuestion: (questionId: string) => void;
  onRefineDraft: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function useWorkspace(): WorkspaceContextType {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceContext.Provider');
  return ctx;
}

export default WorkspaceContext;
