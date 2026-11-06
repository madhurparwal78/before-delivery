/**
 * The product page: the 3D viewer beside the spec panel. Choosing a finish, beam
 * or colour temperature selects the matching variant at once, updates the readout
 * in place, re-lights the model and announces the new values. A combination that
 * does not exist for the product cannot be chosen.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api.js";
import { CATALOGUE, PRODUCT, PROJECTS } from "../../shared/copy.js";
import { PRODUCT_PAGE_CEILING_MM, soloPool } from "../../shared/lightpool.js";
import { formatAmount } from "../../shared/money.js";
import { tierPriceCents } from "../../shared/projection.js";
import type { Product, ProjectSummary, Variant } from "../../shared/types.js";
import {
  useAnnouncer,
  useBreakpoint,
  useCart,
  useRouter,
  useSession,
  useTray,
} from "../state/app.js";
import { CountedNumber } from "../components/Numerals.js";
import { Dialog } from "../components/Dialog.js";
import { PriceLine, StockBadge } from "../components/ProductCard.js";
import { usePublishedHeight } from "../components/Shell.js";
import { ProductViewer, sceneAmbient } from "../three/ProductViewer.js";

function uniqueSorted<T>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : 1));
}

/** Finds the variant matching a finish, beam and colour temperature. */
function findVariant(product: Product, finish: string, beam: number, cct: number): Variant | undefined {
  return product.variants.find((v) => v.finish === finish && v.beam_deg === beam && v.cct_k === cct);
}

function SpecDrawer({
  label,
  openByDefault,
  children,
}: {
  label: string;
  openByDefault?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(openByDefault));
  return (
    <div className="drawer">
      <button type="button" className="drawer-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{label}</span>
        <span className="marker" aria-hidden="true">
          {open ? "\u2212" : "+"}
        </span>
      </button>
      {/* Nothing inside a closed drawer can be reached. */}
      {open && <div className="drawer-panel">{children}</div>}
    </div>
  );
}

