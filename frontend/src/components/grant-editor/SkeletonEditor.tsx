'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Star, Pencil, Check, X } from 'lucide-react';

interface SkeletonEditorProps {
  rawText: string;
  onChange: (text: string) => void;
  flaggedSections: string[];
  onFlaggedChange: (names: string[]) => void;
}

interface Section {
  name: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Parsing / serialisation
// ---------------------------------------------------------------------------

function parseSections(rawText: string): Section[] {
  const sections: Section[] = [];
  let currentName: string | null = null;
  let currentLines: string[] = [];

  for (const line of rawText.split('\n')) {
    if (line.startsWith('## ')) {
      if (currentName !== null) {
        sections.push({ name: currentName, content: currentLines.join('\n').trimEnd() });
      }
      currentName = line.slice(3).trim();
      currentLines = [];
    } else if (currentName !== null) {
      currentLines.push(line);
    }
  }
  if (currentName !== null) {
    sections.push({ name: currentName, content: currentLines.join('\n').trimEnd() });
  }
  return sections;
}

function sectionsToRaw(sections: Section[]): string {
  return sections
    .map((s) => `## ${s.name}\n${s.content}`)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Inline content renderer (no external library)
// ---------------------------------------------------------------------------

function renderInline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(
      /\[TBD:[^\]]*\]/g,
      (m) =>
        `<mark class="bg-yellow-100 text-yellow-800 rounded px-0.5 not-italic font-normal">${m}</mark>`,
    );
}

function SectionContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    nodes.push(
      <ul key={key++} className="space-y-1.5 my-2">
        {bulletBuffer.map((b, i) => (
          <li key={i} className="flex gap-2 text-sm text-gray-700 leading-snug">
            <span className="text-indigo-400 mt-0.5 shrink-0 select-none">•</span>
            <span dangerouslySetInnerHTML={{ __html: renderInline(b) }} />
          </li>
        ))}
      </ul>,
    );
    bulletBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushBullets();
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      bulletBuffer.push(trimmed.slice(2));
    } else if (/^\(Target:/i.test(trimmed)) {
      flushBullets();
      nodes.push(
        <p key={key++} className="text-xs text-gray-400 italic mt-1">
          {trimmed}
        </p>,
      );
    } else if (/^\[TBD:/i.test(trimmed)) {
      flushBullets();
      nodes.push(
        <span
          key={key++}
          className="inline-flex items-center text-xs bg-yellow-50 border border-yellow-200 text-yellow-700 rounded px-2 py-0.5 my-1"
        >
          {trimmed}
        </span>,
      );
    } else {
      flushBullets();
      nodes.push(
        <p
          key={key++}
          className="text-sm text-gray-700 leading-snug my-1"
          dangerouslySetInnerHTML={{ __html: renderInline(trimmed) }}
        />,
      );
    }
  }
  flushBullets();
  return <div className="pt-1">{nodes}</div>;
}

// ---------------------------------------------------------------------------
// Individual section card
// ---------------------------------------------------------------------------

