import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { api, makeOpId, type MeData, type NoteData, type PatternData, type RowData } from "../lib/api";
import { StitchGrid, WrittenLines } from "../components/Chart";
import { announces, s } from "../../common/copy";

export function FollowPage(props: { me: MeData; layout: string; id: string; onLive: (value: string) => void }): JSX.Element {
  const [pattern, setPattern] = useState<PatternData | null>(null);
  const [row, setRow] = useState(1);
  const [latestVersion, setLatestVersion] = useState(1);
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [noteStatus, setNoteStatus] = useState("");
  const [rowAnnouncement, setRowAnnouncement] = useState("");
  const [dialogRow, setDialogRow] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.id]);

  async function loadAll(): Promise<void> {
    const data = await api<PatternData>(`/api/patterns/${props.id}/follow`);
    setPattern(data);
    setRow(data.row ?? 1);
    setLatestVersion(data.latestVersion ?? data.version ?? 1);
    const noteList = await api<{ notes: NoteData[] }>(`/api/patterns/${props.id}/notes`);
    setNotes(noteList.notes);
    openSocket();
  }

  function openSocket(): void {
    if (socketRef.current) return;
    const socket = new WebSocket(`${window.location.origin.replace(/^http/, "ws")}/api/patterns/${props.id}/live`);
    socketRef.current = socket;
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (message.type === "hello") {
        props.onLive(message.live === true ? s.liveOn : s.liveOff);
        return;
      }
      if (message.type === "counter" && message.userId === props.me.id) {
        setRow(Number(message.row));
      }
      if (message.type === "note" && message.userId === props.me.id) {
        const note = message as { row: number; text: string; version: number };
        setNotes((current) => [...current, { row: note.row, text: note.text, tester: props.me.name, version: note.version }]);
      }
      if (message.type === "version") {
        void api<PatternData>(`/api/patterns/${props.id}/follow`).then((data) => {
          setLatestVersion(data.latestVersion ?? data.version ?? 1);
          setNotice(announces.versionOut(data.latestVersion ?? 1, data.version ?? 1));
        });
      }
    };
  }

  const step = async (direction: 1 | -1): Promise<void> => {
    if (!pattern) return;
    try {
      const response = await api<{ row: number }>(`/api/patterns/${props.id}/counter`, {
        method: "POST",
        body: JSON.stringify({ from: row, step: direction, stepId: makeOpId() }),
      });
      const nextRow = response.row;
      if (nextRow !== row) {
        setRow(nextRow);
        const rowInfo = pattern.rows[nextRow - 1];
        setRowAnnouncement(rowInfo?.state === "empty" ? s.emptyRow : rowInfo?.text ?? "");
      }
    } catch {
      // the counter keeps its last saved value
    }
  };

  const currentRow = pattern?.rows[row - 1];
  const grid = (
    <section aria-label="Chart">
      <StitchGrid
        pattern={pattern!}
        cursor={null}
        selection={null}
        peers={{}}
        followRow={row}
        readOnly
      />
    </section>
  );

  if (!pattern) {
    return (
      <>
        <h1 className="lead">{s.loading}</h1>
        <div className="panel" />
      </>
    );
  }

  return (
    <div className={props.layout === "desktop" ? "follow-layout" : undefined}>
      {grid}
      <div>
        <section className="panel" aria-label="Counter">
          <p className="status" role="status" aria-live="polite" aria-label="Row counter">
            {announces.counter(row, pattern.height)}
          </p>
          <p className="status" role="status" aria-live="polite" aria-label="Version">
            {notice ?? (latestVersion !== (pattern.version ?? 1) ? announces.versionOut(latestVersion, pattern.version ?? 1) : announces.versionMoved(pattern.version ?? 1))}
          </p>
          {latestVersion !== (pattern.version ?? 1) ? (
            <button type="button" className="button-primary" aria-label={`Move to version ${latestVersion}`} onClick={() => void moveToLatest()}>
              {`Move to version ${latestVersion}`}
            </button>
          ) : null}
        </section>
        <section className="panel" aria-label="Current row">
          <p className="status" role="status" aria-live="polite" aria-label="Row announcement">
            {rowAnnouncement}
          </p>
          {currentRow?.state === "empty" ? <p>{s.emptyRow}</p> : null}
          <div className="actions">
            <button type="button" className="button-plain" aria-label="Previous row" disabled={row <= 1} onClick={() => void step(-1)}>
              Previous row
            </button>
            <button type="button" className="button-plain" aria-label="Next row" disabled={row >= pattern.height} onClick={() => void step(1)}>
              Next row
            </button>
            <button type="button" className="button-plain" aria-label="Add note" onClick={() => setDialogRow(row)}>
              Add note
            </button>
          </div>
        </section>
        <section className="panel" aria-label="Your notes">
          <h2>Your notes</h2>
          <ul className="panel-list" role="list" aria-label="Your notes">
            {notes.map((note, index) => (
              <li key={index}>{`Row ${note.row}: ${note.text}`}</li>
            ))}
          </ul>
        </section>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-label="Note status">
        {noteStatus}
      </p>
      {dialogRow !== null ? (
        <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setDialogRow(null); }}>
          <div className="dialog" role="dialog" aria-label="Add note" onKeyDown={(event) => { if (event.key === "Escape") setDialogRow(null); }}>
            <h2>Add note</h2>
            <div className="field">
              <label htmlFor="note-text">{`Note for row ${dialogRow}`}</label>
              <input
                id="note-text"
                value={noteText}
                aria-label={`Note for row ${dialogRow}`}
                aria-invalid={noteError ? "true" : undefined}
                onChange={(event) => setNoteText(event.target.value)}
              />
            </div>
            {noteError ? (
              <p className="alert" role="alert" aria-label="Note error">
                {noteError}
              </p>
            ) : null}
            <div className="actions">
              <button type="button" className="button-plain" onClick={() => setDialogRow(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button-primary"
                aria-busy={busy}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/api/patterns/${props.id}/notes`, {
                      method: "POST",
                      body: JSON.stringify({ row: dialogRow, text: noteText }),
                    });
                    setNoteStatus(announces.noteSaved(dialogRow));
                    setNoteText("");
                    setNoteError(null);
                    setDialogRow(null);
                  } catch (error) {
                    setNoteError(error instanceof Error ? error.message : "");
                  }
                  setBusy(false);
                }}
              >
                Save note
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  async function moveToLatest(): Promise<void> {
    if (!pattern) return;
    const response = await api<{ version: number; row: number; movedFrom: number | null }>(
      `/api/patterns/${props.id}/follow`,
      {
        method: "POST",
        body: JSON.stringify({ version: latestVersion }),
      },
    );
    setPattern({ ...pattern, version: response.version, row: response.row });
    setRow(response.row);
    setNotice(announces.versionMoved(response.version));
    if (response.movedFrom !== null) {
      setRowAnnouncement(announces.versionRowGone(response.version, response.row));
    }
    const fresh = await api<PatternData>(`/api/patterns/${props.id}/follow`);
    setPattern(fresh);
  }
}
