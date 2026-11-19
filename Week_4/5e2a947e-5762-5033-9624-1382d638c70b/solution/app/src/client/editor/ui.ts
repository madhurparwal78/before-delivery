export type DialogName = 'share' | 'history' | 'export' | 'import' | 'save' | 'link';
export type PanelName = 'details' | 'activity' | 'presenter';
export type DetailsTab = 'notes' | 'task' | 'comments';

/** What the editor shell lets its parts do: open dialogs and panels, run shortcuts. */
export interface Ui {
  dialog: DialogName | null;
  panel: PanelName | null;
  tab: DetailsTab;
  openDialog: (name: DialogName) => void;
  togglePanel: (name: PanelName) => void;
  openFind: () => void;
  focusBranch: () => void;
  addBoundary: () => void;
  startPresentation: () => void;
}
