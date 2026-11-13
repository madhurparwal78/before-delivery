import { useLayoutEffect as useEffect, useRef, useState } from "preact/hooks";
import { OPS_TEXT, partLine, partNumberLine, promiseLine, stateName, voidRevisionLine } from "../../../shared/copy";
import { allows } from "../../../shared/state-machine";
import { dateText, moneyEn } from "../../../shared/format";
import type { CatalogueModel, CatalogueModelDetail, ClaimView, DeclineReason, OpsClaimRow, OpsClaimView } from "../../../shared/types";
import { request, get, type ApiResult } from "../../api";
import { ClaimsTable } from "../../ClaimsTable";
import { Fan, FanPlaceholder } from "../../Fan";
import { useDesktop } from "../../hooks";
import { ArrowLeft, ChevronDown, ChevronUp } from "../../icons";
import { clearAlert, setWaiting, showAlert, showSuccess, startPending } from "../../messages";
import { Modal, useModal } from "../../Modal";
import { QuoteFigures, RulingFigure, SettlementFigures } from "../../SlipParts";
import { opsRefusal, leaveIfSignedOut } from "../../ops";
import { newKey } from "../../refusals";
import { navigate, onLinkClick } from "../../router";

const QUEUE_PANE_LIMIT = 40;
const WAITING_POLL_MS = 10_000;

const isErased = (claim: OpsClaimView): claim is Extract<OpsClaimView, { state: "erased" }> => claim.state === "erased";
const isClaimView = (value: unknown): value is ClaimView => typeof value === "object" && value !== null && "notices_pending" in value;

interface Outcome {
  message: string | ((view: ClaimView) => string);
  path?: string | ((view: ClaimView) => string);
}

const resolveOutcome = (value: string | ((view: ClaimView) => string), view: OpsClaimView): string =>
  typeof value === "string" ? value : view.state === "erased" ? "" : value(view);

