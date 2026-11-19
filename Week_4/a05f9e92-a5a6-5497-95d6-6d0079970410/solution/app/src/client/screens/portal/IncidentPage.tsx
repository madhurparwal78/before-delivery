import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiFailure, failureText, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { useTopics } from "../../lib/live.js";
import { Modal } from "../../lib/dialog.js";
import { useSession } from "../../lib/session.js";
import { useSlaFeed } from "../../lib/sla.js";
import { SlaPanel } from "../../components/Sla.js";
import { Button, Page, Rest, StatusBlock, useLoad } from "../../lib/ui.js";
import type { RecordJson } from "../../../server/records.js";
import { gate, PortalActions } from "./common.js";

interface Entry {
  at: string;
  actor: string | null;
  kind: string;
  text: string;
}

interface Loaded {
  record: RecordJson;
  comments: Entry[];
}

async function loadIncident(number: string): Promise<Loaded> {
  const [{ record }, { entries }] = await Promise.all([get<{ record: RecordJson }>(`/api/records/${encodeURIComponent(number)}`), get<{ entries: Entry[] }>(`/api/records/${encodeURIComponent(number)}/activity`)]);
  return { record, comments: entries.filter((entry) => entry.kind === "comment").reverse() };
}

function ReopenDialog({ number, onDone, onClose }: { number: string; onDone: () => void; onClose: () => void }): JSX.Element {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const send = (version: number): Promise<unknown> => post(`/api/records/${encodeURIComponent(number)}/transition`, { to: "in_progress", fields: { reopen_reason: { value: reason, version } } });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    // A requester cannot read the reason's version, so a reason left by an earlier reopen answers with the current one to resend.
    send(1)
      .catch((error: unknown) => {
        const current = error instanceof ApiFailure && error.code === "field_conflict" ? (error.extra.conflicts as Array<{ version: number }>)[0]?.version : undefined;
        if (current === undefined) throw error;
        return send(current);
      })
      .then(onDone, (error: unknown) => {
        setBusy(false);
        setMessage(error instanceof ApiFailure && error.fields?.reopen_reason ? error.fields.reopen_reason : failureText(error));
      });
  };

  return (
    <Modal label="Reopen" onClose={onClose} className="rf-dialog">
      <h3>Reopen</h3>
      <form className="stack" onSubmit={submit}>
        <div className="rf-field">
          <label htmlFor="reopen-reason">Reopen reason</label>
          <input id="reopen-reason" type="text" value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        {message ? <p className="form-error">{message}</p> : null}
        <div className="row">
          <button type="submit" className="btn btn-solid" aria-busy={busy || undefined} disabled={busy}>
            Reopen incident
          </button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function IncidentView({ loaded, reload }: { loaded: Loaded; reload: () => void }): JSX.Element {
  const announce = useAnnounce();
  const { record, comments } = loaded;
  const heading = useRef<HTMLHeadingElement>(null);
  const known = useRef(record.state);
  const reopened = useRef(false);
  const slas = useSlaFeed(record.number, record.slas, false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reopening, setReopening] = useState(false);
  const canReopen = record.state === "resolved" && record.transitions.some((move) => move.to === "in_progress");

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (known.current !== record.state) announce(`Your request ${record.number} is now ${record.state_label}.`);
    known.current = record.state;
    // The dialog gives focus back to a button that has just left the page, so the heading takes it once the new state arrives.
    if (reopened.current && record.state !== "resolved") {
      reopened.current = false;
      heading.current?.focus();
    }
  }, [record.state, record.state_label, record.number, announce]);

  const comment = (): void => {
    setBusy(true);
    post(`/api/records/${encodeURIComponent(record.number)}/comments`, { text }).then(
      () => {
        setBusy(false);
        setText("");
        setError("");
        announce("Note added.");
        reload();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failureText(failure));
        announce(failureText(failure));
      },
    );
  };

  return (
    <Page subject={record.number} headingRef={heading}>
      <PortalActions />
      <Rest narrow label="Incident status" className="portal-column">
        <div className="status-head">
          <h2>Incident status</h2>
        </div>
        <p className="status-line">
          <span className="status-name">{record.number}:</span> <StatusBlock>{record.state_label}</StatusBlock>
        </p>
        {canReopen ? (
          <div className="row">
            <Button variant="outline" onClick={() => setReopening(true)}>
              Reopen
            </Button>
          </div>
        ) : null}
      </Rest>
      <Rest narrow className="portal-column">
        <SlaPanel slas={slas.filter((entry) => entry.sla.stage !== "cancelled")} />
      </Rest>
      <Rest narrow className="portal-column">
        <h2>Comments</h2>
        <ul className="comment-list" aria-label="Comments">
          {comments.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              {entry.actor}: {entry.text}
            </li>
          ))}
        </ul>
        <div className="rf-note">
          <label htmlFor="portal-comment">Comment</label>
          <textarea id="portal-comment" rows={2} value={text} onChange={(event) => setText(event.target.value)} />
          {error ? <p className="field-error">{error}</p> : null}
          <Button variant="outline" busy={busy} disabled={busy || text.trim() === ""} onClick={comment}>
            Add comment
          </Button>
        </div>
      </Rest>
      {reopening ? (
        <ReopenDialog
          number={record.number}
          onClose={() => setReopening(false)}
          onDone={() => {
            reopened.current = true;
            setReopening(false);
            reload();
          }}
        />
      ) : null}
    </Page>
  );
}

/** The requester's page for one of their incidents: state, SLA, comments and reopen, live from the record's topic. */
export function IncidentPage({ number }: { number: string }): JSX.Element {
  const session = useSession();
  const { state, reload } = useLoad(() => loadIncident(number), [number, session.accessVersion]);
  useTopics([`record:${number}`], reload);
  if (state.status !== "ready") return gate(state, number, reload);
  return <IncidentView loaded={state.data} reload={reload} />;
}
