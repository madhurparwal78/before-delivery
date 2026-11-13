import { useEffect, useState } from 'react';

export type LayoutName = 'floating' | 'docked' | 'phone';

export const PANEL_TITLES = ['Outline', 'Inspector', 'Props', 'Assets'] as const;
export type PanelTitle = (typeof PANEL_TITLES)[number];

export interface PanelState {
  open: boolean;
  maximised: boolean;
  offset: { x: number; y: number } | null;
}

export const DEFAULT_PANELS: Record<PanelTitle, PanelState> = {
  Outline: { open: true, maximised: false, offset: null },
  Inspector: { open: true, maximised: false, offset: null },
  Props: { open: true, maximised: false, offset: null },
  Assets: { open: true, maximised: false, offset: null },
};

function nameFor(width: number): LayoutName {
  if (width >= 1000) return 'floating';
  if (width >= 600) return 'docked';
  return 'phone';
}

/** Exactly three layouts, by viewport width. */
export function useLayout(): LayoutName {
  const [layout, setLayout] = useState<LayoutName>(() => nameFor(window.innerWidth));
  useEffect(() => {
    const onResize = (): void => setLayout(nameFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return layout;
}
