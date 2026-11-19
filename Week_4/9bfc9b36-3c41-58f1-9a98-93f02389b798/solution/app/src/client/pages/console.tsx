/** The console: pending and decided submissions, the audit trail, the season's tape standing, the role table and the CSV. */
import { useEffect, useState } from "react";
import { getJson, sendJson } from "../api.js";
import { useLive } from "../live.js";
import { useRouter } from "../router.js";
import { answered, Chip, DataTable, Dialog, DialogForm, EmptyState, SelectField, TextField, useDialog, useLoad, useSubmitter } from "../ui.js";
import { PageHeading } from "./chrome.js";
import { instantText } from "../format.js";
import { BULK_REFUSALS, EMPTY, PENDING, ROLE_TABLE, SUCCESS } from "../../shared/copy.js";
import { lengthText } from "../../shared/units.js";
import type { AuditRow, BulkResult, Page, StandingRow, Submission } from "../../shared/types.js";

const TABS = [
  ["submissions", "Submissions"],
  ["audit", "Audit"],
  ["standing", "Standing"],
  ["roles", "Roles"],
  ["export", "Export"],
] as const;

type TabKey = (typeof TABS)[number][0];

const figureText = (item: Submission): string => `${item.as_submitted} · ${lengthText(item.value_mm)}`;

function RejectDialog({ ids, onDone }: { ids: string[]; onDone: (reason: string) => Promise<void> }) {
  const { close } = useDialog();
  const form = useSubmitter();
  const [reason, setReason] = useState("");
  return (
    <DialogForm
      onSubmit={() =>
        void form.run(async () => {
          await onDone(reason);
          close(true);
        }, PENDING.save)
      }
      submit="Reject"
      busy={form.busy}
    >
      <TextField label="Reason" value={reason} onChange={setReason} error={form.errors.reason} />
      <p className="muted">{`${ids.length} selected`}</p>
    </DialogForm>
  );
}

