// Players' folders: the folder list, and one folder as a carousel of part pages that asks the
// server for its current page on every page change, status check and return to the tab.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import type { Folder, FolderEntry, FolderPage } from "../../shared/api";
import { dateTimeLabel } from "../../shared/london";
import { get } from "../api";
import { linkTo, navigate } from "../router";
import { useStatus } from "../status";
import { prefersReducedMotion } from "../ui/Modal";

const SETTLE_MS = 330;
const NOT_IN_FOLDER = "That part isn't in your folder.";

export function FolderList() {
  const { refresh } = useStatus();
  const [folders, setFolders] = useState<FolderEntry[] | null>(null);
  useEffect(() => {
    void get<{ folders: FolderEntry[] }>("/api/folders").then((answer) => {
      if (answer.ok) setFolders(answer.data.folders);
    });
  }, [refresh]);
  return (
    <main className="page folders">
      <h1 className="page__title">Your folders</h1>
      {folders === null && <p className="quiet">Opening your folders</p>}
      {folders?.length === 0 && (
        <div className="empty-card">
          <p className="empty-card__copy">No folders are published for your chair yet.</p>
          <p className="empty-card__note">Your folder holds only the parts for your chair in published programmes.</p>
        </div>
      )}
      {folders && folders.length > 0 && (
        <ul className="folder-list" aria-label="Your folders">
          {folders.map((folder) => (
            <li key={folder.programme_id}>
              <a
                className="folder-list__link"
                aria-label={`Programme ${folder.number} · ${folder.title}`}
                {...linkTo(`/folder/${folder.programme_id}`)}
              >
                <span className="folder-list__numeral">{folder.number}</span>{" "}
                <span className="folder-list__title">{folder.title}</span>
              </a>
              <span className="folder-list__meta">
                {folder.chair_label} · <span className="mono">{folder.part_count}</span> {folder.part_count === 1 ? "part" : "parts"} · first
                rehearsal <span className="mono">{dateTimeLabel(folder.first_rehearsal)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function PageCard({ page, label, scansAvailable, current }: { page: FolderPage; label: string; scansAvailable: boolean; current: boolean }) {
  return (
    <div
      className="folder-page"
      role="group"
      aria-label={label}
      aria-hidden={current ? undefined : true}
      inert={!current}
    >
      <p className="folder-page__work">
        <span className="folder-page__title">{page.work_title}</span>
        <span className="folder-page__composer">{page.composer}</span>
      </p>
      <p className="folder-page__part">
        {page.part_name} · bars{" "}
        <span className="mono">
          {page.bars_from}–{page.bars_to}
        </span>
      </p>
      <h3 className="folder-page__subhead">Cuts</h3>
      {page.cuts.length === 0 ? (
        <p className="quiet">No cuts in this part.</p>
      ) : (
        <ul className="plain-list folder-page__cuts">
          {page.cuts.map((cut) => (
            <li key={`${cut.from_bar}`}>
              <i>vi–de</i>{" "}
              <span className="mono">
                {cut.from_bar}–{cut.to_bar}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="folder-page__subhead">Rehearsal letters</h3>
      <ul className="plain-list letter-strip">
        {page.rehearsal_letters.map((letter) => (
          <li key={letter.letter} className="letter-strip__item">
            <span className="letter-box">{letter.letter}</span>
            <span className="mono">{letter.bar}</span>
          </li>
        ))}
      </ul>
      <div className="folder-page__scan">
        {!scansAvailable ? (
          <p className="state-copy">This marked part can't be opened right now. Its cuts and rehearsal letters are shown below.</p>
        ) : page.marked_scan ? (
          <a className="button button--primary open-part" href={`/api/scans/${page.marked_scan.id}/file`} download>
            <FileText aria-hidden="true" />
            Open marked part
          </a>
        ) : (
          <p className="state-copy">No marked part has been filed yet.</p>
        )}
      </div>
    </div>
  );
}

export function FolderView({ programmeId, partId }: { programmeId: string; partId: string | null }) {
  const { status, refresh, checked } = useStatus();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [notInFolder, setNotInFolder] = useState(false);
  const [index, setIndex] = useState(0);
  const [scansAvailable, setScansAvailable] = useState(true);
  const [offset, setOffset] = useState(0);
  const region = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const touch = useRef<{ x: number; y: number; dx: number; horizontal: boolean | null } | null>(null);
  const animation = useRef(0);

  useEffect(() => {
    void get<Folder>(`/api/folders/${programmeId}`).then((answer) => {
      if (!answer.ok) {
        if (answer.status === 404) setNotInFolder(true);
        return;
      }
      const at = partId ? answer.data.pages.findIndex((p) => p.part_id === partId) : 0;
      if (at < 0 || answer.data.pages.length === 0) {
        setNotInFolder(true);
        return;
      }
      setFolder(answer.data);
      setScansAvailable(answer.data.scans_available);
      setIndex(at);
      const first = answer.data.pages[at];
      if (!partId && first) navigate(`/folder/${programmeId}/${first.part_id}`, true);
    });
  }, [programmeId]);

  useEffect(() => {
    if (checked > 0 && status) setScansAvailable(status.storage === "up");
  }, [checked, status]);

  const currentPage = folder?.pages[index];
  const currentId = currentPage?.part_id;

  useEffect(() => {
    if (!currentId) return;
    let live = true;
    void get<FolderPage>(`/api/folders/${programmeId}/parts/${currentId}`).then((answer) => {
      if (!live) return;
      if (answer.ok) {
        setFolder((current) => (current ? { ...current, pages: current.pages.map((p) => (p.part_id === currentId ? answer.data : p)) } : current));
      } else if (answer.status === 404) {
        setNotInFolder(true);
      }
    });
    return () => {
      live = false;
    };
  }, [programmeId, currentId, refresh]);

  useLayoutEffect(() => {
    const element = region.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [folder !== null]);

  const pages = folder?.pages ?? [];

  const slideTo = (next: number, from: number): void => {
    const target = Math.min(Math.max(next, 0), pages.length - 1);
    const page = pages[target];
    if (!page) return;
    if (target === index && from === 0) return;
    cancelAnimationFrame(animation.current);
    if (target !== index) navigate(`/folder/${programmeId}/${page.part_id}`, true);
    setIndex(target);
    if (prefersReducedMotion()) {
      setOffset(0);
      return;
    }
    const start = from + (target - index) * width;
    let begin: number | null = null;
    const step = (now: number): void => {
      begin ??= now;
      const progress = Math.min((now - begin) / SETTLE_MS, 1);
      const eased = 1 - (1 - progress) ** 3;
      flushSync(() => setOffset(start * (1 - eased)));
      if (progress < 1) animation.current = requestAnimationFrame(step);
    };
    setOffset(start);
    animation.current = requestAnimationFrame(step);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      slideTo(index + (event.key === "ArrowRight" ? 1 : -1), offset);
    }
  };

  const onTouchStart = (event: TouchEvent<HTMLDivElement>): void => {
    const point = event.touches[0];
    if (!point) return;
    cancelAnimationFrame(animation.current);
    touch.current = { x: point.clientX, y: point.clientY, dx: 0, horizontal: null };
  };

  const onTouchMove = (event: TouchEvent<HTMLDivElement>): void => {
    const state = touch.current;
    const point = event.touches[0];
    if (!state || !point) return;
    const dx = point.clientX - state.x;
    const dy = point.clientY - state.y;
    state.horizontal ??= Math.abs(dx) > 6 || Math.abs(dy) > 6 ? Math.abs(dx) > Math.abs(dy) : null;
    if (!state.horizontal) return;
    state.dx = dx;
    if (!prefersReducedMotion()) setOffset(dx);
  };

  const onTouchEnd = (): void => {
    const state = touch.current;
    touch.current = null;
    if (!state?.horizontal) return;
    const far = Math.abs(state.dx) > width / 4;
    const next = far ? index + (state.dx < 0 ? 1 : -1) : index;
    slideTo(next, state.dx);
  };

  if (notInFolder) {
    return (
      <main className="page folder">
        <h1 className="page__title">{NOT_IN_FOLDER}</h1>
        <p>Your folder holds only the parts for your chair in published programmes.</p>
        <a className="button" {...linkTo("/folder")}>
          Back to your folders
        </a>
      </main>
    );
  }

  if (!folder) {
    return (
      <main className="page folder">
        <h1 className="page__title">Opening your folder</h1>
      </main>
    );
  }

  return (
    <main className="page folder">
      <div className="folder__head">
        <h1 className="page__title">
          <span className="mono folder__number">{folder.programme.number}</span> {folder.programme.title}
        </h1>
        <p className="page__lede">
          {folder.chair.label} · first rehearsal <span className="mono nowrap">{dateTimeLabel(folder.programme.first_rehearsal)}</span>
        </p>
      </div>
      <div className="carousel" role="region" aria-label="Folder pages" onKeyDown={onKeyDown}>
        <div ref={region} className="carousel__viewport" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
          <div className="carousel__track" style={{ transform: `translateX(${-index * width + offset}px)` }}>
            {pages.map((page, i) => (
              <PageCard key={page.part_id} page={page} label={`${page.work_title} — ${page.part_name}`} scansAvailable={scansAvailable} current={i === index} />
            ))}
          </div>
        </div>
        <div className="carousel__controls">
          <button type="button" className="button" aria-disabled={index === 0 ? "true" : undefined} onClick={() => slideTo(index - 1, offset)}>
            <ChevronLeft aria-hidden="true" />
            Previous part
          </button>
          <p className="carousel__position mono" role="status" aria-label="Page position">
            Part {index + 1} of {pages.length}
          </p>
          <button
            type="button"
            className="button"
            aria-disabled={index === pages.length - 1 ? "true" : undefined}
            onClick={() => slideTo(index + 1, offset)}
          >
            Next part
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>
    </main>
  );
}
