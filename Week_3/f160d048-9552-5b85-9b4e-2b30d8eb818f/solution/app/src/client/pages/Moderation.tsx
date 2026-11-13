import { useEffect, useRef, useState, type FormEvent } from "react";
import { announce } from "../announce";
import { get, post } from "../api";
import { Choices, ActionButton, Band, TextField } from "../components/ui";
import { useAction, useLoad } from "../hooks";
import { useLive, useLiveReload } from "../live";
import { Link } from "../router";
import { Screen } from "../shell/Page";
import { useSession } from "../session";
import { formatRupees } from "../../shared/money";
import { monthYear, nameOf, OUTCOMES, REJECTION_REASONS, type PostState } from "../../shared/reference";
import { parseDecision, type FieldErrors } from "../../shared/rules";
import type { HistoryEvent, QueuePost } from "../../shared/api";

const LEASE_ENDED = "Your claim on this post expired. Claim it again to decide.";
const TYPE_NAMES = { review: "Review", pay_report: "Pay report", interview_note: "Interview note" } as const;
const RENEW_GAP_MS = 5000;

type RowState = "pending" | "claimed" | "approved" | "rejected";
type Row = { post: QueuePost; state: RowState; byName: string | null; byMe: boolean; history: HistoryEvent[] };

const toRow = (post: QueuePost): Row => ({ post, state: post.state, byName: post.claimed_by_name, byMe: post.claimed_by_me, history: post.history });

function historyText(event: HistoryEvent): string {
  switch (event.type) {
    case "claimed": return `Claimed by ${event.by_name ?? ""}`;
    case "renewed": return `Claim renewed by ${event.by_name ?? ""}`;
    case "expired": return "Claim expired";
    case "approved": return `Approved by ${event.by_name ?? ""}`;
    case "rejected": return `Rejected by ${event.by_name ?? ""}: ${event.reason ?? ""}`;
  }
}

function statusText(row: Row): string {
  const who = row.byMe ? "you" : (row.byName ?? "");
  if (row.state === "pending") return "Pending";
  if (row.state === "claimed") return `Claimed by ${who}`;
  return `${row.state === "approved" ? "Approved" : "Rejected"} by ${who}`;
}

function Content({ post }: { post: QueuePost }) {
  if (post.kind === "review") {
    return (
      <>
        <p className="figure">Overall {post.overall} · Work-life balance {post.work_life} · Pay {post.pay} · Management {post.management}</p>
        <p><strong>Pros</strong> {post.pros}</p>
        <p><strong>Cons</strong> {post.cons}</p>
      </>
    );
  }
  if (post.kind === "pay_report") {
    return <p className="figure">{post.role_name} · {formatRupees(post.annual_pay ?? 0)} a year · {post.years_experience} years of experience</p>;
  }
  return (
    <>
      <p className="figure">{post.role_name} · Difficulty {post.difficulty} of 5 · {nameOf(OUTCOMES, post.outcome ?? "")}</p>
      <p>{post.text}</p>
    </>
  );
}

type DecisionProps = { row: Row; onDecided: (row: Row, state: PostState) => void; onProblem: (message: string) => void };

