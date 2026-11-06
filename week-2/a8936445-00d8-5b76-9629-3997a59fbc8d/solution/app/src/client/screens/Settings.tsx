// Settings (operator): the cancellation policy and its version history.
import { useEffect, useRef, useState } from "preact/hooks";
import type { Policy } from "../../shared/api";
import { FREE_WINDOW_MAX_HOURS } from "../../shared/kitchen";
import { kitchenStamp } from "../../shared/time";
import { api, type ApiFailure } from "../api";
import { act, fieldError } from "../feedback";
import { EmptyRow, Eyebrow, Field, PendingLine, describedBy, nextFieldId } from "../ui/parts";

interface PolicyState {
  current: Policy;
  history: Policy[];
}

export function SettingsScreen() {
  const [state, setState] = useState<PolicyState | null>(null);
  const [freeHours, setFreeHours] = useState("");
  const [latePercent, setLatePercent] = useState("");
  const [basedOn, setBasedOn] = useState(0);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useRef({ free: nextFieldId("policy-free"), late: nextFieldId("policy-late") }).current;

  const load = async (mode: "load" | "refresh", fill: boolean): Promise<void> => {
    const outcome = await act({ pending: mode === "load" ? "Loading…" : undefined }, () =>
      api<PolicyState>("GET", "/api/cancellation-policy"),
    );
    if (!outcome.ok) return;
    setState(outcome.value);
    if (fill) {
      setFreeHours(String(outcome.value.current.free_window_hours));
      setLatePercent(String(outcome.value.current.late_fee_percent));
      setBasedOn(outcome.value.current.version);
    }
  };
  useEffect(() => void load("load", true), []);

  const save = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const outcome = await act(
      {
        pending: "Saving policy…",
        success: (p: Policy) => `Policy version ${p.version} applies to bookings confirmed from now on. Existing bookings keep their terms.`,
        error: (f) =>
          f.code === "stale_version" ? `The policy changed since you opened it. Reload to see version ${String(f.details.current_version)}.` : null,
      },
      () =>
        api<Policy>("PUT", "/api/cancellation-policy", {
          body: { free_window_hours: Number(freeHours), late_fee_percent: Number(latePercent), based_on_version: basedOn },
        }),
    );
    setBusy(false);
    setFailure(outcome.ok ? null : outcome.failure);
    if (outcome.ok) {
      setBasedOn(outcome.value.version);
      void load("refresh", false);
    }
  };

  const freeError = fieldError(failure, "free_window_hours");
  const lateError = fieldError(failure, "late_fee_percent");

  return (
    <div class="sheet">
      <PendingLine />
      <header class="screen-head">
        <h1 class="screen-title">Settings</h1>
      </header>
      <div class="settings-grid">
        <form class="panel policy-form" aria-label="Cancellation policy" onSubmit={(e) => void save(e)}>
          <Eyebrow n={1} label="Cancellation policy" />
          <h2>Cancellation policy</h2>
          <p class="muted">
            A saved change becomes the next version. It applies to bookings confirmed from then on; every existing booking keeps
            the version it was confirmed under.
          </p>
          <Field id={ids.free} label="Free cancellation window (hours)" error={freeError}>
            <input
              id={ids.free}
              type="number"
              class="mono"
              min={0}
              max={FREE_WINDOW_MAX_HOURS}
              step={1}
              value={freeHours}
              aria-describedby={describedBy(ids.free, freeError)}
              onInput={(e) => setFreeHours(e.currentTarget.value)}
            />
          </Field>
          <Field id={ids.late} label="Late cancellation charge (%)" error={lateError}>
            <input
              id={ids.late}
              type="number"
              class="mono"
              min={0}
              max={100}
              step={1}
              value={latePercent}
              aria-describedby={describedBy(ids.late, lateError)}
              onInput={(e) => setLatePercent(e.currentTarget.value)}
            />
          </Field>
          <p class="muted">
            Editing version <span class="mono">v{basedOn}</span>
          </p>
          <button type="submit" class="btn btn-primary" disabled={busy || !state}>
            Save policy
          </button>
        </form>
        <section class="panel">
          <Eyebrow n={2} label="Policy history" />
          <h2>Policy history</h2>
          <div class="table-wrap">
            <table class="data cards" role="table" aria-label="Policy history">
              <thead>
                <tr role="row">
                  <th role="columnheader">Version</th>
                  <th role="columnheader">Free window</th>
                  <th role="columnheader">Late charge</th>
                  <th role="columnheader">Effective</th>
                </tr>
              </thead>
              <tbody>
                {state?.history.length === 0 && <EmptyRow columns={4} text="No policy saved yet." />}
                {state?.history.map((p) => (
                  <tr role="row" key={p.version}>
                    <td role="cell" data-label="Version" class="mono strong">
                      v{p.version}
                    </td>
                    <td role="cell" data-label="Free window" class="mono">
                      {p.free_window_hours} h
                    </td>
                    <td role="cell" data-label="Late charge" class="mono">
                      {p.late_fee_percent}%
                    </td>
                    <td role="cell" data-label="Effective" class="mono">
                      {kitchenStamp(Date.parse(p.effective_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
