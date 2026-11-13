import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { MediaLayout } from '../../ui/index.ts';

export const PANEL_ORDER = ['Entities', 'Layers', 'Properties', 'Parameters', 'Xrefs', 'Versions', 'Issues', 'Markups'] as const;
export type PanelName = (typeof PANEL_ORDER)[number];
/** The only panels a phone offers, in the bottom sheet's tab order. */
const PHONE_PANELS: readonly PanelName[] = ['Issues', 'Markups', 'Versions'];

export interface Panels {
  layout: MediaLayout;
  /** the panels this layout offers, in panel order */
  available: readonly PanelName[];
  isOpen: (name: PanelName) => boolean;
  /** desk: collapse or open one panel */
  toggle: (name: PanelName) => void;
  /** makes a panel visible on any layout: expands it (desk), activates its tab (tablet), opens the sheet on its tab (phone) */
  reveal: (name: PanelName) => void;
  /** the active tab of the tablet strip or of the phone sheet */
  tab: PanelName;
  selectTab: (name: PanelName) => void;
  sheetOpen: boolean;
  /** opens the phone sheet on a tab; it opens on `Issues` unless told otherwise */
  openSheet: (tab?: PanelName) => void;
  closeSheet: () => void;
  /** where focus returns when the phone sheet closes: the `button "Panels"` */
  sheetOpener: RefObject<HTMLButtonElement | null>;
  /** ref callback for the element F6 focuses for a panel (`grid "Entities"`, `region "<name>"`) */
  stopRef: (name: PanelName) => (element: HTMLElement | null) => void;
  /** the open panels' stop elements in panel order */
  openStops: () => HTMLElement[];
}

/** Which panels are open on each layout, and the elements F6 can stop on. `offered` must be a stable list. */
export function usePanels(layout: MediaLayout, offered: readonly PanelName[]): Panels {
  const available = (layout === 'phone' ? PHONE_PANELS : PANEL_ORDER).filter((name) => offered.includes(name));
  const [collapsed, setCollapsed] = useState<readonly PanelName[]>([]);
  const [tabletTab, setTabletTab] = useState<PanelName | null>(null);
  const [phoneTab, setPhoneTab] = useState<PanelName | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetOpener = useRef<HTMLButtonElement | null>(null);
  const elements = useRef(new Map<PanelName, HTMLElement>());

  const chosen = layout === 'phone' ? phoneTab : tabletTab;
  const tab = chosen !== null && available.includes(chosen) ? chosen : available[0] ?? 'Entities';
  const selectTab = layout === 'phone' ? setPhoneTab : setTabletTab;

  const isOpen = (name: PanelName): boolean => {
    if (!available.includes(name)) return false;
    if (layout === 'desk') return !collapsed.includes(name);
    return tab === name && (layout === 'tablet' || sheetOpen);
  };

  const openSheet = (target?: PanelName): void => {
    setPhoneTab(target ?? available[0] ?? null);
    setSheetOpen(true);
  };

  const reveal = (name: PanelName): void => {
    if (layout === 'desk') setCollapsed((previous) => previous.filter((other) => other !== name));
    else if (layout === 'tablet') setTabletTab(name);
    else openSheet(name);
  };

  const toggle = (name: PanelName): void =>
    setCollapsed((previous) => (previous.includes(name) ? previous.filter((other) => other !== name) : [...previous, name]));

  const stopRef = (name: PanelName) => (element: HTMLElement | null): void => {
    if (element) elements.current.set(name, element);
    else elements.current.delete(name);
  };

  const openStops = (): HTMLElement[] =>
    available.flatMap((name) => {
      const element = elements.current.get(name);
      return isOpen(name) && element ? [element] : [];
    });

  return {
    layout, available, isOpen, toggle, reveal, tab, selectTab: (name) => selectTab(name), sheetOpen, openSheet,
    closeSheet: () => setSheetOpen(false), sheetOpener, stopRef, openStops,
  };
}
