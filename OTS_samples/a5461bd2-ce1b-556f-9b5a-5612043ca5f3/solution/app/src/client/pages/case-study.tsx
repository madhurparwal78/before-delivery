import { type KeyboardEvent, type PointerEvent, useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { neighboursOf } from "../../shared/gallery";
import { isHorizontalSwipe } from "../../shared/stage-rules";
import type { Project } from "../../shared/types";
import { catalog } from "../boot";
import { ModalDialog } from "../dialog";
import { displayFamily, metaLine } from "../format";
import { prefersReducedMotion } from "../motion";
import { Link } from "../router";
import { lastGalleryAddress } from "../storage";
import { Swatches } from "../swatches";

const SLIDE_MS = 240;
const SLIDE_PX = 56;

function ImageViewer({ project, start, onClose }: { project: Project; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const [failed, setFailed] = useState<number[]>([]);
  const direction = useRef(0);
  const frame = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const count = project.gallery.length;
  const image = project.gallery[index - 1] as Project["gallery"][number];

  const step = (change: number) => {
    direction.current = change;
    setIndex((at) => ((at - 1 + change + count) % count) + 1);
  };

  useLayoutEffect(() => {
    if (direction.current === 0 || prefersReducedMotion()) return;
    frame.current?.firstElementChild?.animate([{ transform: `translateX(${direction.current * SLIDE_PX}px)` }, { transform: "translateX(0)" }], { duration: SLIDE_MS, easing: "ease-out" });
  }, [index]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowLeft") step(-1);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = touch.current;
    touch.current = null;
    if (!start || event.pointerType !== "touch") return;
    const [dx, dy] = [event.clientX - start.x, event.clientY - start.y];
    if (isHorizontalSwipe(dx, dy)) step(dx < 0 ? 1 : -1);
  };

  const initialFocus = useCallback((dialog: HTMLDialogElement) => dialog.querySelector<HTMLElement>(".viewer-close"), []);

  return (
    <ModalDialog label="Image viewer" className="viewer-dialog" onClose={onClose} initialFocus={initialFocus}>
      <div className="viewer" onKeyDown={onKeyDown}>
        <div className="viewer-bar">
          <p className="viewer-count">Image {index} of {count}</p>
          <button type="button" className="button button--quiet viewer-close" onClick={onClose}>Close viewer</button>
        </div>
        <div className="viewer-frame" ref={frame} onPointerDown={(event) => (touch.current = { x: event.clientX, y: event.clientY })} onPointerUp={onPointerUp} onPointerCancel={() => (touch.current = null)}>
          {failed.includes(index) ? (
            <div className="viewer-plate" style={{ background: project.colours.ground, color: project.colours.ink }}>
              <p>{image.caption}</p>
              <p>Image unavailable</p>
            </div>
          ) : (
            <img src={image.src} alt={image.caption} onError={() => setFailed((list) => [...list, index])} draggable={false} />
          )}
        </div>
        <p className="viewer-caption">{image.caption}</p>
        <div className="viewer-actions">
          <button type="button" className="button button--quiet" onClick={() => step(-1)}>Previous image</button>
          <button type="button" className="button button--quiet" onClick={() => step(1)}>Next image</button>
        </div>
      </div>
    </ModalDialog>
  );
}

export function CaseStudyPage({ project }: { project: Project }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const opener = useRef(0);
  const { previous, next } = neighboursOf(catalog.projects, project.slug);
  const { ground, ink } = project.colours;

  const close = () => {
    flushSync(() => setViewing(null));
    thumbs.current[opener.current]?.focus({ preventScroll: true });
  };

  return (
    <div className="case" style={{ background: ground, color: ink }}>
      <div className="case-inner">
        <h1 tabIndex={-1} style={{ fontFamily: displayFamily(project.display_face) }}>{project.name}</h1>
        <p className="world-meta">{metaLine(project)}</p>
        <h2>The brief</h2>
        <p className="prose">{project.sections.brief}</p>
        <h2>Brand strategy</h2>
        <p className="prose">{project.sections.strategy}</p>
        <h2>Identity</h2>
        <p className="prose">{project.sections.identity}</p>
        <h2>Typography</h2>
        <p>Display face: {project.display_face}</p>
        <p>Body face: {project.body_face}</p>
        <h2>Colour</h2>
        <Swatches colours={project.colours} />
        <h2>Digital design</h2>
        <p className="prose">{project.sections.digital_design}</p>
        <h2>Implementation</h2>
        <p className="prose">{project.sections.implementation}</p>
        <h2>Gallery</h2>
        <ul className="thumbs">
          {project.gallery.map((image, at) => (
            <li key={image.n}>
              <button
                type="button"
                ref={(element) => { thumbs.current[at] = element; }}
                className="thumb"
                aria-label={`Open image ${image.n} of ${project.gallery.length}: ${image.caption}`}
                style={{ background: ground }}
                onClick={() => {
                  opener.current = at;
                  setViewing(image.n);
                }}
              >
                <img src={image.src} alt="" loading="lazy" draggable={false} />
              </button>
            </li>
          ))}
        </ul>
        <h2>Deliverables</h2>
        <ul className="deliverables">
          {project.deliverables.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="neighbours">
          {project.world_slug && <Link className="button button--outline" href={`/worlds/${project.world_slug}`}>Visit the world</Link>}
          <Link className="button button--outline" href={`/work/${previous.slug}`}>Previous project: {previous.name}</Link>
          <Link className="button button--outline" href={`/work/${next.slug}`}>Next project: {next.name}</Link>
          <Link className="button button--outline" href={lastGalleryAddress()}>All work</Link>
        </p>
      </div>
      {viewing !== null && <ImageViewer project={project} start={viewing} onClose={close} />}
    </div>
  );
}
