import { useEffect, useState } from "react";
import { failureText, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { Button } from "../../lib/ui.js";
import { formatLocalIso } from "../../../shared/tz.js";

interface Entry {
  at: string;
  actor: string | null;
  acting_for: string | null;
  kind: string;
  text: string;
}

const KIND_WORDS: Record<string, string> = { work_note: "Work note", comment: "Comment" };

function NoteBox({ number, kind, label, button, onAdded }: { number: string; kind: "work-notes" | "comments"; label: string; button: string; onAdded: () => void }): JSX.Element {
  const announce = useAnnounce();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = `${number}-${kind}`;

  const add = (): void => {
    setBusy(true);
    post(`/api/records/${number}/${kind}`, { text }).then(
      () => {
        setBusy(false);
        setText("");
        setError("");
        announce("Note added.");
        onAdded();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failureText(failure));
        announce(failureText(failure));
      },
    );
  };

  return (
    <div className="rf-note">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} rows={2} value={text} onChange={(event) => setText(event.target.value)} />
      {error ? <p className="field-error">{error}</p> : null}
      <Button variant="outline" busy={busy} disabled={busy || text.trim() === ""} onClick={add}>
        {button}
      </Button>
    </div>
  );
}

/** The `Activity` region: the stream newest first, with work note (desk roles) and comment boxes. */
export function Activity({ number, desk, zone, version }: { number: string; desk: boolean; zone: string; version: unknown }): JSX.Element {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    get<{ entries: Entry[] }>(`/api/records/${number}/activity`).then(
      (response) => current && setEntries(response.entries),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [number, version, reload]);

  return (
    <section className="rf-section" aria-label="Activity" tabIndex={-1}>
      <h3>Activity</h3>
      <div className="rf-notes">
        {desk ? <NoteBox number={number} kind="work-notes" label="Work note" button="Add work note" onAdded={() => setReload((n) => n + 1)} /> : null}
        <NoteBox number={number} kind="comments" label="Comment" button="Add comment" onAdded={() => setReload((n) => n + 1)} />
      </div>
      <ul className="rf-activity">
        {entries.map((entry, index) => (
          <li key={`${entry.at}-${index}`} className={`rf-entry rf-entry-${entry.kind}`}>
            <p className="rf-entry-head">
              {KIND_WORDS[entry.kind] ? <span className="rf-kind">{KIND_WORDS[entry.kind]}</span> : null}
              <span>
                {entry.actor ?? "Switchyard"}
                {entry.acting_for ? ` (as ${entry.acting_for})` : ""}
              </span>
              <span className="muted">{formatLocalIso(entry.at, zone)}</span>
            </p>
            <p className="rf-entry-text">{entry.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
