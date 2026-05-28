'use client';

import { useRef, useCallback } from 'react';
import DocumentPane from './DocumentPane';
import type { PanelConfig } from './types';

interface SplitViewLayoutProps {
  grantId: string;
  panels: PanelConfig[];
  onPanelsChange: (panels: PanelConfig[]) => void;
  widths: Record<string, number>;
  onWidthsChange: (widths: Record<string, number>) => void;
}

export default function SplitViewLayout({
  grantId,
  panels,
  onPanelsChange,
  widths,
  onWidthsChange,
}: SplitViewLayoutProps) {
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
        onWidthsChange({
          ...widths,
          [dragRef.current.leftId]: Math.max(0.15, dragRef.current.startLeft + dFlex),
          [dragRef.current.rightId]: Math.max(0.15, dragRef.current.startRight - dFlex),
        });
      };

      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [widths, onWidthsChange]
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
    onWidthsChange({ ...widths, [newPanelId]: 1 });
  };

  const handleClosePanel = (panelId: string) => {
    if (panels.length <= 1) return;
    onPanelsChange(panels.filter((p) => p.id !== panelId));
    const next = { ...widths };
    delete next[panelId];
    onWidthsChange(next);
  };

  const handlePanelChange = (panelId: string, updated: PanelConfig) => {
    onPanelsChange(panels.map((p) => (p.id === panelId ? updated : p)));
  };

  const hasEditorPanel = panels.some((p) => p.tabs.some((t) => t.type === 'editor'));

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden min-w-0">
      {panels.map((panel, idx) => (
        <div
          key={panel.id}
          className="flex min-w-0 overflow-hidden"
          style={{ flex: widths[panel.id] ?? 1 }}
        >
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <DocumentPane
              panel={panel}
              onPanelChange={(updated) => handlePanelChange(panel.id, updated)}
              canClose={panels.length > 1}
              onClose={() => handleClosePanel(panel.id)}
              grantId={grantId}
              hasEditorPanel={hasEditorPanel}
              onAddPanel={handleAddPanel}
            />
          </div>

          {/* Resize handle */}
          {idx < panels.length - 1 && (
            <div
              onMouseDown={(e) => handleResizeMouseDown(e, panel.id, panels[idx + 1].id)}
              className="flex-shrink-0 w-1 bg-gray-200 hover:bg-indigo-400 active:bg-indigo-500 cursor-col-resize transition-colors select-none"
              title="Drag to resize"
            />
          )}
        </div>
      ))}
    </div>
  );
}
