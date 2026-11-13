// The Shot Rig page: uploads and scale check, the 3D rig with its shot list and live quote, and the deposit.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api, toSignIn, type Engagement, type IntakeFile, type Quote, type Service } from "../api";
import { Dialog } from "../components/Dialog";
import { PayDialog } from "../components/PayDialog";
import { clearOutage, flagOutage, Shell } from "../components/Shell";
import { loadContent } from "../content";
import { reducedMotion } from "../motion";
import { RigController, type QuoteView, type Shot } from "../rig/controller";
import { RigScene } from "../three/rigScene";
import { fileSize, inchReadout, intakeStatus, metreReadout, mmReadout } from "../words";
import { formatMoney } from "../../shared/money";
import { fxLine } from "../../shared/format";
import { NotFound } from "./Public";

type LocalRow = { key: string; name: string; size: number; state: "uploading" | "rejected" | "not_saved"; progress: number };
type Unit = "as_exported" | "mm" | "cm" | "in";
const UNITS: [Unit, string][] = [
  ["as_exported", "As exported (metres)"],
  ["mm", "Millimetres"],
  ["cm", "Centimetres"],
  ["in", "Inches"],
];
const MEASURE_FAILED = "That GLB couldn't be measured. Re-export it as binary glTF 2.0 and upload it again.";

const currentModel = (files: IntakeFile[]): IntakeFile | null => files.filter((f) => f.kind === "model" && f.status === "received").at(-1) ?? null;
const readout = (file: IntakeFile | null): { mm: string; inch: string } | null =>
  file && file.measurement === "measured" && file.unit && file.dimensions_mm ? { mm: mmReadout(file.dimensions_mm), inch: inchReadout(file.dimensions_mm) } : null;

function upload(path: string, file: File, onProgress: (percent: number) => void): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.floor((event.loaded / event.total) * 100));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText) as unknown;
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => resolve({ status: 0, body: { error: "network", message: "The connection dropped. Check it and try again." } });
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

