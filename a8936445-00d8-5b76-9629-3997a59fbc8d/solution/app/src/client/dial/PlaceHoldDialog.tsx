// "Place hold" dialog: start and end selects, weekly repeats, notes and (for the operator) the tenant.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Hold, Tenant } from "../../shared/api";
import { DAY_MINUTES, MAX_WEEKS, NOTES_MAX, STEP_MINUTES } from "../../shared/kitchen";
import { hhmm } from "../../shared/time";
import type { ApiFailure } from "../api";
import { fieldError } from "../feedback";
import { Dialog, useCloseDialog } from "../ui/Dialog";
import { Field, describedBy, nextFieldId } from "../ui/parts";
import { placeHold } from "./holds";

const STARTS = Array.from({ length: DAY_MINUTES / STEP_MINUTES }, (_, i) => i * STEP_MINUTES);
const ENDS = STARTS.map((m) => m + STEP_MINUTES);

interface PlaceHoldProps {
  stationId: string;
  stationName: string;
  date: string;
  minute: number;
  /** Start and end drawn on the ring, when the dialog finishes an arc. */
  preset: { start: number; end: number } | null;
  tenants: Tenant[] | null;
  opener: HTMLElement | null;
  onPlaced: (hold: Hold) => void;
  onClose: () => void;
}

export function PlaceHoldDialog(props: PlaceHoldProps) {
  return (
    <Dialog title="Place hold" opener={props.opener} onClose={props.onClose}>
      <PlaceHoldForm {...props} />
    </Dialog>
  );
}

function PlaceHoldForm({ stationId, stationName, date, minute, preset, tenants, onPlaced }: PlaceHoldProps) {
  const close = useCloseDialog();
  const startDefault = preset?.start ?? Math.min(minute, DAY_MINUTES - STEP_MINUTES * 4);
  const [start, setStart] = useState(startDefault);
  const [end, setEnd] = useState(preset?.end ?? Math.min(startDefault + 60, DAY_MINUTES));
  const [weeks, setWeeks] = useState(1);
  const [notes, setNotes] = useState("");
  const [tenantId, setTenantId] = useState(tenants?.[0]?.id ?? "");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useRef({
    start: nextFieldId("hold-start"),
    end: nextFieldId("hold-end"),
    weeks: nextFieldId("hold-weeks"),
    notes: nextFieldId("hold-notes"),
    tenant: nextFieldId("hold-tenant"),
  }).current;

  useLayoutEffect(() => {
    if (tenants && !tenantId && tenants[0]) setTenantId(tenants[0].id);
  }, [tenants]);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const outcome = await placeHold(
      {
        station_id: stationId,
        date,
        start_local: hhmm(start),
        end_local: hhmm(end),
        weeks,
        notes,
        ...(tenants ? { tenant_id: tenantId } : {}),
      },
      stationName,
    );
    setBusy(false);
    if (outcome.ok) {
      onPlaced(outcome.value);
      close();
    } else {
      setFailure(outcome.failure);
    }
  };

  const err = (field: string): string | null => fieldError(failure, field);

  return (
    <form class="dialog-form" onSubmit={(e) => void submit(e)}>
      <p class="dialog-lede">
        {stationName} · <span class="mono">{date}</span>
      </p>
      <div class="field-row">
        <Field id={ids.start} label="Start" error={err("start_local") ?? err("date")}>
          <select
            id={ids.start}
            value={String(start)}
            aria-describedby={describedBy(ids.start, err("start_local") ?? err("date"))}
            onChange={(e) => setStart(Number(e.currentTarget.value))}
          >
            {STARTS.map((m) => (
              <option key={m} value={String(m)}>
                {hhmm(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={ids.end} label="End" error={err("end_local")}>
          <select
            id={ids.end}
            value={String(end)}
            aria-describedby={describedBy(ids.end, err("end_local"))}
            onChange={(e) => setEnd(Number(e.currentTarget.value))}
          >
            {ENDS.map((m) => (
              <option key={m} value={String(m)}>
                {hhmm(m)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id={ids.weeks} label="Repeat weekly" error={err("weeks")}>
        <select
          id={ids.weeks}
          value={String(weeks)}
          aria-describedby={describedBy(ids.weeks, err("weeks"))}
          onChange={(e) => setWeeks(Number(e.currentTarget.value))}
        >
          {Array.from({ length: MAX_WEEKS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={String(n)}>
              {n === 1 ? "Just this day" : `${n} weeks`}
            </option>
          ))}
        </select>
      </Field>
      <Field id={ids.notes} label="Notes" error={err("notes")}>
        <textarea
          id={ids.notes}
          rows={2}
          maxLength={NOTES_MAX}
          value={notes}
          aria-describedby={describedBy(ids.notes, err("notes"))}
          onInput={(e) => setNotes(e.currentTarget.value)}
        />
      </Field>
      {tenants && (
        <Field id={ids.tenant} label="Tenant" error={err("tenant_id")}>
          <select
            id={ids.tenant}
            value={tenantId}
            aria-describedby={describedBy(ids.tenant, err("tenant_id"))}
            onChange={(e) => setTenantId(e.currentTarget.value)}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.business_name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div class="dialog-actions">
        <button type="submit" class="btn btn-primary" disabled={busy}>
          Place hold
        </button>
        <button type="button" class="btn" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface TimeListboxProps {
  value: number;
  onChoose: (minute: number) => void;
}

/** Reduced-motion stand-in for turning the ring: every 15-minute step from 00:00 to 24:00. */
export function TimeListbox({ value, onChoose }: TimeListboxProps) {
  const [active, setActive] = useState(value);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => setActive(value), [value]);

  useLayoutEffect(() => {
    const box = list.current;
    const option = box?.querySelector<HTMLElement>(`[data-minute="${active}"]`);
    if (!box || !option) return;
    if (option.offsetTop < box.scrollTop) box.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = option.offsetTop + option.offsetHeight - box.clientHeight;
    }
  }, [active]);

  const onKeyDown = (event: KeyboardEvent): void => {
    const moves: Record<string, number> = { ArrowDown: STEP_MINUTES, ArrowUp: -STEP_MINUTES };
    if (event.key in moves) {
      event.preventDefault();
      setActive(Math.min(DAY_MINUTES, Math.max(0, active + moves[event.key])));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : DAY_MINUTES);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onChoose(active);
    }
  };

  return (
    <div class="time-list">
      <p class="rail-label" id="time-list-label">
        Time
      </p>
      <ul
        ref={list}
        class="time-options"
        role="listbox"
        aria-label="Time"
        tabIndex={0}
        aria-activedescendant={`time-${active}`}
        onKeyDown={onKeyDown}
      >
        {[...STARTS, DAY_MINUTES].map((m) => (
          <li
            key={m}
            id={`time-${m}`}
            data-minute={m}
            role="option"
            aria-selected={m === active ? "true" : "false"}
            class={m === value ? "time-option current mono" : "time-option mono"}
            onClick={() => {
              setActive(m);
              onChoose(m);
            }}
          >
            {hhmm(m)}
          </li>
        ))}
      </ul>
    </div>
  );
}
