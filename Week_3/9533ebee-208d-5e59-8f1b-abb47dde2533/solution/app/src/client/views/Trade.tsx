import { useMemo, useRef, useState } from "react";
import { api, failureOf, RetryKey } from "../api.ts";
import { useDecimals, useSession } from "../state.tsx";
import { ActionButton, amountCopy, amountError, Field, Fig, Labelled, Mono, Price, Select, typedAmount, useAction } from "../ui.tsx";
import type { Quote, Swap } from "../types.ts";

const PREVIEW_EMPTY = "Type an amount to see the output.";
import { SWAPS_PAUSED } from "../../shared/copy.ts";

type Preview = { kind: "empty" } | { kind: "figures"; quote: Omit<Quote, "quote_id" | "expires_at" | "server_time"> } | { kind: "message"; text: string };

export function TradeView() {
  const { market, wall } = useSession();
  const decimalsOf = useDecimals();
  const assets = market?.pools.map((p) => p.asset) ?? [];
  const [from, setFrom] = useState("MBTC");
  const [to, setTo] = useState("QUSD");
  const [typed, setTyped] = useState("");
  const [preview, setPreview] = useState<Preview>({ kind: "empty" });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [swap, setSwap] = useState<Swap | null>(null);
  const previewSeq = useRef(0);
  const swapKey = useRef(new RetryKey());
  const fields = useMemo(() => ({ amount_in: { id: "amount-to-pay", label: "Amount to pay" }, from_asset: { id: "pay-with", label: "Pay with" }, to_asset: { id: "receive", label: "Receive" } }), []);
  const { busy, errors, run, showFieldErrors } = useAction(fields);
  const stale = market?.pools.some((p) => (p.asset === from || p.asset === to) && p.market_state === "stale_feed") ?? false;

  // Every input asks the server for a preview of the exact typed amount; only the latest reply is shown.
  function requestPreview(nextFrom: string, nextTo: string, nextTyped: string) {
    setQuote(null);
    const seq = ++previewSeq.current;
    const amount = typedAmount(nextTyped, decimalsOf(nextFrom));
    if ("error" in amount) {
      setPreview({ kind: "empty" });
      return;
    }
    const query = new URLSearchParams({ from_asset: nextFrom, to_asset: nextTo, amount_in: amount.minor });
    api<Omit<Quote, "quote_id" | "expires_at" | "server_time">>("GET", `/api/swap/preview?${query.toString()}`).then(
      (body) => {
        if (seq === previewSeq.current) setPreview({ kind: "figures", quote: body });
      },
      (error: unknown) => {
        if (seq !== previewSeq.current) return;
        const failure = failureOf(error);
        const text = failure.kind === "fields" ? Object.values(failure.errors).join(" ") : failure.kind === "error" ? failure.message : "";
        setPreview(text ? { kind: "message", text } : { kind: "empty" });
      },
    );
  }

  async function getQuote() {
    const amount = typedAmount(typed, decimalsOf(from));
    if ("error" in amount) {
      showFieldErrors({ amount_in: amount.error });
      return;
    }
    const created = await run("quote", {
      pending: "Getting quote",
      call: () => api<Quote>("POST", "/api/swap/quotes", { from_asset: from, to_asset: to, amount_in: amount.minor }),
      done: (q) => ({ text: `Quote ready. Firm until ${wall(q.expires_at)}.` }),
    });
    if (created) {
      setQuote(created);
      setSwap(null);
    }
  }

  async function swapNow() {
    if (!quote) return;
    const body = { quote_id: quote.quote_id };
    const key = swapKey.current.forBody(body);
    const done = await run("swap", {
      pending: "Swapping",
      call: () => api<Swap>("POST", "/api/swaps", body, key),
      done: (s) => ({ text: `Swapped ${amountCopy(s.amount_in, decimalsOf(s.from_asset), s.from_asset)} for ${amountCopy(s.amount_out, decimalsOf(s.to_asset), s.to_asset)}.` }),
    });
    if (done) setSwap(done);
  }

  const options = assets.map((a) => ({ value: a, label: a }));
  return (
    <section className="sheet-section">
      <h1>Trade</h1>
      <p className="lede">Swap one asset for another at the posted prices, less the pool fee. A firm quote holds its figures until it expires on the server's clock.</p>
      <div className="form-grid">
        <Select id="pay-with" label="Pay with" value={from} options={options} onChange={(v) => { setFrom(v); requestPreview(v, to, typed); }} />
        <Select id="receive" label="Receive" value={to} options={options} onChange={(v) => { setTo(v); requestPreview(from, v, typed); }} />
        <Field
          id="amount-to-pay"
          label="Amount to pay"
          value={typed}
          error={errors["amount-to-pay"] ?? amountError(typed, decimalsOf(from))}
          hint={stale ? SWAPS_PAUSED : undefined}
          enterButton="get-quote"
          onChange={(v) => { setTyped(v); requestPreview(from, to, v); }}
        />
      </div>
      <div role="status" aria-label="Swap preview" className="ledger-box preview">
        {preview.kind === "empty" ? <p className="muted">{PREVIEW_EMPTY}</p> : null}
        {preview.kind === "message" ? <p>{preview.text}</p> : null}
        {preview.kind === "figures" ? (
          <>
            <p className="preview-line">
              <span className="preview-label">Pool fee </span>
              <Fig minor={preview.quote.fee} decimals={decimalsOf(preview.quote.from_asset)} asset={preview.quote.from_asset} />
            </p>
            <p className="preview-line">
              <span className="preview-label">You receive </span>
              <Fig minor={preview.quote.amount_out} decimals={decimalsOf(preview.quote.to_asset)} asset={preview.quote.to_asset} />
            </p>
          </>
        ) : null}
      </div>
      <div className="actions">
        <ActionButton id="get-quote" busy={busy !== null} onClick={() => void getQuote()}>
          Get firm quote
        </ActionButton>
      </div>
      <section aria-label="Firm quote" className="ledger-box">
        <h2>Firm quote</h2>
        {quote ? (
          <dl>
            <Labelled label="Pool fee">
              <Fig minor={quote.fee} decimals={decimalsOf(quote.from_asset)} asset={quote.from_asset} />
            </Labelled>
            <Labelled label="You receive">
              <Fig minor={quote.amount_out} decimals={decimalsOf(quote.to_asset)} asset={quote.to_asset} />
            </Labelled>
            <Labelled label={`${quote.from_asset} price`}>
              <Price value={quote.price_from} />
            </Labelled>
            <Labelled label={`${quote.to_asset} price`}>
              <Price value={quote.price_to} />
            </Labelled>
            <p className="firm-until">{`Firm until ${wall(quote.expires_at)}`}</p>
          </dl>
        ) : (
          <p className="muted">No quote yet. Get a firm quote to lock the fee and output.</p>
        )}
        <div className="actions">
          <ActionButton busy={busy !== null || quote === null} onClick={() => void swapNow()}>
            Swap now
          </ActionButton>
        </div>
      </section>
      <section aria-label="Swap receipt" className="ledger-box">
        <h2>Swap receipt</h2>
        {swap ? (
          <dl>
            <Labelled label="Amount in">
              <Fig minor={swap.amount_in} decimals={decimalsOf(swap.from_asset)} asset={swap.from_asset} />
            </Labelled>
            <Labelled label="Pool fee">
              <Fig minor={swap.fee} decimals={decimalsOf(swap.from_asset)} asset={swap.from_asset} />
            </Labelled>
            <Labelled label="Amount out">
              <Fig minor={swap.amount_out} decimals={decimalsOf(swap.to_asset)} asset={swap.to_asset} />
            </Labelled>
            <Labelled label={`${swap.from_asset} price`}>
              <Price value={swap.price_from} />
            </Labelled>
            <Labelled label={`${swap.to_asset} price`}>
              <Price value={swap.price_to} />
            </Labelled>
            <Labelled label="Swap">
              <Mono>{swap.swap_id}</Mono>
            </Labelled>
          </dl>
        ) : (
          <p className="muted">Your swap receipt appears here.</p>
        )}
      </section>
    </section>
  );
}
