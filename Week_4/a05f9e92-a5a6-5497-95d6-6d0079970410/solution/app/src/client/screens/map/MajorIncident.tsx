import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { MajorView, TimelineEntry } from "../../../server/major.js";
import type { RecordJson, SummaryJson } from "../../../server/records.js";
import { useAnnounce } from "../../lib/announce.js";
import { failureText, get, post } from "../../lib/api.js";
import { useTopics } from "../../lib/live.js";
import { Link } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { Button, loadingScreen, reducedMotion, StatusBlock, useLoad } from "../../lib/ui.js";
import { PinnedRelay, StaticRelay } from "./RelayView.js";
import { relayPanels } from "./relayPanels.js";
import { ResolveDialog } from "./Resolve.js";
import { formatLocalIso } from "../../../shared/tz.js";

type Major = { record: RecordJson; impact: MajorView["impact"]; children: SummaryJson[]; timeline: TimelineEntry[] };

const FINISHED = ["resolved", "closed", "cancelled"];
const KIND_LABELS: Record<string, string> = { work_note: "Work note", state: "State", child: "Child", resolution: "Resolution" };

function Children({ incidents }: { incidents: SummaryJson[] }): JSX.Element {
  return (
    <ul className="child-list" aria-label="Child incidents">
      {incidents.map((child) => (
        <li key={child.number} className="child-item">
          <div className="child-main">
            <Link to={`/desk/records/${child.number}`} className="child-number">
              {child.number}
            </Link>
            <span className="child-text">{child.short_description}</span>
          </div>
          <StatusBlock outlined={child.state === "resolved" || child.state === "closed"}>{child.state_label}</StatusBlock>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ entries, zone }: { entries: TimelineEntry[]; zone: string }): JSX.Element {
  return (
    <div role="feed" aria-label="Timeline" className="timeline">
      {entries.map((entry, index) => (
        <article key={`${entry.at}-${index}`} className="timeline-entry">
          <p className="timeline-head">
            <span className="timeline-kind">{KIND_LABELS[entry.kind] ?? entry.kind}</span>
            <span>
              {entry.actor ? `${entry.actor}, ` : ""}
              {formatLocalIso(entry.at, zone)}
            </span>
          </p>
          <p>{entry.text}</p>
        </article>
      ))}
    </div>
  );
}

function WorkNote({ number, onDone }: { number: string; onDone: () => void }): JSX.Element {
  const announce = useAnnounce();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    post(`/api/records/${encodeURIComponent(number)}/work-notes`, { text }).then(
      () => {
        setText("");
        setBusy(false);
        announce("Note added.");
        onDone();
      },
      (failure: unknown) => {
        setError(failureText(failure));
        setBusy(false);
      },
    );
  };
  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        <span className="field-label">Work note</span>
        <textarea value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="row">
        <Button type="submit" busy={busy}>
          Add work note
        </Button>
      </div>
    </form>
  );
}

function MajorBody({ number, data, reload }: { number: string; data: Major; reload: () => void }): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const [resolving, setResolving] = useState(false);
  const [still] = useState(reducedMotion);
  const announced = useRef(false);
  const failed = data.impact.ci;
  const panels = useMemo(() => relayPanels(data.impact.affected), [data.impact.affected]);

  useEffect(() => {
    if (!still || announced.current) return;
    announced.current = true;
    announce(`${data.impact.people_total} people affected by ${failed}.`);
  }, [announce, data.impact.people_total, failed, still]);

  const zone = session.user?.time_zone ?? "UTC";
  const open = !FINISHED.includes(data.record.state);
  const meta = (
    <>
      <span className="relay-number">{number}</span>
      <StatusBlock>{data.record.state_label}</StatusBlock>
    </>
  );

  return (
    <main className="page major-page">
      {still || panels.length === 0 ? (
        <StaticRelay failed={failed} meta={meta} panels={panels} total={data.impact.people_total} />
      ) : (
        <PinnedRelay failed={failed} meta={meta} panels={panels} base={data.impact.base_people} />
      )}
      <section className="rest major-rest" aria-label="Incidents and timeline">
        <div className="major-children">
          <div className="row major-head">
            <h2>Child incidents</h2>
            {session.isDesk && open ? <Button onClick={() => setResolving(true)}>Resolve together</Button> : null}
          </div>
          {data.children.length === 0 ? <p>No incidents are linked to this outage.</p> : null}
          <Children incidents={data.children} />
        </div>
        <div className="major-timeline">
          <h2>Timeline</h2>
          {session.isOperator ? <WorkNote number={number} onDone={reload} /> : null}
          <Timeline entries={data.timeline} zone={zone} />
        </div>
      </section>
      {resolving ? (
        <ResolveDialog
          number={number}
          onClose={() => setResolving(false)}
          onDone={() => {
            setResolving(false);
            reload();
          }}
        />
      ) : null}
    </main>
  );
}

export function MajorIncident({ number }: { number: string }): JSX.Element {
  const session = useSession();
  const { state, reload } = useLoad(() => get<Major>(`/api/major/${encodeURIComponent(number)}`), [number, session.accessVersion]);
  useTopics([`major:${number}`], reload);
  if (state.status !== "ready") return loadingScreen(state, number, reload) as JSX.Element;
  return <MajorBody number={number} data={state.data} reload={reload} />;
}
