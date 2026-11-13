// region "Document": one event as indented JSON, its surrounding events, its score explanation and an edit dialog.
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiFailure, query } from "../../lib/api";
import { Modal } from "../../lib/dialog";
import { useShown } from "../../lib/format";
import { EASE_OUT, play } from "../../lib/motion";
import { announce } from "../../lib/store";
import { Tree } from "../../lib/tree";
import { Button, ErrorSummary, Field, useBusy } from "../../lib/ui";
import { marked } from "./Grid";
import { cellText, pillFilters, type ApiEvent, type SearchState } from "./model";

interface Props {
  event: ApiEvent;
  state: SearchState;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (event: ApiEvent) => void;
}

const PLAIN = /^[^"\\\n\r\t]*$/;

/** The event as indented JSON; matched tokens inside plain string values are wrapped in <mark>. */
function EventJson({ event }: { event: ApiEvent }) {
  const entries = Object.entries(event.fields);
  return (
    <pre className="doc-json mono">
      {"{\n"}
      {`  "@timestamp": ${JSON.stringify(event["@timestamp"])},\n`}
      {`  "_id": ${JSON.stringify(event._id)}${entries.length > 0 ? "," : ""}\n`}
      {entries.map(([field, value], k) => {
        const ranges = event.highlights[field];
        const comma = k < entries.length - 1 ? ",\n" : "\n";
        return (
          <span key={field}>
            {`  ${JSON.stringify(field)}: `}
            {typeof value === "string" && ranges && PLAIN.test(value) ? <>&quot;{marked(value, ranges)}&quot;</> : JSON.stringify(value)}
            {comma}
          </span>
        );
      })}
      {"}"}
    </pre>
  );
}

function EditDialog({ event, stream, onClose, onSaved }: { event: ApiEvent; stream: string; onClose: () => void; onSaved: (event: ApiEvent) => void }) {
  const [text, setText] = useState(JSON.stringify(event.fields, null, 2));
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (submitEvent: FormEvent): void => {
    submitEvent.preventDefault();
    void run(async () => {
      let edited: Record<string, unknown>;
      try {
        edited = JSON.parse(text) as Record<string, unknown>;
      } catch {
        setFailure(new ApiFailure(422, "invalid", "Check the highlighted fields.", { fields: "Enter the fields as a JSON object." }));
        return;
      }
      const fields: Record<string, unknown> = { ...edited };
      for (const key of Object.keys(event.fields)) if (!(key in edited)) fields[key] = null;
      try {
        const saved = await api.patch<ApiEvent>(`/api/streams/${stream}/events/${encodeURIComponent(event._id)}`, { fields });
        announce("Event saved.");
        onSaved(saved);
        onClose();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <Modal label="Edit event" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary failure={failure} labels={{ fields: "Fields JSON" }} />
        <Field label="Fields JSON" error={failure?.fields.fields}>
          {(props) => <textarea {...props} data-field="fields" className="mono tall" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Save event</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

interface Around { before: ApiEvent[]; event: ApiEvent; after: ApiEvent[] }

export function Document({ event, state, canEdit, onClose, onSaved }: Props) {
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const shown = useShown();
  const [around, setAround] = useState<Around | null>(null);
  const [explained, setExplained] = useState<ApiEvent | null>(null);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<ApiFailure | null>(null);

  useLayoutEffect(() => {
    closeButton.current?.focus();
    play(panel.current as HTMLElement, "panel-in", [{ transform: "translateX(16px)", opacity: 0 }, { transform: "translateX(0)", opacity: 1 }], 160, EASE_OUT);
  }, []);

  useLayoutEffect(() => {
    setAround(null);
    setExplained(null);
  }, [event._id]);

  const loadAround = async (): Promise<void> => {
    try {
      setProblem(null);
      setAround(await api.get<Around>(`/api/streams/${state.stream}/events/${encodeURIComponent(event._id)}/surrounding`));
    } catch (error) {
      setProblem(error as ApiFailure);
    }
  };

  const explain = async (): Promise<void> => {
    try {
      setProblem(null);
      const found = await api.get<{ events: ApiEvent[] }>(`/api/search${query({
        stream: state.stream, q: state.q, from: state.from, to: state.to, filters: JSON.stringify(pillFilters(state.pills)), id: event._id, explain: "true",
      })}`);
      setExplained(found.events[0] ?? null);
    } catch (error) {
      setProblem(error as ApiFailure);
    }
  };

  const explanation = explained?.explanation;
  return (
    <section ref={panel} role="region" aria-label="Document" className="document" onKeyDown={(keyboard) => { if (keyboard.key === "Escape") { keyboard.stopPropagation(); onClose(); } }}>
      <div className="doc-head">
        <h2>Document</h2>
        <div className="doc-actions">
          <button ref={closeButton} type="button" className="btn btn-outline" aria-label="Close document" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="doc-actions">
        <Button onClick={() => void loadAround()}>Surrounding events</Button>
        {event._score !== null && event._score > 0 ? <Button onClick={() => void explain()}>Explain score</Button> : null}
        {canEdit ? <Button onClick={() => setEditing(true)}>Edit event</Button> : null}
      </div>
      {problem ? <div role="alert" aria-label="Error" className="error-box"><p>{problem.message}</p></div> : null}
      <EventJson event={event} />
      {around ? (
        <div className="table-wrap">
          <table className="data" aria-label="Surrounding events">
            <thead><tr><th scope="col">Time</th><th scope="col">Host</th><th scope="col">Level</th><th scope="col">Message</th></tr></thead>
            <tbody>
              {[...around.before, around.event, ...around.after].map((item) => (
                <tr key={item._id} aria-current={item._id === event._id ? "true" : undefined} className={item._id === event._id ? "chosen" : ""}>
                  <td className="mono">{shown(item["@timestamp"])}</td><td className="mono">{cellText(item.fields.host)}</td><td className="mono">{cellText(item.fields.level)}</td><td className="mono">{cellText(item.fields.message)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {explanation ? (
        <Tree
          name="Score explanation"
          nodes={[{
            id: "score", label: explanation.text, content: <span className="mono">{explanation.text}</span>,
            children: explanation.children.map((child, k) => ({ id: `leaf-${k}`, label: child.text, content: <span className="mono small">{child.text}</span>, children: [] })),
          }]}
        />
      ) : null}
      {editing ? <EditDialog event={event} stream={state.stream} onClose={() => setEditing(false)} onSaved={onSaved} /> : null}
    </section>
  );
}
