import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { keepTabInside } from "../shared/dialog";
import { ritualById, type RitualId } from "../shared/rituals";
import { api, CHECK_DETAILS, type ApiFailure, type Plan } from "./api";
import {
  BedtimeField,
  CheckYourHour,
  HourSummary,
  NoteField,
  RitualsField,
  TimeZoneField,
  checkHour,
  hourErrors,
  type FieldErrors,
  type HourField,
} from "./fields";
import { fitsHour, type RitualChoice } from "../shared/hour";
import { PageShell, SignInRequest } from "./PageShell";

type View = { kind: "loading" } | { kind: "signed_out" } | { kind: "draft" } | { kind: "ready"; plan: Plan } | { kind: "unavailable"; message: string };

const COPY = {
  saving: "Saving your hour…",
  saved: "Your hour is saved.",
  remindersOn: "Reminders are on.",
  remindersPaused: "Reminders are paused.",
  conflict: "This plan changed somewhere else. Here is the latest version; your edits were not saved.",
  shareReady: "Your share link is ready.",
  copied: "Link copied.",
  sharingOff: "Sharing is off. The old link no longer works.",
  deleted: "Everything is deleted. You will not get another reminder.",
  signedOut: "You are signed out.",
  signIn: "Sign in to manage your hour.",
  draft: "Your hour is waiting for confirmation. Open the link in your confirmation email.",
  failed: "That did not work. Please try again.",
};

/** "Next reminder: Sunday 1 November at 22:00 (Europe/London)", in the hour's own zone whatever the browser's. */
function nextReminderLine(plan: Plan) {
  if (!plan.next_reminder_at) return COPY.remindersPaused;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: plan.time_zone,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(plan.next_reminder_at))
      .map((part) => [part.type, part.value]),
  );
  return `Next reminder: ${parts.weekday} ${parts.day} ${parts.month} at ${parts.hour}:${parts.minute} (${plan.time_zone})`;
}

/** /manage: sign in by email link, then change, pause, share or delete the hour. */
export function ManagePage() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [status, setStatus] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (after?: string) => {
    const result = await api<{ plan: Plan }>("GET", "/api/me/plan");
    if (result.ok) setView({ kind: "ready", plan: result.data.plan });
    else if (result.status === 401) setView({ kind: "signed_out" });
    else if (result.code === "no_plan") setView({ kind: "draft" });
    else setView({ kind: "unavailable", message: result.message ?? COPY.failed });
    if (after !== undefined) setStatus(after);
    return result;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Shows the signed-out form; the editor's controls are gone, so focus moves to the page heading. */
  const signedOut = useCallback((copy: string) => {
    setView({ kind: "signed_out" });
    setStatus(copy);
    window.requestAnimationFrame(() => heading.current?.focus());
  }, []);

  return (
    <PageShell busy={view.kind === "loading"} wide={view.kind === "ready"}>
      <h1 className="sh-page__title" ref={heading} tabIndex={-1}>
        Manage my hour
      </h1>
      <p className="sh-live" role="status" aria-label="Manage status">
        {status}
      </p>
      {view.kind === "signed_out" ? (
        <>
          <p className="sh-page__lead">Change your bedtime and rituals, pause reminders, share your hour or delete it.</p>
          <SignInRequest />
        </>
      ) : null}
      {view.kind === "draft" ? (
        <section className="sh-panel">
          <p>{COPY.draft}</p>
          <SignOut onDone={() => signedOut(COPY.signedOut)} />
        </section>
      ) : null}
      {view.kind === "unavailable" ? (
        <section className="sh-panel">
          <p>{view.message}</p>
          <div className="sh-panel__actions">
            <button className="sh-button sh-button--quiet" type="button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        </section>
      ) : null}
      {view.kind === "ready" ? (
        <Editor
          plan={view.plan}
          onStatus={setStatus}
          onReload={(after) => load(after)}
          onPlan={(plan) => setView({ kind: "ready", plan })}
          onSignedOut={signedOut}
        />
      ) : null}
    </PageShell>
  );
}

function SignOut({ onDone }: { onDone: () => void }) {
  return (
    <div className="sh-panel__actions">
      <button
        className="sh-button sh-button--quiet"
        type="button"
        onClick={async () => {
          await api("POST", "/api/session/end");
          onDone();
        }}
      >
        Sign out
      </button>
    </div>
  );
}

interface EditorProps {
  plan: Plan;
  onStatus: (copy: string) => void;
  onReload: (after: string) => Promise<unknown>;
  onPlan: (plan: Plan) => void;
  onSignedOut: (copy: string) => void;
}

