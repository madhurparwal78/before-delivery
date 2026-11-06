// The drop page: the pinned loaf scene, scent chips, counts, holds and the bar list.
import { useEffect, useRef, useState } from "preact/hooks";
import type { PageProps } from "../app.js";
import { t, cartMessage } from "../state/i18n.js";
import { api, ApiError, scentName, scentNotes, scentTint } from "../state/api.js";
import type { Cart, Batch, Hold } from "../state/api.js";
import { formatMoney, formatLongDate, formatDropTime } from "../state/format.js";
import { LoafScene, deepLinkScroll } from "../scene/loaf.js";

const SECTION_HEIGHT_EXTRA = 2400;

export function DropPage({ locale }: PageProps) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [pendingHold, setPendingHold] = useState(false);
  const [notice, setNotice] = useState("");
  const [barListOpen, setBarListOpen] = useState(false);
  const [, setServerNow] = useState<string>(new Date().toISOString());
  const figureRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<LoafScene | null>(null);
  const announcedRef = useRef<Set<number>>(new Set());
  const cartRegionRef = useRef<HTMLDivElement>(null);
  const totalRef = useRef(0);

  // ---- batch selection ----
  const effectiveBatches = batches.filter((batch) => ["scheduled", "live", "sold_out"].includes(batch.state));
  const current = effectiveBatches.find((batch) => batch.code === selected) ?? effectiveBatches.find((batch) => batch.state === "live") ?? effectiveBatches[0] ?? null;

  // ---- load batches and cart ----
  const load = async () => {
    try {
      const data = await api<{ server_now: string; batches: Batch[] }>("/drop");
      setServerNow(data.server_now);
      setBatches(data.batches);
      const cartData = await api<Cart>("/cart");
      setCart(cartData);
    } catch {
      setNotice(cartMessage("networkFailure", locale));
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  // ---- deep links ----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const batchParam = params.get("batch");
    if (batchParam) setSelected(batchParam);
    const hash = window.location.hash;
    const barMatch = /^#bar-(\d+)$/.exec(hash);
    if (barMatch && current) {
      const k = Number(barMatch[1]);
      window.scrollTo(0, deepLinkScroll(k, current.bars_cut));
    } else {
      window.scrollTo(0, 0);
    }
  }, []);

  // ---- the drop section height: viewport at load plus 2400 ----
  useEffect(() => {
    const section = document.querySelector(".drop-scroll") as HTMLElement | null;
    if (!section) return;
    const base = window.innerHeight;
    section.style.height = `${base + SECTION_HEIGHT_EXTRA}px`;
  }, []);

  // ---- scene setup ----
  useEffect(() => {
    if (!canvasRef.current || !figureRef.current || !captionRef.current) return;
    const scene = new LoafScene(
      canvasRef.current,
      figureRef.current,
      captionRef.current,
      (cut, n) => t("signatureCaption", locale, { c: cut, n }),
      () => undefined
    );
    sceneRef.current = scene;
    const onScroll = () => scene.setScroll(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current || !current) return;
    sceneRef.current.setBatch({
      code: current.code,
      scentTint: scentTint(current.scent),
      bars: current.bars,
      barsTotal: current.bars_cut
    });
    sceneRef.current.publish();
  }, [current?.code, current?.bars, locale]);

  // ---- cart announcements ----
  useEffect(() => {
    if (!cart) return;
    const messages: string[] = [];
    for (const hold of cart.holds) {
      if (!announcedRef.current.has(hold.bar)) {
        announcedRef.current.add(hold.bar);
      }
    }
    void messages;
    if (totalRef.current !== cart.total.cents) {
      if (totalRef.current !== 0 || cart.total.cents !== 0) {
        setNotice((previous) => previous);
      }
      totalRef.current = cart.total.cents;
    }
  }, [cart]);

  const totalLine = cart ? formatMoney(cart.total.cents, locale) : formatMoney(0, locale);
  void totalLine;

  const selectBatch = (code: string) => {
    setSelected(code);
    const url = new URL(window.location.href);
    url.searchParams.set("batch", code);
    url.hash = "";
    window.history.replaceState(null, "", url.toString());
    window.scrollTo(0, 0);
    announcedRef.current.clear();
  };

  const holdBar = async () => {
    if (!current) return;
    setPendingHold(true);
    try {
      const result = await api<{ hold: Hold; cart: Cart }>("/holds", {
        method: "POST",
        body: { batch: current.code }
      });
      setCart(result.cart);
      const secondsLeft = Math.max(0, (new Date(result.hold.expires_at).getTime() - new Date(result.cart.server_now).getTime()) / 1000);
      const messages = [
        cartMessage("holdSucceeded", locale, {
          k: result.hold.bar,
          left: formatCountdownText(secondsLeft)
        })
      ];
      if (secondsLeft > 60) {
        messages.push(cartMessage("oneMinute", locale, { k: result.hold.bar }));
      }
      messages.push(cartMessage("totalChanged", locale, { total: formatMoney(result.cart.total.cents, locale) }));
      setNotice(messages.join(" "));
      setBatches((previous) => previous.map((batch) => batch.code === current.code ? { ...batch } : batch));
      void load();
    } catch (err) {
      if (err instanceof ApiError) {
        const key = err.code === "sold_out" ? "soldOut"
          : err.code === "all_held" ? "allHeld"
          : err.code === "hold_limit" ? "holdLimit"
          : err.code === "not_live" ? "notLive" : null;
        setNotice(key ? cartMessage(key, locale) : err.message);
      } else {
        setNotice(cartMessage("networkFailure", locale));
      }
    } finally {
      setPendingHold(false);
    }
  };

  const liveBatch = current?.state === "live";
  const availableCount = current?.available ?? 0;
  const heldCount = current?.held ?? 0;
  const soldOut = current?.state === "sold_out";

  return (
    <div class="drop-page">
      <div class="drop-scroll">
        <div class="drop-layout">
          <figure
            ref={figureRef}
            class="loaf-figure"
            role="figure"
            aria-label={t("figure", locale)}
            data-state="fallback"
            data-batch={current?.code ?? ""}
            data-tint={current ? scentTint(current.scent) : ""}
            data-swirl-seed={current?.code ?? ""}
            data-bars-total={current?.bars_cut ?? 0}
            data-progress="0.000"
            data-wire="0.00"
            data-cut-step="0"
            data-yaw="0"
            data-loaf-band="0-0"
            data-bar-spans=""
            data-motion="full"
            data-animating="false"
            data-bars=""
          >
            <canvas ref={canvasRef} class="loaf-canvas" role="img" aria-label={t("loafCrossSection", locale)}></canvas>
            <div ref={diagramRef} class="loaf-diagram" role="img" aria-label={t("loafDiagram", locale)} hidden>
              {current?.bars.map((bar) => (
                <span class={`diagram-bar diagram-${bar.status}`}>{bar.number}</span>
              ))}
            </div>
            <figcaption ref={captionRef}>{t("signatureCaption", locale, { c: 0, n: current?.bars_cut ?? 0 })}</figcaption>
          </figure>
          <div class="drop-side">
            <h1>{current ? scentName(current.scent, locale) : ""}</h1>
            <fieldset class="scent-chips" role="radiogroup" aria-label={t("scentGroup", locale)}>
              {effectiveBatches.map((batch) => (
                <label key={batch.code} class="scent-chip">
                  <input
                    type="radio"
                    name="batch"
                    value={batch.code}
                    checked={current?.code === batch.code}
                    onChange={() => selectBatch(batch.code)}
                    onKeyDown={(event) => {
                      if (["ArrowRight", "ArrowDown"].includes(event.key)) {
                        event.preventDefault();
                        const index = effectiveBatches.findIndex((candidate) => candidate.code === batch.code);
                        const next = effectiveBatches[(index + 1) % effectiveBatches.length];
                        selectBatch(next.code);
                      }
                      if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
                        event.preventDefault();
                        const index = effectiveBatches.findIndex((candidate) => candidate.code === batch.code);
                        const previousIndex = (index - 1 + effectiveBatches.length) % effectiveBatches.length;
                        selectBatch(effectiveBatches[previousIndex].code);
                      }
                    }}
                  />
                  {scentName(batch.scent, locale)}
                </label>
              ))}
            </fieldset>
            {current && (
              <>
                <section class="drop-section" aria-label={t("batchRegion", locale)}>
                  <h2>{t("batchRegion", locale)}</h2>
                  <p><strong>{current.code}</strong></p>
                  <p>{t("barsCut", locale, { n: current.bars_cut })}</p>
                </section>
                <section class="drop-section" aria-label={t("cureDate", locale)}>
                  <h2>{t("cureDate", locale)}</h2>
                  <p>{formatLongDate(current.cure_date, locale)}</p>
                </section>
                <section class="drop-section" aria-label={t("scentNotes", locale)}>
                  <h2>{t("scentNotes", locale)}</h2>
                  <p>{scentNotes(current.scent, locale)}</p>
                </section>
                <section class="drop-section" aria-label={t("dropTime", locale)}>
                  <h2>{t("dropTime", locale)}</h2>
                  {current.drop_at_local ? (
                    <p><time dateTime={current.drop_at ?? undefined}>{formatDropTime(current.drop_at_local, locale)}</time></p>
                  ) : (
                    <p>—</p>
                  )}
                </section>
                <section class="drop-section" aria-label={t("price", locale)}>
                  <h2>{t("price", locale)}</h2>
                  <p>{t("aBar", locale, { price: formatMoney(current.unit_price.cents, locale) })}</p>
                </section>
              </>
            )}
            <div role="status" class="counts-strip" aria-label={t("batchCounts", locale)}>
              {t("countsLine", locale, {
                cut: current?.bars_cut ?? 0,
                a: availableCount,
                h: heldCount,
                s: current?.sold ?? 0
              })}
            </div>
            <div class="hold-control">
              {liveBatch && (
                <button
                  type="button"
                  class="button primary hold-button"
                  disabled={pendingHold || (availableCount === 0 && heldCount > 0)}
                  onClick={holdBar}
                >
                  {pendingHold
                    ? t("holding", locale)
                    : availableCount === 0 && heldCount > 0
                      ? t("allHeld", locale)
                      : t("holdBar", locale)}
                </button>
              )}
              {current?.state === "scheduled" && current.drop_at_local && (
                <p class="drop-notice">{t("dropOpens", locale, { when: formatDropTime(current.drop_at_local, locale) })}</p>
              )}
              {soldOut && <p class="drop-notice">{t("soldOut", locale)}</p>}
            </div>
            {cart && cart.holds.length > 0 && (
              <a class="checkout-link" href="/checkout">{t("goToCheckout", locale, { n: cart.holds.length })}</a>
            )}
            <button
              type="button"
              class="bar-list-toggle"
              aria-expanded={barListOpen ? "true" : "false"}
              onClick={() => setBarListOpen(!barListOpen)}
            >
              {t("showBarList", locale)}
            </button>
            {current && (
              <ol
                class={`bar-list ${barListOpen ? "open" : ""}`}
                aria-label={t("barList", locale)}
              >
                {current.bars.map((bar) => (
                  <li key={bar.number} class={`bar-row bar-${bar.status}`} id={`bar-${bar.number}`}>
                    {bar.status === "available"
                      ? t("barAvailable", locale, { k: bar.number })
                      : bar.status === "held"
                        ? t("barHeld", locale, { k: bar.number })
                        : t("barSold", locale, { k: bar.number })}
                  </li>
                ))}
              </ol>
            )}
            <div ref={cartRegionRef} role="status" class="cart-updates" aria-live="polite" aria-label={t("cartUpdates", locale)}>
              {notice}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCountdownText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${rest < 10 ? `0${rest}` : rest}`;
}
