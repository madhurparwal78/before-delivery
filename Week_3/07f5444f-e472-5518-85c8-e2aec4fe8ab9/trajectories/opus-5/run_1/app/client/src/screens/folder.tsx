import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileMusic } from 'lucide-react';
import type { Folder, FolderListEntry, FolderPage } from '../../../shared/api.js';
import { EN_DASH, MIDDLE_DOT } from '../../../shared/format.js';
import { ApiFailure, api } from '../api.js';
import { useApp } from '../app.js';
import { useReducedMotion } from '../ui.js';

export const NOT_IN_FOLDER = "That part isn't in your folder.";
export const NO_FOLDERS = 'No folders are published for your chair yet.';
export const SCANS_UNAVAILABLE =
  "This marked part can't be opened right now. Its cuts and rehearsal letters are shown below.";
export const NO_SCAN_FILED = 'No marked part has been filed yet.';

export function FolderList(): JSX.Element {
  const { statusTick, visibilityTick, navigate } = useApp();
  const [folders, setFolders] = useState<FolderListEntry[] | null>(null);

  const load = useCallback(async () => {
    try {
      const answer = await api.folders();
      setFolders(answer.folders);
    } catch {
      /* a failed read leaves the screen as it is */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (statusTick > 0) void load();
  }, [statusTick, load]);
  useEffect(() => {
    if (visibilityTick > 0) void load();
  }, [visibilityTick, load]);

  if (folders === null) {
    return (
      <main className="folder">
        <p className="loading">Opening your folder</p>
      </main>
    );
  }

  return (
    <main className="folder">
      <h1>Your folders</h1>
      {folders.length === 0 ? <p>{NO_FOLDERS}</p> : null}
      <ul aria-label="Your folders" className="folder-list">
        {folders.map((folder) => (
          <li key={folder.programme_id}>
            <a
              href={`/folder/${folder.programme_id}`}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                navigate(`/folder/${folder.programme_id}`);
              }}
            >
              {`Programme ${folder.number} ${MIDDLE_DOT} ${folder.title}`}
            </a>
            <span className="mono folder-chair">{folder.chair_label}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function FolderScreen({
  programmeId,
  partId,
}: {
  programmeId: string;
  partId: string | null;
}): JSX.Element {
  const { status, statusTick, visibilityTick, navigate } = useApp();
  const reducedMotion = useReducedMotion();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [missing, setMissing] = useState(false);
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const [scansAnswer, setScansAnswer] = useState<{ available: boolean; at: number } | null>(null);
  const touchStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const track = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setScansAnswer((current) => {
      const available = status.storage === 'up';
      if (statusTick === 0) return current;
      return { available, at: Date.now() };
    });
  }, [statusTick, status.storage]);

  const loadFolder = useCallback(async () => {
    try {
      const answer = await api.folder(programmeId);
      setFolder(answer);
      setMissing(false);
      setScansAnswer({ available: answer.scans_available, at: Date.now() });
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404) setMissing(true);
    }
  }, [programmeId]);

  useEffect(() => {
    void loadFolder();
  }, [loadFolder]);

  useEffect(() => {
    if (!folder) return;
    const wanted = partId === null ? -1 : folder.pages.findIndex((page) => page.part_id === partId);
    if (partId !== null && wanted < 0) {
      setMissing(true);
      return;
    }
    if (wanted >= 0 && wanted !== index) {
      setIndex(wanted);
      return;
    }
    const page = folder.pages[index];
    if (page && page.part_id !== partId) {
      navigate(`/folder/${programmeId}/${page.part_id}`);
    }
  }, [folder, partId, index, navigate, programmeId]);

  const currentPage: FolderPage | undefined = folder?.pages[index];

  const refreshPage = useCallback(async () => {
    const page = currentPage;
    if (!page) return;
    try {
      const fresh = await api.folderPage(programmeId, page.part_id);
      setFolder((current) =>
        current === null
          ? current
          : { ...current, pages: current.pages.map((entry) => (entry.part_id === fresh.part_id ? fresh : entry)) },
      );
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404) setMissing(true);
    }
  }, [currentPage, programmeId]);

  useEffect(() => {
    if (statusTick > 0) void refreshPage();
  }, [statusTick, refreshPage]);
  useEffect(() => {
    if (visibilityTick > 0) {
      void refreshPage();
    }
  }, [visibilityTick, refreshPage]);

  const goTo = useCallback(
    (next: number) => {
      if (!folder) return;
      const bounded = Math.max(0, Math.min(folder.pages.length - 1, next));
      const page = folder.pages[bounded];
      setIndex(bounded);
      if (page) navigate(`/folder/${programmeId}/${page.part_id}`);
      void refreshPage();
    },
    [folder, navigate, programmeId, refreshPage],
  );

  if (missing) {
    return (
      <main className="folder">
        <h1>{NOT_IN_FOLDER}</h1>
      </main>
    );
  }

  if (!folder) {
    return (
      <main className="folder">
        <p className="loading">Opening your folder</p>
      </main>
    );
  }

  const scansAvailable = scansAnswer === null ? true : scansAnswer.available;

  return (
    <main className="folder">
      <h1>
        {`Programme ${folder.programme.number} ${MIDDLE_DOT} ${folder.programme.title}`}
        <span className="folder-chair mono">{folder.chair.label}</span>
      </h1>

      <div
        className="carousel"
        role="region"
        aria-label="Folder pages"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            goTo(index + 1);
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            goTo(index - 1);
          }
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
        }}
        onTouchMove={(event) => {
          const start = touchStart.current;
          const touch = event.touches[0];
          if (!start || !touch) return;
          const dx = touch.clientX - start.x;
          if (Math.abs(dx) > Math.abs(touch.clientY - start.y) && !reducedMotion) setDrag(dx);
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          setDrag(0);
          const touch = event.changedTouches[0];
          if (!start || !touch) return;
          const dx = touch.clientX - start.x;
          const width = track.current?.getBoundingClientRect().width ?? 1;
          const quickFlick = Math.abs(dx) > 40 && Date.now() - start.at < 250;
          if (dx <= -width / 4 || (quickFlick && dx < 0)) goTo(index + 1);
          else if (dx >= width / 4 || (quickFlick && dx > 0)) goTo(index - 1);
        }}
      >
        <div
          className="carousel-track"
          ref={track}
          style={{
            transform: `translateX(calc(${-index * 100}% + ${drag}px))`,
            transition: reducedMotion || drag !== 0 ? 'none' : 'transform 330ms cubic-bezier(0.2, 0, 0.1, 1)',
          }}
        >
          {folder.pages.map((page, pageIndex) => (
            <section
              className="folder-page"
              role="group"
              aria-label={`${page.work_title} \u2014 ${page.part_name}`}
              aria-hidden={pageIndex === index ? undefined : true}
              key={page.part_id}
            >
              <h2>{page.work_title}</h2>
              <p className="composer">{page.composer}</p>
              <p className="part-name">
                {page.part_name} <span className="mono">
                  {page.bars_from}
                  {EN_DASH}
                  {page.bars_to}
                </span>
              </p>

              <h3>Cuts</h3>
              <ul className="page-cuts mono">
                {page.cuts.map((cut) => (
                  <li key={`${cut.from_bar}-${cut.to_bar}`}>
                    vi{EN_DASH}de {cut.from_bar}
                    {EN_DASH}
                    {cut.to_bar}
                  </li>
                ))}
                {page.cuts.length === 0 ? <li>No cuts</li> : null}
              </ul>

              <h3>Rehearsal letters</h3>
              <p className="page-letters">
                {page.rehearsal_letters.map((letter) => (
                  <span className="letter-chip" key={letter.letter}>
                    <span className="letter">{letter.letter}</span>
                    <span className="mono">{letter.bar}</span>
                  </span>
                ))}
              </p>

              {!scansAvailable ? (
                <p className="page-scan">{SCANS_UNAVAILABLE}</p>
              ) : page.marked_scan ? (
                <a
                  className="page-scan"
                  href={`/api/scans/${page.marked_scan.id}/file`}
                  download
                  tabIndex={pageIndex === index ? undefined : -1}
                >
                  <FileMusic className="icon" aria-hidden="true" focusable="false" />
                  Open marked part
                </a>
              ) : (
                <p className="page-scan">{NO_SCAN_FILED}</p>
              )}
            </section>
          ))}
        </div>

        <div className="carousel-controls">
          <button type="button" onClick={() => goTo(index - 1)}>
            <ChevronLeft className="icon" aria-hidden="true" focusable="false" />
            Previous part
          </button>
          <p role="status" aria-label="Page position" className="mono">
            Part {index + 1} of {folder.pages.length}
          </p>
          <button type="button" onClick={() => goTo(index + 1)}>
            <ChevronRight className="icon" aria-hidden="true" focusable="false" />
            Next part
          </button>
        </div>
      </div>
    </main>
  );
}
