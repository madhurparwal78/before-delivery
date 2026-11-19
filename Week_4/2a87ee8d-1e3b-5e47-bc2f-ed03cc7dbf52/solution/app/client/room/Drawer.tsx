// The Session drawer: the timer, the facilitator's controls, the room list, vote totals, the join link and
// invites, the recap status and the Trash and Versions dialogs.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, History, Link2, Link2Off, Trash2 } from "lucide-react";
import { api, ApiFailure, opId } from "../api.js";
import { euro, instantDate, instantDateTime, instantTime, mmss, noteCount } from "../format.js";
import { Dialog, Ticker } from "../ui.js";
import { planLimitOf } from "../pages/Workshops.js";
import { nextStatuses, STATUS_LABELS, type Status } from "../../shared/states.js";
import { RECAP_REASON_COPY, VERSION_REASON_LABELS } from "../../shared/copy.js";
import { isFacilitatorWorkshop, type FacilitatorWorkshop, type TrashItem, type Version } from "../types.js";
import { ranked } from "./model.js";
import type { RoomActions } from "./Room.js";

const TRANSITION_LABELS: Partial<Record<Status, string>> = {
  open: "Open room",
  silent_round: "Start silent round",
  revealed: "Reveal",
  voting: "Start voting",
  closed: "Close workshop",
  archived: "Archive",
};

function Timer({ endsAt, offset }: { endsAt: string; offset: () => number }) {
  const left = () => (Date.parse(endsAt) - (Date.now() + offset())) / 1000;
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    const tick = window.setInterval(() => setSeconds(left()), 1000);
    return () => clearInterval(tick);
  }, [endsAt]);
  const over = seconds <= 0;
  return (
    <div role="timer" aria-label="Session timer" className={!over && seconds <= 60 ? "timer mono last-minute" : "timer mono"}>
      {over ? "Time's up" : mmss(seconds)}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="drawer-section">
      <h2 className="drawer-heading">{title}</h2>
      {children}
    </section>
  );
}

