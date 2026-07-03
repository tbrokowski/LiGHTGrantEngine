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
import type { PanelConfig, PanelTab, PanelTabType } from './split-view/types';

const PANEL_LABELS: Record<PanelTabType, string> = {
  idea: 'Idea',
  skeleton: 'Skeleton',
  editor: 'Draft',
  'call-doc': 'Call Requirements',
  'workspace-file': 'File',
  'new-document': 'New Document',
  browser: 'Browser',
  'archive-section': 'Archive Source',
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
  openPanelRef: React.MutableRefObject<((type: PanelTabType, meta?: PanelTab['meta']) => void) | null>;
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

  // Expose openOrFocusPanel to GrantEditor via ref. For most panel types, a tab of
  // that type is unique and gets focused if already open. For 'archive-section',
  // different sectionIds are genuinely different content — match on type + sectionId
  // so clicking a second, different archive citation opens/focuses a distinct tab
  // instead of silently swapping content in the first one.
  const openOrFocusPanel = useCallback((type: PanelTabType, meta?: PanelTab['meta']) => {
    setPanels((prev) => {
      const matchesTab = (t: PanelTab) =>
        t.type === type && (type !== 'archive-section' || t.meta?.sectionId === meta?.sectionId);
      const existingPanel = prev.find((p) => p.tabs.some(matchesTab));
      if (existingPanel) {
        const tab = existingPanel.tabs.find(matchesTab)!;
        return prev.map((p) =>
          p.id === existingPanel.id ? { ...p, activeTabId: tab.id } : p
        );
      }
      // Otherwise add a new panel
      const newPanelId = `panel-${Date.now()}`;
      const newTabId = `${type}-${Date.now()}`;
      const label = type === 'archive-section' && meta?.grantTitle
        ? `${meta.grantTitle}${meta.sectionType ? ` — ${meta.sectionType}` : ''}`
        : PANEL_LABELS[type];
      const newPanel: PanelConfig = {
        id: newPanelId,
        tabs: [{ id: newTabId, type, label, meta }],
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