function SectionCard({
  section,
  index,
  flagged,
  onToggleFlag,
  onUpdate,
}: {
  section: Section;
  index: number;
  flagged: boolean;
  onToggleFlag: () => void;
  onUpdate: (updated: Section) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(section.name);
  const [editContent, setEditContent] = useState(section.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEdit = () => {
    setEditName(section.name);
    setEditContent(section.content);
    setEditing(true);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        autoResize(textareaRef.current);
      }
    }, 0);
  };

  const commit = () => {
    onUpdate({ name: editName.trim() || section.name, content: editContent });
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const isEmpty = !section.content.trim();

  return (
    <div className={`group rounded-xl border transition-colors ${flagged ? 'border-amber-300 bg-amber-50/30' : 'border-gray-200 bg-white'} overflow-hidden`}>
      {/* Header row */}
      <div className={`flex items-center gap-2 px-4 py-2.5 ${flagged ? 'bg-amber-50' : 'bg-gray-50'} border-b border-gray-100`}>
        <button
          type="button"
          onClick={onToggleFlag}
          title={flagged ? 'Remove star' : 'Star to prioritise in draft generation'}
          className="shrink-0 transition-colors"
        >
          <Star
            className={`w-4 h-4 transition-colors ${
              flagged ? 'fill-amber-400 text-amber-400' : 'text-gray-300 hover:text-amber-400'
            }`}
          />
        </button>

        {editing ? (
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="flex-1 text-sm font-semibold text-gray-800 bg-white border border-indigo-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            autoFocus
          />
        ) : (
          <h3 className="flex-1 text-sm font-semibold text-gray-800">{section.name}</h3>
        )}

        <span className="text-xs text-gray-400 shrink-0 tabular-nums">
          §{index + 1}
        </span>

        {editing ? (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={commit}
              className="text-green-600 hover:text-green-700 transition-colors"
              title="Save"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={cancel}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 transition-all shrink-0"
            title="Edit section"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {editing ? (
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => {
              setEditContent(e.target.value);
              autoResize(e.target);
            }}
            className="w-full text-sm text-gray-700 leading-relaxed bg-transparent focus:outline-none resize-none font-mono"
            style={{ minHeight: '120px', overflow: 'hidden' }}
            placeholder="- bullet point&#10;- another point&#10;[TBD: missing information]"
            spellCheck
          />
        ) : isEmpty ? (
          <button
            type="button"
            onClick={startEdit}
            className="text-sm text-gray-400 italic hover:text-indigo-500 transition-colors"
          >
            Click to add content…
          </button>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="w-full text-left"
            title="Click to edit"
          >
            <SectionContent content={section.content} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fallback: raw textarea when no sections detected
// ---------------------------------------------------------------------------

function RawEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => { onChange(e.target.value); autoResize(); }}
      onInput={autoResize}
      placeholder={`## Section Title\n\n- specific point about the proposal\n- another specific point\n\n## Next Section\n\n- ...`}
      className="w-full text-sm text-gray-800 leading-relaxed bg-white border border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 placeholder:text-gray-300 font-mono"
      style={{ resize: 'none', overflow: 'hidden', minHeight: '320px' }}
      spellCheck
    />
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function SkeletonEditor({
  rawText,
  onChange,
  flaggedSections,
  onFlaggedChange,
}: SkeletonEditorProps) {
  const sections = useMemo(() => parseSections(rawText), [rawText]);
  const flaggedSet = useMemo(() => new Set(flaggedSections), [flaggedSections]);
  const hasSections = sections.length > 0;

  const updateSection = useCallback(
    (idx: number, updated: Section) => {
      const next = sections.map((s, i) => (i === idx ? updated : s));
      onChange(sectionsToRaw(next));
    },
    [sections, onChange],
  );

  const toggleFlag = useCallback(
    (name: string) => {
      const next = new Set(flaggedSet);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      onFlaggedChange(Array.from(next));
    },
    [flaggedSet, onFlaggedChange],
  );

  if (!hasSections) {
    return (
      <div className="space-y-3">
        <RawEditor value={rawText} onChange={onChange} />
        <p className="text-xs text-gray-400">
          Use <code className="bg-gray-100 px-1 rounded">## Section Name</code> headings to create sections. They will appear as formatted cards above.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Section cards */}
      {sections.map((sec, idx) => (
        <SectionCard
          key={`${idx}-${sec.name}`}
          section={sec}
          index={idx}
          flagged={flaggedSet.has(sec.name)}
          onToggleFlag={() => toggleFlag(sec.name)}
          onUpdate={(updated) => updateSection(idx, updated)}
        />
      ))}

      {/* Star hint */}
      <p className="text-xs text-gray-400 pl-1">
        ★ Star sections to prioritise them in draft generation. Click any section to edit.
      </p>
    </div>
  );
}
