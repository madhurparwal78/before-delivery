import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import type { Grant, GrantState, ExerciseOrder, Tranche, VestingType } from "../../shared/types.js";
import { CLIFF_MONTHS, MARKS, cellIndexOf, cellMarks } from "../../shared/vesting.js";
import { VESTING_LABEL, displayDate, dollars, groupThousands } from "../../shared/format.js";
import { ApiFailure, api } from "../api.js";
import { announce, announceOnce } from "../announce.js";
import { prefersReducedMotion, useResource, useSettled, useSocketGate } from "../hooks.js";
import { navigate, requestFocus } from "../router.js";
import { useSession } from "../session.js";
import { Band, CountedNumber, Countdown, Dialog, LabelledValue, groupedCount } from "../ui.js";
import { FailurePage } from "./notFound.js";
import { WarningStrips } from "./strips.js";

const STATE_WORD: Record<GrantState, string> = {
  draft: "Draft",
  board_queue: "With the board",
  approved: "Approved",
  offered: "Offered",
  accepted: "Accepted",
  expired: "Expired",
};

export function VestingPage() {
  const grants = useResource<{ grants: Grant[] }>("/api/grants", ["grants"]);
  const oldest = grants.data?.grants.find((grant) => grant.state === "accepted" || grant.state === "offered");
  useEffect(() => {
    if (oldest) navigate(`/grants/${oldest.id}`, { replace: true, focus: "main h1" });
  }, [oldest]);
  if (grants.data && !oldest) {
    return (
      <main className="page-state">
        <Band tone="black" className="band-fill">
          You hold no grants yet.
        </Band>
      </main>
    );
  }
  return (
    <main className="page-state">
      <Band tone="black" className="band-fill band-delayed">
        Loading your register.
      </Band>
    </main>
  );
}

export function GrantPage({ id }: { id: string }) {
  const { person } = useSession();
  const grant = useResource<Grant>(`/api/grants/${id}`, ["grants", "registry", "orders"]);
  if (grant.error) return <FailurePage failure={grant.error} />;
  if (!grant.data) {
    return (
      <main className="page-state">
        <Band tone="black" className="band-fill band-delayed">
          Loading your register.
        </Band>
      </main>
    );
  }
  return <GrantChapter grant={grant.data} holder={grant.data.holder_id === person.id} reload={grant.reload} />;
}

