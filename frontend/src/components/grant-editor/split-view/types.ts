export type PanelTabType =
  | 'editor'
  | 'idea'
  | 'skeleton'
  | 'call-doc'
  | 'workspace-file'
  | 'new-document'
  | 'browser';

export interface PanelTab {
  id: string;
  type: PanelTabType;
  label: string;
  meta?: {
    fileId?: string;
    fileUrl?: string;
    url?: string;
  };
}

export interface PanelConfig {
  id: string;
  tabs: PanelTab[];
  activeTabId: string;
}
