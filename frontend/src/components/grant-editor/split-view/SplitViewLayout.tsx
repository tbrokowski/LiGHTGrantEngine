'use client';

import { useState, useRef, useCallback } from 'react';
import { Columns2 } from 'lucide-react';
import DocumentPane from './DocumentPane';
import type { PanelConfig } from './types';
import type { SkeletonSection } from '../SkeletonEditor';

interface SplitViewLayoutProps {
  grantId: string;
  panels: PanelConfig[];
  onPanelsChange: (panels: PanelConfig[]) => void;
  // Data for panel content
  documentHtml: string;
  onDocumentChange: (html: string, words: number, headings: string[]) => void;
  onSelectionChange: (text: string) => void;
  onActiveSectionChange: (section: string) => void;
  grantIdea: string;
  skeleton: Record<string, unknown>;
  callRequirements: string;
  onInsertText: (text: string) => void;
}

export default function SplitViewLayout({
  grantId,
  panels,
  onPanelsChange,
  documentHtml,
  onDocumentChange,
  onSelectionChange,
  onActiveSectionChange,
  grantIdea,
  skeleton,
  callRequirements,
  onInsertText,
}: SplitViewLayoutProps) {
  // Flex widths keyed by panel ID — avoids array/panels sync issues
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(panels.map((p) => [p.id, 1]))
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    leftId: string;
    rightId: string;
    startX: number;
    startLeft: number;
    startRight: number;
  } | null>(null);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, leftId: string, rightId: string) => {
      e.preventDefault();
      dragRef.current = {
        leftId,
        rightId,
        startX: e.clientX,
        startLeft: widths[leftId] ?? 1,
        startRight: widths[rightId] ?? 1,
      };

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current || !containerRef.current) return;
        const totalWidth = containerRef.current.offsetWidth;
        const totalFlex = dragRef.current.startLeft + dragRef.current.startRight;
        const dx = ev.clientX - dragRef.current.startX;
        const dFlex = (dx / totalWidth) * totalFlex;
        setWidths((w) => ({
          ...w,
          [dragRef.current!.leftId]: Math.max(0.15, dragRef.current!.startLeft + dFlex),
          [dragRef.current!.rightId]: Math.max(0.15, dragRef.current!.startRight - dFlex),
        }));
      };

      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [widths]
  );

  const handleAddPanel = () => {
    const newPanelId = `panel-${Date.now()}`;
    const newTabId = `browser-${Date.now()}`;
    const newPanel: PanelConfig = {
      id: newPanelId,
      tabs: [{ id: newTabId, type: 'browser', label: 'Browser' }],
      activeTabId: newTabId,
    };
    onPanelsChange([...panels, newPanel]);
    setWidths((w) => ({ ...w, [newPanelId]: 1 }));
  };

  const handleClosePanel = (panelId: string) => {
    if (panels.length <= 1) return;
    onPanelsChange(panels.filter((p) => p.id !== panelId));
    setWidths((w) => {
      const next = { ...w };
      delete next[panelId];
      return next;
    });
  };

  const handlePanelChange = (panelId: string, updated: PanelConfig) => {
    onPanelsChange(panels.map((p) => (p.id === panelId ? updated : p)));
  };

  const hasEditorPanel = panels.some((p) => p.tabs.some((t) => t.type === 'editor'));
  const skeletonSections = (skeleton?.sections ?? []) as SkeletonSection[];

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden min-w-0">
      {panels.map((panel, idx) => (
        <div key={panel.id} className="flex min-w-0 overflow-hidden" style={{ flex: widths[panel.id] ?? 1 }}>
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <DocumentPane
              panel={panel}
              onPanelChange={(updated) => handlePanelChange(panel.id, updated)}
              canClose={panels.length > 1}
              onClose={() => handleClosePanel(panel.id)}
              grantId={grantId}
              documentHtml={documentHtml}
              onDocumentChange={onDocumentChange}
              onSelectionChange={onSelectionChange}
              onActiveSectionChange={onActiveSectionChange}
              grantIdea={grantIdea}
              skeletonSections={skeletonSections}
              callRequirements={callRequirements}
              onInsertText={onInsertText}
              hasEditorPanel={hasEditorPanel}
            />
          </div>

          {/* Resize handle between this panel and the next */}
          {idx < panels.length - 1 && (
            <div
              onMouseDown={(e) =>
                handleResizeMouseDown(e, panel.id, panels[idx + 1].id)
              }
              className="flex-shrink-0 w-1 bg-gray-200 hover:bg-indigo-400 active:bg-indigo-500 cursor-col-resize transition-colors select-none"
              title="Drag to resize"
            />
          )}
        </div>
      ))}

      {/* Add panel button */}
      <button
        onClick={handleAddPanel}
        title="Add panel"
        className="flex-shrink-0 self-start mt-1.5 ml-1 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-indigo-600 transition-colors"
      >
        <Columns2 className="w-4 h-4" />
      </button>
    </div>
  );
}
