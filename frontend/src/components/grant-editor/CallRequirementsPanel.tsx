'use client';

interface CallRequirementsPanelProps {
  callAnalysis: Record<string, unknown>;
}

export default function CallRequirementsPanel({ callAnalysis }: CallRequirementsPanelProps) {
  if (!callAnalysis || Object.keys(callAnalysis).length === 0) {
    return (
      <div className="text-xs text-gray-400 italic p-3 bg-gray-50 rounded-lg border border-dashed border-gray-200">
        Upload a call document to auto-extract requirements.
      </div>
    );
  }

  const criteria = (callAnalysis.evaluation_criteria as string[]) || [];
  const sections = (callAnalysis.required_sections as string[]) || [];
  const risks = (callAnalysis.risks as string[]) || [];

  return (
    <div className="space-y-3">
      {callAnalysis.summary ? (
        <div className="text-xs text-gray-700 bg-white border border-gray-200 rounded-lg p-3">
          <div className="font-semibold text-gray-800 mb-1">Summary</div>
          {String(callAnalysis.summary)}
        </div>
      ) : null}

      {criteria.length > 0 && (
        <div className="text-xs bg-white border border-gray-200 rounded-lg p-3">
          <div className="font-semibold text-gray-800 mb-1.5">Evaluation Criteria</div>
          <ul className="list-disc list-inside space-y-0.5 text-gray-600">
            {criteria.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {sections.length > 0 && (
        <div className="text-xs bg-white border border-gray-200 rounded-lg p-3">
          <div className="font-semibold text-gray-800 mb-1.5">Required Sections</div>
          <ul className="list-disc list-inside space-y-0.5 text-gray-600">
            {sections.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        {callAnalysis.word_limit ? (
          <div className="bg-amber-50 border border-amber-100 rounded p-2">
            <span className="font-medium text-amber-800">Word limit:</span> {String(callAnalysis.word_limit)}
          </div>
        ) : null}
        {callAnalysis.page_limit ? (
          <div className="bg-amber-50 border border-amber-100 rounded p-2">
            <span className="font-medium text-amber-800">Page limit:</span> {String(callAnalysis.page_limit)}
          </div>
        ) : null}
        {callAnalysis.award_amount ? (
          <div className="bg-green-50 border border-green-100 rounded p-2 col-span-2">
            <span className="font-medium text-green-800">Award:</span> {String(callAnalysis.award_amount)}
          </div>
        ) : null}
      </div>

      {risks.length > 0 && (
        <div className="text-xs bg-red-50 border border-red-100 rounded-lg p-3">
          <div className="font-semibold text-red-800 mb-1">Risks</div>
          <ul className="list-disc list-inside space-y-0.5 text-red-700">
            {risks.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
