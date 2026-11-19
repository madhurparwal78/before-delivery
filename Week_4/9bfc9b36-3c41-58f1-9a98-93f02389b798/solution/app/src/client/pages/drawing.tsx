/** A drawing: its overview and the four steps at their own addresses, with the step rail across the top. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { getJson, sendJson } from "../api.js";
import { useLive } from "../live.js";
import { play, reducedMotion } from "../motion.js";
import { Link, useRouter } from "../router.js";
import { Chip, DataTable, Dialog, DialogForm, EmptyState, SelectField, TextField, UnitPair, useCollection, useDialog, useLoad, usePoll, useSubmitter, type Collection } from "../ui.js";
import { RecordMeasurementDialog } from "./measure-dialog.js";
import { PageHeading } from "./chrome.js";
import { NotFound } from "./public.js";
import { StatusChip } from "./loft.js";
import { SailCanvas } from "./sail.js";
import { Nesting, RollRemaining, loadNest, type NestData } from "./nesting.js";
import { useConfirmCut } from "./cutting.js";
import { useLayout } from "../layout.js";
import { dimensionCell } from "./boat.js";
import { sailLabel } from "../format.js";
import { ACCOUNT_CHIPS, ACCOUNT_LINES, EMPTY, OUTAGES, PENDING, SUCCESS, supersededCopy, stepCopy } from "../../shared/copy.js";
import { STEPS, type Account, type Boat, type CutResult, type Drawing, type Grant, type Page, type SailAccount, type Step } from "../../shared/types.js";
import type { ScreenName } from "../../shared/routes.js";
import { areaParts, penceOfPounds, poundsText } from "../../shared/units.js";

const STEP_NAMES: Record<Step, string> = { measure: "Measure", draw: "Draw", nest: "Nest", confirm: "Confirm" };

// ---- the rail ---------------------------------------------------------------------------------

function Rail({ code, drawing, current }: { code: string; drawing: Drawing | null; current: Step | null }) {
  const reached = drawing?.step ? STEPS.indexOf(drawing.step) : 0;
  const index = current ? STEPS.indexOf(current) : -1;
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  return (
    <nav aria-label="Sail steps" className="rail">
      <ol>
        {STEPS.map((step, position) => {
          const reachable = drawing !== null && position <= reached;
          return (
            <li key={step}>
              {reachable ? (
                <Link to={`/drawings/${code}/${step}`} aria-current={current === step ? "step" : undefined} focus>
                  {STEP_NAMES[step]}
                </Link>
              ) : (
                <span>{STEP_NAMES[step]}</span>
              )}
            </li>
          );
        })}
      </ol>
      {index >= 0 ? <div className={`rail-marker${first.current ? " instant" : ""}`} style={{ transform: `translateX(${index * 100}%)` }} aria-hidden="true" /> : null}
    </nav>
  );
}

const STEP_FADE_MS = 160;

/** Two steps are never laid out at once: the outgoing step fades out and is removed in a commit of its own, then the incoming one mounts and fades in. */
function StepFrame({ screen, children }: { screen: ScreenName; children: (screen: ScreenName) => ReactNode }) {
  const [shown, setShown] = useState<ScreenName | null>(screen);
  const frame = useRef<HTMLDivElement>(null);
  const entering = useRef(false);
  useEffect(() => {
    if (shown === null || screen === shown) return;
    const element = frame.current;
    const fading = element && !reducedMotion() && play(element, [{ opacity: 1 }, { opacity: 0 }], STEP_FADE_MS);
    if (!fading) {
      setShown(screen);
      return;
    }
    const timer = window.setTimeout(() => {
      flushSync(() => setShown(null));
      entering.current = true;
      flushSync(() => setShown(screen));
    }, STEP_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [screen, shown]);
  useLayoutEffect(() => {
    const element = frame.current;
    if (entering.current && shown !== null && element) {
      entering.current = false;
      element.getAnimations().forEach((animation) => animation.cancel());
      play(element, [{ opacity: 0 }, { opacity: 1 }], STEP_FADE_MS);
    }
  }, [shown]);
  return (
    <div ref={frame} className="step-frame">
      {shown === null ? null : children(shown)}
    </div>
  );
}

// ---- overview -----------------------------------------------------------------------------------

function GrantDialog({ code, accounts, onDone }: { code: string; accounts: Collection<Account>; onDone: () => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const owners = accounts.items.filter((account) => account.role === "yacht-owner");
  const [owner, setOwner] = useState("");
  const [ends, setEnds] = useState("");
  const save = () =>
    form.run(async () => {
      const email = owner || owners[0]?.email;
      await sendJson<Grant>("POST", `/api/drawings/${code}/grants`, { owner_email: email, ends_at: ends.trim() === "" ? undefined : ends.trim() });
      say(SUCCESS.grant(owners.find((account) => account.email === email)?.display_name ?? ""));
      close(true);
      await onDone();
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Grant" busy={form.busy}>
      <SelectField label="Owner" value={owner || owners[0]?.email || ""} onChange={setOwner} options={owners.map((account) => ({ value: account.email, label: account.display_name }))} error={form.errors.owner_email} />
      <TextField label="Sight ends" value={ends} onChange={setEnds} error={form.errors.ends_at} hint="YYYY-MM-DDTHH:MM:SSZ, empty for no end" />
    </DialogForm>
  );
}

const hexKey = (): string => [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function PaymentDialog({ code, onDone }: { code: string; onDone: () => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const key = useRef(hexKey());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const save = () =>
    form.run(async () => {
      const pence = penceOfPounds(amount) ?? 0;
      const { data } = await sendJson<SailAccount>("POST", `/api/drawings/${code}/payments`, { amount_pence: pence, note }, { "idempotency-key": key.current });
      say(SUCCESS.payment(poundsText(pence), poundsText(data.balance_pence)));
      close(true);
      await onDone();
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Save payment" busy={form.busy}>
      <TextField label="Amount (£)" value={amount} onChange={setAmount} error={form.errors.amount_pence} inputMode="numeric" />
      <TextField label="Note" value={note} onChange={setNote} error={form.errors.note} />
    </DialogForm>
  );
}

function CreditDialog({ code, onDone }: { code: string; onDone: () => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const save = () =>
    form.run(async () => {
      const pence = penceOfPounds(amount) ?? 0;
      const { data } = await sendJson<SailAccount>("POST", `/api/drawings/${code}/credit-notes`, { amount_pence: pence, reason });
      say(SUCCESS.creditNote(poundsText(pence), poundsText(data.balance_pence)));
      close(true);
      await onDone();
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Save credit note" busy={form.busy}>
      <TextField label="Amount (£)" value={amount} onChange={setAmount} error={form.errors.amount_pence} inputMode="numeric" />
      <TextField label="Reason" value={reason} onChange={setReason} error={form.errors.reason} />
    </DialogForm>
  );
}

export function AccountRegion({ account, actions }: { account: SailAccount; actions?: ReactNode }) {
  const pence: Record<(typeof ACCOUNT_LINES)[number], number> = {
    "Cloth charge": account.charge_pence,
    "Tax at 20%": account.tax_pence,
    Total: account.total_pence,
    Deposit: account.deposit_pence,
    Paid: account.paid_pence,
    "Credit notes": account.credited_pence,
    Balance: account.balance_pence,
  };
  return (
    <section role="region" aria-label="Sail account" className="field-surface account">
      <div className="section-head">
        <h2>Sail account</h2>
        <Chip tone={account.status === "settled" ? "cobalt" : "ink"}>{ACCOUNT_CHIPS[account.status]}</Chip>
      </div>
      <dl className="account-lines">
        {ACCOUNT_LINES.map((label) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{`£${poundsText(pence[label])}`}</dd>
          </div>
        ))}
      </dl>
      {actions}
    </section>
  );
}

function Overview({ drawing, reload }: { drawing: Drawing; reload: () => Promise<Drawing | null> }) {
  const { say, setOutage, outage } = useLive();
  const { navigate } = useRouter();
  const submit = useSubmitter();
  const [dialog, setDialog] = useState<"grant" | "payment" | "credit" | null>(null);
  const hasAccount = ["cut", "pending_store", "issued"].includes(drawing.status);
  const account = useLoad((signal) => (hasAccount ? getJson<SailAccount>(`/api/drawings/${drawing.code}/account`, signal) : Promise.resolve(null)), [drawing.code, drawing.status]);
  const grants = useLoad((signal) => (drawing.status === "issued" ? getJson<Page<Grant>>(`/api/drawings/${drawing.code}/grants?limit=50`, signal) : Promise.resolve(null)), [drawing.code, drawing.status]);
  const people = useCollection<Account>("/api/accounts");
  const loftHands = people.items.filter((item) => item.role === "loft-hand");
  const [loftHand, setLoftHand] = useState("");
  const previous = useRef(drawing.status);

  useEffect(() => {
    if (previous.current === "pending_store" && drawing.status === "issued") say(SUCCESS.issued);
    previous.current = drawing.status;
    if (drawing.status === "pending_store") setOutage(OUTAGES.issuing);
    else if (outage === OUTAGES.issuing) setOutage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing.status]);
  usePoll(() => void reload(), 5, drawing.status === "pending_store");

  const issue = () =>
    submit.run(async () => {
      const { data, status } = await sendJson<Drawing>("POST", `/api/drawings/${drawing.code}/issue`);
      if (status === 200) {
        previous.current = data.status;
        say(SUCCESS.issued);
      }
      await reload();
    }, PENDING.issue);
  const revise = () =>
    submit.run(async () => {
      const { data } = await sendJson<Drawing>("POST", `/api/drawings/${drawing.code}/revise`);
      navigate(`/drawings/${data.code}`, { state: { focus: true } });
    }, PENDING.save);
  const assign = () =>
    submit.run(async () => {
      await sendJson<Drawing>("POST", `/api/drawings/${drawing.code}/assign`, { loft_hand_email: loftHand || drawing.assigned_to?.email || loftHands[0]?.email });
      say(SUCCESS.saved);
      await reload();
    }, PENDING.save);
  const withdraw = (grant: Grant) =>
    submit.run(async () => {
      await sendJson<Grant>("POST", `/api/grants/${grant.id}/withdraw`);
      say(SUCCESS.withdraw(grant.owner.display_name));
      await grants.reload();
    }, PENDING.save);

  return (
    <>
      <section className="field-surface">
        <div className="section-head">
          <PageHeading>{drawing.code}</PageHeading>
          <StatusChip status={drawing.status} />
        </div>
        <p className="muted">
          {`${drawing.boat_code} · ${drawing.boat_name} · ${sailLabel(drawing.sail)} on ${drawing.cloth_code}`}
          {drawing.lot ? ` · lot ${drawing.lot}` : ""}
          {drawing.predecessor ? ` · revises ${drawing.predecessor}` : ""}
        </p>
        {drawing.cut_sheet?.superseded_by ? <p className="banner-black">{supersededCopy(drawing.cut_sheet.superseded_by)}</p> : null}
        <div className="assign-row">
          <SelectField
            label="Loft hand"
            value={loftHand || drawing.assigned_to?.email || loftHands[0]?.email || ""}
            onChange={setLoftHand}
            options={loftHands.map((item) => ({ value: item.email, label: item.display_name }))}
          />
          <button type="button" className="button" onClick={() => void assign()} disabled={drawing.status === "pending_store" || drawing.status === "issued"}>
            Assign
          </button>
        </div>
        <div className="actions">
          {drawing.status === "cut" ? (
            <button type="button" className="button primary" aria-busy={submit.busy || undefined} onClick={() => void issue()}>
              Issue cut sheet
            </button>
          ) : null}
          {drawing.status === "issued" && !drawing.successor ? (
            <button type="button" className="button" onClick={() => void revise()}>
              Revise drawing
            </button>
          ) : null}
          {drawing.status === "issued" ? (
            <>
              <button type="button" className="button" onClick={() => setDialog("grant")}>
                Grant sight
              </button>
              {drawing.cut_sheet ? (
                <a className="button" href={`/api/cut-sheets/${drawing.cut_sheet.sha256}`} target="_blank" rel="noopener">
                  Open cut sheet
                </a>
              ) : null}
            </>
          ) : null}
        </div>
        {drawing.status === "issued" && grants.data ? (
          <ul className="grant-list">
            {grants.data.items
              .filter((grant) => grant.status === "granted")
              .map((grant) => (
                <li key={grant.id}>
                  <span>{`${grant.owner.display_name} · ${grant.id}`}</span>
                  <button type="button" className="button" onClick={() => void withdraw(grant)}>
                    {`Withdraw sight from ${grant.owner.display_name}`}
                  </button>
                </li>
              ))}
          </ul>
        ) : null}
      </section>
      {account.data ? (
        <AccountRegion
          account={account.data}
          actions={
            <div className="actions">
              <button type="button" className="button" onClick={() => setDialog("payment")}>
                Record payment
              </button>
              <button type="button" className="button" onClick={() => setDialog("credit")}>
                Issue credit note
              </button>
            </div>
          }
        />
      ) : null}
      {dialog === "grant" && people.ready ? (
        <Dialog title="Grant sight" onClose={() => setDialog(null)}>
          <GrantDialog code={drawing.code} accounts={people} onDone={async () => void (await grants.reload())} />
        </Dialog>
      ) : null}
      {dialog === "payment" ? (
        <Dialog title="Record payment" onClose={() => setDialog(null)}>
          <PaymentDialog code={drawing.code} onDone={async () => void (await account.reload())} />
        </Dialog>
      ) : null}
      {dialog === "credit" ? (
        <Dialog title="Credit note" onClose={() => setDialog(null)}>
          <CreditDialog code={drawing.code} onDone={async () => void (await account.reload())} />
        </Dialog>
      ) : null}
    </>
  );
}

// ---- the steps ------------------------------------------------------------------------------------

function MeasureStep({ drawing, reload }: { drawing: Drawing; reload: () => Promise<Drawing | null> }) {
  const boat = useLoad((signal) => getJson<Boat>(`/api/boats/${drawing.boat_code}`, signal), [drawing.boat_code]);
  const [open, setOpen] = useState(false);
  const used = drawing.sail === "mainsail" ? (["P", "E"] as const) : (["LL", "LP"] as const);
  const rows = (boat.data?.dimensions ?? []).filter((item) => used.includes(item.key as never));
  return (
    <>
      <section className="field-surface">
        <PageHeading>{`Measure ${drawing.code}`}</PageHeading>
        <p className="muted">{`${sailLabel(drawing.sail)} on ${drawing.boat_code} · ${drawing.boat_name}`}</p>
        <DataTable
          label="Used dimensions"
          headers={["Dimension", "Value", "Status", "Due"]}
          rows={rows.map((item) => ({
            key: item.key,
            cells: [item.key, dimensionCell(item), <Chip key="c" tone={item.status === "remeasure" ? "ink" : "plain"}>{item.status === "remeasure" ? "Remeasure" : "Measured"}</Chip>, item.remeasure_due ? `Remeasure by ${item.remeasure_due}` : ""],
          }))}
        />
        <div className="actions">
          <button type="button" className="button" onClick={() => setOpen(true)}>
            Record measurement
          </button>
        </div>
      </section>
      {open ? (
        <RecordMeasurementDialog
          boatCode={drawing.boat_code}
          dimensions={[...used]}
          onSaved={() => {
            void boat.reload();
            void reload();
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function DrawStep({ drawing, reload }: { drawing: Drawing; reload: () => Promise<Drawing | null> }) {
  const { say } = useLive();
  const { navigate } = useRouter();
  const layout = useLayout();
  const submit = useSubmitter();
  const [selected, setSelected] = useState<number | null>(null);
  const drawn = drawing.panels.length > 0;
  const panel = drawing.panels.find((item) => item.number === selected) ?? null;
  const draw = () =>
    submit.run(async () => {
      const { data } = await sendJson<Drawing>("POST", `/api/drawings/${drawing.code}/draw`);
      say(SUCCESS.draw(data.panels.length));
      await reload();
      navigate(`/drawings/${drawing.code}/nest`, { state: { focus: true } });
    }, PENDING.save);
  useEffect(() => {
    const clear = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, []);
  return (
    <>
      <PageHeading>{`Draw ${drawing.code}`}</PageHeading>
      <div className={`draw-layout draw-${layout}`}>
        <section role="region" aria-label="Sail drawing" className="canvas-field field-cobalt">
          {drawn ? (
            <SailCanvas panels={drawing.panels} label="Sail panels" mode="draw" selected={selected} onSelect={setSelected} rig={{ luff: drawing.luff_mm!, foot: drawing.foot_mm! }} />
          ) : (
            <EmptyState>{EMPTY.draw}</EmptyState>
          )}
        </section>
        <div className="draw-side">
          <section role="region" aria-label="Sail area" className="field-black area-field">
            <p className="poster-label">Sail area</p>
            <p className="poster">{drawing.area ? <UnitPair parts={areaParts(drawing.area.area_mm2)} stacked /> : "Not drawn"}</p>
            {drawing.area ? <p className="poster-basis">{drawing.area.basis}</p> : null}
          </section>
          <div className="field-surface draw-controls">
            <StatusChip status={drawing.status} />
            <button type="button" className="button primary" onClick={() => void draw()} aria-busy={submit.busy || undefined} disabled={drawing.status !== "measuring"}>
              Draw sail
            </button>
            {panel ? (
              <p className="panel-facts">
                {`Panel ${panel.number}: ${panel.length_mm} mm long, ${panel.width_mm} mm wide, ${panel.area_m2} m² (${panel.area_ft2} ft²)`}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function ConfirmStep({ drawing, reload }: { drawing: Drawing; reload: () => Promise<Drawing | null> }) {
  const nest = useLoad((signal) => loadNest(drawing.code, signal), [drawing.code, drawing.status]);
  const onCut = useCallback(
    (_result: CutResult) => {
      void nest.reload();
      void reload();
    },
    [nest, reload],
  );
  const cutting = useConfirmCut(drawing.code, onCut);
  const data: NestData | null = nest.data;
  const holds = (data?.claims ?? []).filter((claim) => claim.status === "held" && claim.lays.length > 0);
  const figureHold = holds[0] ?? null;
  return (
    <>
      <section className="field-surface">
        <PageHeading>{`Confirm ${drawing.code}`}</PageHeading>
        <DataTable
          label="Holds to cut"
          headers={["Stock", "Lot", "Used length", "Panels", "Confirm"]}
          rows={holds.map((claim) => ({
            key: claim.id,
            cells: [
              claim.stock_code,
              data?.stocks[claim.stock_code]?.lot ?? "",
              `${claim.used_mm} mm`,
              claim.lays.map((lay) => lay.panel_number).join(", "),
              <button key="b" type="button" className="button primary" aria-busy={cutting.busy || undefined} onClick={() => void cutting.confirm(claim.id)}>
                {`Confirm cut on ${claim.stock_code}`}
              </button>,
            ],
          }))}
        />
      </section>
      <RollRemaining figures={figureHold && data ? (data.stocks[figureHold.stock_code] ?? null) : null} offcuts={data?.summary.offcuts ?? 0} />
    </>
  );
}

// ---- the page ---------------------------------------------------------------------------------------

export function DrawingPage({ code, screen }: { code: string; screen: ScreenName }) {
  const { navigate } = useRouter();
  const { refuse } = useLive();
  const drawing = useLoad((signal) => getJson<Drawing>(`/api/drawings/${code}`, signal), [code]);
  const reload = useCallback(async () => drawing.reload(), [drawing]);
  const data = drawing.data;
  const step: Step | null = screen === "drawing" ? null : (screen as Step);
  const reachedIndex = data?.step ? STEPS.indexOf(data.step) : 0;

  useEffect(() => {
    if (!data || !step || !data.step) return;
    if (STEPS.indexOf(step) > reachedIndex) {
      refuse(stepCopy(STEP_NAMES[data.step]));
      navigate(`/drawings/${code}/${data.step}`, { replace: true, state: { focus: true, alert: true } });
    }
  }, [data, step, reachedIndex, code, navigate, refuse]);

  if (drawing.error?.status === 404) return <NotFound />;
  const onDrawing = (next: Drawing) => drawing.set(next);

  const body = (shown: ScreenName): ReactNode => {
    if (!data) return null;
    switch (shown) {
      case "measure": return <MeasureStep drawing={data} reload={reload} />;
      case "draw": return <DrawStep drawing={data} reload={reload} />;
      case "nest":
        return (
          <>
            <PageHeading>{`Nest ${code}`}</PageHeading>
            <Nesting code={code} onDrawing={onDrawing} onCut={() => void reload()} />
          </>
        );
      case "confirm": return <ConfirmStep drawing={data} reload={reload} />;
      default: return <Overview drawing={data} reload={reload} />;
    }
  };

  return (
    <main className="page">
      <Rail code={code} drawing={data} current={step} />
      {data ? <StepFrame screen={screen}>{body}</StepFrame> : <PageHeading>{screen === "drawing" ? code : `${STEP_NAMES[screen as Step]} ${code}`}</PageHeading>}
    </main>
  );
}
