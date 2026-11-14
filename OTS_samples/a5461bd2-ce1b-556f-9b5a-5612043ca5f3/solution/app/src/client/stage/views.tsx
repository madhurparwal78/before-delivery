import { type KeyboardEvent, type ReactNode, useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { WORLD_COUNT, worldNumber, worldNumeral } from "../../shared/stage-rules";
import type { World } from "../../shared/types";
import { catalog, worldAt } from "../boot";
import { Link, navigate } from "../router";
import { stage, type StageSnapshot } from "./controller";

export function useStage(): StageSnapshot {
  return useSyncExternalStore(stage.subscribe, stage.getSnapshot);
}

const NO_WEBGL_NOTICE = "Your browser cannot show the 3D worlds, so here they are as a still gallery.";
const MODEL_FAILURE_NOTICE = "Some 3D scenes could not load, so the worlds are shown as a still gallery.";

/** The element that carries `data-stage`: it takes pointer drags and swipes, and holds the canvas while the stage draws. */
function StageHost({ className, accent, children }: { className: string; accent?: string; children: ReactNode }) {
  const attach = useCallback((element: HTMLDivElement | null) => stage.attach(element), []);
  return (
    <div
      ref={attach}
      data-stage=""
      className={className}
      {...(accent ? { style: { "--world-accent": accent } as React.CSSProperties } : {})}
      onPointerDown={(event) => {
        if (stage.pointerDown(event.pointerId, event.pointerType, event.button, event.clientX, event.clientY, event.target)) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => stage.pointerMove(event.pointerId, event.clientX)}
      onPointerUp={(event) => stage.pointerUp(event.pointerId, event.clientX, event.clientY)}
      onPointerCancel={() => stage.pointerCancel()}
    >
      {children}
    </div>
  );
}

function Rail({ active }: { active: number }) {
  const strip = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const track = strip.current;
    const current = track?.querySelector<HTMLElement>("[aria-current='true']");
    if (!track || !current) return;
    track.scrollLeft = current.offsetLeft - (track.clientWidth - current.offsetWidth) / 2;
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const target = event.key === "Home" ? 1 : event.key === "End" ? WORLD_COUNT : step === undefined ? undefined : Math.min(WORLD_COUNT, Math.max(1, active + step));
    if (target === undefined) return;
    event.preventDefault();
    stage.select(target);
    strip.current?.querySelectorAll<HTMLElement>("button")[target - 1]?.focus({ preventScroll: true });
  };

  return (
    <nav ref={strip} className="rail" aria-label="World rail" onKeyDown={onKeyDown}>
      {catalog.worlds.map((world) => (
        <button key={world.slug} type="button" className="rail-button" style={{ "--world-accent": world.colours.accent } as React.CSSProperties} tabIndex={world.index === active ? 0 : -1} aria-current={world.index === active ? "true" : undefined} onClick={() => stage.select(world.index)}>
          <span className="rail-numeral" aria-hidden="true">{worldNumber(world.index)}</span>
          <span className="rail-name">{world.name}</span>
        </button>
      ))}
    </nav>
  );
}

function Overlay({ active }: { active: number }) {
  const world = worldAt(active);
  return (
    <div className="overlay">
      <p className="overlay-numeral" aria-hidden="true">{worldNumeral(active)}</p>
      <h2 className="overlay-name">{world.name}</h2>
      <p className="overlay-industry">{world.industry}</p>
      <div className="overlay-actions">
        <button type="button" className="button button--quiet" disabled={active === 1} onClick={() => stage.select(active - 1)}>Previous world</button>
        <button type="button" className="button button--quiet" disabled={active === WORLD_COUNT} onClick={() => stage.select(active + 1)}>Next world</button>
        <button type="button" className="button button--primary" onClick={() => navigate(`/worlds/${world.slug}`)}>Enter {world.name}</button>
      </div>
    </div>
  );
}

function Plate({ world }: { world: World }) {
  const { ground, ink, accent } = world.colours;
  return (
    <div className="plate" aria-hidden="true" style={{ background: ground }}>
      <span className="plate-sun" style={{ background: accent }} />
      <span className="plate-line" style={{ background: ink }} />
      <span className="plate-line plate-line--short" style={{ background: ink }} />
    </div>
  );
}

/** The worlds as a still gallery, in ring order, with a link to every world page. */
function StillGallery({ snapshot, onRetry }: { snapshot: StageSnapshot; onRetry: () => void }) {
  return (
    <div className="still">
      <h2>The eight worlds</h2>
      <p className="still-notice">{snapshot.reason === "no-webgl" ? NO_WEBGL_NOTICE : MODEL_FAILURE_NOTICE}</p>
      {snapshot.reason === "model-failure" && <button type="button" className="button button--primary" onClick={onRetry}>Try 3D again</button>}
      <ul className="still-list" aria-label="Worlds">
        {catalog.worlds.map((world) => (
          <li key={world.slug}>
            <article className="still-card">
              <Plate world={world} />
              <h3>{world.name}</h3>
              <p className="still-industry">{world.industry}</p>
              <p>{world.summary}</p>
              <Link className="button button--quiet" href={`/worlds/${world.slug}`}>Explore {world.name}</Link>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The pinned stage of the home page: the canvas, the overlay and the rail, or the still gallery. */
export function WorldsStage({ onRetry }: { onRetry: () => void }) {
  const snapshot = useStage();
  const world = worldAt(snapshot.active);
  return (
    <StageHost className={snapshot.mode === "still" ? "stage stage--still" : "stage stage--pinned"} accent={world.colours.accent}>
      {snapshot.mode === "still" ? (
        <StillGallery snapshot={snapshot} onRetry={onRetry} />
      ) : (
        <>
          <Overlay active={snapshot.active} />
          <Rail active={snapshot.active} />
          {snapshot.mode === "loading" && <p className="stage-loading">Loading the worlds…</p>}
        </>
      )}
    </StageHost>
  );
}

/** The band at the top of a world page: the camera inside the island, or a plate in the world's colours. */
export function StageBand({ world }: { world: World }) {
  const snapshot = useStage();
  return (
    <StageHost className="stage stage--band" accent={world.colours.accent}>
      {snapshot.mode === "still" && <Plate world={world} />}
      {snapshot.mode === "loading" && <p className="stage-loading">Loading the worlds…</p>}
    </StageHost>
  );
}

export function Announcer() {
  const snapshot = useStage();
  return <div role="status" aria-label="World announcer" className="sr-only">{snapshot.announcement}</div>;
}
