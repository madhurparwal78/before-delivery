// The Island view stage: one scene controller that stays mounted across Village, Scout, Raid and
// Replay, the hooks that connect its input to the app, and the ghost's small action bar.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { FLAT_NOTICE } from './copy';
import { Icon } from './icons';
import { onPanelAnimating } from './panel';
import { IslandController } from './scene/controller';
import type { Ghost, ViewMode } from './scene/types';
import { notify, openPanel, reducedMotion, state, update, warn } from './store';

let controller: IslandController | null = null;
const ready = new Set<(c: IslandController) => void>();
let flatAnnounced = false;
onPanelAnimating((on) => controller?.setPanelAnimating(on));

/** Screen-specific reactions to island input; each screen sets the ones it uses. */
export const stageHandlers: {
  confirmGhost: (ghost: Ghost) => void;
  deploy: (x: number, y: number) => void;
  pickUnit: (index: number) => void;
} = { confirmGhost: () => undefined, deploy: () => undefined, pickUnit: () => undefined };

type GhostView = (Ghost & { valid: boolean }) | null;
const ghostListeners = new Set<(g: GhostView) => void>();

/** The controller once the stage is mounted; re-renders the caller when it appears. */
export function useStage(): IslandController | null {
  const [c, set] = useState(controller);
  useLayoutEffect(() => {
    if (controller) {
      set(controller);
      return undefined;
    }
    const fn = (next: IslandController): void => set(next);
    ready.add(fn);
    return () => void ready.delete(fn);
  }, []);
  return c;
}

export function IslandView({ mode }: { mode: ViewMode }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = new IslandController(
      host.current as HTMLDivElement,
      canvas.current as HTMLCanvasElement,
      {
        announce: (text) => notify(text),
        warn: (text) => warn(text),
        openDetails: (id, viaKeyboard) => openPanel({ kind: 'details', id, focus: viaKeyboard }),
        closePanels: () => {
          if (state.panel && (state.panel.kind === 'details' || state.panel.kind === 'train')) openPanel(null);
        },
        openBuild: () => update({ dialog: { kind: 'build' } }),
        confirmGhost: (g) => stageHandlers.confirmGhost(g),
        ghostChanged: (g) => ghostListeners.forEach((fn) => fn(g)),
        deploy: (x, y) => stageHandlers.deploy(x, y),
        pickUnit: (i) => stageHandlers.pickUnit(i),
      },
      reducedMotion(),
    );
    c.setMode(mode);
    controller = c;
    ready.forEach((fn) => fn(c));
    ready.clear();
    if (c.renderer.kind === 'flat' && !flatAnnounced) {
      flatAnnounced = true;
      notify(FLAT_NOTICE);
    }
    return () => {
      c.dispose();
      controller = null;
    };
  }, []);
  useLayoutEffect(() => controller?.setMode(mode), [mode]);
  return (
    <div ref={host} class="island" role="application" aria-label="Island view" tabIndex={0} aria-roledescription="island">
      <canvas ref={canvas} />
    </div>
  );
}

/** "Rotate", "Confirm placement" and "Cancel placement", kept beside the ghost and inside the view. */
export function GhostBar() {
  const c = useStage();
  const [ghost, setGhost] = useState<GhostView>(() => controller?.ghostState() ?? null);
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fn = (g: GhostView): void => setGhost(g);
    ghostListeners.add(fn);
    return () => void ghostListeners.delete(fn);
  }, []);
  useLayoutEffect(() => {
    const el = bar.current;
    const anchor = c?.ghostAnchor();
    if (!el || !anchor) return;
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h')) || 52;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.min(window.innerWidth - w - 8, Math.max(8, anchor.x + 16));
    const y = Math.min(window.innerHeight - h - 8, Math.max(top + 64, anchor.y - h / 2));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  });
  if (!ghost || !c) return null;
  return (
    <div ref={bar} class={ghost.valid ? 'ghost-bar' : 'ghost-bar invalid'} role="toolbar" aria-label="Placement">
      <button type="button" class="btn" onClick={() => c.rotateGhost()}>
        <Icon name="rotate" />
        Rotate
      </button>
      <button type="button" class="btn primary" onClick={() => c.confirmGhost()}>
        <Icon name="check" />
        Confirm placement
      </button>
      <button type="button" class="btn quiet" onClick={() => c.cancelGhost()}>
        <Icon name="close" />
        Cancel placement
      </button>
    </div>
  );
}
