import { Download, GitCompareArrows, Heart } from "lucide-react";
import { useEffect, useId, useState, type FormEvent, type MouseEvent } from "react";
import { ownLux, poolDiameterMm, REFERENCE_CEILING_MM } from "../../shared/lightpool";
import type { Order, Product as ProductData, ProjectSummary, Variant } from "../../shared/types";
import { CompareTray } from "../components/CompareTray";
import { Dialog } from "../components/Dialog";
import { Dock } from "../components/Dock";
import { Drawer } from "../components/Drawer";
import { FittingDrawing } from "../components/Drawings";
import { FittingStage } from "../components/Fitting3D";
import { request } from "../lib/api";
import { familyLabel, fittingKind, FINISH_COLOURS, LIGHT_COLOURS, plusGst, stockBadge, tierPrice, variantByCode, type FittingKind } from "../lib/format";
import { useCountUp, usePhone } from "../lib/hooks";
import { navigate, replaceQuery, useLocation } from "../lib/router";
import { useFavourites } from "../lib/favourites";
import { useSession } from "../lib/session";
import { addToTray, removeFromTray, useTray } from "../lib/tray";
import { NotFound } from "./NotFound";

const MOUNTING: Record<FittingKind, string> = {
  recessed: "Recessed into the ceiling, deep-set lens",
  track: "Mounted on three-circuit track, rotating and tilting head",
  pendant: "Suspended on a cord from a ceiling canopy",
  cylinder: "Surface mounted to the ceiling",
  gimbal: "Recessed, adjustable gimbal",
};

type Dimension = "finish" | "beam" | "cct";

function matches(variant: Variant, dimension: Dimension, value: string | number, current: Variant): boolean {
  return (
    (dimension === "finish" ? variant.finish === value : variant.finish === current.finish) &&
    (dimension === "beam" ? variant.beam_deg === value : variant.beam_deg === current.beam_deg) &&
    (dimension === "cct" ? variant.cct_k === value : variant.cct_k === current.cct_k)
  );
}

function Figure({ label, value, format }: { label: string; value: number; format: (n: number) => string }) {
  const shown = useCountUp(value);
  return (
    <div className="readout__item">
      <dt>{label}</dt>
      <dd className="mono">{format(shown)}</dd>
    </div>
  );
}

function TradePrice({ trade, retail }: { trade: number; retail: number }) {
  const shownTrade = useCountUp(trade);
  return (
    <div className="readout__item readout__item--price">
      <dt>Price</dt>
      <dd className="mono">
        Trade {plusGst(shownTrade)}
        <span className="readout__rrp">RRP {plusGst(retail)}</span>
      </dd>
    </div>
  );
}

