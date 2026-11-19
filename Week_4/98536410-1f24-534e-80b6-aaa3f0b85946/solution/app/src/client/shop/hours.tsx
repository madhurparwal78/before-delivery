import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiFailure, api } from "../lib/api";
import { Figure } from "../lib/figure";
import { focusById, focusIdOf } from "../lib/focus";
import { useLatestRequest } from "../lib/hooks";
import { loadScreen, dropScreen, saveScreen } from "../lib/persist";
import { useMe } from "../session";
import type { DayHours, DayPlan, Hours } from "../types";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface DraftDay {
  open: boolean;
  opens: string;
  closes: string;
}

interface Draft {
  effective: string;
  days: DraftDay[];
  errors: Record<string, string>;
  preview: string;
  focus: string | null;
}

function fromServer(hours: Hours): Draft {
  return {
    effective: hours.local_today,
    days: hours.days.map((day: DayHours) => ({ open: day.open, opens: day.opens ?? "", closes: day.closes ?? "" })),
    errors: {}, preview: hours.local_today, focus: null,
  };
}

export function HoursEditor({ shopId, shopName, hours, announce, onPublished }: {
  shopId: string; shopName: string; hours: Hours | null; announce: (text: string) => void; onPublished: () => void;
}) {
  const me = useMe();
  const key = `hours-draft:${shopId}`;
  const [draft, setDraft] = useState<Draft | null>(() => loadScreen<Draft>(me.user.id, key));
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef(draft?.focus ?? null);
  const previews = useLatestRequest();

  const current: Draft | null = draft ?? (hours ? fromServer(hours) : null);
  const edit = (patch: Partial<Draft>) => {
    if (!current) return;
    const next = { ...current, ...patch };
    setDraft(next);
    saveScreen(me.user.id, key, next);
  };

  const loadPlan = useCallback((date: string, quiet = false) => {
    const token = previews.begin();
    if (!quiet) announce("Loading slots.");
    api<DayPlan>("GET", `/api/stores/${shopId}/day-plan?date=${date}`).then((answer) => {
      if (!previews.isLatest(token)) return;
      setPlan(answer);
      if (!quiet) announce(`Times are local to ${shopName} (${answer.timezone}).`);
    }, (error: unknown) => {
      if (!quiet && previews.isLatest(token) && error instanceof ApiFailure) announce("Pick a date from 2026 to 2030.");
    });
  }, [announce, previews, shopId, shopName]);

  const previewDate = current?.preview ?? "";
  const loaded = hours !== null;
  useEffect(() => {
    if (loaded && DATE.test(previewDate)) loadPlan(previewDate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, previewDate]);

  useEffect(() => {
    if (restoreFocus.current && root.current && current) {
      focusById(root.current, restoreFocus.current);
      restoreFocus.current = null;
    }
  }, [current]);

  const updateDay = (index: number, patch: Partial<DraftDay>) => {
    if (!current) return;
    edit({ days: current.days.map((day, at) => (at === index ? { ...day, ...patch } : day)) });
  };

  async function publish() {
    if (!current || busy) return;
    setBusy(true);
    announce("Publishing...");
    const days = current.days.map((day, index) => ({ weekday: index + 1, open: day.open, opens: day.open ? day.opens : null, closes: day.open ? day.closes : null }));
    try {
      await api<Hours>("PUT", `/api/stores/${shopId}/hours`, { effective_from: current.effective, days });
      dropScreen(me.user.id, key);
      setDraft({ ...current, errors: {} });
      announce(`Opening hours published from ${current.effective}.`);
      onPublished();
      loadPlan(current.preview, true);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        const errors = (error.body.errors ?? {}) as Record<string, string>;
        edit({ errors });
        announce("");
      } else announce("Something went wrong. Try again.");
    }
    setBusy(false);
  }

  const upcoming = hours?.upcoming;
  const errors = current?.errors ?? {};
  const message = useMemo(() => (upcoming ? `New hours start on ${upcoming.effective_from}.` : ""), [upcoming]);

  if (!current) return null;
  return (
    <div className="hours" role="group" aria-label="Opening hours" ref={root} onFocusCapture={(event) => edit({ focus: focusIdOf(event) })}>
      <div className="hours-effective">
        <label className="field-label" htmlFor="effective">Effective from</label>
        <input
          id="effective" className="field" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={current.effective} data-focus-id="effective"
          aria-invalid={errors.effective_from ? true : undefined} aria-describedby={errors.effective_from ? "effective-error" : undefined}
          onChange={(event) => edit({ effective: event.target.value })}
        />
        {errors.effective_from ? <p id="effective-error" className="field-error">{errors.effective_from}</p> : null}
      </div>
      <div className="hours-days">
        {WEEKDAYS.map((name, index) => {
          const day = current.days[index];
          if (!day) return null;
          const opensError = errors[`days.${index}.opens`];
          const closesError = errors[`days.${index}.closes`];
          return (
            <div key={name} className="hours-row">
              <label className="hours-open">
                <input type="checkbox" checked={day.open} aria-label={`Open on ${name}`} data-focus-id={`open:${index}`} onChange={(event) => updateDay(index, { open: event.target.checked })} />
                <span>{name}</span>
              </label>
              <div>
                <input
                  className="field" type="text" placeholder="HH:MM" aria-label={`${name} opens`} value={day.opens} data-focus-id={`opens:${index}`}
                  aria-invalid={opensError ? true : undefined} aria-describedby={opensError ? `opens-error-${index}` : undefined}
                  onChange={(event) => updateDay(index, { opens: event.target.value })}
                />
                {opensError ? <p id={`opens-error-${index}`} className="field-error">{opensError}</p> : null}
              </div>
              <div>
                <input
                  className="field" type="text" placeholder="HH:MM" aria-label={`${name} closes`} value={day.closes} data-focus-id={`closes:${index}`}
                  aria-invalid={closesError ? true : undefined} aria-describedby={closesError ? `closes-error-${index}` : undefined}
                  onChange={(event) => updateDay(index, { closes: event.target.value })}
                />
                {closesError ? <p id={`closes-error-${index}`} className="field-error">{closesError}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hours-publish">
        <button type="button" className="btn block" data-focus-id="publish" aria-disabled={busy} onClick={() => void publish()}>Publish hours</button>
      </div>
      {message ? <p className="upcoming">{message}</p> : null}
      <div className="hours-preview">
        <label className="field-label" htmlFor="preview">Preview date</label>
        <input
          id="preview" className="field" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={current.preview} data-focus-id="preview"
          onChange={(event) => edit({ preview: event.target.value })}
        />
        <p className="total-line">Slots {plan ? <Figure kind="slot-count" value={plan.slots.length} className="big" /> : null}</p>
        <ul aria-label="Slots on preview date" className="slots">
          {(plan?.slots ?? []).map((slot) => (
            <li key={slot.start_local}>{`${slot.start_local} (UTC${slot.utc_offset}), ${slot.remaining} left`}</li>
          ))}
        </ul>
        {plan ? <p className="status-line">{`Times are local to ${shopName} (${plan.timezone}).`}</p> : null}
      </div>
    </div>
  );
}