function GrantChapter({ grant, holder, reload }: { grant: Grant; holder: boolean; reload: () => void }) {
  const { person } = useSession();
  const gate = useSocketGate();
  const [exercising, setExercising] = useState(false);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [vaultDown, setVaultDown] = useState(false);
  const accepted = grant.state === "accepted";
  const leaver = person.role === "leaver";

  const accept = async () => {
    setBusy("accept");
    announce("Sealing your signed agreement in the vault.");
    try {
      await api("POST", `/api/grants/${grant.id}/accept`, {});
      setVaultDown(false);
      announceOnce(`accepted:${grant.id}`, `Grant ${grant.id} accepted. Your signed agreement is sealed in the vault.`);
      requestFocus("[data-exercise]");
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      setVaultDown(failure.code === "vault_unavailable");
      if (failure.code === "offer_expired") announce(`The offer for grant ${grant.id} has expired.`);
    } finally {
      setBusy(null);
      reload();
    }
  };

  const decline = async () => {
    setBusy("decline");
    try {
      await api("POST", `/api/grants/${grant.id}/decline`, {});
      announce(`Grant ${grant.id} declined and returned to the board.`);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.code === "offer_expired") announce(`The offer for grant ${grant.id} has expired.`);
    } finally {
      setBusy(null);
      reload();
    }
  };

  return (
    <main className="chapter">
      <WarningStrips grants={[grant]} />
      <section className="sheet">
        <p className="note">
          {person.name}
          <br />
          {grant.id}
        </p>
        <h1 tabIndex={-1}>{grant.id}</h1>
        <p className="state-word">{STATE_WORD[grant.state]}</p>
        {grant.holder_name && holder === false && <p className="note-inline">Held by {grant.holder_name}</p>}
      </section>

      {grant.state === "offered" && holder && (
        <section className="sheet" aria-label="Grant agreement">
          <p className="note">Read the agreement, then accept or decline.</p>
          <div className="agreement">
            <p>Tidecraft Robotics, Inc. — Stock Option Grant Agreement</p>
            <p>Grant: {grant.id}</p>
            <p>Holder: {grant.holder_name}</p>
            <p>Options: {groupThousands(grant.options ?? 0)}</p>
            <p>Strike price: {dollars(grant.strike ?? "0")}</p>
            <p>
              Vesting: {grant.vesting_type ? VESTING_LABEL[grant.vesting_type] : ""}, from {displayDate(grant.vesting_start ?? "")}
            </p>
          </div>
          {vaultDown && (
            <Band tone="red" role="alert">
              The document vault can't be reached. Your signature is pending and grant {grant.id} is not yet accepted.
            </Band>
          )}
          {grant.agreement.status === "pending" && !vaultDown && <p className="pending-note">Your signature is pending. Use Retry signing to seal the agreement in the vault.</p>}
          <div className="actions">
            <button type="button" className="button button-primary" disabled={gate || busy !== null} onClick={() => void accept()}>
              Accept grant
            </button>
            <button type="button" className="button button-secondary" disabled={gate || busy !== null} onClick={() => void decline()}>
              Decline grant
            </button>
            {grant.agreement.status === "pending" && (
              <button type="button" className="button button-secondary" disabled={gate || busy !== null} onClick={() => void accept()}>
                Retry signing
              </button>
            )}
          </div>
        </section>
      )}

      {accepted && holder && (
        <section className="sheet">
          <p className="note">Exercise vested options at the strike.</p>
          <div className="actions">
            <button type="button" data-exercise className="button button-primary" disabled={gate} onClick={() => setExercising(true)}>
              Exercise
            </button>
          </div>
        </section>
      )}

      {grant.schedule.length > 0 && grant.vesting_type !== null && <Projection grant={grant} vestingType={grant.vesting_type} leaver={leaver} />}
      {exercising && <ExerciseDialog grant={grant} onClose={() => setExercising(false)} />}
    </main>
  );
}

