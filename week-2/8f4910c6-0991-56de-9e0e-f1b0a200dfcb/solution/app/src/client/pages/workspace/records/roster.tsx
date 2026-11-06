// The roster (agency director): withdraw, restore and erase, the legacy import dialog and its report, export.

import { useRef, useState, type FormEvent } from "react";
import { api } from "../../../api.js";
import { definePage } from "../../../router.js";
import { AlertDialog, Dialog } from "../../../ui/dialog.js";
import { Button } from "../../../ui/button.js";
import { FieldError } from "../../../ui/fields.js";
import { Problems, useFormErrors } from "../../../ui/problems.js";
import { useAnnouncer } from "../../../ui/status.js";
import { LOADING, RecordsPage, focusSoon } from "./common.js";
import { failureCopy, useResource } from "../../../workspace/data.js";

interface RosterTalent {
  id: string;
  slug: string;
  displayName: string;
  state: "active" | "withdrawn" | "erased";
  office: "toronto" | "vancouver";
  board: string;
}

interface ReportRow {
  row: number;
  outcome: "created" | "merged" | "unchanged" | "orphan";
  talentId: string | null;
  reason: string | null;
  filled: string[];
}

interface Report {
  counts: { created: number; merged: number; unchanged: number; orphan: number };
  rows: ReportRow[];
}

const BOARD_NAMES: Record<string, string> = { women: "Women", men: "Men", creators: "Creators", new_faces: "New Faces" };
const STATE_NAMES: Record<RosterTalent["state"], string> = { active: "Active", withdrawn: "Withdrawn", erased: "Erased" };
const CHANGED_ELSEWHERE = "That talent's record changed elsewhere. Reload to see it.";
const REASONS: Record<string, string> = {
  no_identity: "No email or date of birth",
  unknown_office: "Unknown office",
  unknown_division: "Unknown division",
  bad_height: "Height not readable",
  bad_date: "Date not readable",
};

type Action = "withdraw" | "restore" | "erase";

const SUCCESS: Record<Action, (name: string) => string> = {
  withdraw: (name) => `Withdrew ${name}. They no longer appear on boards, packages or feeds.`,
  restore: (name) => `Restored ${name} to their boards, packages and feed.`,
  erase: (name) => `Erased ${name}'s personal data. Booking amounts are kept under Erased talent.`,
};

