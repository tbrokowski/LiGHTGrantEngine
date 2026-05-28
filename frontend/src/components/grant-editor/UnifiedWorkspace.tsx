'use client';

/**
 * UnifiedWorkspace
 *
 * Top-level split-panel container. Wraps SplitViewLayout with:
 * - localStorage persistence for panel configs and widths (keyed by grantId)
 * - openOrFocusPanel(type) API exposed via openPanelRef so GrantEditor can
 *   trigger panel changes after skeleton/draft generation
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import SplitViewLayout from './split-view/SplitViewLayout';
import type { PanelConfig, PanelTabType } from './split-view/types';

const PANEL_LABELS: Record<PanelTabType, string> = {
  idea: 'Idea',
  skeleton: 'Skeleton',
  editor: 'Draft',
  'call-doc': 'Call Requirements',
  'workspace-file': 'File',
  'new-document': 'New Document',
  browser: 'Browser',
};

function buildDefaultPanels(type: PanelTabType): PanelConfig[] {
  const tabId = `${type}-main`;
  return [
    {
      id: 'main',
      tabs: [{ id: tabId, type, label: PANEL_LABELS[type] }],
      activeTabId: tabId,
    },
  ];
}

function loadPanels(grantId: string, defaultType: PanelTabType): PanelConfig[] {
  try {
    const raw = localStorage.getItem(`panels:${grantId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as PanelConfig[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return buildDefaultPanels(defaultType);
}

function loadWidths(grantId: string, panels: PanelConfig[]): Record<string, number> {
  try {
    const raw = localStorage.getItem(`panelWidths:${grantId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    }
  } catch { /* ignore */ }
  return Object.fromEntries(panels.map((p) => [p.id, 1]));
}

interface UnifiedWorkspaceProps {
  grantId: string;
  defaultPanelType: PanelTabType;
  openPanelRef: React.MutableRefObject<((type: PanelTabType) => void) | null>;
}

export default function UnifiedWorkspace({ grantId, defaultPanelType, openPanelRef }: UnifiedWorkspaceProps) {
  const [panels, setPanels] = useState<PanelConfig[]>(() => loadPanels(grantId, defaultPanelType));
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    loadWidths(grantId, loadPanels(grantId, defaultPanelType))
  );
  const prevGrantId = useRef(grantId);

  // When grantId changes (user navigates to a different grant), reload from localStorage
  useEffect(() => {
    if (prevGrantId.current === grantId) return;
    prevGrantId.current = grantId;
    const next = loadPanels(grantId, defaultPanelType);
    setPanels(next);
    setWidths(loadWidths(grantId, next));
  }, [grantId, defaultPanelType]);

  // Persist panels whenever they change
  useEffect(() => {
    localStorage.setItem(`panels:${grantId}`, JSON.stringify(panels));
  }, [grantId, panels]);

  // Persist widths whenever they change
  useEffect(() => {
    localStorage.setItem(`panelWidths:${grantId}`, JSON.stringify(widths));
  }, [grantId, widths]);

  // Expose openOrFocusPanel to GrantEditor via ref
  const openOrFocusPanel = useCallback((type: PanelTabType) => {
    setPanels((prev) => {
      // If a panel already has a tab of this type, just make it the active tab
      const existingPanel = prev.find((p) => p.tabs.some((t) => t.type === type));
      if (existingPanel) {
        const tab = existingPanel.tabs.find((t) => t.type === type)!;
        return prev.map((p) =>
          p.id === existingPanel.id ? { ...p, activeTabId: tab.id } : p
        );
      }
      // Otherwise add a new panel
      const newPanelId = `panel-${Date.now()}`;
      const newTabId = `${type}-${Date.now()}`;
      const newPanel: PanelConfig = {
        id: newPanelId,
        tabs: [{ id: newTabId, type, label: PANEL_LABELS[type] }],
        activeTabId: newTabId,
      };
      setWidths((w) => ({ ...w, [newPanelId]: 1 }));
      return [...prev, newPanel];
    });
  }, []);

  useEffect(() => {
    openPanelRef.current = openOrFocusPanel;
  }, [openPanelRef, openOrFocusPanel]);

  return (
    <SplitViewLayout
      grantId={grantId}
      panels={panels}
      onPanelsChange={setPanels}
      widths={widths}
      onWidthsChange={setWidths}
    />
  );
}
