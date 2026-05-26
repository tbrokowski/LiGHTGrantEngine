'use client';

export const DEFAULT_INTRO_ARC = [
  { beat: 'broad_statement', label: 'Broad opening statement (global significance)', guidance: '' },
  { beat: 'context', label: 'Context (setting, stakeholders, geography)', guidance: '' },
  { beat: 'problem', label: 'Problem (evidence-backed gap)', guidance: '' },
  { beat: 'solution', label: 'Proposed solution (your approach)', guidance: '' },
  { beat: 'limitations', label: 'Potential limitations / counterarguments', guidance: '' },
  { beat: 'resolution', label: 'Resolution (why this team, why now, why this works)', guidance: '' },
];

interface IntroArcEditorProps {
  introArc: Array<{ beat: string; label: string; guidance: string }>;
  onChange: (arc: Array<{ beat: string; label: string; guidance: string }>) => void;
}

export default function IntroArcEditor({ introArc, onChange }: IntroArcEditorProps) {
  return (
    <div className="space-y-2 mt-2 pl-3 border-l-2 border-indigo-200">
      <div className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">Intro Narrative Arc</div>
      {introArc.map((beat, i) => (
        <div key={beat.beat} className="space-y-0.5">
          <label className="text-[10px] text-gray-500">{i + 1}. {beat.label}</label>
          <input
            type="text"
            value={beat.guidance}
            onChange={(e) => {
              const updated = [...introArc];
              updated[i] = { ...beat, guidance: e.target.value };
              onChange(updated);
            }}
            placeholder="Guidance for this beat..."
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>
      ))}
    </div>
  );
}
