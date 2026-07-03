export type PanelTabType =
  | 'editor'
  | 'idea'
  | 'skeleton'
  | 'call-doc'
  | 'workspace-file'
  | 'new-document'
  | 'browser'
  | 'archive-section';

export interface PanelTab {
  id: string;
  type: PanelTabType;
  label: string;
  meta?: {
    fileId?: string;
    fileUrl?: string;
    url?: string;
    sectionId?: string;
    archiveId?: string;
    grantTitle?: string;
    sectionType?: string;
  };
}

export interface PanelConfig {
  id: string;
  tabs: PanelTab[];
  activeTabId: string;
}