function Projection({ grant, vestingType, leaver }: { grant: Grant; vestingType: VestingType; leaver: boolean }) {
  const schedule = grant.schedule;
  const todayMark = schedule.filter((tranche) => tranche.date <= grant.server_date).length - 1;
  const [marker, setMarker] = useState(Math.max(0, todayMark));
  const markerIndex = cellIndexOf(vestingType, marker);
  const todayIndex = cellIndexOf(vestingType, Math.max(0, todayMark));
  const marks = cellMarks(vestingType);
  const byMonth = new Map<number, Tranche>(schedule.map((tranche) => [tranche.month, tranche]));
  const current = byMonth.get(marker) ?? schedule[0];
  const trackRef = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const windowEnds = grant.exercise_window_ends_at;

  useLayoutEffect(() => {
    const track = trackRef.current;
    const cell = track?.querySelectorAll<HTMLElement>("li")[markerIndex];
    if (!track || !cell) return;
    // Every target is a cell start, so the frame always shows whole cells.
    const left = cell.offsetLeft;
    const right = left + cell.offsetWidth;
    let target = track.scrollLeft;
    if (left < track.scrollLeft) target = left;
    else if (right > track.scrollLeft + track.clientWidth) target = right - track.clientWidth;
    if (first.current) {
      // The first view has the marker's cell near the middle.
      const cells = track.querySelectorAll<HTMLElement>("li");
      const visible = Math.floor((track.clientWidth + 4) / (cell.offsetWidth + 4));
      target = cells[Math.max(0, markerIndex - Math.floor((visible - 1) / 2))]?.offsetLeft ?? left;
    }
    const behavior = first.current || prefersReducedMotion() ? "instant" : "smooth";
    first.current = false;
    if (target !== track.scrollLeft) track.scrollTo({ left: target, behavior });
  }, [markerIndex]);

  // A relayout (a resize, a rotated phone) keeps the marker's cell whole inside the frame.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(() => {
      const cell = track.querySelectorAll<HTMLElement>("li")[markerIndex];
      if (!cell) return;
      const inFrame = cell.offsetLeft >= track.scrollLeft && cell.offsetLeft + cell.offsetWidth <= track.scrollLeft + track.clientWidth;
      if (!inFrame) track.scrollTo({ left: cell.offsetLeft, behavior: "instant" });
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [markerIndex]);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: marker + 1,
      ArrowUp: marker + 1,
      ArrowLeft: marker - 1,
      ArrowDown: marker - 1,
      PageUp: marker + CLIFF_MONTHS,
      PageDown: marker - CLIFF_MONTHS,
      Home: Math.max(0, todayMark),
      End: MARKS,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setMarker(Math.min(MARKS, Math.max(0, next)));
  };

  const valueText = `${displayDate(current?.date ?? "")}${marker === Math.max(0, todayMark) ? " (today)" : ""}`;
  const stateOf = (tranche: Tranche, index: number): "vested" | "unvested" | "projected" | "cancelled" =>
    tranche.state === "unvested" && index > todayIndex && index <= markerIndex ? "projected" : tranche.state;

  return (
    <section className="sheet ribbon-sheet">
      <p className="note">Vesting runs monthly. The red cells are vested on the server's date.</p>
      <div role="group" aria-label="Tranche ribbon" className="ribbon">
        {leaver && windowEnds && (
          <div className="leaver-band">
            <span>Exercise window</span>
            <Countdown to={windowEnds} label="Exercise window" suffix=" left" done="Window closed" className="leaver-countdown" />
          </div>
        )}
        <div className="track" ref={trackRef} role="region" aria-label="Tranche scroll area" tabIndex={0}>
          <ul role="list" aria-label="Tranches" className="cells">
            {marks.map((mark, index) => {
              const tranche = byMonth.get(mark);
              if (!tranche) return null;
              const state = stateOf(tranche, index);
              return (
                <li
                  key={mark}
                  role="listitem"
                  className="cell"
                  data-state={state}
                  aria-label={`${displayDate(tranche.date)}, ${groupThousands(tranche.cumulative)} options, ${state}`}
                  onClick={() => setMarker(mark)}
                >
                  <span className="fill fill-projected" data-on={state === "projected"} />
                  <span className="fill fill-vested" data-on={state === "vested"} />
                  <span className="fill fill-cancelled" data-on={state === "cancelled"} />
                  <span className="cell-flags" aria-hidden="true">
                    {index === markerIndex && <ChevronDown size={24} strokeWidth={2} />}
                    {index === todayIndex && <span className="today-flag">Today</span>}
                  </span>
                  <span className="cell-date" aria-hidden="true">
                    {displayDate(tranche.date).split(" ").slice(0, 2).join(" ")}
                  </span>
                  <span className="cell-year" aria-hidden="true">
                    {tranche.date.slice(0, 4)}
                  </span>
                  <span className="cell-count" aria-hidden="true">
                    {groupThousands(tranche.cumulative)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="slider-timeline">
        <p className="slider-value" aria-hidden="true">
          <span style={{ left: `calc(${thumbAt(marker)})`, transform: `translateX(-${(marker / MARKS) * 100}%)` }}>{valueText}</span>
        </p>
        <div
          className="slider"
          role="slider"
          tabIndex={0}
          aria-label="Projection date"
          aria-valuemin={0}
          aria-valuemax={MARKS}
          aria-valuenow={marker}
          aria-valuetext={valueText}
          onKeyDown={move}
          onPointerDown={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setMarker(Math.min(MARKS, Math.max(0, Math.round(((event.clientX - box.left) / box.width) * MARKS))));
          }}
        >
          <span className="slider-rail" />
          <span className="slider-vested" style={{ width: `calc(${thumbAt(Math.max(0, todayMark))})` }} />
          <span className="slider-thumb" style={{ left: `calc(${thumbAt(marker)})` }} />
        </div>
        <p className="slider-ends" aria-hidden="true">
          <span>{displayDate(schedule[0]?.date ?? "")}</span>
          <span>{displayDate(schedule[schedule.length - 1]?.date ?? "")}</span>
        </p>
        </div>
      </div>

      <div role="group" aria-label="Projection figures" className="figures">
        <LabelledValue label="Vested">
          <CountedNumber value={String(current?.cumulative ?? 0)} render={groupedCount} />
        </LabelledValue>
        <LabelledValue label="Cost to exercise">
          <CountedNumber value={current?.cost_at_strike ?? "0.00"} decimals={2} render={dollars} />
        </LabelledValue>
        <LabelledValue label="Vested ownership">
          <CountedNumber value={current?.vested_ownership ?? "0.00"} decimals={2} render={(plain) => `${plain}%`} />
        </LabelledValue>
      </div>
      {leaver && windowEnds && (
        <LabelledValue label="Exercisable now">
          <CountedNumber value={String(grant.exercisable)} render={groupedCount} />
        </LabelledValue>
      )}
    </section>
  );
}

/** Where month m sits on the slider rail, as a CSS length (the thumb's centre). */
function thumbAt(month: number): string {
  return `14px + (100% - 28px) * ${month / MARKS}`;
}

function ExerciseDialog({ grant, onClose }: { grant: Grant; onClose: () => void }) {
  const gate = useSocketGate();
  const [text, setText] = useState("");
  const [cost, setCost] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const key = useRef("");

  const countOf = (value: string): number | string => (/^\d+$/.test(value.replace(/,/g, "")) ? Number.parseInt(value.replace(/,/g, ""), 10) : value);

  useSettled(text, 250, async (value) => {
    key.current = "";
    if (value.trim() === "") {
      setCost(null);
      setError(undefined);
      return;
    }
    try {
      const quote = await api<{ cost: string }>("POST", `/api/grants/${grant.id}/exercise-quote`, { options: countOf(value) });
      setCost(quote.cost);
      setError(undefined);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      setCost(null);
      setError(failure.fields.options ?? failure.body.error.message);
    }
  });

  const placeExercise = async () => {
    if (!key.current) key.current = `ex-${crypto.randomUUID().replace(/-/g, "")}`;
    setBusy(true);
    try {
      const order = await api<ExerciseOrder>("POST", `/api/grants/${grant.id}/exercises`, { options: countOf(text) }, { "Idempotency-Key": key.current });
      if (order.state === "issued") announceOnce(`order-issued:${order.id}`, `Payment confirmed. ${groupThousands(order.options)} shares issued on grant ${grant.id}.`);
      else announce("Payment pending at the provider. Your shares appear once it confirms.");
      navigate(`/exercises/${order.id}`, { focus: "main h1" });
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.code === "provider_unavailable" && failure.body.order) navigate(`/exercises/${failure.body.order.id}`, { focus: "main h1" });
      else setError(failure.fields.options ?? failure.body.error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Exercise options" onClose={onClose}>
      <form
        className="form-column"
        onSubmit={(event) => {
          event.preventDefault();
          void placeExercise();
        }}
      >
        <div className="field">
          <label htmlFor="exercise-options">Options to exercise</label>
          <input
            id="exercise-options"
            data-autofocus
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={text}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setError(undefined);
            }}
          />
          {error && <p className="field-error">Error: {error}</p>}
        </div>
        <p className="cost-line">
          <span id="exercise-cost-label">Cost</span> <span aria-labelledby="exercise-cost-label" className="cost-value">{cost === null ? "—" : dollars(cost)}</span>
        </p>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={gate || busy}>
            {busy ? "Sending to the provider" : "Confirm exercise"}
          </button>
          <button type="button" className="button button-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Dialog>
  );
}
