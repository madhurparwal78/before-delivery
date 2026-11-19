import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiFailure, del, get, type Farm, type Pen, isDefect } from "../api";
import { TwinStill } from "../charts";
import { gradeLine } from "../format";
import { recentPens } from "../recent";
import { useLive, useShell } from "../shell";
import { ArrowIcon, Confirm, Dialog, ErrorLine, Link, useDialog } from "../ui";

interface Data { pens: Pen[]; details: Record<string, Pen>; farms: Farm[] }

export function PensPage() {
  const shell = useShell();
  const [data, setData] = useState<Data | null>(null);
  const [farmOpen, setFarmOpen] = useState<string | null>(null);
  const [erasing, setErasing] = useState<string | null>(null);
  const [eraseError, setEraseError] = useState("");
  const [pending, setPending] = useState(false);
  const pendingFocus = useRef<string | null>(null);
  const alive = useRef(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [pens, farms] = await Promise.all([get<{ pens: Pen[] }>("/api/pens", { silent: true }), get<{ farms: Farm[] }>("/api/farms", { silent: true })]);
      const details: Record<string, Pen> = {};
      await Promise.all(pens.pens.map(async (pen) => { details[pen.id] = (await get<{ pen: Pen }>(`/api/pens/${pen.id}`, { silent: true })).pen; }));
      if (alive.current && mine === seq.current) setData({ pens: pens.pens, details, farms: farms.farms });
    } catch {
      /* the next live event or visit loads again */
    }
  }, []);

  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  /** When the erased farm's card or Farm details button holds focus (or `own` is that button), focus moves to the item before it. */
  const planFocus = (farmId: string, own: boolean) => {
    const items = [...document.querySelectorAll<HTMLElement>("[data-nav-item]")];
    const held = own ? items.find((el) => el.dataset.navItem === `farm:${farmId}`) : items.find((el) => el === document.activeElement && el.dataset.farm === farmId);
    if (!held) return;
    const before = items[items.indexOf(held) - 1];
    pendingFocus.current = before ? before.dataset.navItem ?? null : null;
  };

  useLive((event) => {
    if (event.type === "farm.erased" && event.farm_id) {
      if (event.device_id !== shell.deviceId) planFocus(event.farm_id, false);
      void load();
    } else if (event.type.startsWith("defect.") || event.type === "revision.published" || event.type === "import.created" || event.type === "resync") {
      void load();
    }
  });

  useLayoutEffect(() => {
    if (!data || !pendingFocus.current) return;
    document.querySelector<HTMLElement>(`[data-nav-item="${pendingFocus.current}"]`)?.focus();
    pendingFocus.current = null;
  }, [data]);

  useEffect(() => {
    if (!data || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [data]);

  if (!data) return <PensSkeleton />;
  const known = new Set(data.pens.map((p) => p.id));
  const openId = recentPens().find((id) => known.has(id)) ?? "skv-01";
  const farm = data.farms.find((f) => f.id === farmOpen);
  const erase = data.farms.find((f) => f.id === erasing);

  const doErase = async (typed: string) => {
    if (!erase || pending) return;
    const target = erase;
    setPending(true);
    setEraseError("");
    shell.announce("Erasing…");
    try {
      await del(`/api/farms/${target.id}`, { confirm_name: typed });
      planFocus(target.id, true);
      shell.announce(`Erased ${target.name}`);
      setErasing(null);
      setFarmOpen(null);
      await load();
    } catch (error) {
      shell.announce("");
      if (error instanceof ApiFailure) setEraseError(error.fields?.confirm_name ?? error.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="pens-page">
      <h1 className="visually-hidden">Pens</h1>
      <PenCard pen={data.pens.find((p) => p.id === openId) ?? data.pens[0]} detail={data.details[openId] ?? data.details[data.pens[0].id]} open seed={0} />
      <div className="card-grid">
        {data.pens.map((pen, index) => <PenCard key={pen.id} pen={pen} detail={data.details[pen.id]} seed={index} />)}
      </div>
      <section className="farms-band" aria-label="Farms">
        <h2>Farms</h2>
        {data.farms.map((f) => (
          <div className="farm-row" key={f.id} id={`farm-${f.id}`}>
            <div>
              <h3>{f.name}</h3>
              <p className="muted">{f.sites.map((s) => `${s.name} (${s.code})`).join(", ")}</p>
            </div>
            <button type="button" className="btn" data-nav-item={`farm:${f.id}`} data-farm={f.id} aria-label={`Farm details: ${f.name}`} onClick={() => setFarmOpen(f.id)}>Farm details</button>
          </div>
        ))}
      </section>
      {farm && (
        <Dialog title="Farm details" onClose={() => setFarmOpen(null)} className="dialog-wide">
          <h2>{farm.name}</h2>
          <ul className="plain">
            {farm.sites.map((s) => (
              <li key={s.code}>{s.name} <span className="muted">{s.code}</span> <span className="num">{s.latitude.toFixed(4)}° N, {s.longitude.toFixed(4)}° E</span></li>
            ))}
          </ul>
          <p className="num">{`${farm.day_rate.amount} ${farm.day_rate.currency} per day`}</p>
          <div className="dialog-actions">
            <CloseDialogButton />
            <button type="button" className="btn btn-solid" onClick={() => { setEraseError(""); setErasing(farm.id); }}>Erase farm</button>
          </div>
        </Dialog>
      )}
      {erase && (
        <EraseDialog name={erase.name} pending={pending} error={eraseError} onErase={doErase} onClose={() => setErasing(null)} />
      )}
    </div>
  );
}

function CloseDialogButton() {
  const dialog = useDialog();
  return <button type="button" className="btn" onClick={() => dialog?.close()}>Close</button>;
}

function EraseDialog({ name, pending, error, onErase, onClose }: { name: string; pending: boolean; error: string; onErase: (typed: string) => void; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  return (
    <Confirm title="Erase farm" action="Erase" pending={pending} error={error} onConfirm={() => onErase(typed)} onClose={onClose}
      message={<>This removes {name}, its pens, defects, reports and files for good.</>}>
      <label className="field">
        <span>Type the farm name to confirm</span>
        <input type="text" aria-label="Type the farm name to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
    </Confirm>
  );
}

function PenCard({ pen, detail, open, seed }: { pen: Pen; detail?: Pen; open?: boolean; seed: number }) {
  const pins = (detail?.defects ?? []).filter(isDefect).map((d) => ({ id: d.id, chart_x_m: d.chart_x_m, depth_m: d.depth_m, bearing_deg: d.bearing_deg }));
  return (
    <Link
      to={`/pens/${pen.id}`}
      className={open ? "card card-open" : "card"}
      aria-label={open ? `Open pen ${pen.name}` : pen.name}
      data-nav-item={open ? `open:${pen.id}` : `card:${pen.id}`}
      data-farm={pen.farm_id}
    >
      <div className="card-media"><TwinStill name={pen.name} geo={pen} pins={pins} seed={seed} /></div>
      <div className="card-scrim" />
      <span className="card-text">
        <span className="card-title">{pen.name}</span>
        <span className="card-grade">{gradeLine(pen.grade, pen.open_defects)}</span>
      </span>
      <ArrowIcon className="card-arrow" />
    </Link>
  );
}

function PensSkeleton() {
  return (
    <div className="pens-page" aria-hidden="true">
      <div className="skeleton card-open-skeleton" />
      <div className="card-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton card-skeleton" />)}</div>
    </div>
  );
}
