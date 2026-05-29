'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import type { AIThinkingStepData } from '@/lib/callAnalysisStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EligibilityItem {
  item: string;
  met: boolean | null;
  notes?: string;
  critical?: boolean;
}

interface SectionRequirement {
  requirements?: string;
  word_limit?: number | null;
  page_limit?: string | null;
  priority?: string;
  key_asks?: string[];
  questions_to_address?: string[];
  evidence_needed?: string[];
}

interface Deadlines {
  full_proposal?: string | null;
  loi?: string | null;
  concept_note?: string | null;
  questions_due?: string | null;
}

interface KeyFocusArea {
  area: string;
  description?: string;
  why_it_matters?: string;
}

interface KeyPhrase {
  phrase: string;
  context?: string;
  significance?: string;
}

type CallAnalysisStatus = 'idle' | 'running' | 'completed' | 'failed';

interface CallRequirementsPanelProps {
  callAnalysis: Record<string, unknown>;
  callRequirementsText?: string;
  callAnalysisStatus?: CallAnalysisStatus;
  callAnalysisSteps?: AIThinkingStepData[];
  onReanalyze?: () => void;
  onReset?: () => void;
  reanalyzing?: boolean;
  analysisError?: string | null;
  softTimeout?: boolean;
  callIntelligence?: Record<string, unknown>;
}

