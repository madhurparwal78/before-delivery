import { useEffectEvent, useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import { useSceneSlice } from '../store/index.ts';
import type { FocusTarget } from '../store/index.ts';
import type { FocusTargets } from './focusTargets.tsx';
import type { Panels, PanelName } from './workspace/usePanels.ts';

/** The panel a focus request needs open. */
const PANEL_OF: Partial<Record<FocusTarget, PanelName>> = { 'layer-list': 'Layers', 'parameter-list': 'Parameters' };

/**
 * Carries out the store's focus requests: `command` and `drawing` focus their elements, the list targets open their panel first (a
 * collapsed panel, another tablet tab) and then focus the element the panel registered.
 */
export function useFocusRequests(parts: {
  panels: Panels;
  targets: FocusTargets;
  command: RefObject<HTMLInputElement | null>;
  drawingRegion: () => HTMLElement | null;
}): void {
  const { panels, targets, command, drawingRegion } = parts;
  const request = useSceneSlice((snapshot) => snapshot.focus);
  const panel = request ? PANEL_OF[request.target] : undefined;
  const panelOpen = panel === undefined || panels.isOpen(panel);

  const carryOut = useEffectEvent((target: FocusTarget) => {
    if (panel !== undefined && !panelOpen) {
      if (panels.available.includes(panel)) panels.reveal(panel);
    } else if (target === 'command') {
      command.current?.focus();
    } else if (target === 'drawing') {
      drawingRegion()?.focus();
    } else {
      targets.focus(target);
    }
  });

  // once per request, and again when the panel it waits for has opened
  useLayoutEffect(() => {
    if (request) carryOut(request.target);
  }, [request, panelOpen]);
}
