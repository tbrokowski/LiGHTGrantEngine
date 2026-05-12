'use client';
import { useState, useCallback, useRef } from 'react';
import { grants } from '@/lib/api';
import SectionEditor from './SectionEditor';
import AIChatPanel from './AIChatPanel';
import { Plus, ChevronDown, ChevronRight, GripVertical, Trash2, Settings2 } from 'lucide-react';
import type { EditorSection } from '@/app/grants/[id]/page';

interface GrantDetail {
  id: string;
  title: string;
  funder: string | null;
  call_requirements: string | null;
  editor_sections: Record<string, EditorSection>;
}

interface GrantEditorProps {
  grant: GrantDetail;
  onGrantUpdate: () => void;
}

const SECTION_TYPES = [
  'abstract', 'executive_summary', 'problem_statement', 'background',
  'specific_aims', 'objectives', 'innovation', 'methods', 'implementation_plan',
  'timeline', 'team_capacity', 'partnerships', 'mel_evaluation', 'ethics',
  'data_governance', 'responsible_ai', 'risk_mitigation', 'sustainability',
  'budget_justification', 'dissemination', 'other',
];

const DEFAULT_SECTIONS: Omit<EditorSection, 'id'>[] = [
  { title: 'Abstract', section_type: 'abstract', content_html: '', content_text: '', word_count: 0, order: 0 },
  { title: 'Problem Statement', section_type: 'problem_statement', content_html: '', content_text: '', word_count: 0, order: 1 },
  { title: 'Background & Rationale', section_type: 'background', content_html: '', content_text: '', word_count: 0, order: 2 },
  { title: 'Objectives & Specific Aims', section_type: 'specific_aims', content_html: '', content_text: '', word_count: 0, order: 3 },
  { title: 'Methods & Approach', section_type: 'methods', content_html: '', content_text: '', word_count: 0, order: 4 },
  { title: 'Implementation Plan', section_type: 'implementation_plan', content_html: '', content_text: '', word_count: 0, order: 5 },
  { title: 'Team & Capacity', section_type: 'team_capacity', content_html: '', content_text: '', word_count: 0, order: 6 },
  { title: 'Monitoring, Evaluation & Learning', section_type: 'mel_evaluation', content_html: '', content_text: '', word_count: 0, order: 7 },
  { title: 'Ethics & Responsible AI', section_type: 'responsible_ai', content_html: '', content_text: '', word_count: 0, order: 8 },
  { title: 'Budget Justification', section_type: 'budget_justification', content_html: '', content_text: '', word_count: 0, order: 9 },
];

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function GrantEditor({ grant, onGrantUpdate }: GrantEditorProps) {
  const [sections, setSections] = useState<EditorSection[]>(() => {
    const existing = grant.editor_sections ? Object.values(grant.editor_sections) : [];
    if (existing.length > 0) return existing.sort((a, b) => a.order - b.order);
    return DEFAULT_SECTIONS.map(s => ({ ...s, id: genId() }));
  });

  const [activeSectionId, setActiveSectionId] = useState<string | null>(
    sections.length > 0 ? sections[0].id : null
  );
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedText, setSelectedText] = useState('');
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [showCallReqPanel, setShowCallReqPanel] = useState(false);
  const [callRequirements, setCallRequirements] = useState(grant.call_requirements || '');
  const [aiPanelWidth, setAiPanelWidth] = useState(380);
  const dividerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Build full document text for AI context
  const getDocumentContext = useCallback(() => {
    return sections
      .map(s => `## ${s.title}\n${s.content_text || '(empty)'}`)
      .join('\n\n');
  }, [sections]);

  const saveSection = useCallback(async (section: EditorSection) => {
    setSavingSection(section.id);
    try {
      await grants.upsertSection(grant.id, section.id, {
        title: section.title,
        section_type: section.section_type,
        content_html: section.content_html,
        content_text: section.content_text,
        word_count: section.word_count,
        order: section.order,
      });
    } catch (e) {
      console.error('Failed to save section', e);
    } finally {
      setSavingSection(null);
    }
  }, [grant.id]);

  const updateSection = useCallback((id: string, updates: Partial<EditorSection>) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const handleSectionChange = useCallback((id: string, updates: Partial<EditorSection>) => {
    updateSection(id, updates);
    const section = sections.find(s => s.id === id);
    if (section) {
      const updated = { ...section, ...updates };
      // Debounce auto-save is handled by SectionEditor
      saveSection(updated);
    }
  }, [sections, updateSection, saveSection]);

  const addSection = useCallback(() => {
    const newSection: EditorSection = {
      id: genId(),
      title: 'New Section',
      section_type: 'other',
      content_html: '',
      content_text: '',
      word_count: 0,
      order: sections.length,
    };
    setSections(prev => [...prev, newSection]);
    setActiveSectionId(newSection.id);
    saveSection(newSection);
  }, [sections.length, saveSection]);

  const deleteSection = useCallback(async (id: string) => {
    if (!confirm('Delete this section?')) return;
    setSections(prev => prev.filter(s => s.id !== id));
    if (activeSectionId === id) {
      setActiveSectionId(sections.find(s => s.id !== id)?.id || null);
    }
    await grants.deleteSection(grant.id, id);
  }, [activeSectionId, grant.id, sections]);

  const toggleCollapse = (id: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleInsertText = useCallback((text: string) => {
    if (!activeSectionId) return;
    const section = sections.find(s => s.id === activeSectionId);
    if (!section) return;
    const newHtml = section.content_html
      ? section.content_html + `<p>${text}</p>`
      : `<p>${text}</p>`;
    const newText = section.content_text ? section.content_text + '\n\n' + text : text;
    const words = newText.trim().split(/\s+/).filter(Boolean).length;
    handleSectionChange(activeSectionId, {
      content_html: newHtml,
      content_text: newText,
      word_count: words,
    });
  }, [activeSectionId, sections, handleSectionChange]);

  const saveCallRequirements = async () => {
    await grants.update(grant.id, { call_requirements: callRequirements });
    setShowCallReqPanel(false);
    onGrantUpdate();
  };

  // Draggable divider for resizing AI panel
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = aiPanelWidth;
    const onMove = (mv: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX - mv.clientX;
      const clamped = Math.min(600, Math.max(280, startWidth + delta));
      setAiPanelWidth(clamped);
    };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const totalWords = sections.reduce((acc, s) => acc + (s.word_count || 0), 0);
  const activeSection = sections.find(s => s.id === activeSectionId);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel: section outline + editors ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Section toolbar */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{sections.length} sections · {totalWords.toLocaleString()} words</span>
            {savingSection && <span className="text-xs text-blue-400 animate-pulse">Saving...</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCallReqPanel(!showCallReqPanel)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              Call Requirements
            </button>
            <button
              onClick={addSection}
              className="flex items-center gap-1.5 text-xs bg-blue-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Section
            </button>
          </div>
        </div>

        {/* Call requirements panel (collapsible) */}
        {showCallReqPanel && (
          <div className="flex-shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-3">
            <div className="text-xs font-semibold text-amber-800 mb-1.5">Call Requirements (AI Context)</div>
            <textarea
              value={callRequirements}
              onChange={e => setCallRequirements(e.target.value)}
              placeholder="Paste the grant call requirements, evaluation criteria, and key guidelines here. This context is sent to the AI assistant with every request..."
              className="w-full text-xs border border-amber-200 rounded-lg px-3 py-2 bg-white resize-none h-28 focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={saveCallRequirements}
                className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700">
                Save
              </button>
              <button onClick={() => setShowCallReqPanel(false)}
                className="text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Sections list */}
        <div className="flex-1 overflow-y-auto">
          {sections.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="text-4xl mb-3">📄</div>
              <div className="text-gray-600 font-medium mb-1">No sections yet</div>
              <div className="text-sm text-gray-400 mb-4">Add sections to start writing your proposal</div>
              <button onClick={addSection}
                className="flex items-center gap-1.5 text-sm bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700">
                <Plus className="w-4 h-4" /> Add first section
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {sections.map((section) => (
                <div
                  key={section.id}
                  className={`transition-colors ${activeSectionId === section.id ? 'bg-blue-50/40' : 'bg-white hover:bg-gray-50/60'}`}
                >
                  {/* Section header */}
                  <div
                    className="flex items-center gap-2 px-4 py-2.5 cursor-pointer group"
                    onClick={() => {
                      setActiveSectionId(section.id);
                      if (collapsedSections.has(section.id)) toggleCollapse(section.id);
                    }}
                  >
                    <GripVertical className="w-3.5 h-3.5 text-gray-300 cursor-grab opacity-0 group-hover:opacity-100" />
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleCollapse(section.id); }}
                      className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                    >
                      {collapsedSections.has(section.id)
                        ? <ChevronRight className="w-3.5 h-3.5" />
                        : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    <input
                      value={section.title}
                      onChange={e => {
                        e.stopPropagation();
                        updateSection(section.id, { title: e.target.value });
                      }}
                      onBlur={() => saveSection(section)}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 text-sm font-medium bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-300 focus:bg-white rounded px-1 text-gray-800"
                    />
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-xs text-gray-400">{(section.word_count || 0).toLocaleString()}w</span>
                      <select
                        value={section.section_type}
                        onChange={e => { updateSection(section.id, { section_type: e.target.value }); saveSection({ ...section, section_type: e.target.value }); }}
                        onClick={e => e.stopPropagation()}
                        className="text-xs border border-gray-200 rounded px-1.5 py-0.5 text-gray-500 bg-white"
                      >
                        {SECTION_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                      </select>
                      <button
                        onClick={e => { e.stopPropagation(); deleteSection(section.id); }}
                        className="text-red-400 hover:text-red-600 p-0.5 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Section editor */}
                  {!collapsedSections.has(section.id) && (
                    <div className="px-4 pb-4">
                      <SectionEditor
                        section={section}
                        isActive={activeSectionId === section.id}
                        onFocus={() => setActiveSectionId(section.id)}
                        onChange={(updates) => handleSectionChange(section.id, updates)}
                        onSelectionChange={setSelectedText}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Drag handle ── */}
      <div
        ref={dividerRef}
        onMouseDown={onMouseDown}
        className="flex-shrink-0 w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize transition-colors relative group"
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>

      {/* ── Right panel: AI chat ── */}
      <div className="flex-shrink-0 overflow-hidden" style={{ width: aiPanelWidth }}>
        <AIChatPanel
          grantId={grant.id}
          activeSection={activeSection}
          selectedText={selectedText}
          getDocumentContext={getDocumentContext}
          onInsertText={handleInsertText}
          callRequirements={callRequirements}
        />
      </div>
    </div>
  );
}