export function Workspace({ reference }: { reference: string }) {
  const desktop = useDesktop();
  const [claim, setClaim] = useState<OpsClaimView | null>(null);
  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [queue, setQueue] = useState<OpsClaimRow[] | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [detailLoaded, setDetailLoaded] = useState(false);
  const shown = useRef(false);
  const [slug, setSlug] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [detail, setDetail] = useState<CatalogueModelDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [reason, setReason] = useState<DeclineReason | "">("");
  const [typed, setTyped] = useState("");
  const decline = useModal();
  const erase = useModal();
  const initialRevision = useRef<number>(-1);

  const adopt = (view: OpsClaimView): void => {
    setClaim(view);
    if (initialRevision.current === -1 && !isErased(view)) initialRevision.current = view.quotes.find((quote) => quote.status === "current")?.revision ?? 0;
    if (!isErased(view)) {
      setSlug(view.model.slug);
      setPicked(view.part.booklet_number);
      setQuantity(String(view.quantity));
      setWaiting(view.notices_pending);
    } else setWaiting(0);
  };

  const reload = async (): Promise<OpsClaimView | null> => {
    const result = await get<OpsClaimView>(`/api/ops/claims/${reference}`);
    if (result.data) {
      adopt(result.data);
      return result.data;
    }
    if (!leaveIfSignedOut(result)) showAlert(opsRefusal(result));
    return null;
  };

  const loadQueue = (): void => {
    if (!desktop) return;
    void get<{ claims: OpsClaimRow[] }>("/api/ops/claims").then((result) => {
      if (result.data) setQueue(result.data.claims);
      setQueueLoaded(true);
    });
  };

  useEffect(() => {
    const end = startPending("");
    void Promise.all([reload(), get<{ models: CatalogueModel[] }>("/api/models")]).then(([, catalogue]) => {
      end();
      if (catalogue.data) setModels(catalogue.data.models);
      setModelsLoaded(true);
    });
  }, [reference]);

  useEffect(loadQueue, [desktop, claim?.state]);

  useEffect(() => {
    if (slug === "") return;
    void get<CatalogueModelDetail>(`/api/models/${slug}`).then((result) => {
      if (result.data) setDetail(result.data);
      setDetailLoaded(true);
    });
  }, [slug]);

  const waiting = claim && !isErased(claim) ? claim.notices_pending : 0;
  useEffect(() => {
    if (waiting === 0) return;
    const timer = window.setInterval(() => void reload(), WAITING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, reference]);

  /** Runs one action: pending copy, every action button disabled until the answer, then the success or refusal copy. */
  const act = async (call: () => Promise<ApiResult<unknown>>, outcome: Outcome): Promise<void> => {
    setBusy(true);
    const end = startPending(OPS_TEXT.working);
    clearAlert();
    const result = await call();
    if (result.error || result.status === 0) {
      end();
      setBusy(false);
      if (!leaveIfSignedOut(result)) showAlert(opsRefusal(result));
      if (result.error?.code === "wrong_state") await reload();
      return;
    }
    const view = isClaimView(result.data) ? result.data : await reload();
    if (view) {
      adopt(view);
      showSuccess(resolveOutcome(outcome.message, view));
      if (outcome.path) navigate(resolveOutcome(outcome.path, view));
    }
    setBusy(false);
    loadQueue();
  };

  const here = `/ops/claims/${reference}`;
  const url = (action: string): string => `/api/ops/claims/${reference}/${action}`;
  const keyed = (): Record<string, string> => ({ "idempotency-key": newKey() });

  const live = claim && !isErased(claim) ? claim : null;
  // The first paint waits for every pane's data, so nothing in the workspace moves once it shows.
  shown.current ||= claim !== null && modelsLoaded && (!live || detailLoaded) && (!desktop || queueLoaded);
  if (!claim || !shown.current) return <div class="workspace" />;

  const state = claim.state;
  const paid = live?.payment != null;
  const can = (action: Parameters<typeof allows>[0]): boolean => !busy && allows(action, state, paid);
  const current = live?.quotes.find((quote) => quote.status === "current") ?? null;
  const earlier = live?.quotes.filter((quote) => quote.status === "void") ?? [];
  
  return (
    <div class="stack">
      <h1 class="plate-title">Claim workspace</h1>
      <div class="workspace">
        {desktop ? (
          <nav class="queue-pane" aria-label="Claim queue">
            <h2>Claim queue</h2>
            <ClaimsTable claims={queue} models={models} limit={QUEUE_PANE_LIMIT} />
          </nav>
        ) : null}
        <div class="fan-column">
          {desktop ? null : (
            <a class="back-link" href="/ops/claims" onClick={(event) => onLinkClick(event, "/ops/claims")}>
              <ArrowLeft />
              All claims
            </a>
          )}
          {detail && live ? (
            <Fan key={detail.slug} model={detail} lang="en-GB" selected={picked} onSelect={can("identify") ? setPicked : undefined} startOpen={picked !== null} />
          ) : (
            <FanPlaceholder text="" />
          )}
        </div>
        <section class="slip" role="region" aria-label="Claim slip">
          <div class="slip-head">
            <p class="slip-ref">{claim.reference}</p>
            <p class="slip-state">{stateName(state, "en-GB")}</p>
          </div>
          {live ? (
            <>
              <div>
                <h4>Owner</h4>
                <dl class="detail-list">
                  <dt>Name</dt>
                  <dd>{live.owner.name}</dd>
                  <dt>Email</dt>
                  <dd>{live.owner.email}</dd>
                  <dt>Postcode</dt>
                  <dd class="mono">{live.owner.postcode}</dd>
                  <dt>Bought</dt>
                  <dd>{dateText(live.purchase_date, "en-GB")}</dd>
                  <dt>Club</dt>
                  <dd>{live.club_member ? "Member" : "Not a member"}</dd>
                </dl>
                {live.description ? <p>{live.description}</p> : null}
              </div>
              <div>
                <h4>Photos</h4>
                <div class="photos">
                  {live.photos.map((photo) => (
                    <a key={photo.index} href={`/api/ops/claims/${live.reference}/photos/${photo.index}`} target="_blank" rel="noopener">
                      <img src={`/api/ops/claims/${live.reference}/photos/${photo.index}`} alt={`Damage photo ${photo.index} of ${live.photos.length}`} width="88" height="88" />
                    </a>
                  ))}
                </div>
              </div>
              <div>
                <p class="line">{partLine(live.part.booklet_number, live.part.name, "en-GB")}</p>
                <p class="mono part-number">{partNumberLine(live.part.part_number, "en-GB")}</p>
                <RulingFigure ruling={live.ruling} lang="en-GB" />
                <div class="field">
                  <label for="ws-model">Model</label>
                  <select id="ws-model" value={slug} disabled={!can("identify")} onChange={(event) => { setSlug(event.currentTarget.value); setPicked(null); }}>
                    {models.map((model) => (
                      <option key={model.slug} value={model.slug}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div class="field">
                  <label for="ws-quantity">Quantity</label>
                  <input id="ws-quantity" type="number" value={quantity} disabled={!can("identify")} onInput={(event) => setQuantity(event.currentTarget.value)} />
                </div>
                <button
                  type="button"
                  class="primary"
                  disabled={!can("identify") || picked === null}
                  onClick={() =>
                    void act(() => request("POST", url("identify"), { model: slug, booklet_number: picked, quantity: Number(quantity) }), {
                      message: (view) => OPS_TEXT.identified(view.ruling?.edition ?? ""),
                      path: `${here}/quote`,
                    })
                  }
                >
                  Identify part
                </button>
              </div>
              {current ? (
                <div>
                  <div class={current.revision === initialRevision.current ? "" : "revision-enter"} key={current.revision}>
                    <QuoteFigures quote={current} lang="en-GB" />
                  </div>
                  {earlier.length > 0 ? (
                    <div>
                      <button type="button" class="disclosure-button" aria-expanded={earlierOpen} onClick={() => setEarlierOpen(!earlierOpen)}>
                        Earlier revisions ({earlier.length})
                        {earlierOpen ? <ChevronUp /> : <ChevronDown />}
                      </button>
                      {earlierOpen ? (
                        <ul class="disclosure-body">
                          {earlier.map((quote) => (
                            <li key={quote.revision} class="mono">
                              {voidRevisionLine(quote.revision, quote.total_minor)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {current ? (
                <div>
                  <SettlementFigures paidMinor={live.payment?.paid_minor ?? null} decline={live.decline} lang="en-GB" />
                  <p class="line">{promiseLine(current.promise, "en-GB")}</p>
                  {live.dispatched_at ? (
                    <p>
                      <a href={`/api/ops/claims/${live.reference}/dispatch-note`} target="_blank" rel="noopener">
                        Dispatch note
                      </a>
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div>
                <h4>Share link</h4>
                {live.share_link ? (
                  <>
                    <p class="share-link-url">{`${window.location.origin}${live.share_link.url}`}</p>
                    <p class="caption">{live.share_link.state}</p>
                  </>
                ) : (
                  <p class="hint">No share link yet.</p>
                )}
              </div>
            </>
          ) : null}
          <div class="actions">
            <button
              type="button"
              disabled={!can("quote")}
              onClick={() => void act(() => request("POST", url("quote"), {}, keyed()), { message: (view) => OPS_TEXT.quoted(view.quotes.find((q) => q.status === "current")?.revision ?? 0), path: (view) => `${here}/quote/${view.quotes.find((q) => q.status === "current")?.revision ?? 1}` })}
            >
              {live && live.quotes.length > 0 ? "Re-quote" : "Get quote"}
            </button>
            <button
              type="button"
              disabled={!can("payment")}
              onClick={() => void act(() => request("POST", url("payment"), {}, keyed()), { message: (view) => OPS_TEXT.payment(moneyEn(view.payment?.paid_minor ?? 0)) })}
            >
              Record payment
            </button>
            <button type="button" disabled={!can("decline")} onClick={(event) => { setReason(""); decline.open(event.currentTarget); }}>
              Decline
            </button>
            <button
              type="button"
              disabled={!can("dispatch")}
              onClick={() => void act(() => request("POST", url("dispatch"), {}, keyed()), { message: OPS_TEXT.dispatched, path: `${here}/dispatched` })}
            >
              Dispatch
            </button>
            <button type="button" disabled={!can("close")} onClick={() => void act(() => request("POST", url("close"), {}), { message: OPS_TEXT.closed, path: here })}>
              Close claim
            </button>
            <button type="button" disabled={!can("share_link")} onClick={() => void act(() => request("DELETE", url("share-link")), { message: OPS_TEXT.withdrawn, path: here })}>
              Withdraw share link
            </button>
            <button type="button" disabled={!can("share_link")} onClick={() => void act(() => request("POST", url("share-link"), {}), { message: OPS_TEXT.newLink, path: here })}>
              Send new share link
            </button>
            <button type="button" disabled={!can("erase")} onClick={(event) => { setTyped(""); erase.open(event.currentTarget); }}>
              Erase owner data
            </button>
          </div>
        </section>
      </div>

      <Modal title="Decline claim" control={decline}>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (reason === "") return;
            void act(() => request("POST", url("decline"), { reason }, keyed()), { message: OPS_TEXT.declined, path: `${here}/declined` }).then(decline.close);
          }}
        >
          <fieldset role="radiogroup" aria-label="Reason">
            <label class="radio-row">
              <input type="radio" name="reason" value="owner_declined" checked={reason === "owner_declined"} onChange={() => setReason("owner_declined")} />
              Owner declined the quote
            </label>
            <label class="radio-row">
              <input type="radio" name="reason" value="cannot_send" checked={reason === "cannot_send"} onChange={() => setReason("cannot_send")} />
              Part cannot be sent
            </label>
          </fieldset>
          <div class="dialog-buttons">
            <button type="submit" class="primary" disabled={busy || reason === ""}>
              Confirm decline
            </button>
            <button type="button" disabled={busy} onClick={decline.close}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal title="Erase owner data" control={erase}>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (typed !== reference) return;
            void act(() => request("POST", url("erase"), { confirm_reference: typed }), { message: OPS_TEXT.erased, path: here }).then(erase.close);
          }}
        >
          <div class="field">
            <label for="erase-confirm">Type the reference to confirm</label>
            <input id="erase-confirm" type="text" autoComplete="off" spellcheck={false} value={typed} onInput={(event) => setTyped(event.currentTarget.value)} />
          </div>
          <div class="dialog-buttons">
            <button type="submit" class="primary" disabled={busy || typed !== reference}>
              Erase everything
            </button>
            <button type="button" disabled={busy} onClick={erase.close}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