function ImportDialog({ onClose, onImported, announce }: {
  onClose: () => void;
  onImported: (report: Report) => void;
  announce: (text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const form = useFormErrors({ file: "roster-file" });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const file = input.current?.files?.[0];
    const data = new FormData();
    if (file) data.append("file", file);
    setPending(true);
    const result = await api<Report>("POST", "/api/roster/imports", data);
    setPending(false);
    if (result.ok) {
      onImported(result.data);
      return;
    }
    if (result.status === 413) {
      form.set({ file: "That file is larger than 2,000,000 bytes." });
      announce("Please fix 1 problem.");
    } else if (!form.take(result.error, announce)) announce(failureCopy(result.error));
  };

  return (
    <Dialog title="Import roster" onClose={onClose} restoreFocus={false}
      actions={<Button type="submit" form="import-form" pending={pending} pendingLabel="Importing roster…">Import</Button>}>
      <Problems items={form.problems} />
      <form id="import-form" noValidate className="stack" onSubmit={(event) => void submit(event)}>
        <p className="muted">Choose the old system's CSV export. Rows are matched by email, then by name and date of birth;
          matched talent only gain the details they were missing.</p>
        <div className="field">
          <label htmlFor="roster-file">Roster CSV</label>
          <input ref={input} id="roster-file" type="file" accept=".csv,text/csv" className="file-input"
            aria-invalid={form.error("file") ? true : undefined}
            aria-describedby={form.error("file") ? "roster-file-error" : undefined}
            onChange={() => form.clear()} />
          <FieldError id="roster-file" error={form.error("file")} />
        </div>
      </form>
    </Dialog>
  );
}

function ImportReport({ report, names }: { report: Report; names: Map<string, string> }) {
  const { counts } = report;
  return (
    <section className="import-report table-scroll" aria-labelledby="import-report-title" tabIndex={0}>
      <h2 id="import-report-title" tabIndex={-1}>Import report</h2>
      <p className="muted num">{counts.created} created, {counts.merged} merged, {counts.unchanged} unchanged,
        {" "}{counts.orphan} orphans</p>
      <table className="data-table pinned" aria-label="Import report">
        <thead>
          <tr><th scope="col">Row</th><th scope="col">Outcome</th><th scope="col">Talent</th><th scope="col">Reason</th>
            <th scope="col">Filled</th></tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.row}>
              <th scope="row" className="num">{row.row}</th>
              <td>{row.outcome[0].toUpperCase() + row.outcome.slice(1)}</td>
              <td>{row.talentId ? names.get(row.talentId) ?? "—" : "—"}</td>
              <td>{row.reason ? REASONS[row.reason] ?? row.reason : "—"}</td>
              <td>{row.filled.length ? row.filled.join(", ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RosterRow({ talent, onAction, busy }: {
  talent: RosterTalent;
  onAction: (talent: RosterTalent, action: Action, opener: HTMLButtonElement | null) => void;
  busy: Action | null;
}) {
  const erase = useRef<HTMLButtonElement>(null);
  return (
    <tr>
      <th scope="row">{talent.displayName}</th>
      <td className="wrap-anywhere">{talent.slug}</td>
      <td>{talent.office === "toronto" ? "Toronto" : "Vancouver"}</td>
      <td>{BOARD_NAMES[talent.board] ?? talent.board}</td>
      <td><span className="state-text" data-state-of={talent.id} tabIndex={-1}>{STATE_NAMES[talent.state]}</span></td>
      <td>
        <div className="btn-row">
          {talent.state === "active" ? (
            <Button variant="quiet" pending={busy === "withdraw"} pendingLabel="Saving…"
              onClick={() => onAction(talent, "withdraw", null)}>Withdraw</Button>
          ) : null}
          {talent.state === "withdrawn" ? (
            <Button variant="quiet" pending={busy === "restore"} pendingLabel="Saving…"
              onClick={() => onAction(talent, "restore", null)}>Restore</Button>
          ) : null}
          {talent.state !== "erased" ? (
            <Button ref={erase} variant="quiet" onClick={() => onAction(talent, "erase", erase.current)}>Erase</Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function Roster() {
  const { data, reload } = useResource<{ talent: RosterTalent[] }>("/api/talent");
  const { message, announce } = useAnnouncer();
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: Action } | null>(null);
  const [erasing, setErasing] = useState<{ talent: RosterTalent; opener: HTMLButtonElement | null } | null>(null);

  const act = async (talent: RosterTalent, action: Action) => {
    setBusy({ id: talent.id, action });
    const result = await api("POST", `/api/talent/${talent.id}/${action}`, {});
    setBusy(null);
    if (result.ok) {
      announce(SUCCESS[action](talent.displayName));
      await reload();
      return;
    }
    announce(result.status === 409 ? CHANGED_ELSEWHERE : failureCopy(result.error));
  };

  const request = (talent: RosterTalent, action: Action, opener: HTMLButtonElement | null) => {
    if (action === "erase") setErasing({ talent, opener });
    else void act(talent, action);
  };

  const imported = async (next: Report) => {
    setImporting(false);
    setReport(next);
    const { created, merged, unchanged, orphan } = next.counts;
    announce(`Import finished: ${created} created, ${merged} merged, ${unchanged} unchanged, ${orphan} orphans.`);
    focusSoon("#import-report-title");
    await reload();
  };

  const names = new Map((data?.talent ?? []).map((talent) => [talent.id, talent.displayName]));

  return (
    <RecordsPage title="Roster" lede="Every talent the agency represents, with their state on the public site."
      statusName="Roster" message={message}
      actions={(
        <>
          <Button onClick={() => setImporting(true)}>Import roster</Button>
          <a href="/api/roster/export.csv" download className="btn-quiet">Export roster</a>
        </>
      )}>
      {report ? <ImportReport report={report} names={names} /> : null}
      {data ? (
        <div className="table-scroll" role="region" aria-label="Roster list" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr><th scope="col">Talent</th><th scope="col">Slug</th><th scope="col">Office</th><th scope="col">Board</th>
                <th scope="col">State</th><th scope="col">Actions</th></tr>
            </thead>
            <tbody>
              {data.talent.map((talent) => (
                <RosterRow key={talent.id} talent={talent} onAction={request}
                  busy={busy?.id === talent.id ? busy.action : null} />
              ))}
            </tbody>
          </table>
        </div>
      ) : LOADING}
      {importing ? (
        <ImportDialog onClose={() => setImporting(false)} onImported={(next) => void imported(next)} announce={announce} />
      ) : null}
      {erasing ? (
        <AlertDialog title={`Erase ${erasing.talent.displayName}?`} onClose={() => setErasing(null)}
          returnFocus={() => erasing.opener}
          actions={(
            <>
              <Button pending={busy?.action === "erase"} pendingLabel="Saving…" onClick={async () => {
                const target = erasing.talent;
                await act(target, "erase");
                setErasing(null);
                focusSoon(`[data-state-of="${target.id}"]`);
              }}>Erase</Button>
              <Button variant="quiet" onClick={() => setErasing(null)}>Keep</Button>
            </>
          )}>
          <p>This removes their name, contact details, measurements, photos and account everywhere, and it cannot be undone.
            Booking amounts stay on the books under Erased talent.</p>
        </AlertDialog>
      ) : null}
    </RecordsPage>
  );
}

definePage({ pattern: "/workspace/roster", kind: "workspace", roles: ["agency_director"], render: () => <Roster /> });