function DecisionForm({ row, onDecided, onProblem }: DecisionProps) {
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const lastRenew = useRef(Number.NEGATIVE_INFINITY);
  const approve = useRef<HTMLInputElement>(null);
  const firstReason = useRef<HTMLInputElement>(null);
  const detailsField = useRef<HTMLInputElement>(null);
  const focus = useRef<"approve" | "reason" | "details" | undefined>(undefined);
  const { busy, run } = useAction();
  const id = row.post.id;

  useEffect(() => {
    approve.current?.focus();
  }, []);
  useEffect(() => {
    const target = focus.current;
    focus.current = undefined;
    if (target === "approve") approve.current?.focus();
    if (target === "reason") firstReason.current?.focus();
    if (target === "details") detailsField.current?.focus();
  });

  function renew() {
    const now = Date.now();
    if (now - lastRenew.current < RENEW_GAP_MS) return;
    lastRenew.current = now;
    void post(`/api/moderation/${id}/renew`).then((result) => {
      if (!result.ok) onProblem(result.message);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = parseDecision({ decision, reason, details });
    if (!checked.ok) {
      setErrors(checked.fields);
      focus.current = checked.fields["decision"] ? "approve" : checked.fields["reason"] ? "reason" : "details";
      return;
    }
    setErrors({});
    const result = await run(() => post<{ state: "approved" | "rejected" }>(`/api/moderation/${id}/decision`, { decision, reason, details }));
    if (result.ok) onDecided(row, result.data.state);
    else onProblem(result.message);
  }

  return (
    <form className="form-grid" onSubmit={(event) => void submit(event)} noValidate>
      <Choices
        legend="Decision"
        name={`decision-${id}`}
        value={decision}
        options={[{ id: "approve", name: "Approve" }, { id: "reject", name: "Reject" }]}
        firstRef={approve}
        error={errors["decision"]}
        onChange={(value) => { setDecision(value); renew(); }}
      />
      {decision === "reject" ? (
        <Choices
          legend="Reason"
          name={`reason-${id}`}
          value={reason}
          options={REJECTION_REASONS.map((entry) => ({ id: entry, name: entry }))}
          firstRef={firstReason}
          error={errors["reason"]}
          onChange={(value) => { setReason(value); renew(); }}
        />
      ) : null}
      {decision === "reject" && reason === "Other" ? (
        <TextField label="Reason details" value={details} inputRef={detailsField} error={errors["details"]} onChange={(event) => { setDetails(event.target.value); renew(); }} />
      ) : null}
      <div>
        <ActionButton type="submit" busy={busy}>Submit decision</ActionButton>
      </div>
    </form>
  );
}

export function Moderation() {
  const { me } = useSession();
  const queue = useLoad(() => get<{ posts: QueuePost[] }>("/api/moderation/queue"), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [problem, setProblem] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [after, setAfter] = useState<string | undefined>();
  const claim = useAction();
  const [pressed, setPressed] = useState<string | undefined>();
  const known = useRef<Row[]>([]);
  known.current = rows;

  useEffect(() => {
    if (queue.data) {
      setRows(queue.data.posts.map(toRow));
      setLoaded(true);
    }
  }, [queue.data]);

  useLive("queue.changed", (event) => {
    const row = known.current.find((entry) => entry.post.id === event.post_id);
    if (event.state === "deleted") {
      setRows((current) => current.filter((entry) => entry.post.id !== event.post_id));
      return;
    }
    if (!row) {
      queue.reload();
      return;
    }
    const state = event.state;
    if (row.byMe && row.state === "claimed" && state === "pending") setProblem(LEASE_ENDED);
    setRows((current) =>
      current.map((entry) => (entry.post.id === event.post_id ? { ...entry, state, byName: event.by_name, byMe: event.by_me } : entry)),
    );
  });
  useLive("queue.history", (event) =>
    setRows((current) =>
      current.map((entry) => (entry.post.id === event.post_id ? { ...entry, history: [...entry.history, event.event] } : entry)),
    ),
  );
  useLiveReload(queue.reload);

  async function claimPost(row: Row) {
    if (row.state !== "pending") return;
    setProblem("");
    setPressed(row.post.id);
    const result = await claim.run(() => post<{ claimed_by_name: string }>(`/api/moderation/${row.post.id}/claim`));
    if (result.ok) {
      setRows((current) =>
        current.map((entry) => (entry.post.id === row.post.id ? { ...entry, state: "claimed", byName: me?.display_name ?? null, byMe: true } : entry)),
      );
      announce(`Claimed ${row.post.label}.`);
    } else {
      setProblem(result.message);
    }
  }

  function decided(row: Row, state: PostState) {
    setProblem("");
    setRows((current) =>
      current.map((entry) => (entry.post.id === row.post.id ? { ...entry, state: state === "approved" ? "approved" : "rejected", byName: me?.display_name ?? null, byMe: true } : entry)),
    );
    announce(`${state === "approved" ? "Approved" : "Rejected"} ${row.post.label}.`);
    setAfter(row.post.id);
  }

  useEffect(() => {
    if (!after) return;
    setAfter(undefined);
    const index = rows.findIndex((entry) => entry.post.id === after);
    const next = rows.slice(index + 1).find((entry) => entry.state === "pending");
    if (next) document.getElementById(`claim-${next.post.id}`)?.focus();
    else document.getElementById("back-to-search")?.focus();
  }, [after, rows]);

  const actionable = rows.some((entry) => entry.state === "pending" || (entry.state === "claimed" && entry.byMe));
  return (
    <Screen title="Moderation queue" band={problem ? <Band>{problem}</Band> : null}>
      <h1 className="page-title">Moderation queue</h1>
      <table className="table queue" aria-label="Moderation queue">
        <thead>
          <tr>
            <th scope="col" className="col-type">Type</th>
            <th scope="col" className="col-company">Company</th>
            <th scope="col">Summary</th>
            <th scope="col" className="col-posted">Posted</th>
            <th scope="col" className="col-status">Status</th>
          </tr>
        </thead>
        {rows.map((row) => {
          const mine = row.state === "claimed" && row.byMe;
          return (
            <tbody key={row.post.id} data-id={row.post.id}>
              <tr className={mine ? "claimed" : undefined}>
                <td>{TYPE_NAMES[row.post.kind]}</td>
                <td className="col-company">{row.post.company_name}</td>
                <td>
                  <span className="item-title">{row.post.label}</span>
                  <ul className="history" aria-label={`History of ${row.post.label}`}>
                    {row.history.map((event, index) => (
                      <li key={`${event.type}-${index}`}>{historyText(event)}</li>
                    ))}
                  </ul>
                </td>
                <td className="col-posted">{monthYear(row.post.posted_month)}</td>
                <td>
                  <span>{statusText(row)}</span>
                  {row.state === "pending" || (row.state === "claimed" && !row.byMe) ? (
                    <div>
                      <button
                        type="button"
                        id={`claim-${row.post.id}`}
                        className="btn-quiet"
                        aria-label={`Claim ${row.post.label}`}
                        aria-disabled={row.state !== "pending"}
                        disabled={claim.busy && pressed === row.post.id}
                        onClick={() => void claimPost(row)}
                      >
                        Claim
                      </button>
                      {claim.busy && pressed === row.post.id ? <span className="working">Working</span> : null}
                    </div>
                  ) : null}
                </td>
              </tr>
              {mine ? (
                <tr className="claimed">
                  <td colSpan={5}>
                    <div className="detail-body">
                      <Content post={row.post} />
                    </div>
                    <DecisionForm row={row} onDecided={decided} onProblem={setProblem} />
                  </td>
                </tr>
              ) : null}
            </tbody>
          );
        })}
      </table>
      {loaded && !actionable ? (
        <div className="empty">
          <p>Nothing is waiting for review.</p>
          <Link to="/jobs" id="back-to-search" className="btn">Back to job search</Link>
        </div>
      ) : null}
    </Screen>
  );
}
