import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { FollowEngine, pointerOf, REST_FOCUS, type FollowConfig } from '../../../shared/evaluator/follow';
import { glide } from '../../../shared/easing';
import { Link } from '../../router';
import { useSession } from '../../session';
import { useReducedMotion } from './hooks';
import { createLightRenderer, type LightRenderer } from './lightRenderer';

const RISE_MS = 800;
const PAD = 32;

const focusText = (x: number, y: number): string => `${x.toFixed(3)}, ${y.toFixed(3)}`;

export function FollowLightStage() {
  const session = useSession();
  const reduced = useReducedMotion();
  const stageRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controls = useRef<{ move: (event: ReactPointerEvent) => void; leave: (event: ReactPointerEvent) => void }>({
    move: () => undefined,
    leave: () => undefined,
  });

  useLayoutEffect(() => {
    const stage = stageRef.current as HTMLElement;
    const host = hostRef.current as HTMLDivElement;
    const content = contentRef.current as HTMLDivElement;
    const created = createLightRenderer(host);
    const renderer: LightRenderer | null = created?.renderer ?? null;
    const engine = new FollowEngine();
    const config: FollowConfig = { tilts: [], light: { enabled: true, momentum: 1 }, reduced };
    let level = reduced ? 1 : 0;
    let riseStart: number | null = null;
    let frame = 0;
    let running = false;
    let focus: { x: number; y: number } = { x: REST_FOCUS.x, y: REST_FOCUS.y };

    const paint = (): void => {
      stage.dataset['lightLevel'] = String(Number(level.toFixed(3)));
      stage.dataset['lightFocus'] = focusText(focus.x, focus.y);
      if (!renderer || !created) return;
      const { canvas } = created;
      const bounds = stage.getBoundingClientRect();
      const box = content.getBoundingClientRect();
      const scale = canvas.width / Math.max(bounds.width, 1);
      renderer.draw(
        { level, x: focus.x, y: focus.y },
        {
          cx: (box.left + box.width / 2 - bounds.left) * scale,
          cy: (box.top + box.height / 2 - bounds.top) * scale,
          hx: (box.width / 2 + PAD) * scale,
          hy: (box.height / 2 + PAD) * scale,
        },
      );
    };

    const step = (now: number): void => {
      if (level < 1) {
        riseStart ??= now;
        const t = Math.min((now - riseStart) / RISE_MS, 1);
        level = t >= 1 ? 1 : glide(t);
      }
      engine.tick(now, config);
      focus = engine.snapshot(config).focus;
      paint();
      if (level < 1 || engine.active) frame = requestAnimationFrame(step);
      else running = false;
    };
    const kick = (): void => {
      if (running) return;
      running = true;
      frame = requestAnimationFrame(step);
    };

    const resize = (): void => {
      const bounds = stage.getBoundingClientRect();
      if (renderer) renderer.resize(Math.max(1, Math.round(bounds.width)), Math.max(1, Math.round(bounds.height)));
      paint();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    observer.observe(content);
    resize();

    controls.current = {
      move(event) {
        if (reduced) return;
        const bounds = stage.getBoundingClientRect();
        const { n, m } = pointerOf(event.clientX - bounds.left, event.clientY - bounds.top, bounds.width, bounds.height);
        engine.setPointer(n, m);
        kick();
      },
      leave() {
        engine.release(performance.now());
        kick();
      },
    };
    if (!reduced) kick();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer?.dispose();
      created?.canvas.remove();
    };
  }, [reduced]);

  const target = session.status === 'in' ? '/projects' : '/signin';
  return (
    <section
      ref={stageRef}
      className="light-stage"
      aria-label="Follow Light stage"
      data-light-level="0"
      data-light-focus={focusText(REST_FOCUS.x, REST_FOCUS.y)}
      onPointerEnter={(event) => controls.current.move(event)}
      onPointerMove={(event) => controls.current.move(event)}
      onPointerDown={(event) => controls.current.move(event)}
      onPointerLeave={(event) => controls.current.leave(event)}
      onPointerCancel={(event) => controls.current.leave(event)}
      onPointerUp={(event) => {
        if (event.pointerType !== 'mouse') controls.current.leave(event);
      }}
    >
      <div ref={hostRef} className="stage-host" />
      <div ref={contentRef} className="stage-copy">
        <Link href="/#version-export" id="release-note" className="release-pill" style={{ ['--enter' as string]: '0ms' }}>
          <span className="pill-dot" aria-hidden="true" />
          <strong>New</strong> <span className="muted">Republish any version as the next one</span>
        </Link>
        <h1 className="split-face">
          <span className="head-line" style={{ ['--enter' as string]: '60ms' }}>
            Scenes that hold
          </span>{' '}
          <span className="head-line" style={{ ['--enter' as string]: '120ms' }}>
            their <span className="serif-word">shape</span>
          </span>
        </h1>
        <p className="stage-sub" style={{ ['--enter' as string]: '180ms' }}>
          Layer 2D, 3D, type, particles and cloth in one scene, tune how it answers the pointer, the scroll and the screen, then publish it as a numbered version that never changes.
        </p>
        <Link href={target} className="open-editor" style={{ ['--enter' as string]: '480ms' }}>
          Open editor
        </Link>
      </div>
    </section>
  );
}

export function useHashScroll(): void {
  useEffect(() => {
    const go = (): void => {
      const id = window.location.hash.slice(1);
      if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);
}