const choicesOf = (plan: Plan): RitualChoice[] => plan.rituals.map(({ id, minutes }) => ({ id, minutes }));
const sameRituals = (a: readonly RitualChoice[], b: readonly RitualChoice[]) =>
  a.length === b.length && a.every((entry, index) => entry.id === b[index].id && entry.minutes === b[index].minutes);

function Editor({ plan, onStatus, onReload, onPlan, onSignedOut }: EditorProps) {
  const [bedtime, setBedtime] = useState(plan.bedtime);
  const [zone, setZone] = useState(plan.time_zone);
  const [rituals, setRituals] = useState(() => choicesOf(plan));
  const [note, setNote] = useState(plan.note);
  const [errors, setErrors] = useState<FieldErrors>({});
  const pending = useRef(false);
  const alert = useRef<HTMLDivElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);

  // A newer version (after a save, a switch or a conflict) replaces every field with the stored hour.
  useEffect(() => {
    setBedtime(plan.bedtime);
    setZone(plan.time_zone);
    setRituals(choicesOf(plan));
    setNote(plan.note);
    setErrors({});
  }, [plan.version]);

  /** Shared handling for every failed call on this page. */
  function fail(result: ApiFailure) {
    if (result.status === 401) onSignedOut(COPY.signIn);
    else if (result.status === 409 && result.current) {
      onPlan(result.current);
      onStatus(COPY.conflict);
    } else if (result.status === 422) {
      setErrors(hourErrors(result.fields));
      onStatus(CHECK_DETAILS);
      window.requestAnimationFrame(() => alert.current?.focus());
    } else onStatus(result.message ?? COPY.failed);
  }

  /** Runs one request at a time; controls stay enabled (and focused) while it is in flight. */
  async function once(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    try {
      await work();
    } finally {
      pending.current = false;
    }
  }

  const patch = (body: Record<string, unknown>, done: string) =>
    once(async () => {
      onStatus(COPY.saving);
      const result = await api<{ plan: Plan }>("PATCH", "/api/me/plan", body, { "If-Match": String(plan.version) });
      if (result.ok) await onReload(done);
      else fail(result);
    });

  function save(event: FormEvent) {
    event.preventDefault();
    const changed: Partial<Record<HourField, unknown>> = {};
    if (bedtime !== plan.bedtime) changed.bedtime = bedtime;
    if (zone !== plan.time_zone) changed.time_zone = zone;
    if (!sameRituals(rituals, choicesOf(plan))) changed.rituals = rituals;
    if (note !== plan.note) changed.note = note;
    const fields = Object.keys(changed) as HourField[];
    const found = checkHour({ email: plan.email, bedtime, time_zone: zone, rituals, note }, fields);
    setErrors(found);
    if (Object.keys(found).length) {
      onStatus(CHECK_DETAILS);
      window.requestAnimationFrame(() => alert.current?.focus());
      return;
    }
    if (!fields.length) {
      onStatus(COPY.saved);
      return;
    }
    void patch(changed, COPY.saved);
  }

  const share = (method: "POST" | "DELETE", done: string) =>
    once(async () => {
      const result = await api(method, "/api/me/share");
      if (!result.ok) return fail(result);
      await onReload(done);
      // Turning sharing off removes the button that was pressed; focus stays on the share button that remains.
      if (method === "DELETE") shareButton.current?.focus();
    });

  async function copyLink(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      onStatus(COPY.copied);
    } catch {
      onStatus("Select the link and copy it.");
    }
  }

  /** Takes a new ritual list unless it would pass 60 minutes; says whether it was taken. */
  const change = (next: RitualChoice[]) => {
    if (!fitsHour(next)) return false;
    setRituals(next);
    return true;
  };

  const controls = {
    chosen: rituals,
    add: (id: RitualId) => change([...rituals, { id, minutes: ritualById(id).minutes }]),
    remove: (id: RitualId) => change(rituals.filter((entry) => entry.id !== id)),
    setMinutes: (id: RitualId, minutes: number) => change(rituals.map((entry) => (entry.id === id ? { id, minutes } : entry))),
  };

  const address = plan.share_url ? `${window.location.origin}${plan.share_url}` : "";
  const on = plan.reminders === "on";

  return (
    <>
      <div className="sh-account__intro">
        <p className="sh-account__email">Signed in as {plan.email}</p>
        <p className="sh-account__next">{nextReminderLine(plan)}</p>
      </div>
      <div className="sh-manage">
        <form className="sh-panel sh-manage__hour" noValidate aria-labelledby="edit-title" onSubmit={save}>
          <h2 className="sh-panel__title" id="edit-title">
            Your hour
          </h2>
          <CheckYourHour prefix="edit" errors={errors} ref={alert} />
          <div className="sh-planner__row">
            <BedtimeField prefix="edit" value={bedtime} error={errors.bedtime} onChange={setBedtime} />
            <TimeZoneField prefix="edit" value={zone} error={errors.time_zone} onChange={setZone} />
          </div>
          <RitualsField prefix="edit" controls={controls} error={errors.rituals} />
          <NoteField prefix="edit" value={note} error={errors.note} onChange={setNote} />
          <HourSummary bedtime={bedtime} zone={zone} rituals={rituals} />
          <div className="sh-panel__actions">
            <button className="sh-button sh-button--ember" type="submit">
              Save changes
            </button>
          </div>
        </form>

        <div className="sh-manage__side">
          <section className="sh-panel" aria-labelledby="reminders-title">
            <h2 className="sh-panel__title" id="reminders-title">
              Nightly reminder
            </h2>
            <p>One email when your hour starts, at {plan.starts_at_local} {plan.time_zone} time.</p>
            <button
              className="sh-switch"
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => void patch({ reminders: on ? "paused" : "on" }, on ? COPY.remindersPaused : COPY.remindersOn)}
            >
              <span className="sh-switch__track" aria-hidden="true">
                <span className="sh-switch__thumb" />
              </span>
              <span className="sh-switch__text">Reminders</span>
            </button>
          </section>

          <section className="sh-panel" aria-labelledby="share-title">
            <h2 className="sh-panel__title" id="share-title">
              Share with a partner
            </h2>
            <p>A shared link shows your bedtime, time zone and rituals. It never shows your email or your note.</p>
            <div className="sh-field">
              <label className="sh-field__label" htmlFor="share-link">
                Share link
              </label>
              <input className="sh-input" id="share-link" readOnly value={address} onFocus={(event) => event.target.select()} />
            </div>
            <div className="sh-panel__actions">
              <button className="sh-button sh-button--ember" type="button" ref={shareButton} onClick={() => void share("POST", COPY.shareReady)}>
                {address ? "Make a new share link" : "Create a share link"}
              </button>
              {address ? (
                <>
                  <button className="sh-button sh-button--quiet" type="button" onClick={() => void copyLink(address)}>
                    Copy link
                  </button>
                  <button className="sh-button sh-button--quiet" type="button" onClick={() => void share("DELETE", COPY.sharingOff)}>
                    Turn off sharing
                  </button>
                </>
              ) : null}
            </div>
          </section>

          <section className="sh-panel" aria-labelledby="leave-title">
            <h2 className="sh-panel__title" id="leave-title">
              Leave Stillhour
            </h2>
            <DeleteEverything onDeleted={() => onSignedOut(COPY.deleted)} onFailed={fail} />
            <SignOut onDone={() => onSignedOut(COPY.signedOut)} />
          </section>
        </div>
      </div>
    </>
  );
}

