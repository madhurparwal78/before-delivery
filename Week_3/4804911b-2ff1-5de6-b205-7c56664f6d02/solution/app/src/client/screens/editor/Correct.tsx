import { useEffect, useRef, useState, type MutableRef } from "preact/hooks";
import { COPY, rupees } from "../../../shared/copy";
import type { ApiError, NoticeDetail, NoticeVersion } from "../../../shared/types";
import { emptyToNull, toPaise } from "../../lib/forms";
import { Modal } from "../../lib/Modal";
import { ApiFailure, post } from "../../lib/net";
import type { HeldCorrection } from "../../lib/session";
import { namedSkus, PreviewPanel, usePreview } from "./preview";

export interface CorrectionApi {
  capture: () => HeldCorrection | null;
}

export function CorrectDialog({ notice, held, apiRef, say, lastRefusal, onRefused, onClose, onDone }: {
  notice: NoticeDetail; held: HeldCorrection | null; apiRef: MutableRef<CorrectionApi | null>; say: (message: string) => void;
  lastRefusal: ApiError | null; onRefused: (error: ApiError | null) => void; onClose: () => void; onDone: (version: NoticeVersion) => void;
}) {
  const base = useRef(notice.versions[0]!).current;
  const baseVersion = held?.baseVersion ?? base.version;
  const loaded = useRef({ date: base.effectiveDate, runOut: base.runOutUntil ?? "", reason: "", prices: Object.fromEntries(base.rows.map((r) => [r.skuCode, rupees(r.revisedMrpPaise)])) }).current;
  const [values, setValues] = useState(held ? { date: held.effectiveDate, runOut: held.runOutUntil, reason: held.reason, prices: held.rows } : loaded);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const statusEl = useRef<HTMLElement | null>(null);

  useEffect(() => {
    apiRef.current = {
      capture: () => {
        const v = valuesRef.current;
        if (JSON.stringify(v) === JSON.stringify(loaded)) return null;
        return { number: notice.number, effectiveDate: v.date, runOutUntil: v.runOut, reason: v.reason, rows: v.prices, baseVersion };
      },
    };
    onRefused(null);
    return () => {
      apiRef.current = null;
      onRefused(null);
    };
  }, []);

  const bodyOf = () => {
    const v = valuesRef.current;
    return {
      baseVersion,
      reason: v.reason,
      effectiveDate: v.date,
      runOutUntil: emptyToNull(v.runOut),
      rows: base.rows.map((r) => ({ skuCode: r.skuCode, kind: r.kind, revisedMrpPaise: toPaise(v.prices[r.skuCode] ?? "") ?? v.prices[r.skuCode] ?? null, oldRate: r.oldRate, newRate: r.newRate })),
    };
  };
  const preview = usePreview(`/api/editor/notices/${notice.number}/corrections/preview`, bodyOf, JSON.stringify(values));
  const fieldId = (sku: string) => `fix-${sku}`;
  const blocking = preview?.blocking ?? lastRefusal;
  const named = new Set(namedSkus(blocking));

  const set = (patch: Partial<typeof values>) => {
    setValues((v) => ({ ...v, ...patch }));
    onRefused(null);
  };

  const submit = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    say("Publishing.");
    try {
      const done = await post<{ number: string; version: NoticeVersion }>(`/api/editor/notices/${notice.number}/corrections`, bodyOf());
      say(`Notice ${done.number} version ${done.version.version} published.`);
      onDone(done.version);
    } catch (error) {
      if (error instanceof ApiFailure) {
        onRefused(error.body);
        say(error.body.message);
      } else say(COPY.unavailable);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal label="Correct notice" initialFocus="input" onEscape={() => !pending.current && onClose()}>
      <h2>Correct notice {notice.number}</h2>
      <div class="fields">
        <label for="fix-date">Effective date</label>
        <input id="fix-date" type="text" inputMode="numeric" value={values.date} onInput={(e) => set({ date: (e.currentTarget as HTMLInputElement).value })} />
        <label for="fix-runout">Old wrappers until</label>
        <input id="fix-runout" type="text" inputMode="numeric" value={values.runOut} onInput={(e) => set({ runOut: (e.currentTarget as HTMLInputElement).value })} />
        {base.rows.map((row) => (
          <div class="price-row" key={row.skuCode}>
            <label for={fieldId(row.skuCode)}>Revised MRP for {row.skuCode}</label>
            <span class="live-name">{row.name}</span>
            <input
              id={fieldId(row.skuCode)}
              type="text"
              inputMode="decimal"
              value={values.prices[row.skuCode] ?? ""}
              aria-invalid={named.has(row.skuCode) ? "true" : undefined}
              aria-describedby={named.has(row.skuCode) ? `why-fix-${row.skuCode}` : undefined}
              onInput={(e) => set({ prices: { ...values.prices, [row.skuCode]: (e.currentTarget as HTMLInputElement).value } })}
            />
            {named.has(row.skuCode) && (
              <p id={`why-fix-${row.skuCode}`} class="field-error">
                {blocking?.message}
              </p>
            )}
          </div>
        ))}
        <label for="fix-reason">Correction reason</label>
        <input id="fix-reason" type="text" value={values.reason} onInput={(e) => set({ reason: (e.currentTarget as HTMLInputElement).value })} />
      </div>
      <PreviewPanel id={notice.number} preview={preview} refusal={lastRefusal} statusRef={(el) => (statusEl.current = el)} fieldId={fieldId} onFix={(sku) => document.getElementById(fieldId(sku))?.focus()} />
      {lastRefusal && <p class="field-error">{lastRefusal.message}</p>}
      <div class="actions">
        <button type="button" class="rect-button" aria-disabled={busy ? "true" : undefined} onClick={() => void submit()}>
          Publish correction
        </button>
        <button type="button" class="rect-button" onClick={() => !pending.current && onClose()}>
          Close
        </button>
      </div>
    </Modal>
  );
}