function Spin({ label, value, min, max, onChange }: { label: string; value: string; min: number; max: number; onChange: (v: string) => void }) {
  const id = `spin-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="field field-inline">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function TrashDialog({ actions, zone, onClose }: { actions: RoomActions; zone: string; onClose: () => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const load = () =>
    api<{ items: TrashItem[] }>("GET", `/api/workshops/${actions.board.workshop.id}/trash`).then(
      (r) => setItems(r.items),
      (e: unknown) => actions.complain(actions.failed(e)),
    );
  useEffect(() => {
    void load();
  }, []);
  const restore = async (item: TrashItem) => {
    try {
      const r = await api<{ restored: { notes: number } }>("POST", `/api/trash/${item.id}/restore`, { clientOpId: opId() });
      actions.say(`Frame ${item.title} restored with ${noteCount(r.restored.notes)}`);
      await actions.refresh();
      void load();
    } catch (e) {
      actions.complain(actions.failed(e));
      void load();
    }
  };
  return (
    <Dialog title="Trash" onClose={onClose}>
      {items === null ? (
        <p className="muted">Loading the trash…</p>
      ) : items.length === 0 ? (
        <p className="empty">The trash is empty.</p>
      ) : (
        <ul className="ruled-list">
          {items.map((item) => (
            <li key={item.id} className="ruled-row dialog-row">
              <span>
                <strong>{item.title}</strong>
                <span className="muted">
                  {" "}
                  Deleted {instantDate(item.deletedAt, zone)}, purged {instantDate(item.purgeAt, zone)}
                </span>
              </span>
              <button type="button" className="btn btn-quiet" onClick={() => void restore(item)}>
                Restore {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

function VersionsDialog({ actions, zone, onClose }: { actions: RoomActions; zone: string; onClose: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [confirm, setConfirm] = useState<Version | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    api<{ versions: Version[] }>("GET", `/api/workshops/${actions.board.workshop.id}/versions`).then(
      (r) => setVersions(r.versions),
      (e: unknown) => actions.complain(actions.failed(e)),
    );
  useEffect(() => {
    void load();
  }, []);
  const restore = async (v: Version) => {
    setBusy(true);
    try {
      const r = await api<{ restoredFrom: number; saved: { version: number } }>("POST", `/api/workshops/${actions.board.workshop.id}/versions/${v.id}/restore`, { clientOpId: opId() });
      actions.say(`Board restored to version ${r.restoredFrom}. The previous board is saved as version ${r.saved.version}.`);
      setConfirm(null);
      await actions.refresh();
      void load();
    } catch (e) {
      actions.complain(actions.failed(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Versions" onClose={onClose} wide>
      {confirm && (
        <div className="confirm">
          <p>Restore version {confirm.version}? The current board is saved as a version first.</p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-primary" data-autofocus onClick={() => void restore(confirm)}>
              {busy ? "Restoring…" : "Restore"}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {versions === null ? (
        <p className="muted">Loading versions…</p>
      ) : versions.length === 0 ? (
        <p className="empty">No versions yet. The board saves one every 50 changes, at close and before every restore.</p>
      ) : (
        <ul className="ruled-list">
          {versions.map((v) => (
            <li key={v.id} className="ruled-row dialog-row">
              <span>
                Version {v.version} — {VERSION_REASON_LABELS[v.reason]} — {instantDateTime(v.createdAt, zone)}
              </span>
              <button type="button" className="btn btn-quiet" onClick={() => setConfirm(v)}>
                Restore version {v.version}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

function CloseDialog({ onConfirm, onClose, busy }: { onConfirm: () => void; onClose: () => void; busy: boolean }) {
  return (
    <Dialog title="Close workshop" onClose={onClose}>
      <p>Closing freezes the board, raises the sponsor invoice and sends the recap to the sponsor and every invited client.</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {busy ? "Working…" : "Close and send recap"}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function FacilitatorPanel({ actions, w }: { actions: RoomActions; w: FacilitatorWorkshop }) {
  const [round, setRound] = useState("5");
  const [voteLength, setVoteLength] = useState("2");
  const [dots, setDots] = useState("3");
  const [busy, setBusy] = useState<Status | null>(null);
  const [dialog, setDialog] = useState<"trash" | "versions" | "close" | null>(null);
  const [emails, setEmails] = useState("");
  const [emailError, setEmailError] = useState("");
  const [sending, setSending] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const { board } = actions;
  const zone = w.timeZone;

  const move = async (to: Status, opener: HTMLElement | null) => {
    if (busy) return;
    setBusy(to);
    const body: Record<string, unknown> = { clientOpId: opId(), to };
    if (to === "silent_round") body.durationSeconds = Math.round(Number(round) * 60);
    if (to === "voting") {
      body.durationSeconds = Math.round(Number(voteLength) * 60);
      body.dotBudget = Math.round(Number(dots));
    }
    try {
      const r = await api<{ workshop: FacilitatorWorkshop }>("POST", `/api/workshops/${w.id}/transitions`, body);
      setDialog(null);
      const said: Partial<Record<Status, string>> = {
        open: "Room open",
        silent_round: r.workshop.round ? `Silent round started — ends at ${instantTime(r.workshop.round.endsAt, zone)}` : "",
        voting: `Voting started — ${r.workshop.voting?.dotBudget ?? ""} dots each`,
        closed: "Workshop closed. Preparing the recap.",
        archived: "Workshop archived",
      };
      if (said[to]) actions.say(said[to] ?? "");
      await actions.refresh();
    } catch (e) {
      const limit = planLimitOf(e);
      if (limit) actions.planLimit(limit, opener);
      else if (e instanceof ApiFailure && e.code === "illegal_transition") {
        await actions.refresh();
        const now = await api<{ workshop: FacilitatorWorkshop }>("GET", `/api/workshops/${w.id}`).catch(() => null);
        actions.complain(`The session has already moved on — it's now ${STATUS_LABELS[now?.workshop.status ?? w.status]}.`);
      } else actions.complain(e instanceof ApiFailure && e.code === "validation" ? (Object.values(e.fields)[0] ?? e.message) : actions.failed(e));
    } finally {
      setBusy(null);
    }
  };

  const linkAction = async (kind: "rotate" | "off") => {
    try {
      if (kind === "rotate") await api("POST", `/api/workshops/${w.id}/join-link/rotate`);
      else await api("DELETE", `/api/workshops/${w.id}/join-link`);
      actions.say(kind === "rotate" ? "New join link created. The old link no longer works." : "Join link turned off. Everyone who joined with it has been disconnected.");
      await actions.refresh();
    } catch (e) {
      actions.complain(actions.failed(e));
    }
  };

  const copy = async () => {
    if (!w.joinUrl) return;
    try {
      await navigator.clipboard.writeText(w.joinUrl);
      actions.say("Join link copied");
    } catch {
      actions.complain("Couldn't copy the link — select it and copy it by hand.");
    }
  };

  const send = async () => {
    if (sending) return;
    setSending(true);
    setEmailError("");
    const list = emails
      .split(/[\n,]/)
      .map((e) => e.trim())
      .filter(Boolean);
    try {
      const r = await api<{ invites: { email: string; status: "sent" | "queued" }[] }>("POST", `/api/workshops/${w.id}/invites`, { emails: list });
      const queued = r.invites.filter((i) => i.status === "queued").length;
      actions.say(queued ? `${r.invites.length - queued} sent, ${queued} queued — email is unavailable. Queued invites go out automatically.` : `Invites sent to ${r.invites.length} people`);
      setEmails("");
      await actions.refresh();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === "quota_exceeded") setEmailError(`Today's invite limit is reached. You can send more after midnight (${zone}).`);
      else if (e instanceof ApiFailure && e.fields.emails) setEmailError(e.fields.emails);
      else actions.complain(actions.failed(e));
    } finally {
      setSending(false);
    }
  };

  const legal = nextStatuses(w.status);
  const totals = ranked(board);
  const recap = w.recap;
  const recapText = recap
    ? recap.status === "complete"
      ? `Recap sent to ${recap.recipients} people`
      : recap.reason
        ? RECAP_REASON_COPY[recap.reason]
        : "Recap in progress"
    : null;

  return (
    <>
      <Section title="Session">
        {legal.includes("silent_round") && <Spin label="Round length in minutes" value={round} min={1} max={60} onChange={setRound} />}
        {legal.includes("voting") && (
          <>
            <Spin label="Voting length in minutes" value={voteLength} min={1} max={60} onChange={setVoteLength} />
            <Spin label="Dots per person" value={dots} min={1} max={20} onChange={setDots} />
          </>
        )}
        <div className="control-row">
          {legal.map((to) => (
            <button
              key={to}
              ref={to === "closed" ? closeButton : undefined}
              type="button"
              className={to === "revealed" ? "btn btn-primary" : "btn"}
              onClick={(e) => (to === "closed" ? setDialog("close") : void move(to, e.currentTarget))}
            >
              {busy === to && to !== "closed" ? "Working…" : TRANSITION_LABELS[to]}
            </button>
          ))}
        </div>
        <p className="muted small">
          {w.participantCount} of {w.participantCap ?? "unlimited"} places taken · rounds used {w.roundsUsed}
        </p>
      </Section>
      {w.status === "silent_round" && board.participants && (
        <Section title="Room">
          <ul aria-label="Room" className="ruled-list compact">
            {board.participants
              .filter((p) => p.active)
              .map((p) => (
                <li key={p.id} className="ruled-row">
                  {p.displayName} — {p.notesThisRound} notes this round
                </li>
              ))}
          </ul>
        </Section>
      )}
      {(w.status === "voting" || w.status === "closed" || w.status === "archived") && (
        <Section title="Vote totals">
          <ol aria-label="Vote totals" className="ruled-list compact">
            {totals.map(({ cluster }) => (
              <li key={cluster.id} className="ruled-row">
                {cluster.title} — <Ticker value={String(cluster.dotTotal ?? 0)} /> dots
              </li>
            ))}
          </ol>
        </Section>
      )}
      {recap && (
        <Section title="Recap">
          <p className={recap.status === "complete" ? "recap-status" : "recap-status queued"}>{recapText}</p>
          {recap.invoice && (
            <p className="mono">
              Invoice {recap.invoice.number} — {euro(recap.invoice.amount)}
            </p>
          )}
          <a href={recap.recapUrl} className="btn btn-quiet" target="_blank" rel="noreferrer">
            Open recap page
          </a>
        </Section>
      )}
      <Section title="Join link">
        {w.joinUrl ? (
          <>
            <p className="join-url mono">{w.joinUrl}</p>
            <p className="muted small">Works until {instantDateTime(w.joinLinkExpiresAt, zone)} ({zone})</p>
          </>
        ) : (
          <p className="muted">The join link is off. Create a new one to let people in.</p>
        )}
        <div className="control-row">
          {w.joinUrl && (
            <button type="button" className="btn btn-quiet" onClick={() => void copy()}>
              <Copy aria-hidden="true" size={18} strokeWidth={1.75} />
              Copy join link
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => void linkAction("rotate")}>
            <Link2 aria-hidden="true" size={18} strokeWidth={1.75} />
            New join link
          </button>
          {w.joinUrl && (
            <button type="button" className="btn btn-quiet" onClick={() => void linkAction("off")}>
              <Link2Off aria-hidden="true" size={18} strokeWidth={1.75} />
              Turn off join link
            </button>
          )}
        </div>
      </Section>
      <Section title="Invites">
        <div className="field">
          <label htmlFor="client-emails">Client emails</label>
          <textarea
            id="client-emails"
            rows={3}
            value={emails}
            placeholder="one per line, or separated by commas"
            aria-describedby={emailError ? "client-emails-msg" : undefined}
            aria-invalid={emailError ? true : undefined}
            onChange={(e) => setEmails(e.target.value)}
          />
          {emailError && (
            <p id="client-emails-msg" className="field-message">
              {emailError}
            </p>
          )}
        </div>
        <button type="button" className="btn" onClick={() => void send()}>
          {sending ? "Sending…" : "Send invites"}
        </button>
        <ul aria-label="Invites" className="ruled-list compact">
          {w.invites.map((i) => (
            <li key={i.email} className="ruled-row">
              {i.email} — {i.status}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="History">
        <div className="control-row">
          <button type="button" className="btn btn-quiet" onClick={() => setDialog("trash")}>
            <Trash2 aria-hidden="true" size={18} strokeWidth={1.75} />
            Trash
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setDialog("versions")}>
            <History aria-hidden="true" size={18} strokeWidth={1.75} />
            Versions
          </button>
        </div>
      </Section>
      {dialog === "trash" && <TrashDialog actions={actions} zone={zone} onClose={() => setDialog(null)} />}
      {dialog === "versions" && <VersionsDialog actions={actions} zone={zone} onClose={() => setDialog(null)} />}
      {dialog === "close" && <CloseDialog busy={busy === "closed"} onClose={() => setDialog(null)} onConfirm={() => void move("closed", closeButton.current)} />}
    </>
  );
}

export function Drawer({ actions, banner }: { actions: RoomActions; banner: ReactNode }) {
  const { board } = actions;
  const w = board.workshop;
  const deadline = w.status === "silent_round" ? w.round?.endsAt : w.status === "voting" ? w.voting?.endsAt : undefined;
  const viewer = board.viewer;
  return (
    <aside aria-label="Session" className="drawer">
      {banner}
      {deadline && (
        <div className="timer-block">
          <span className="drawer-heading">{w.status === "silent_round" ? `Silent round ${w.round?.number ?? ""}` : "Voting"}</span>
          <Timer endsAt={deadline} offset={actions.clockOffset} />
        </div>
      )}
      {viewer.role === "participant" && (
        <Section title={`You're in as ${viewer.displayName}`}>
          {w.status === "voting" && w.voting && viewer.dotsRemaining !== null && (
            <p className="dots-left mono">
              <Ticker value={String(viewer.dotsRemaining)} /> of {w.voting.dotBudget} dots left
            </p>
          )}
          <p className="muted small">
            {w.status === "silent_round"
              ? "Write freely — nobody can read your notes until the facilitator reveals them."
              : w.status === "voting"
                ? "Spend your dots on the clusters that matter most. Nobody else sees your dots."
                : "Notes, clusters and votes update live for everyone in the room."}
          </p>
        </Section>
      )}
      {isFacilitatorWorkshop(w) && <FacilitatorPanel actions={actions} w={w} />}
    </aside>
  );
}