function ReverseDialog({ id, onDone }: { id: string; onDone: () => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const [reason, setReason] = useState("");
  return (
    <DialogForm
      onSubmit={() =>
        void form.run(async () => {
          await sendJson<Submission>("POST", `/api/submissions/${id}/reverse`, { reason });
          say(SUCCESS.reverse(id));
          close(true);
          await onDone();
        }, PENDING.save)
      }
      submit="Reverse"
      busy={form.busy}
    >
      <TextField label="Reason" value={reason} onChange={setReason} error={form.errors.reason} />
    </DialogForm>
  );
}

function SubmissionsTab() {
  const { say } = useLive();
  const form = useSubmitter();
  const pending = useLoad((signal) => getJson<Page<Submission>>("/api/submissions?status=pending&limit=50", signal), []);
  const decided = useLoad(async (signal) => {
    const lists = await Promise.all(["accepted", "rejected", "reversed"].map((status) => getJson<Page<Submission>>(`/api/submissions?status=${status}&limit=50`, signal)));
    return lists
      .flatMap((page) => page.items)
      .sort((a, b) => (b.decided_at ?? "").localeCompare(a.decided_at ?? "") || b.id.localeCompare(a.id))
      .slice(0, 50);
  }, []);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState(0);
  const [dialog, setDialog] = useState<{ kind: "reject" } | { kind: "reverse"; id: string } | null>(null);

  const rows = (pending.data?.items ?? []).filter((item) => !removed.has(item.id));
  const total = Math.max(0, (pending.data?.total ?? 0) - applied);

  const decide = async (decision: "accept" | "reject", reason: string) => {
    const ids = [...checked];
    const { data } = await sendJson<{ results: BulkResult[] }>("POST", "/api/admin/submissions/decisions", { decisions: ids.map((id) => ({ id, decision, reason })) });
    const done = data.results.filter((result) => result.outcome === "applied");
    const refused = data.results.filter((result) => result.outcome === "refused");
    setRemoved((set) => new Set([...set, ...done.map((result) => result.id)]));
    setApplied((count) => count + done.length);
    setResults(Object.fromEntries(refused.map((result) => [result.id, result.reason ? BULK_REFUSALS[result.reason] : ""])));
    setChecked(new Set());
    say(SUCCESS.bulk(done.length, refused.length));
    void decided.reload();
  };

  const accept = () => void form.run(() => decide("accept", ""), PENDING.save);
  const toggle = (id: string) =>
    setChecked((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!answered(pending, decided)) return null;
  return (
    <>
      <section className="field-surface">
        <div className="section-head">
          <h2>Pending submissions</h2>
          <p className="count">{`${total} pending`}</p>
        </div>
        {pending.data && rows.length === 0 ? (
          <EmptyState>{EMPTY.console}</EmptyState>
        ) : (
          <DataTable
            label="Pending submissions"
            headers={["Select", "Submission", "Owner", "Boat", "Dimension", "Figure", "Measured on", "Submitted", "Note", "Result"]}
            rows={rows.map((item) => ({
              key: item.id,
              cells: [
                <input key="c" type="checkbox" aria-label={`Select ${item.id}`} checked={checked.has(item.id)} onChange={() => toggle(item.id)} />,
                item.id,
                item.submitted_by.display_name,
                item.boat_code,
                item.dimension,
                figureText(item),
                item.measured_on,
                instantText(item.submitted_at),
                item.note,
                results[item.id] ?? "",
              ],
            }))}
          />
        )}
        <div className="actions">
          <button type="button" className="button" disabled={checked.size === 0} onClick={accept}>
            Accept selected
          </button>
          <button type="button" className="button" disabled={checked.size === 0} onClick={() => setDialog({ kind: "reject" })}>
            Reject selected
          </button>
        </div>
      </section>
      <section className="field-ground">
        <h2>Decided submissions</h2>
        <DataTable
          label="Decided submissions"
          headers={["Submission", "Owner", "Boat", "Dimension", "Figure", "Status", "Decided", "Reason", "Action"]}
          rows={(decided.data ?? []).map((item) => ({
            key: item.id,
            cells: [
              item.id,
              item.submitted_by.display_name,
              item.boat_code,
              item.dimension,
              figureText(item),
              <Chip key="s" tone={item.status === "accepted" ? "cobalt" : item.status === "rejected" ? "ink" : "ink"}>{item.status === "accepted" ? "Accepted" : item.status === "rejected" ? "Rejected" : "Reversed"}</Chip>,
              instantText(item.decided_at),
              item.reason ?? "",
              item.status === "accepted" ? (
                <button key="r" type="button" className="button" onClick={() => setDialog({ kind: "reverse", id: item.id })}>
                  {`Reverse ${item.id}`}
                </button>
              ) : (
                ""
              ),
            ],
          }))}
        />
      </section>
      {dialog?.kind === "reject" ? (
        <Dialog title="Reject submissions" onClose={() => setDialog(null)}>
          <RejectDialog ids={[...checked]} onDone={(reason) => decide("reject", reason)} />
        </Dialog>
      ) : null}
      {dialog?.kind === "reverse" ? (
        <Dialog title="Reverse submission" onClose={() => setDialog(null)}>
          <ReverseDialog id={dialog.id} onDone={async () => void (await decided.reload())} />
        </Dialog>
      ) : null}
    </>
  );
}

function AuditTab() {
  const first = useLoad((signal) => getJson<Page<AuditRow>>("/api/admin/audit?limit=50", signal), []);
  const [more, setMore] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const next = cursor === undefined ? (first.data?.next_cursor ?? null) : cursor;
  const rows = [...(first.data?.items ?? []), ...more];
  const older = async () => {
    if (!next) return;
    const page = await getJson<Page<AuditRow>>(`/api/admin/audit?limit=50&cursor=${encodeURIComponent(next)}`);
    setMore((list) => [...list, ...page.items]);
    setCursor(page.next_cursor);
  };
  return (
    <section className="field-surface">
      <h2>Audit trail</h2>
      <DataTable
        label="Audit trail"
        headers={["When", "Actor", "Action", "Target", "Before", "After", "Reason"]}
        rows={rows.map((row) => ({ key: row.id, cells: [instantText(row.at), row.actor_email, row.action, row.target, row.before ?? "", row.after ?? "", row.reason ?? ""] }))}
      />
      <div className="actions">
        <button type="button" className="button" disabled={!next} onClick={() => void older()}>
          Older entries
        </button>
      </div>
    </section>
  );
}

interface StandingAnswer {
  season: number;
  seasons: number[];
  items: StandingRow[];
}

/** The standing asked for at the press of its tab, so it is already on its way when the tab shows; used once, never kept. */
let pressed: { season: string; at: number; answer: Promise<StandingAnswer> } | null = null;

function pressStanding(season: string): void {
  const answer = getJson<StandingAnswer>(`/api/admin/standing?season=${season}`);
  answer.catch(() => undefined);
  pressed = { season, at: performance.now(), answer };
}

function fetchStanding(season: string, signal: AbortSignal): Promise<StandingAnswer> {
  const early = pressed && pressed.season === season && performance.now() - pressed.at < 2000 ? pressed.answer : null;
  pressed = null;
  return early ?? getJson<StandingAnswer>(`/api/admin/standing?season=${season}`, signal);
}

function StandingTab({ season, onSeason }: { season: string; onSeason: (season: string) => void }) {
  const { say } = useLive();
  const standing = useLoad((signal) => fetchStanding(season, signal), [season]);
  useEffect(() => {
    if (standing.data) say(SUCCESS.standing(standing.data.items.length, season));
  }, [standing.data, season, say]);
  const years = standing.data?.seasons.length ? standing.data.seasons : [Number(season)];
  return (
    <section className="field-surface">
      <div className="section-head">
        <h2>Tape standing</h2>
        <SelectField label="Season" value={season} onChange={onSeason} options={[...new Set([...years, Number(season)])].sort((a, b) => b - a).map((year) => ({ value: String(year), label: String(year) }))} />
      </div>
      {standing.data ? (
        <DataTable
          label="Tape standing"
          headers={["Rank", "Owner", "Counted", "Accepted", "Rejected", "Reversed", "Streak", "Standing"]}
          rows={standing.data.items.map((row) => ({
            key: row.owner_email,
            cells: [row.rank, row.owner_name, row.counted, row.accepted, row.rejected, row.reversed, row.streak, <Chip key="c" tone={row.standing === "True tape" ? "cobalt" : row.standing === "Steady tape" ? "ink" : "plain"}>{row.standing}</Chip>],
          }))}
        />
      ) : null}
    </section>
  );
}

function RolesTab() {
  const roles = useLoad((signal) => getJson<{ items: typeof ROLE_TABLE }>("/api/admin/roles", signal), []);
  return (
    <section className="field-surface">
      <h2>Role abilities</h2>
      <DataTable
        label="Role abilities"
        headers={["Ability", "Sailmaker", "Loft hand", "Yacht owner"]}
        rows={(roles.data?.items ?? []).map((row) => ({ key: row.ability, cells: [row.ability, row.sailmaker, row["loft-hand"], row["yacht-owner"]] }))}
      />
    </section>
  );
}

function ExportTab() {
  return (
    <section className="field-surface">
      <h2>Export</h2>
      <p>Every ledger line, newest first.</p>
      <a className="button" href="/api/exports/ledger.csv" download="ledger.csv">
        Download ledger CSV
      </a>
    </section>
  );
}

export function ConsolePage() {
  const { location, navigate } = useRouter();
  const params = new URLSearchParams(location.search);
  const requested = params.get("tab");
  const tab: TabKey = TABS.some(([key]) => key === requested) ? (requested as TabKey) : "submissions";
  const season = params.get("season") ?? String(new Date().getUTCFullYear());
  const choose = (key: TabKey) => navigate(key === "standing" ? `/console?tab=standing&season=${season}` : `/console?tab=${key}`);
  return (
    <main className="page">
      <section className="field-ground">
        <PageHeading>Console</PageHeading>
        <div role="tablist" aria-label="Console" className="tabs">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className="tab" onPointerDown={key === "standing" && tab !== key ? () => pressStanding(season) : undefined} onClick={() => choose(key)}>
              {label}
            </button>
          ))}
        </div>
      </section>
      {tab === "submissions" ? <SubmissionsTab /> : null}
      {tab === "audit" ? <AuditTab /> : null}
      {tab === "standing" ? <StandingTab season={season} onSeason={(value) => navigate(`/console?tab=standing&season=${value}`)} /> : null}
      {tab === "roles" ? <RolesTab /> : null}
      {tab === "export" ? <ExportTab /> : null}
    </main>
  );
}