/** "Delete everything": an in-page dialog that asks for the word DELETE before anything is removed. */
function DeleteEverything({ onDeleted, onFailed }: { onDeleted: () => void; onFailed: (result: ApiFailure) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLInputElement>(null);
  /** After a delete the editor unmounts and focus goes to the heading; the dialog's close must not pull it back. */
  const deleted = useRef(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function erase(event: FormEvent) {
    event.preventDefault();
    if (typed !== "DELETE" || deleting) return;
    setDeleting(true);
    const result = await api("DELETE", "/api/me");
    setDeleting(false);
    if (result.ok) {
      deleted.current = true;
      dialog.current?.close();
      onDeleted();
      return;
    }
    dialog.current?.close();
    onFailed(result);
  }

  return (
    <>
      <div className="sh-panel__actions">
        <button
          className="sh-button sh-button--danger"
          type="button"
          ref={opener}
          onClick={() => {
            setTyped("");
            dialog.current?.showModal();
            box.current?.focus();
          }}
        >
          Delete everything
        </button>
      </div>
      <dialog
        className="sh-dialog"
        ref={dialog}
        aria-labelledby="delete-title"
        aria-describedby="delete-text"
        onKeyDown={(event) => keepTabInside(event.currentTarget, event)}
        onClose={() => {
          if (!deleted.current) opener.current?.focus();
        }}
      >
        <form className="sh-dialog__body" onSubmit={erase}>
          <h2 className="sh-panel__title" id="delete-title">
            Delete everything
          </h2>
          <p id="delete-text">This removes your hour, your reminders and any share link. It cannot be undone.</p>
          <div className="sh-field">
            <label className="sh-field__label" htmlFor="delete-confirm">
              Type DELETE to confirm
            </label>
            <input
              className="sh-input"
              id="delete-confirm"
              ref={box}
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          <div className="sh-panel__actions">
            <button className="sh-button sh-button--danger" type="submit" disabled={typed !== "DELETE" || deleting}>
              Delete my hour for good
            </button>
            <button className="sh-button sh-button--quiet" type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
