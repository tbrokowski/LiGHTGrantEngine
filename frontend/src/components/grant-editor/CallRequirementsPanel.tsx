'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

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

interface CallRequirementsPanelProps {
  callAnalysis: Record<string, unknown>;
}

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
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        {count !== undefined && (
          <span className="text-xs text-gray-400 ml-1">({count})</span>
        )}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

export default function CallRequirementsPanel({ callAnalysis }: CallRequirementsPanelProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  if (!callAnalysis || Object.keys(callAnalysis).length === 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        Upload a call document to generate a detailed brief.
      </p>
    );
  }

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

  const primaryDeadline = deadlines?.full_proposal || deadlines?.concept_note || deadlines?.loi;

  // Build stats line
  const statParts = [
    awardAmount,
    primaryDeadline,
    wordLimit ? `${wordLimit} words` : null,
    projectDuration,
  ].filter(Boolean);

  // Critical eligibility flags
  const criticalFlags = (eligibilityChecklist || []).filter(
    (item) => item.critical && item.met === false
  );

  const sectionKeys = requiredSections?.length
    ? requiredSections
    : Object.keys(sectionRequirements || {});

  const deadlineEntries = Object.entries(deadlines || {}).filter(([, v]) => v);

  return (
    <div className="space-y-4">
      {/* Stats line */}
      {statParts.length > 0 && (
        <p className="text-xs text-gray-400">
          {statParts.map((part, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1.5">·</span>}
              {part}
            </span>
          ))}
          {foaNumber && (
            <span>
              <span className="mx-1.5">·</span>
              <span>Ref: {foaNumber}</span>
            </span>
          )}
        </p>
      )}

      {/* Critical eligibility warnings */}
      {criticalFlags.map((item, i) => (
        <p key={i} className="text-xs text-red-600">
          ⚠ {item.item}{item.notes ? ` — ${item.notes}` : ''}
        </p>
      ))}

      {/* Geographic restriction warning */}
      {geographicEligibility && (
        <p className="text-xs text-orange-600">
          ⚠ Eligibility: {geographicEligibility}
        </p>
      )}

      {/* Call Brief */}
      {(narrativeBrief || summary) && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-500">Call Brief</p>
          <div className="text-xs text-gray-700 leading-relaxed space-y-2">
            {(narrativeBrief || summary || '').split('\n\n').filter(Boolean).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      )}

      {/* Required Sections — expanded by default */}
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
                <div key={sec} className="py-2">
                  <div
                    className={`flex items-baseline gap-2 ${hasDetails ? 'cursor-pointer' : ''}`}
                    onClick={() => hasDetails && setExpandedSection(isExpanded ? null : sec)}
                  >
                    {hasDetails && (
                      <ChevronDown
                        className={`w-3 h-3 text-gray-300 flex-shrink-0 mt-0.5 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
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
                    <p className="text-xs text-gray-400 mt-0.5 pl-5 truncate">{req.requirements}</p>
                  )}
                  {isExpanded && (
                    <div className="mt-2 pl-5 space-y-3">
                      {req?.requirements && (
                        <p className="text-xs text-gray-600">{req.requirements}</p>
                      )}
                      {req?.key_asks && req.key_asks.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500">What the funder asks for</p>
                          <ul className="mt-1 space-y-0.5">
                            {req.key_asks.map((ask, i) => (
                              <li key={i} className="text-xs text-gray-600">• {ask}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {req?.questions_to_address && req.questions_to_address.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500">Questions to answer</p>
                          <ul className="mt-1 space-y-0.5">
                            {req.questions_to_address.map((q, i) => (
                              <li key={i} className="text-xs text-gray-600">• {q}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {req?.evidence_needed && req.evidence_needed.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500">Evidence needed</p>
                          <ul className="mt-1 space-y-0.5">
                            {req.evidence_needed.map((e, i) => (
                              <li key={i} className="text-xs text-gray-600">• {e}</li>
                            ))}
                          </ul>
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
          <ol className="space-y-1 pl-1">
            {evaluationCriteria.map((c, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-600">
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
          <div className="space-y-1">
            {deadlineEntries.map(([key, val]) => (
              <div key={key} className="flex justify-between text-xs">
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
          <p className="text-xs text-gray-600">{budgetConstraints}</p>
        </CollapsibleGroup>
      )}

      {/* Risks */}
      {Array.isArray(risks) && risks.length > 0 && (
        <CollapsibleGroup label="Risks" count={risks.length}>
          <ul className="space-y-1">
            {risks.map((r, i) => (
              <li key={i} className="text-xs text-gray-600">• {r}</li>
            ))}
          </ul>
        </CollapsibleGroup>
      )}

      {/* Submission */}
      {submissionPortal && (
        <CollapsibleGroup label="Submission">
          <p className="text-xs text-gray-600">{submissionPortal}</p>
        </CollapsibleGroup>
      )}

      {/* Missing information */}
      {Array.isArray(missingInformation) && missingInformation.length > 0 && (
        <CollapsibleGroup label="Still Need to Find Out" count={missingInformation.length}>
          <ul className="space-y-1">
            {missingInformation.map((m, i) => (
              <li key={i} className="text-xs text-gray-600">? {m}</li>
            ))}
          </ul>
        </CollapsibleGroup>
      )}
    </div>
  );
}