function hasDisplayableContent(analysis: Record<string, unknown>): boolean {
  if (analysis.narrative_brief || analysis.summary) return true;
  const listKeys = [
    'call_background', 'funder_priorities', 'strategic_objectives', 'requirements_overview',
    'required_sections', 'evaluation_criteria', 'risks', 'missing_information', 'thematic_areas',
  ];
  for (const key of listKeys) {
    const val = analysis[key];
    if (Array.isArray(val) && val.length > 0) return true;
  }
  if (Array.isArray(analysis.key_phrases) && analysis.key_phrases.length > 0) return true;
  if (Array.isArray(analysis.key_focus_areas) && analysis.key_focus_areas.length > 0) return true;
  const secReqs = analysis.section_requirements;
  if (secReqs && typeof secReqs === 'object' && Object.keys(secReqs as object).length > 0) return true;
  const scalars = [
    'budget_constraints', 'geographic_eligibility', 'award_amount', 'submission_portal',
  ];
  return scalars.some((k) => Boolean(analysis[k]));
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function CollapsibleGroup({
  label,
  count,
  defaultOpen = false,
  children,
}: {
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-left py-1"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-500 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        {count !== undefined && (
          <span className="text-xs text-gray-400 ml-1">({count})</span>
        )}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function BulletList({ items, className = '' }: { items: string[]; className?: string }) {
  return (
    <ul className={`space-y-2 ${className}`}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-gray-600 leading-snug">
          <span className="text-gray-300 flex-shrink-0 mt-0.5">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CallRequirementsPanel({
  callAnalysis,
  callRequirementsText,
  callAnalysisStatus = 'idle',
  callAnalysisSteps,
  onReanalyze,
  onReset,
  reanalyzing,
  analysisError,
  softTimeout,
  callIntelligence,
}: CallRequirementsPanelProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [expandedFocusArea, setExpandedFocusArea] = useState<string | null>(null);
  const [adversarialExpanded, setAdversarialExpanded] = useState(false);

  const isRunning = reanalyzing || callAnalysisStatus === 'running';

  const displaySteps = callAnalysisSteps && callAnalysisSteps.length > 0 ? callAnalysisSteps : null;

  // Smooth progress bar: tracks a displayed pct that drifts forward during active steps
  const [displayedPct, setDisplayedPct] = useState(5);
  const driftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isRunning) {
      if (driftTimerRef.current) clearInterval(driftTimerRef.current);
      setDisplayedPct(5);
      return;
    }
    if (!displaySteps) return;

    const total = displaySteps.length;
    const doneCount = displaySteps.filter((s) => s.status === 'done').length;
    const hasActive = displaySteps.some((s) => s.status === 'active');

    // Real percentage from completed steps (leaves headroom for drift)
    const realPct = Math.round((doneCount / total) * 80) + 5;

    // Snap forward to real progress when a step actually completes
    setDisplayedPct((prev) => Math.max(prev, realPct));

    // While a step is active, drift slowly toward the next milestone
    if (driftTimerRef.current) clearInterval(driftTimerRef.current);
    if (hasActive) {
      // Ceiling: 4% before where the next milestone would be
      const nextMilestonePct = Math.round(((doneCount + 1) / total) * 80) + 5;
      const ceiling = nextMilestonePct - 4;

      driftTimerRef.current = setInterval(() => {
        setDisplayedPct((prev) => {
          if (prev >= ceiling) return prev;
          // Ease-out: faster at start, slower near ceiling
          const remaining = ceiling - prev;
          const step = Math.max(0.08, remaining * 0.015);
          return Math.min(prev + step, ceiling);
        });
      }, 600);
    }

    return () => {
      if (driftTimerRef.current) clearInterval(driftTimerRef.current);
    };
  }, [isRunning, displaySteps]);

  if (isRunning) {
    return (
      <div className="space-y-4 py-4">
        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500 shrink-0" />
            <span className="font-medium text-gray-700">Analyzing call document…</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-400"
              style={{
                width: `${displayedPct}%`,
                transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </div>
        </div>
        {/* Step log */}
        {displaySteps ? (
          <div className="space-y-1">
            {displaySteps.map((step) => (
              <div key={step.id} className="flex items-start gap-2 text-xs">
                {step.status === 'done' && (
                  <span className="mt-px text-green-500 shrink-0">✓</span>
                )}
                {step.status === 'active' && (
                  <span className="mt-px w-3.5 h-3.5 shrink-0 flex items-center justify-center">
                    <span className="block w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  </span>
                )}
                {step.status === 'pending' && (
                  <span className="mt-px text-gray-300 shrink-0">·</span>
                )}
                {step.status === 'error' && (
                  <span className="mt-px text-red-500 shrink-0">✗</span>
                )}
                <span className={
                  step.status === 'done' ? 'text-gray-400' :
                  step.status === 'active' ? 'text-gray-700 font-medium' :
                  step.status === 'error' ? 'text-red-600' :
                  'text-gray-300'
                }>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">This may take 1–5 minutes for long call documents.</p>
        )}
        <div className="pt-1 flex items-center gap-3">
          {onReanalyze && (
            <button
              type="button"
              onClick={onReanalyze}
              className="text-xs text-gray-400 hover:text-indigo-600 underline transition-colors"
            >
              Stuck? Force re-analyze
            </button>
          )}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="text-xs text-red-400 hover:text-red-600 underline transition-colors"
            >
              Cancel &amp; reset
            </button>
          )}
        </div>
      </div>
    );
  }

  const hasAnalysisObject = callAnalysis && Object.keys(callAnalysis).length > 0;
  const hasContent = hasAnalysisObject && hasDisplayableContent(callAnalysis);

  if (!hasAnalysisObject && !callRequirementsText?.trim()) {
    return (
      <p className="text-sm text-gray-400 italic">
        Upload a call document to generate a detailed brief.
      </p>
    );
  }

  if (!hasAnalysisObject && callRequirementsText?.trim()) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-gray-700">Call Requirements</p>
        <pre className="text-sm text-gray-600 whitespace-pre-wrap font-sans leading-relaxed">
          {callRequirementsText}
        </pre>
        {onReanalyze && (
          <button
            type="button"
            onClick={onReanalyze}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            Re-analyze for structured intelligence
          </button>
        )}
      </div>
    );
  }

  // --- Existing fields ---
  const narrativeBrief = callAnalysis.narrative_brief as string | undefined;
  const summary = callAnalysis.summary as string | undefined;
  const awardAmount = callAnalysis.award_amount as string | undefined;
  const projectDuration = callAnalysis.project_duration as string | undefined;
  const wordLimit = callAnalysis.word_limit as string | undefined;
  const deadlines = callAnalysis.deadlines as Deadlines | undefined;
  const requiredSections = callAnalysis.required_sections as string[] | undefined;
  const sectionRequirements = callAnalysis.section_requirements as Record<string, SectionRequirement> | undefined;
  const evaluationCriteria = callAnalysis.evaluation_criteria as string[] | undefined;
  const eligibilityChecklist = callAnalysis.eligibility_checklist as EligibilityItem[] | undefined;
  const risks = callAnalysis.risks as string[] | undefined;
  const missingInformation = callAnalysis.missing_information as string[] | undefined;
  const submissionPortal = callAnalysis.submission_portal as string | undefined;
  const foaNumber = callAnalysis.foa_number as string | undefined;
  const budgetConstraints = callAnalysis.budget_constraints as string | undefined;
  const geographicEligibility = callAnalysis.geographic_eligibility as string | undefined;

  // --- New fields ---
  const callBackground = callAnalysis.call_background as string[] | undefined;
  const funderPriorities = callAnalysis.funder_priorities as string[] | undefined;
  const strategicObjectives = callAnalysis.strategic_objectives as string[] | undefined;
  const keyFocusAreas = callAnalysis.key_focus_areas as KeyFocusArea[] | undefined;
  const keyPhrases = callAnalysis.key_phrases as KeyPhrase[] | undefined;
  const requirementsOverview = callAnalysis.requirements_overview as string[] | undefined;
  const administrativeRequirements = callAnalysis.administrative_requirements as string[] | undefined;

  // Detect whether the new enhanced fields are present (post-deployment analysis)
  const isEnhanced = !!(
    callBackground?.length ||
    requirementsOverview?.length ||
    funderPriorities?.length ||
    strategicObjectives?.length ||
    (keyPhrases?.length ?? 0) > 0 ||
    (keyFocusAreas?.length ?? 0) > 0
  );

  const analysisErrorMsg =
    analysisError ||
    (typeof callAnalysis.error === 'string' ? callAnalysis.error : null);

  const primaryDeadline = deadlines?.full_proposal || deadlines?.concept_note || deadlines?.loi;

  const statParts = [
    awardAmount,
    primaryDeadline,
    wordLimit ? `${wordLimit} words` : null,
    projectDuration,
  ].filter(Boolean) as string[];

  const criticalFlags = (eligibilityChecklist || []).filter(
    (item) => item.critical && item.met === false
  );

  const sectionKeys = requiredSections?.length
    ? requiredSections
    : Object.keys(sectionRequirements || {});

  const deadlineEntries = Object.entries(deadlines || {}).filter(([, v]) => v);

  // --- Call intelligence badges ---
  const ciTypeLabel = callIntelligence?.call_type_label as string | undefined;
  const ciAdversarial = callIntelligence?.adversarial_challenges as {
    rejection_risks?: string[];
    compliance_gaps?: string[];
  } | undefined;
  const rejectionRisks = ciAdversarial?.rejection_risks || [];
  const complianceGaps = ciAdversarial?.compliance_gaps || [];
  const totalRisks = rejectionRisks.length + complianceGaps.length;

  return (
    <div className="space-y-5">
      {/* Call intelligence summary row */}
      {(ciTypeLabel || totalRisks > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {ciTypeLabel && (
            <span className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
              {ciTypeLabel}
            </span>
          )}
          {totalRisks > 0 && (
            <button
              type="button"
              onClick={() => setAdversarialExpanded(v => !v)}
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
              {totalRisks} reviewer risk{totalRisks !== 1 ? 's' : ''} identified
              <ChevronDown className={`w-3 h-3 transition-transform ${adversarialExpanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      )}
      {adversarialExpanded && totalRisks > 0 && (
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 space-y-2.5 text-xs">
          {rejectionRisks.length > 0 && (
            <div>
              <p className="font-semibold text-amber-800 mb-1">Reviewer rejection risks</p>
              <ul className="space-y-1">
                {rejectionRisks.map((r, i) => (
                  <li key={i} className="flex gap-1.5 text-amber-700"><span>⚠</span><span>{r}</span></li>
                ))}
              </ul>
            </div>
          )}
          {complianceGaps.length > 0 && (
            <div>
              <p className="font-semibold text-amber-800 mb-1">Compliance gaps</p>
              <ul className="space-y-1">
                {complianceGaps.map((c, i) => (
                  <li key={i} className="flex gap-1.5 text-amber-700"><span>✗</span><span>{c}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {softTimeout && !analysisErrorMsg && !isRunning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Analysis is taking longer than expected. The job is still running in the background — refresh the page later to see results.
          {onReanalyze && (
            <button type="button" onClick={onReanalyze} className="ml-2 font-medium underline hover:no-underline">
              Try again now
            </button>
          )}
        </div>
      )}

      {analysisErrorMsg && !softTimeout && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {analysisErrorMsg}
          {onReanalyze && (
            <button
              type="button"
              onClick={onReanalyze}
              className="ml-2 font-medium underline hover:no-underline"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {/* Stats line */}
      {(statParts.length > 0 || foaNumber) && (
        <p className="text-sm text-gray-500">
          {statParts.map((part, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-2 text-gray-300">·</span>}
              {part}
            </span>
          ))}
          {foaNumber && (
            <span>
              <span className="mx-2 text-gray-300">·</span>
              <span>Ref: {foaNumber}</span>
            </span>
          )}
        </p>
      )}

      {/* Critical eligibility warnings */}
      {criticalFlags.map((item, i) => (
        <p key={i} className="text-sm text-red-600 leading-snug">
          ⚠ {item.item}{item.notes ? ` — ${item.notes}` : ''}
        </p>
      ))}

      {/* Geographic restriction warning */}
      {geographicEligibility && (
        <p className="text-sm text-orange-600 leading-snug">
          ⚠ Eligibility: {geographicEligibility}
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Call brief — show whenever present (legacy or alongside enhanced sections) */}
      {(narrativeBrief || summary) && !isEnhanced && (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-gray-700">Call Brief</p>
          <div className="text-sm text-gray-700 leading-relaxed space-y-2.5">
            {(narrativeBrief || summary || '').split('\n\n').filter(Boolean).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      )}

      {/* Re-analyze nudge only when there is no displayable structured content */}
      {!hasContent && !analysisErrorMsg && !isRunning && onReanalyze && (
        <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-indigo-50 border border-indigo-100">
          <RefreshCw className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
          <p className="text-xs text-indigo-700 flex-1">
            Re-analyze to get Background, Objectives, Key Phrases and more
          </p>
          <button
            type="button"
            onClick={onReanalyze}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap"
          >
            Re-analyze
          </button>
        </div>
      )}

      {/* Fallback: formatted requirements text when JSON has no renderable fields */}
      {!hasContent && callRequirementsText?.trim() && (
        <CollapsibleGroup label="Call Requirements" defaultOpen>
          <pre className="text-sm text-gray-600 whitespace-pre-wrap font-sans leading-relaxed">
            {callRequirementsText}
          </pre>
        </CollapsibleGroup>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* NEW: Background & Context                                           */}
      {/* ------------------------------------------------------------------ */}
      {callBackground && callBackground.length > 0 && (
        <CollapsibleGroup
          label="Background & Context"
          count={callBackground.length}
          defaultOpen
        >
          <BulletList items={callBackground} />
        </CollapsibleGroup>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* NEW: What They're Looking For                                       */}
      {/* ------------------------------------------------------------------ */}
      {requirementsOverview && requirementsOverview.length > 0 && (
        <CollapsibleGroup
          label="What They're Looking For"
          count={requirementsOverview.length}
          defaultOpen
        >
          <BulletList items={requirementsOverview} />
        </CollapsibleGroup>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* NEW: Funder Priorities                                              */}
      {/* ------------------------------------------------------------------ */}
      {funderPriorities && funderPriorities.length > 0 && (
        <CollapsibleGroup
          label="Funder Priorities"
          count={funderPriorities.length}
          defaultOpen
        >
          <ol className="space-y-2 pl-1">
            {funderPriorities.map((p, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-600 leading-snug">
                <span className="text-gray-400 shrink-0 font-medium">{i + 1}.</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
        </CollapsibleGroup>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* NEW: Strategic Objectives                                           */}
      {/* ------------------------------------------------------------------ */}
      {strategicObjectives && strategicObjectives.length > 0 && (
        <CollapsibleGroup
          label="Strategic Objectives"
          count={strategicObjectives.length}
        >
          <BulletList items={strategicObjectives} />
        </CollapsibleGroup>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* NEW: Key Focus Areas                                                */}
      {/* ------------------------------------------------------------------ */}
      {keyFocusAreas && keyFocusAreas.length > 0 && (
        <CollapsibleGroup
          label="Key Focus Areas"
          count={keyFocusAreas.length}
        >
          <div className="space-y-2">
            {keyFocusAreas.map((area) => {
              const isOpen = expandedFocusArea === area.area;
              const hasDetail = area.description || area.why_it_matters;
              return (
                <div key={area.area} className="border border-gray-100 rounded-md">
                  <button
                    type="button"
                    onClick={() => hasDetail && setExpandedFocusArea(isOpen ? null : area.area)}
                    className={`flex items-center gap-2 w-full text-left px-3 py-2 ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    {hasDetail && (
                      <ChevronDown
                        className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                      />
                    )}
                    {!hasDetail && <span className="w-3 flex-shrink-0" />}
                    <span className="text-sm font-medium text-gray-800">{area.area}</span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 space-y-1.5 border-t border-gray-100 pt-2">
                      {area.description && (
                        <p className="text-sm text-gray-600 leading-snug">{area.description}</p>
                      )}
                      {area.why_it_matters && (
                        <p className="text-xs text-indigo-600 leading-snug">
                          Why it matters: {area.why_it_matters}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleGroup>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* NEW: Key Phrases                                                    */}
      {/* ------------------------------------------------------------------ */}
      {keyPhrases && keyPhrases.length > 0 && (
        <CollapsibleGroup
          label="Key Phrases to Use"
          count={keyPhrases.length}
        >
          <div className="space-y-3">
            {keyPhrases.map((kp, i) => (
              <div key={i} className="pl-3 border-l-2 border-indigo-100">
                <p className="text-sm text-gray-800 italic">&ldquo;{kp.phrase}&rdquo;</p>
                {kp.significance && (
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug">{kp.significance}</p>
                )}
              </div>
            ))}
          </div>
        </CollapsibleGroup>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Existing: Required Sections                                         */}
      {/* ------------------------------------------------------------------ */}
      {sectionKeys.length > 0 && (
        <CollapsibleGroup
          label="Required Sections"
          count={sectionKeys.length}
          defaultOpen
        >
          <div className="divide-y divide-gray-100">
            {sectionKeys.map((sec) => {
              const req = sectionRequirements?.[sec];
              const isExpanded = expandedSection === sec;
              const hasDetails =
                req &&
                (
                  (req.key_asks?.length ?? 0) > 0 ||
                  (req.questions_to_address?.length ?? 0) > 0 ||
                  (req.evidence_needed?.length ?? 0) > 0
                );
              return (
                <div key={sec} className="py-2.5">
                  <div
                    className={`flex items-baseline gap-2 ${hasDetails ? 'cursor-pointer' : ''}`}
                    onClick={() => hasDetails && setExpandedSection(isExpanded ? null : sec)}
                  >
                    {hasDetails && (
                      <ChevronDown
                        className={`w-3 h-3 text-gray-400 flex-shrink-0 mt-0.5 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                      />
                    )}
                    {!hasDetails && <span className="w-3 flex-shrink-0" />}
                    <span className="text-sm font-medium text-gray-800 flex-1">{sec}</span>
                    {req?.word_limit && (
                      <span className="text-xs text-gray-400">{req.word_limit} words</span>
                    )}
                    {req?.page_limit && !req?.word_limit && (
                      <span className="text-xs text-gray-400">{req.page_limit} pages</span>
                    )}
                    {req?.priority && (
                      <span className={`text-xs ${req.priority === 'high' ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
                        {req.priority.charAt(0).toUpperCase() + req.priority.slice(1)}
                      </span>
                    )}
                  </div>
                  {req?.requirements && !isExpanded && (
                    <p className="text-sm text-gray-400 mt-0.5 pl-5 truncate">{req.requirements}</p>
                  )}
                  {isExpanded && (
                    <div className="mt-2.5 pl-5 space-y-3.5">
                      {req?.requirements && (
                        <p className="text-sm text-gray-600">{req.requirements}</p>
                      )}
                      {req?.key_asks && req.key_asks.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">What the funder asks for</p>
                          <BulletList items={req.key_asks} />
                        </div>
                      )}
                      {req?.questions_to_address && req.questions_to_address.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Questions to answer</p>
                          <BulletList items={req.questions_to_address} />
                        </div>
                      )}
                      {req?.evidence_needed && req.evidence_needed.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Evidence needed</p>
                          <BulletList items={req.evidence_needed} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleGroup>
      )}

      {/* Evaluation Criteria */}
      {Array.isArray(evaluationCriteria) && evaluationCriteria.length > 0 && (
        <CollapsibleGroup label="Evaluation Criteria" count={evaluationCriteria.length}>
          <ol className="space-y-1.5 pl-1">
            {evaluationCriteria.map((c, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-600">
                <span className="text-gray-400 shrink-0">{i + 1}.</span>
                <span>{c}</span>
              </li>
            ))}
          </ol>
        </CollapsibleGroup>
      )}

      {/* Key Dates */}
      {deadlineEntries.length > 0 && (
        <CollapsibleGroup label="Key Dates" count={deadlineEntries.length}>
          <div className="space-y-1.5">
            {deadlineEntries.map(([key, val]) => (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-gray-500 capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="text-gray-800 font-medium">{typeof val === 'string' ? val : JSON.stringify(val)}</span>
              </div>
            ))}
          </div>
        </CollapsibleGroup>
      )}

      {/* Budget & Award */}
      {budgetConstraints && (
        <CollapsibleGroup label="Budget & Award">
          <p className="text-sm text-gray-600">{budgetConstraints}</p>
        </CollapsibleGroup>
      )}

      {/* Risks */}
      {Array.isArray(risks) && risks.length > 0 && (
        <CollapsibleGroup label="Risks" count={risks.length}>
          <BulletList items={risks} />
        </CollapsibleGroup>
      )}

      {/* Submission */}
      {submissionPortal && (
        <CollapsibleGroup label="Submission">
          <p className="text-sm text-gray-600">{submissionPortal}</p>
        </CollapsibleGroup>
      )}

      {/* Missing information */}
      {Array.isArray(missingInformation) && missingInformation.length > 0 && (
        <CollapsibleGroup label="Still Need to Find Out" count={missingInformation.length}>
          <ul className="space-y-1.5">
            {missingInformation.map((m, i) => (
              <li key={i} className="text-sm text-gray-600">? {m}</li>
            ))}
          </ul>
        </CollapsibleGroup>
      )}

      {/* Administrative & Compliance — collapsed at bottom, not primary for grant writers */}
      {administrativeRequirements && administrativeRequirements.length > 0 && (
        <CollapsibleGroup
          label="Administrative & Compliance"
          count={administrativeRequirements.length}
        >
          <BulletList items={administrativeRequirements} />
        </CollapsibleGroup>
      )}

      {/* Full Call Brief — collapsed at bottom for enhanced analyses */}
      {isEnhanced && (narrativeBrief || summary) && (
        <CollapsibleGroup label="Full Call Brief">
          <div className="text-sm text-gray-700 leading-relaxed space-y-2.5">
            {(narrativeBrief || summary || '').split('\n\n').filter(Boolean).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </CollapsibleGroup>
      )}
    </div>
  );
}