export function ProductPage({ slug }: { slug: string }) {
  const { search, setQuery, navigate } = useRouter();
  const { user, lightState } = useSession();
  const tray = useTray();
  const cart = useCart();
  const breakpoint = useBreakpoint();
  const { message, announce } = useAnnouncer();

  const [product, setProduct] = useState<Product | null>(null);
  const [missing, setMissing] = useState(false);
  const [code, setCode] = useState<string | null>(new URLSearchParams(search).get("variant"));
  const [quantity, setQuantity] = useState(1);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [sheetBusy, setSheetBusy] = useState(false);
  const quickAddRef = usePublishedHeight("--quick-add-height");

  const isApprovedTrade = user?.role === "trade" && user.trade_status === "approved";

  useEffect(() => {
    void api
      .product(slug)
      .then(({ product: loaded }) => {
        setProduct(loaded);
        setCode((current) => {
          if (current && loaded.variants.some((v) => v.code === current)) return current;
          return loaded.default_variant;
        });
      })
      .catch(() => setMissing(true));
  }, [slug]);

  const variant = useMemo(() => {
    if (!product) return null;
    return product.variants.find((v) => v.code === code) ?? product.variants[0] ?? null;
  }, [product, code]);

  useEffect(() => {
    if (!user || !variant) {
      setSaved(false);
      return;
    }
    void api
      .favourites()
      .then(({ items }) => setSaved(items.some((item) => item.code === variant.code)))
      .catch(() => setSaved(false));
  }, [user, variant]);

  // The quick-add bar is fixed to the bottom of the screen at 375.
  useEffect(() => {
    document.body.classList.add("has-quick-add");
    return () => document.body.classList.remove("has-quick-add");
  }, []);

  const selectVariant = useCallback(
    (next: Variant) => {
      setCode(next.code);
      // The URL's `?variant=` changes without a reload.
      setQuery(`variant=${next.code}`);
      if (!product) return;
      announce(
        PRODUCT.variantChanged({
          productName: product.name,
          finishName: next.finish_name,
          beamDeg: next.beam_deg,
          cctK: next.cct_k,
          lumens: next.lumens,
          priceCents: tierPriceCents(next),
        }),
      );
    },
    [product, setQuery, announce],
  );

  if (missing) {
    return (
      <div className="wrap section">
        <h1>Fitting not found</h1>
        <p className="muted">That fitting is not in the catalogue.</p>
      </div>
    );
  }
  if (!product || !variant) {
    return (
      <div className="wrap section">
        <h1 />
      </div>
    );
  }

  const finishes = uniqueSorted(product.variants.map((v) => v.finish));
  const beams = uniqueSorted(product.variants.map((v) => v.beam_deg));
  const ccts = uniqueSorted(product.variants.map((v) => v.cct_k));
  const pool = soloPool(variant.beam_deg, variant.candela, PRODUCT_PAGE_CEILING_MM);
  const priceCents = tierPriceCents(variant);
  const soldOut = variant.clearance && variant.stock_on_hand === 0;

  const addToCart = async (): Promise<void> => {
    setAdding(true);
    try {
      const { order } = await api.addCartLine(variant.code, quantity);
      cart.setOrder(order);
      announce(PRODUCT.addedToCart(quantity, order.subtotal_cents));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.code === "insufficient_stock") {
        announce(PRODUCT.onlyNLeft(Number(error.failure.extra.available ?? 0)));
      } else if (error.failure.status === 401) {
        navigate("/signin");
      }
    } finally {
      setAdding(false);
    }
  };

  const openProjectDialog = async (): Promise<void> => {
    const { projects: list } = await api.projects();
    setProjects(list);
    setProjectDialogOpen(true);
  };

  const toggleSave = async (): Promise<void> => {
    if (!user) {
      announce(PRODUCT.signInToSave);
      return;
    }
    if (saved) {
      await api.removeFavourite(variant.code);
      setSaved(false);
      announce(PRODUCT.removedFromFavourites);
    } else {
      await api.saveFavourite(variant.code);
      setSaved(true);
      announce(PRODUCT.savedToFavourites);
    }
  };

  const addButtonLabel = isApprovedTrade ? "Add to project" : "Add to cart";
  const onAdd = isApprovedTrade ? () => void openProjectDialog() : () => void addToCart();

  return (
    <div className="wrap section">
      <div className="product-layout">
        <div className="product-canvas">
          <ProductViewer
            productName={product.name}
            family={product.family}
            slug={product.slug}
            finish={variant.finish}
            beamDeg={variant.beam_deg}
            cctK={variant.cct_k}
            ambient={sceneAmbient(lightState)}
          />
        </div>

        <div className="product-panel">
          <section aria-label="Specification" className="stack">
            <p className="eyebrow">{product.family.replace("-", " ")}</p>
            <h1>{product.name}</h1>
            <p className="muted">{product.description}</p>
            <span className="small numeric muted">{variant.code}</span>

            <fieldset className="radio-set" role="radiogroup" aria-label="Finish">
              <legend>Finish</legend>
              {finishes.map((finish) => {
                const match =
                  findVariant(product, finish, variant.beam_deg, variant.cct_k) ??
                  product.variants.find((v) => v.finish === finish);
                const exists = Boolean(findVariant(product, finish, variant.beam_deg, variant.cct_k));
                const name = match?.finish_name ?? finish;
                return (
                  <label className="chip" key={finish}>
                    <input
                      type="radio"
                      name="finish"
                      checked={variant.finish === finish}
                      disabled={!exists}
                      onChange={() => {
                        const next = findVariant(product, finish, variant.beam_deg, variant.cct_k);
                        if (next) selectVariant(next);
                      }}
                    />
                    <span>{name}</span>
                  </label>
                );
              })}
            </fieldset>

            <fieldset className="radio-set" role="radiogroup" aria-label="Beam angle">
              <legend>Beam angle</legend>
              {beams.map((beam) => {
                const exists = Boolean(findVariant(product, variant.finish, beam, variant.cct_k));
                return (
                  <label className="chip" key={beam}>
                    <input
                      type="radio"
                      name="beam"
                      checked={variant.beam_deg === beam}
                      disabled={!exists}
                      onChange={() => {
                        const next = findVariant(product, variant.finish, beam, variant.cct_k);
                        if (next) selectVariant(next);
                      }}
                    />
                    <span className="numeric">{`${beam}\u00b0`}</span>
                  </label>
                );
              })}
            </fieldset>

            <fieldset className="radio-set" role="radiogroup" aria-label="Colour temperature">
              <legend>Colour temperature</legend>
              {ccts.map((cct) => {
                const exists = Boolean(findVariant(product, variant.finish, variant.beam_deg, cct));
                return (
                  <label className="chip" key={cct}>
                    <input
                      type="radio"
                      name="cct"
                      checked={variant.cct_k === cct}
                      disabled={!exists}
                      onChange={() => {
                        const next = findVariant(product, variant.finish, variant.beam_deg, cct);
                        if (next) selectVariant(next);
                      }}
                    />
                    <span className="numeric">{`${cct}K`}</span>
                  </label>
                );
              })}
            </fieldset>

            <section aria-label="Light readout" className="readout">
              <div className="readout-item">
                <div className="readout-label">Price</div>
                <div className="readout-value">{`$${formatAmount(priceCents)}`}</div>
              </div>
              <div className="readout-item">
                <div className="readout-label">Lumens</div>
                <div className="readout-value">
                  <CountedNumber value={variant.lumens} />
                </div>
              </div>
              <div className="readout-item">
                <div className="readout-label">Pool at 2.7 m</div>
                <div className="readout-value">
                  <CountedNumber value={pool.pool_diameter_mm} suffix=" mm" />
                </div>
              </div>
              <div className="readout-item">
                <div className="readout-label">Centre at 2.7 m</div>
                <div className="readout-value">
                  <CountedNumber value={pool.centre_lux} suffix=" lux" />
                </div>
              </div>
            </section>

            <PriceLine variant={variant} />
            <StockBadge variant={variant} />

            <p role="status" aria-label="Product updates" className="small muted">
              {message}
            </p>

            <div className="row">
              <div className="field" style={{ maxWidth: 120 }}>
                <label htmlFor="product-quantity">Quantity</label>
                <input
                  id="product-quantity"
                  type="number"
                  min={1}
                  max={999}
                  value={quantity}
                  onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
                />
              </div>
              {/* At 375 the inline add button is not shown. */}
              {breakpoint !== "phone" && (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={adding || soldOut}
                  onClick={onAdd}
                >
                  {adding ? PRODUCT.addingToCart : addButtonLabel}
                </button>
              )}
              <button
                type="button"
                className="button"
                aria-pressed={tray.has(variant.code)}
                onClick={() => {
                  const accepted = tray.add({
                    code: variant.code,
                    productName: product.name,
                    productSlug: product.slug,
                  });
                  announce(accepted ? PRODUCT.addedToComparison : PRODUCT.comparisonFull);
                }}
              >
                Compare
              </button>
              <button type="button" className="button" aria-pressed={saved} onClick={() => void toggleSave()}>
                Save to favourites
              </button>
            </div>

            <div style={{ marginTop: 8 }}>
              <SpecDrawer label="Photometrics" openByDefault>
                <dl className="stack" style={{ margin: 0, gap: 6 }}>
                  <div className="spread">
                    <dt className="muted small">Lumens</dt>
                    <dd className="numeric" style={{ margin: 0 }}>{`${variant.lumens} lumens`}</dd>
                  </div>
                  <div className="spread">
                    <dt className="muted small">Candela</dt>
                    <dd className="numeric" style={{ margin: 0 }}>{`${variant.candela} cd`}</dd>
                  </div>
                  <div className="spread">
                    <dt className="muted small">CRI</dt>
                    <dd className="numeric" style={{ margin: 0 }}>{product.cri}</dd>
                  </div>
                  <div className="spread">
                    <dt className="muted small">Pool at 2.7 m</dt>
                    <dd className="numeric" style={{ margin: 0 }}>{`${pool.pool_diameter_mm} mm`}</dd>
                  </div>
                  <div className="spread">
                    <dt className="muted small">Centre at 2.7 m</dt>
                    <dd className="numeric" style={{ margin: 0 }}>{`${pool.centre_lux} lux`}</dd>
                  </div>
                </dl>
              </SpecDrawer>

              <SpecDrawer label="Dimensions">
                <dl className="stack" style={{ margin: 0, gap: 6 }}>
                  <div className="spread">
                    <dt className="muted small">Power</dt>
                    <dd className="numeric" style={{ margin: 0 }}>{`${product.watts} W`}</dd>
                  </div>
                  <div className="spread">
                    <dt className="muted small">IP rating</dt>
                    <dd className="numeric" style={{ margin: 0 }}>{product.ip_rating}</dd>
                  </div>
                  <div className="spread">
                    <dt className="muted small">Finish</dt>
                    <dd style={{ margin: 0 }}>{variant.finish_name}</dd>
                  </div>
                </dl>
              </SpecDrawer>

              <SpecDrawer label="Downloads">
                <a
                  href={`/api/variants/${variant.code}/spec-sheet`}
                  className="button"
                  onClick={(event) => {
                    event.preventDefault();
                    setSheetBusy(true);
                    announce(PRODUCT.preparingSpecSheet);
                    void fetch(`/api/variants/${variant.code}/spec-sheet`)
                      .then(async (response) => {
                        if (!response.ok) {
                          announce(PRODUCT.specSheetUnavailable);
                          return;
                        }
                        const blob = await response.blob();
                        const url = URL.createObjectURL(blob);
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = `lightfall-${variant.code}.pdf`;
                        anchor.click();
                        URL.revokeObjectURL(url);
                        announce("");
                      })
                      .catch(() => announce(PRODUCT.specSheetUnavailable))
                      .finally(() => setSheetBusy(false));
                  }}
                >
                  {sheetBusy ? PRODUCT.preparingSpecSheet : "Spec sheet (PDF)"}
                </a>
              </SpecDrawer>
            </div>
          </section>
        </div>
      </div>

      {/* At 375 a quick-add bar holds the price and the single add button for the role. */}
      {breakpoint === "phone" && (
        <div className="quick-add" role="region" aria-label="Quick add" ref={quickAddRef}>
          <div className="quick-add-inner">
            <span className="price-line">{CATALOGUE.priceLine(priceCents)}</span>
            <button
              type="button"
              className="button button-primary"
              disabled={adding || soldOut}
              onClick={onAdd}
            >
              {adding ? PRODUCT.addingToCart : addButtonLabel}
            </button>
          </div>
        </div>
      )}

      {projectDialogOpen && (
        <AddToProjectDialog
          projects={projects}
          variantCode={variant.code}
          onClose={() => setProjectDialogOpen(false)}
          onAdded={(qty, projectName) => {
            announce(PROJECTS.addedToProject(qty, variant.code, projectName));
            setProjectDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AddToProjectDialog({
  projects,
  variantCode,
  onClose,
  onAdded,
}: {
  projects: ProjectSummary[];
  variantCode: string;
  onClose: () => void;
  onAdded: (quantity: number, projectName: string) => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const chosen = projects.find((project) => project.id === projectId);
    if (!chosen) return;
    setBusy(true);
    try {
      await api.addProjectLine(chosen.id, variantCode, quantity);
      onAdded(quantity, chosen.name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add to project" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label htmlFor="add-project">Project</label>
          <select id="add-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 140 }}>
          <label htmlFor="add-project-qty">Quantity</label>
          <input
            id="add-project-qty"
            type="number"
            min={1}
            max={999}
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
          />
        </div>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy || projects.length === 0}
          onClick={() => void submit()}
        >
          {busy ? PROJECTS.saving : "Add"}
        </button>
      </div>
    </Dialog>
  );
}
