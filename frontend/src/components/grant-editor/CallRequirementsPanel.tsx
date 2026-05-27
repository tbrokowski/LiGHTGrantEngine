'use client';

import { Calendar, DollarSign, FileText, Clock, AlertTriangle, CheckSquare, ArrowRight } from 'lucide-react';

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

function QuickChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-3 py-1.5 text-xs">
      <span className="text-gray-400">{icon}</span>
      <span className="text-gray-500">{label}:</span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

export default function CallRequirementsPanel({ callAnalysis }: CallRequirementsPanelProps) {
  if (!callAnalysis || Object.keys(callAnalysis).length === 0) {
    return (
      <div className="text-xs text-gray-400 italic p-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
        Upload a call document to generate a detailed brief.
      </div>
    );
  }

  const narrativeBrief = callAnalysis.narrative_brief as string | undefined;
  const summary = callAnalysis.summary as string | undefined;
  const awardAmount = callAnalysis.award_amount as string | undefined;
  const projectDuration = callAnalysis.project_duration as string | undefined;
  const wordLimit = callAnalysis.word_limit as string | undefined;
  const pageLimit = callAnalysis.page_limit as string | undefined;
  const deadlines = callAnalysis.deadlines as Deadlines | undefined;
  const requiredSections = callAnalysis.required_sections as string[] | undefined;
  const sectionRequirements = callAnalysis.section_requirements as Record<string, SectionRequirement> | undefined;
  const evaluationCriteria = callAnalysis.evaluation_criteria as string[] | undefined;
  const eligibilityChecklist = callAnalysis.eligibility_checklist as EligibilityItem[] | undefined;
  const risks = callAnalysis.risks as string[] | undefined;
  const missingInformation = callAnalysis.missing_information as string[] | undefined;
  const recommendedNextSteps = callAnalysis.recommended_next_steps as string[] | undefined;
  const geographicEligibility = callAnalysis.geographic_eligibility as string | undefined;
  const budgetConstraints = callAnalysis.budget_constraints as string | undefined;
  const submissionPortal = callAnalysis.submission_portal as string | undefined;
  const foaNumber = callAnalysis.foa_number as string | undefined;
  const rawContactInfo = callAnalysis.contact_info;
  const contactInfo: string | undefined =
    typeof rawContactInfo === 'string'
      ? rawContactInfo
      : rawContactInfo && typeof rawContactInfo === 'object'
      ? [
          (rawContactInfo as Record<string, unknown>).program_officer_name,
          (rawContactInfo as Record<string, unknown>).email,
          (rawContactInfo as Record<string, unknown>).questions_deadline
            ? `Questions by: ${(rawContactInfo as Record<string, unknown>).questions_deadline}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;

  // Build quick-glance chips
  const chips: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (awardAmount) chips.push({ icon: <DollarSign className="w-3 h-3" />, label: 'Award', value: awardAmount });
  if (projectDuration) chips.push({ icon: <Clock className="w-3 h-3" />, label: 'Duration', value: projectDuration });
  const primaryDeadline = deadlines?.full_proposal || deadlines?.concept_note || deadlines?.loi;
  if (primaryDeadline) chips.push({ icon: <Calendar className="w-3 h-3" />, label: 'Deadline', value: primaryDeadline });
  if (wordLimit) chips.push({ icon: <FileText className="w-3 h-3" />, label: 'Words', value: wordLimit });
  if (pageLimit) chips.push({ icon: <FileText className="w-3 h-3" />, label: 'Pages', value: pageLimit });

  // Critical eligibility flags
  const criticalFlags = (eligibilityChecklist || []).filter(
    (item) => item.critical && item.met === false
  );
  const eligibilityWarnings = (eligibilityChecklist || []).filter(
    (item) => item.met === false && !item.critical
  );

  return (
    <div className="space-y-4">
      {/* Quick-glance chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip, i) => (
            <QuickChip key={i} icon={chip.icon} label={chip.label} value={chip.value} />
          ))}
          {foaNumber && (
            <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-3 py-1.5 text-xs text-blue-700">
              <span className="font-medium">Ref:</span> {foaNumber}
            </div>
          )}
        </div>
      )}

      {/* Critical eligibility blockers */}
      {criticalFlags.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-red-800">
            <AlertTriangle className="w-3.5 h-3.5" />
            Critical eligibility concerns
          </div>
          {criticalFlags.map((item, i) => (
            <div key={i} className="text-xs text-red-700 pl-5">
              • {item.item}{item.notes ? ` — ${item.notes}` : ''}
            </div>
          ))}
        </div>
      )}

      {/* Narrative brief — the main content */}
      {narrativeBrief ? (
        <Section title="Call Brief">
          <div className="text-xs text-gray-700 leading-relaxed bg-white border border-gray-200 rounded-lg p-4 space-y-3">
            {narrativeBrief.split('\n\n').filter(Boolean).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </Section>
      ) : summary ? (
        <Section title="Summary">
          <div className="text-xs text-gray-700 bg-white border border-gray-200 rounded-lg p-3">
            {summary}
          </div>
        </Section>
      ) : null}

      {/* Required sections with per-section limits */}
      {(requiredSections?.length || (sectionRequirements && Object.keys(sectionRequirements).length)) ? (
        <Section title="Required Sections">
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {(requiredSections || Object.keys(sectionRequirements || {})).map((sec, i) => {
              const req = sectionRequirements?.[sec];
              return (
                <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-medium text-gray-800">{sec}</span>
                    {req?.requirements && (
                      <p className="text-gray-500 mt-0.5">{req.requirements}</p>
                    )}
                  </div>
                  {(req?.word_limit || req?.page_limit) && (
                    <span className="text-gray-400 whitespace-nowrap">
                      {req.word_limit ? `${req.word_limit}w` : ''}{req.word_limit && req.page_limit ? ' / ' : ''}{req.page_limit ? `${req.page_limit}p` : ''}
                    </span>
                  )}
                  {req?.priority === 'high' && (
                    <span className="text-red-600 text-xs font-medium">High</span>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      {/* Evaluation criteria */}
      {evaluationCriteria?.length ? (
        <Section title="Evaluation Criteria">
          <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-1">
            {evaluationCriteria.map((c, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-700">
                <span className="text-indigo-400 font-bold flex-shrink-0">{i + 1}.</span>
                <span>{c}</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Budget constraints */}
      {budgetConstraints && (
        <Section title="Budget & Award">
          <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-700">
            {budgetConstraints}
          </div>
        </Section>
      )}

      {/* All deadlines */}
      {deadlines && Object.values(deadlines).some(Boolean) && (
        <Section title="Key Dates">
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {Object.entries(deadlines).map(([key, val]) =>
              val ? (
                <div key={key} className="flex justify-between items-center px-3 py-2 text-xs">
                  <span className="text-gray-500 capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className="font-medium text-gray-800">{typeof val === 'string' ? val : JSON.stringify(val)}</span>
                </div>
              ) : null
            )}
          </div>
        </Section>
      )}

      {/* Geographic eligibility */}
      {geographicEligibility && (
        <Section title="Geographic Eligibility">
          <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-700">
            {geographicEligibility}
          </div>
        </Section>
      )}

      {/* Eligibility warnings (non-critical) */}
      {eligibilityWarnings.length > 0 && (
        <Section title="Eligibility Notes">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
            {eligibilityWarnings.map((item, i) => (
              <div key={i} className="text-xs text-amber-800">
                • {item.item}{item.notes ? ` — ${item.notes}` : ''}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Submission info */}
      {(submissionPortal || contactInfo) && (
        <Section title="Submission">
          <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-1 text-xs text-gray-700">
            {submissionPortal && <p><span className="font-medium">Portal:</span> {submissionPortal}</p>}
            {contactInfo && <p><span className="font-medium">Contact:</span> {contactInfo}</p>}
          </div>
        </Section>
      )}

      {/* Risks */}
      {risks?.length ? (
        <Section title="Risks & Concerns">
          <div className="bg-red-50 border border-red-100 rounded-lg p-3 space-y-1">
            {risks.map((r, i) => (
              <div key={i} className="text-xs text-red-700 flex gap-2">
                <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Missing information */}
      {missingInformation?.length ? (
        <Section title="Still Need to Find Out">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
            {missingInformation.map((m, i) => (
              <div key={i} className="text-xs text-gray-600 flex gap-2">
                <span className="text-gray-400 flex-shrink-0">?</span>
                <span>{m}</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Next steps */}
      {recommendedNextSteps?.length ? (
        <Section title="Recommended Next Steps">
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 space-y-1">
            {recommendedNextSteps.map((step, i) => (
              <div key={i} className="flex gap-2 text-xs text-indigo-800">
                <ArrowRight className="w-3 h-3 flex-shrink-0 mt-0.5 text-indigo-400" />
                <span>{step}</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