export function RigPage({ id }: { id: string }) {
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState<QuoteView | null>(null);
  const [quoteNote, setQuoteNote] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [unitFor, setUnitFor] = useState<IntakeFile | null>(null);
  const [unitChoice, setUnitChoice] = useState<Unit>("mm");
  const [paying, setPaying] = useState(false);
  const [depositDone, setDepositDone] = useState(false);
  const controller = useRef<RigController | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pip = useRef<HTMLElement>(null);
  const pipLabel = useRef<HTMLElement>(null);
  const rigFocus = useRef<HTMLParagraphElement>(null);
  const numerals = { total: useRef<HTMLSpanElement>(null), deposit: useRef<HTMLSpanElement>(null), look_dev: useRef<HTMLSpanElement>(null), final: useRef<HTMLSpanElement>(null) };
  const barTotal = useRef<HTMLSpanElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const payButton = useRef<HTMLButtonElement>(null);
  const unitOpener = useRef<HTMLElement | null>(null);
  const autoOpened = useRef(new Set<string>());
  const known = useRef(new Map<string, string>());
  const queueChain = useRef(Promise.resolve());
  const scene = useRef<RigScene | null>(null);
  const reduced = reducedMotion();

  const load = useCallback(async (): Promise<Engagement | null> => {
    const reply = await api<Engagement>("GET", `/api/engagements/${id}`);
    if (reply.status === 401) {
      toSignIn();
      return null;
    }
    if (reply.status === 404) {
      setMissing(true);
      return null;
    }
    if (!reply.ok) return null;
    setEngagement(reply.data);
    return reply.data;
  }, [id]);

  useEffect(() => {
    void load();
    void loadContent().then((content) => "services" in content && setServices(content.services));
  }, [load]);

  // The rig starts once the engagement and the shot catalogue are both known.
  useEffect(() => {
    if (!engagement || !services || controller.current || !group.current || !canvas.current || !pip.current || !pipLabel.current || !rigFocus.current || !barTotal.current) return;
    const shots: Shot[] = services.map((s) => ({ code: s.code, title: s.title, azimuth: s.azimuth_deg, elevation: s.elevation_deg, listPrice: s.list_price_pence }));
    const rig = new RigScene(canvas.current, () => pip.current?.getBoundingClientRect() ?? null);
    scene.current = rig;
    const made = new RigController(engagement.id, shots, engagement.quote, reduced, setView, setQuoteNote);
    controller.current = made;
    const n = numerals;
    if (!n.total.current || !n.deposit.current || !n.look_dev.current || !n.final.current) return;
    made.attach({
      group: group.current,
      pip: pip.current,
      pipLabel: pipLabel.current,
      rigFocus: rigFocus.current,
      numerals: { total: n.total.current, deposit: n.deposit.current, look_dev: n.look_dev.current, final: n.final.current },
      barTotal: barTotal.current,
      scene: rig,
    });
    setView({ quote: engagement.quote, desired: new Map(), busy: false });
    return () => made.detach();
  }, [engagement !== null, services !== null]);

  // R resets the orbit from the rig, the shot checkboxes, Upload files, Check unit buttons and Pay deposit only.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.key !== "r" && event.key !== "R") || event.metaKey || event.ctrlKey || event.altKey) return;
      const here = document.activeElement;
      if (here instanceof HTMLElement && here.closest("[data-orbit-reset]") === here) controller.current?.resetOrbit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // The model on the plinth follows the current model and its unit decision; measurement news is announced once.
  const model = engagement ? currentModel(engagement.files) : null;
  useEffect(() => {
    if (!engagement) return;
    const measured = model && model.measurement === "measured" && !model.needs_unit_confirmation ? model : null;
    scene.current?.setModel(measured ? `/api/engagements/${engagement.id}/files/${measured.id}/content` : null, measured?.dimensions_m ?? null, measured?.dimensions_mm ?? null);
    for (const file of engagement.files.filter((f) => f.kind === "model")) {
      const before = known.current.get(file.id);
      const now = `${file.measurement}:${file.unit ?? ""}`;
      known.current.set(file.id, now);
      if (before === undefined || before === now) continue;
      if (file.measurement === "failed") setUploadNote(`${file.name}: ${MEASURE_FAILED}`);
      else if (file.measurement === "measured" && file.needs_unit_confirmation) setUploadNote(`Check the export unit for ${file.name}.`);
      else if (file.measurement === "measured" && file.dimensions_mm) setUploadNote(`Measurement complete: ${mmReadout(file.dimensions_mm)} · ${inchReadout(file.dimensions_mm)}.`);
    }
    if (model?.measurement === "measured" && model.needs_unit_confirmation && !autoOpened.current.has(model.id)) {
      autoOpened.current.add(model.id);
      unitOpener.current = null;
      setUnitChoice("mm");
      setUnitFor(model);
    }
  }, [engagement, services !== null]);

  // While a measurement is pending (2 s) or delayed (10 s) the page re-reads the engagement.
  const waiting = model?.measurement === "pending" ? 2_000 : model?.measurement === "delayed" ? 10_000 : 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => void load(), waiting);
    return () => window.clearTimeout(timer);
  }, [waiting, engagement]);

  if (missing) return <NotFound />;

  const quote: Quote | null = view?.quote ?? engagement?.quote ?? null;
  const shots = services ?? [];
  const lineOf = (code: string) => quote?.lines.find((l) => l.shot_code === code) ?? null;
  const selected = (code: string): boolean => {
    const want = view?.desired.get(code);
    return want !== undefined ? want !== null : lineOf(code) !== null;
  };
  const quantity = (code: string): number => {
    const want = view?.desired.get(code);
    return typeof want === "number" ? want : lineOf(code)?.quantity ?? 1;
  };
  const titleOf = (service: Service): string => lineOf(service.code)?.title ?? service.title;
  const money = (minor: number): string => (quote ? formatMoney(minor, quote.currency) : "");

  const chooseFiles = (list: FileList | null): void => {
    if (!list) return;
    const files = [...list];
    const added = files.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, name: file.name, size: file.size, state: "uploading" as const, progress: 0 }));
    setRows((current) => [...current, ...added]);
    files.forEach((file, i) => {
      const key = added[i]?.key ?? "";
      queueChain.current = queueChain.current.then(async () => {
        let step = -1;
        const result = await upload(`/api/engagements/${id}/files`, file, (percent) => {
          setRows((current) => current.map((r) => (r.key === key ? { ...r, progress: percent } : r)));
          if (Math.floor(percent / 10) > step) {
            step = Math.floor(percent / 10);
            setUploadNote(`Uploading ${file.name}: ${percent}%`);
          }
        });
        const body = result.body as { name?: string; error?: string; message?: string } | null;
        if (result.status === 201) {
          clearOutage("storage");
          const created = result.body as { id?: string } | null;
          if (created?.id) known.current.set(created.id, "uploaded");
          setRows((current) => current.filter((r) => r.key !== key));
          setUploadNote(`${body?.name ?? file.name} received.`);
          await load();
        } else {
          flagOutage(body?.error ?? "");
          setRows((current) => current.map((r) => (r.key === key ? { ...r, state: result.status === 503 ? "not_saved" : "rejected" } : r)));
          setUploadNote(`${file.name}: ${body?.message ?? "The upload failed."}`);
        }
      });
    });
  };

  const closeUnit = (): void => {
    const file = unitFor;
    setUnitFor(null);
    const target = unitOpener.current ?? (file ? document.querySelector<HTMLElement>(`[data-file-row="${file.id}"]`) : null);
    target?.focus();
  };
  const useUnit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!unitFor) return;
    const reply = await api<IntakeFile>("PUT", `/api/engagements/${id}/files/${unitFor.id}/unit`, { unit: unitChoice });
    if (!reply.ok) {
      setUploadNote(`${unitFor.name}: ${reply.failure.message}`);
      return;
    }
    closeUnit();
    await load();
  };

  const depositMinor = quote?.milestones.deposit_minor ?? 0;
  const scale = readout(model);

  return (
    <Shell banner={["billing", "storage", "email", "measuring", "documents"]}>
      <div class="wrap rig-page">
        <div class="rig-layout">
          <div class="rig-intro">
            <div>
              <span class="eyebrow">{engagement ? `${engagement.reference} · ${engagement.title}` : "Shot Rig"}</span>
              <h1>Shot Rig</h1>
            </div>
            <p class="muted">Upload your GLB, check its scale, then choose shots around your own model.</p>
          {depositDone && engagement && quote && (
            <div class="deposit-done">
              <h2>Deposit received</h2>
              <p>A receipt for this deposit goes to {engagement.finance_email}.</p>
              <p>{fxLine(quote.currency, quote.fx_rate, quote.fx_locked, quote.fx_locked_at)}</p>
              <p>
                Deposit {money(quote.milestones.deposit_minor)} · Look-dev {money(quote.milestones.look_dev_minor)} · Final delivery {money(quote.milestones.final_delivery_minor)}
              </p>
            </div>
          )}
          </div>
          <div class="upload-controls">
              <button type="button" class="button" ref={uploadButton} data-orbit-reset onClick={() => fileInput.current?.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
                </svg>
                Upload files
              </button>
              <input
                type="file"
                multiple
                class="sr-only"
                tabindex={-1}
                aria-label="Product files"
                accept=".glb,.step,.stp,.pdf"
                ref={fileInput}
                onChange={(event) => {
                  chooseFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              <p class="muted" style={{ margin: 0 }}>
                GLB, STEP or PDF.
              </p>
            </div>
          <div class="rig-right">
            <div
              class="rig-group"
              role="group"
              aria-label="Shot Rig"
              aria-describedby="rig-help"
              tabindex={0}
              ref={group}
              data-orbit-reset
              data-frustum-count="0"
              data-focused-shot="hero_front"
              data-rig-phase="idle"
              data-orbit-azimuth="0"
              onKeyDown={(event) => {
                const c = controller.current;
                if (!c) return;
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  c.moveFocus(1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  c.moveFocus(-1);
                } else if (event.key === " ") {
                  event.preventDefault();
                  c.toggle(c.focusedShot());
                }
              }}
              onPointerDown={(event) => {
                const target = event.currentTarget;
                const start = { x: event.clientX, y: event.clientY, last: event.clientX, horizontal: event.pointerType === "mouse" ? true : null as boolean | null };
                const move = (e: PointerEvent): void => {
                  if (start.horizontal === null && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) start.horizontal = Math.abs(e.clientX - start.x) > Math.abs(e.clientY - start.y);
                  if (start.horizontal) controller.current?.orbitBy((e.clientX - start.last) * 0.4);
                  start.last = e.clientX;
                };
                const end = (): void => {
                  target.removeEventListener("pointermove", move);
                  target.removeEventListener("pointerup", end);
                  target.removeEventListener("pointercancel", end);
                };
                target.addEventListener("pointermove", move);
                target.addEventListener("pointerup", end);
                target.addEventListener("pointercancel", end);
              }}
            >
              <canvas class="rig-canvas" ref={canvas} aria-hidden="true" />
              <p class="rig-hud" id="rig-help">
                Arrow keys move between cameras, Space selects, R resets the view. Drag to orbit.
              </p>
              <figure class="camera-view" aria-label="Camera view" ref={pip} data-pip-shot="overview">
                <figcaption ref={pipLabel}>Overview</figcaption>
              </figure>
            </div>
          </div>
            <ul class="shots-list" aria-label="Shots">
              {shots.map((service) => (
                <li key={service.code}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected(service.code)}
                      data-orbit-reset
                      onClick={(event) => {
                        event.preventDefault();
                        controller.current?.toggle(service.code);
                      }}
                    />
                    {titleOf(service)}
                  </label>
                  {selected(service.code) && (
                    <input
                      type="number"
                      class="spin"
                      min={1}
                      max={6}
                      step={1}
                      aria-label={`Colourways for ${titleOf(service)}`}
                      value={String(quantity(service.code))}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                          event.preventDefault();
                          const next = Math.min(6, Math.max(1, quantity(service.code) + (event.key === "ArrowUp" ? 1 : -1)));
                          if (next !== quantity(service.code)) controller.current?.setQuantity(service.code, next);
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          controller.current?.setQuantity(service.code, Number(event.currentTarget.value));
                        }
                      }}
                      onChange={(event) => {
                        const typed = Number(event.currentTarget.value);
                        if (typed !== quantity(service.code)) controller.current?.setQuantity(service.code, typed);
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
            <section
              class="quote-region"
              aria-label="Quote"
              tabindex={0}
              aria-busy={view?.busy ? "true" : "false"}
              data-quote-revision={view ? String(view.quote.revision) : undefined}
            >
              <h2 class="eyebrow" style={{ margin: 0 }}>
                Quote
              </h2>
              <div class="quote-total" data-value-minor={quote ? String(quote.total_minor) : undefined}>
                <span ref={numerals.total} />
              </div>
              <dl class="figures">
                <dt>Subtotal</dt>
                <dd data-value-minor={quote ? String(quote.subtotal_minor) : undefined}>{quote ? money(quote.subtotal_minor) : ""}</dd>
                <dt>VAT (20%)</dt>
                <dd data-value-minor={quote ? String(quote.vat_minor) : undefined}>{quote ? money(quote.vat_minor) : ""}</dd>
                <dt>Deposit (40%)</dt>
                <dd data-value-minor={quote ? String(quote.milestones.deposit_minor) : undefined}>
                  <span ref={numerals.deposit} />
                </dd>
                <dt>Look-dev (30%)</dt>
                <dd data-value-minor={quote ? String(quote.milestones.look_dev_minor) : undefined}>
                  <span ref={numerals.look_dev} />
                </dd>
                <dt>Final delivery</dt>
                <dd data-value-minor={quote ? String(quote.milestones.final_delivery_minor) : undefined}>
                  <span ref={numerals.final} />
                </dd>
              </dl>
              <p class="fx-line">{quote ? fxLine(quote.currency, quote.fx_rate, quote.fx_locked, quote.fx_locked_at) : ""}</p>
            </section>
            <div class="pay-bar">
              <span class="bar-total" aria-hidden="true" ref={barTotal} />
              <button type="button" class="button primary" ref={payButton} data-orbit-reset onClick={() => setPaying(true)}>
                Pay deposit
              </button>
            </div>
          <div class="rig-under">
            <section aria-label="Product scale">
              {scale ? (
                <p class="scale-readout">
                  <span class="numerals">{scale.mm}</span>
                  <br />
                  <span class="numerals">{scale.inch}</span>
                </p>
              ) : (
                <div class="empty">
                  <svg viewBox="0 0 120 60" aria-hidden="true">
                    <ellipse cx="50" cy="44" rx="40" ry="8" fill="none" stroke="#f3eee6" stroke-opacity="0.4" />
                    <rect x="94" y="38" width="22" height="12" fill="none" stroke="#f3eee6" stroke-opacity="0.6" />
                  </svg>
                  <p>Upload a GLB to see it at true scale.</p>
                </div>
              )}
            </section>
            <div class="table-scroll">
              <table aria-label="Shot positions" tabindex={0}>
                <thead>
                  <tr>
                    <th scope="col">Shot</th>
                    <th scope="col" class="num">
                      Azimuth
                    </th>
                    <th scope="col" class="num">
                      Elevation
                    </th>
                    <th scope="col" class="num">
                      Price
                    </th>
                    <th scope="col">Selected</th>
                  </tr>
                </thead>
                <tbody>
                  {shots.map((service) => {
                    const line = lineOf(service.code);
                    return (
                      <tr key={service.code}>
                        <td>{titleOf(service)}</td>
                        <td class="num">{service.azimuth_deg}°</td>
                        <td class="num">{service.elevation_deg}°</td>
                        <td class="num">{formatMoney(line ? line.unit_price_gbp_minor : service.list_price_pence, "GBP")}</td>
                        <td>{line ? "Yes" : "No"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <h2 class="eyebrow">Intake files</h2>
            <ul class="intake-list" aria-label="Intake files">
              {engagement?.files.map((file) => (
                <li key={file.id} tabindex={-1} data-file-row={file.id}>
                  <span>{file.name}</span>
                  <span class="status-word" data-status={file.status}>
                    {intakeStatus(file)}
                  </span>
                  <span class="row-meta">
                    <span class="num">{fileSize(file.size_bytes)}</span>
                    {file.id === model?.id && file.measurement !== "failed" && (
                      <span>{file.measurement === "measured" ? "Measured" : file.measurement === "delayed" ? "Measuring is delayed" : "Measuring"}</span>
                    )}
                    {file.id === model?.id && file.needs_unit_confirmation && (
                      <button
                        type="button"
                        class="button"
                        data-orbit-reset
                        onClick={(event) => {
                          unitOpener.current = event.currentTarget;
                          setUnitChoice("mm");
                          setUnitFor(file);
                        }}
                      >
                        Check unit
                      </button>
                    )}
                  </span>
                </li>
              ))}
              {rows.map((row) => (
                <li key={row.key} tabindex={-1}>
                  <span>{row.name}</span>
                  <span class="status-word" data-status={row.state}>
                    {row.state === "uploading" ? `Uploading ${row.progress}%` : row.state === "rejected" ? "Rejected" : "Not saved"}
                  </span>
                  <span class="row-meta">
                    <span class="num">{fileSize(row.size)}</span>
                  </span>
                  {row.state === "uploading" && (
                    <span class="progress" aria-hidden="true">
                      <i style={{ width: `${row.progress}%` }} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {engagement && engagement.files.length === 0 && rows.length === 0 && <p class="muted">No files yet.</p>}
          </div>
        </div>
        <p class="sr-only" role="status" aria-label="Upload progress">
          {uploadNote}
        </p>
        <p class="sr-only" role="status" aria-label="Quote updates">
          {quoteNote}
        </p>
        <p class="sr-only" role="status" aria-label="Rig focus" ref={rigFocus} />
      </div>
      {unitFor && unitFor.dimensions_m && (
        <Dialog title="Check the export unit" onClose={closeUnit}>
          <form noValidate onSubmit={useUnit}>
            <p>
              {unitFor.name} measures {metreReadout(unitFor.dimensions_m)} as exported. glTF is defined in metres; if your CAD exported in another unit, choose it here.
            </p>
            <div class="field">
              <span class="label" id="unit-legend">
                Export unit
              </span>
              <div class="radio-row" role="radiogroup" aria-labelledby="unit-legend">
                {UNITS.map(([value, label]) => (
                  <label key={value}>
                    <input type="radio" name="unit" value={value} checked={unitChoice === value} onChange={() => setUnitChoice(value)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div class="actions">
              <button type="submit" class="button primary">
                Use this unit
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {paying && quote && (
        <PayDialog<{ engagement: Engagement }>
          title="Pay deposit"
          payLabel={`Pay ${money(depositMinor)}`}
          path={`/api/engagements/${id}/deposit`}
          onClose={() => {
            setPaying(false);
            payButton.current?.focus();
          }}
          onPaid={(data) => {
            setPaying(false);
            setEngagement(data.engagement);
            controller.current?.adopt(data.engagement.quote);
            setDepositDone(true);
            clearOutage("email");
          }}
        />
      )}
    </Shell>
  );
}
