import { useEffect, useRef, useState } from "react";
import type { Trash } from "../../../shared/api";
import { countdownText } from "../../../shared/words";
import { api, ApiError } from "../api";
import { COPY, useDeck } from "../deck";
import { useField } from "../field";
import { useDocumentTitle, useRefetch } from "../hooks";
import { measureRows, slideRowOut, slideRowsFrom } from "../motion";

const TICK_MS = 1_000;

export function TrashScreen() {
  useDocumentTitle("Trash");
  const field = useField();
  const { say } = useDeck();
  const [trash, setTrash] = useState<{ data: Trash; fetchedAt: number } | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const before = useRef<Map<string, DOMRect> | null>(null);

  const accept = (data: Trash) => setTrash({ data, fetchedAt: performance.now() });
  useRefetch({ load: () => api<Trash>("GET", "/trash"), onData: accept }, "trash");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const emptyTrash = trash !== null && trash.data.items.length === 0;
  useEffect(() => {
    field.show(null, emptyTrash ? COPY.emptyTrash : null);
    return () => field.show(null);
  }, [field, emptyTrash]);

  useEffect(() => {
    if (!before.current) return;
    slideRowsFrom(list.current, before.current);
    before.current = null;
  }, [trash]);

  const restore = async (id: string, title: string) => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(":scope > [data-row]") ?? [])];
    const at = rows.findIndex((row) => row.dataset.row === id);
    const next = rows[at + 1] ?? rows[at - 1];
    try {
      await api("POST", `/references/${id}/restore`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) {
        say(COPY.restoreClosed);
        api<Trash>("GET", "/trash").then(accept, () => undefined);
      } else {
        say(COPY.generic);
      }
      return;
    }
    say(`Restored ${title}.`);
    const target = next?.querySelector<HTMLElement>("button");
    (target ?? heading.current)?.focus();
    const leaving = rows[at];
    if (leaving) await slideRowOut(leaving);
    before.current = measureRows(list.current);
    setTrash((previous) =>
      previous ? { ...previous, data: { ...previous.data, items: previous.data.items.filter((item) => item.id !== id) } } : previous,
    );
  };

  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        Trash
      </h1>
      {emptyTrash && <p className="muted">{COPY.emptyTrash}</p>}
      {trash && (
        <ul ref={list} role="list" className="row-list trash-list" aria-label="Trashed references">
          {trash.data.items.map((item) => {
            const left = Math.max(0, item.seconds_left - Math.max(0, Math.floor((now - trash.fetchedAt) / TICK_MS)));
            return (
              <li key={item.id} data-row={item.id} className="row trash-row">
                <div className="row-text">
                  <span className="row-name">{item.title}</span>
                  <span className="row-meta">
                    {item.maker && <span>{item.maker}</span>}
                    <span className="size-line">Restorable for {countdownText(left)}</span>
                  </span>
                </div>
                <button type="button" className="btn" aria-label={`Restore ${item.title}`} onClick={() => void restore(item.id, item.title)}>
                  Restore
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