function Picker<T extends string | number>({
  label,
  options,
  selected,
  available,
  render,
  onPick,
}: {
  label: string;
  options: T[];
  selected: T;
  available: (option: T) => boolean;
  render: (option: T) => { text: string; swatch?: string };
  onPick: (option: T) => void;
}) {
  const name = useId();
  return (
    <fieldset role="radiogroup" aria-label={label} className="picker">
      <legend className="picker__legend">{label}</legend>
      <div className="picker__options">
        {options.map((option) => {
          const { text, swatch } = render(option);
          const disabled = !available(option);
          return (
            <label key={String(option)} className={`picker__option ${disabled ? "is-disabled" : ""}`}>
              <input
                type="radio"
                name={name}
                checked={option === selected}
                disabled={disabled}
                onChange={() => onPick(option)}
              />
              {swatch && <span className="swatch" style={{ background: swatch }} aria-hidden="true" />}
              <span>{text}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Product({ slug }: { slug: string }) {
  const { search } = useLocation();
  const session = useSession();
  const phone = usePhone();
  const tray = useTray();
  const favourites = useFavourites();
  const [product, setProduct] = useState<ProductData | null>(null);
  const [missing, setMissing] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState("");
  const [projectStatus, setProjectStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);

  useEffect(() => {
    void request<{ product: ProductData }>(`/api/products/${encodeURIComponent(slug)}`).then((reply) => {
      if (reply.ok) setProduct(reply.data.product);
      else setMissing(true);
    });
  }, [slug, session.user]);

  useEffect(() => {
    if (product) document.title = `${product.name} · Lightfall`;
  }, [product]);

  if (missing) return <NotFound />;

  const shown = product ? variantByCode(product, search.get("variant")) : null;
  // The stage is in the same place while loading and once loaded, so the 3D view starts at once and is kept.
  const stage = (
    <div className="product__stage">
      <FittingStage
        productName={product?.name ?? null}
        code={shown?.code ?? null}
        finish={shown?.finish ?? "WH"}
        beam={shown?.beam_deg ?? 36}
        cct={shown?.cct_k ?? 3000}
      />
    </div>
  );
  if (!product || !shown) {
    return (
      <div className="product page-docked">
        <div className="product__layout">
          {stage}
          <section className="product__spec" aria-busy="true" />
        </div>
      </div>
    );
  }

  const variant = shown;
  const price = tierPrice(variant, session.seesTrade);
  const kind = fittingKind(variant.code);
  const inTray = tray.items.some((item) => item.code === variant.code);
  const saved = favourites.isSaved(product.slug);
  const badge = stockBadge(variant);
  const finishes = [...new Map(product.variants.map((v) => [v.finish, v.finish_name]))];
  const beams = [...new Set(product.variants.map((v) => v.beam_deg))].sort((a, b) => a - b);
  const ccts = [...new Set(product.variants.map((v) => v.cct_k))].sort((a, b) => a - b);
  const available = (dimension: Dimension) => (value: string | number) =>
    product.variants.some((v) => matches(v, dimension, value, variant));

  const pick = (dimension: Dimension, value: string | number) => {
    const next = product.variants.find((v) => matches(v, dimension, value, variant));
    if (!next) return;
    const params = new URLSearchParams(location.search);
    params.set("variant", next.code);
    replaceQuery(params);
    setStatus(
      `${product.name}, ${next.finish_name}, ${next.beam_deg}° beam, ${next.cct_k}K: ${next.lumens} lumens, ${plusGst(tierPrice(next, session.seesTrade))}.`,
    );
  };

  const units = Math.max(1, Math.min(999, Number.parseInt(quantity, 10) || 1));

  const addToCart = async () => {
    if (!session.user) {
      navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    setAdding(true);
    const reply = await request<{ order: Order }>("/api/cart/lines", {
      method: "POST",
      body: { variant_code: variant.code, quantity: units },
    });
    setAdding(false);
    if (reply.ok) {
      session.refreshCart();
      setStatus(`Added ${units} to cart. Cart total ${plusGst(reply.data.order.subtotal_cents)}.`);
    } else if (reply.error.error === "insufficient_stock") {
      setStatus(`Only ${reply.error.available ?? 0} left.`);
    }
  };

  const toggleSave = () => void favourites.toggle(product.slug, variant).then(setStatus);

  const downloadSheet = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setPreparing(true);
    const href = event.currentTarget.href;
    try {
      const response = await fetch(href);
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${variant.code}-spec-sheet.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setStatus("Spec sheet unavailable right now. Try again shortly.");
    } finally {
      setPreparing(false);
    }
  };

  const addButton = session.approvedTrade ? (
    <button type="button" className="button button--primary" onClick={() => setProjectDialog(true)}>
      Add to project
    </button>
  ) : (
    <button type="button" className="button button--primary" onClick={() => void addToCart()} disabled={adding}>
      {adding ? "Adding" : "Add to cart"}
    </button>
  );

  return (
    <div className={`product page-docked ${phone ? "page-docked--quick" : ""}`}>
      <div className="product__layout">
        {stage}
        <section aria-label="Specification" className="product__spec">
          <p className="eyebrow">{familyLabel(product.family)}</p>
          <h1 className="product__name">{product.name}</h1>
          <p className="product__description">{product.description}</p>
          <p className="product__code mono">{variant.code}</p>

          <Picker
            label="Finish"
            options={finishes.map(([code]) => code)}
            selected={variant.finish}
            available={available("finish")}
            render={(code) => ({ text: finishes.find(([c]) => c === code)?.[1] ?? code, swatch: FINISH_COLOURS[code] })}
            onPick={(code) => pick("finish", code)}
          />
          <Picker
            label="Beam angle"
            options={beams}
            selected={variant.beam_deg}
            available={available("beam")}
            render={(beam) => ({ text: `${beam}°` })}
            onPick={(beam) => pick("beam", beam)}
          />
          <Picker
            label="Colour temperature"
            options={ccts}
            selected={variant.cct_k}
            available={available("cct")}
            render={(cct) => ({ text: `${cct}K`, swatch: LIGHT_COLOURS[cct] })}
            onPick={(cct) => pick("cct", cct)}
          />

          <section aria-label="Light readout" className="readout">
            <dl className="readout__list">
              {session.seesTrade && !variant.clearance ? (
                <TradePrice trade={price} retail={variant.retail_price_cents} />
              ) : (
                <Figure label="Price" value={price} format={plusGst} />
              )}
              <Figure label="Lumens" value={variant.lumens} format={(n) => `${n} lm`} />
              <Figure label="Pool at 2.7 m" value={poolDiameterMm(REFERENCE_CEILING_MM, variant.beam_deg)} format={(n) => `${n} mm`} />
              <Figure label="Centre at 2.7 m" value={ownLux(variant.candela, REFERENCE_CEILING_MM)} format={(n) => `${n} lux`} />
            </dl>
            {variant.was_price_cents !== null && (
              <p className="readout__was mono">
                Clearance price. Regular <s>{plusGst(variant.was_price_cents)}</s>
              </p>
            )}
            {badge && <p className={`badge ${badge === "Sold out" ? "badge--out" : "badge--low"}`}>{badge}</p>}
          </section>

          <div className="product__buy">
            <div className="field field--quantity">
              <label htmlFor="product-quantity">Quantity</label>
              <input
                id="product-quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            {!phone && (
              <div className="product__add">
                {addButton}
                {session.approvedTrade && (
                  <button type="button" className="button button--quiet" onClick={() => void addToCart()} disabled={adding}>
                    {adding ? "Adding" : "Add to cart"}
                  </button>
                )}
              </div>
            )}
            <div className="product__secondary">
              <button
                type="button"
                className="chip-button"
                aria-pressed={inTray}
                onClick={() =>
                  inTray
                    ? removeFromTray(variant.code)
                    : addToTray({ code: variant.code, product_slug: product.slug, product_name: product.name })
                }
              >
                <GitCompareArrows aria-hidden="true" size={16} strokeWidth={1.5} />
                Compare
              </button>
              <button type="button" className="chip-button" aria-pressed={saved} onClick={toggleSave}>
                <Heart aria-hidden="true" size={16} strokeWidth={1.5} fill={saved ? "currentColor" : "none"} />
                Save to favourites
              </button>
            </div>
          </div>
          <p role="status" aria-label="Product updates" className="form-status">
            {status}
          </p>
          {session.approvedTrade && (
            <p role="status" aria-label="Project updates" className="form-status">
              {projectStatus}
            </p>
          )}

          <div className="drawers">
            <Drawer title="Photometrics" defaultOpen>
              <table className="data-table data-table--compact">
                <caption className="visually-hidden">Pool diameter and centre lux by ceiling height</caption>
                <thead>
                  <tr>
                    <th scope="col">Ceiling</th>
                    <th scope="col">Pool diameter</th>
                    <th scope="col">Centre lux</th>
                  </tr>
                </thead>
                <tbody>
                  {[2400, 2700, 3000, 3600].map((ceiling) => (
                    <tr key={ceiling}>
                      <th scope="row" className="mono">{(ceiling / 1000).toFixed(1)} m</th>
                      <td className="mono">{poolDiameterMm(ceiling, variant.beam_deg)} mm</td>
                      <td className="mono">{ownLux(variant.candela, ceiling)} lux</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="spec-list">
                <div><dt>Candela</dt><dd className="mono">{variant.candela} cd</dd></div>
                <div><dt>Beam</dt><dd className="mono">{variant.beam_deg}°</dd></div>
                <div><dt>CRI</dt><dd className="mono">{product.cri}</dd></div>
              </dl>
            </Drawer>
            <Drawer title="Dimensions">
              <div className="dimensions">
                <FittingDrawing kind={kind} finish={variant.finish} beam={variant.beam_deg} cct={variant.cct_k} className="dimensions__drawing" />
                <dl className="spec-list">
                  <div><dt>Mounting</dt><dd>{MOUNTING[kind]}</dd></div>
                  <div><dt>Power</dt><dd className="mono">{product.watts} W</dd></div>
                  <div><dt>IP rating</dt><dd className="mono">{product.ip_rating}</dd></div>
                </dl>
              </div>
            </Drawer>
            <Drawer title="Downloads">
              <a
                className="download-link"
                href={`/api/variants/${encodeURIComponent(variant.code)}/spec-sheet`}
                onClick={(event) => void downloadSheet(event)}
                aria-busy={preparing}
              >
                <Download aria-hidden="true" size={18} strokeWidth={1.5} />
                {preparing ? "Preparing spec sheet" : "Spec sheet (PDF)"}
              </a>
            </Drawer>
          </div>
        </section>
      </div>

      {phone && (
        <Dock>
          <section aria-label="Quick add" className="quick-add">
            <p className="quick-add__price mono">{plusGst(price)}</p>
            {addButton}
          </section>
        </Dock>
      )}

      {session.approvedTrade && (
        <AddToProject
          open={projectDialog}
          onClose={() => setProjectDialog(false)}
          code={variant.code}
          quantity={units}
          onDone={(message) => {
            setProjectStatus(message);
            setProjectDialog(false);
          }}
        />
      )}
      <CompareTray />
    </div>
  );
}

function AddToProject({
  open,
  onClose,
  code,
  quantity,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  code: string;
  quantity: number;
  onDone: (message: string) => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [units, setUnits] = useState(String(quantity));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUnits(String(quantity));
    void request<{ projects: ProjectSummary[] }>("/api/projects").then((reply) => {
      if (!reply.ok) return;
      setProjects(reply.data.projects);
      setProjectId((current) => current || reply.data.projects[0]?.id || "");
    });
  }, [open, quantity]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const project = projects?.find((p) => p.id === projectId);
    const count = Number.parseInt(units, 10);
    if (!project || !(count >= 1 && count <= 999)) return;
    setSaving(true);
    const reply = await request(`/api/projects/${project.id}/lines`, { method: "POST", body: { variant_code: code, quantity: count } });
    setSaving(false);
    if (reply.ok) onDone(`Added ${count} × ${code} to ${project.name}.`);
  };

  return (
    <Dialog title="Add to project" open={open} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="form-stack">
        <div className="field">
          <label htmlFor="add-project">Project</label>
          <select id="add-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="add-project-quantity">Quantity</label>
          <input id="add-project-quantity" type="number" min={1} max={999} value={units} onChange={(event) => setUnits(event.target.value)} />
        </div>
        <p className="dialog__note mono">{code}</p>
        <button type="submit" className="button button--primary" disabled={saving || !projects?.length}>
          {saving ? "Saving" : "Add"}
        </button>
      </form>
    </Dialog>
  );
}
