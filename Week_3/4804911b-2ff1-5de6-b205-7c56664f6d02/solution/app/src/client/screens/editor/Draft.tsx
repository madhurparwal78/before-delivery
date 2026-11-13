import { useEffect, useRef, useState } from "preact/hooks";
import { COPY, rupees } from "../../../shared/copy";
import type { ApiError, Draft, NoticeVersion } from "../../../shared/types";
import { emptyToNull, toPaise } from "../../lib/forms";
import { Modal } from "../../lib/Modal";
import { ApiFailure, LostRequest, post, put } from "../../lib/net";
import type { HeldDraft } from "../../lib/session";
import { namedSkus, PreviewPanel, usePreview } from "./preview";

interface Values {
  title: string;
  date: string;
  runOut: string;
  prices: Record<string, string>;
}

const valuesOf = (d: Draft): Values => ({
  title: d.title,
  date: d.effectiveDate,
  runOut: d.runOutUntil ?? "",
  prices: Object.fromEntries(d.rows.map((r) => [r.skuCode, rupees(r.revisedMrpPaise)])),
});
const same = (a: Values, b: Values): boolean => JSON.stringify(a) === JSON.stringify(b);

function bodyOf(base: Draft, v: Values, revision: number) {
  return {
    title: v.title,
    effectiveDate: v.date,
    runOutUntil: emptyToNull(v.runOut),
    baseRevision: revision,
    rows: base.rows.map((r) => ({ skuCode: r.skuCode, kind: r.kind, revisedMrpPaise: toPaise(v.prices[r.skuCode] ?? "") ?? v.prices[r.skuCode] ?? null, oldRate: r.oldRate, newRate: r.newRate })),
  };
}

export interface DraftApi {
  capture: () => HeldDraft | null;
  fix: () => void;
}

export function DraftGroup({
  draft, held, focusTitle, say, onPublished, onChanged, register,
}: {
  draft: Draft;
  held: HeldDraft | undefined;
  focusTitle: boolean;
  say: (message: string) => void;
  onPublished: (number: string, version: NoticeVersion) => void;
  onChanged: () => void;
  register: (id: string, api: DraftApi | null) => void;
}) {
  const [base, setBase] = useState(draft);
  const [values, setValues] = useState<Values>(() => (held ? { title: held.title ?? draft.title, date: held.effectiveDate ?? draft.effectiveDate, runOut: held.runOutUntil ?? "", prices: { ...valuesOf(draft).prices, ...held.rows } } : valuesOf(draft)));
  const [snapshot, setSnapshot] = useState<Values>(valuesOf(draft));
  const [revision, setRevision] = useState(held ? held.revision : draft.revision);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const statusEl = useRef<HTMLElement | null>(null);
  const title = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const fixFocused = useRef(false);
  const dirty = !same(values, snapshot);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;

  useEffect(() => {
    if (focusTitle) title.current?.focus();
  }, []);

  useEffect(() => {
    register(draft.id, {
      capture: () => {
        const v = valuesRef.current;
        const was = snapshotRef.current;
        if (same(v, was)) return null;
        return { title: v.title, effectiveDate: v.date, runOutUntil: v.runOut, rows: v.prices, revision: revisionRef.current };
      },
      fix: () => undefined,
    });
    return () => register(draft.id, null);
  }, [draft.id]);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const key = JSON.stringify(values) + revision;
  const preview = usePreview(`/api/editor/notices/${draft.id}/preview`, () => bodyOf(base, valuesRef.current, revisionRef.current), key);
  const savedPreview = usePreview(`/api/editor/notices/${draft.id}/preview`, () => bodyOf(base, snapshotRef.current, revisionRef.current), JSON.stringify(snapshot) + revision, confirm);

  const fieldId = (sku: string) => `mrp-${draft.id}-${sku}`;
  const named = new Set(namedSkus(preview?.blocking ?? refusal));
  const blockMessage = (preview?.blocking ?? refusal)?.message ?? "";

  // a focused Fix link that leaves hands focus to the preview status
  useEffect(() => {
    if (fixFocused.current && !document.querySelector(`[aria-label="Refused rows ${draft.id}"] a:focus`) && (!document.activeElement || document.activeElement === document.body)) {
      statusEl.current?.focus({ preventScroll: true });
      fixFocused.current = false;
    }
  });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    say("Saving draft.");
    try {
      const saved = await put<Draft>(`/api/editor/notices/${draft.id}`, bodyOf(base, values, revision));
      const fresh = valuesOf(saved);
      setBase(saved);
      setValues(fresh);
      setSnapshot(fresh);
      setRevision(saved.revision);
      setRefusal(null);
      say("Draft saved.");
      onChanged();
    } catch (error) {
      say(error instanceof ApiFailure ? error.body.message : error instanceof LostRequest ? COPY.unavailable : COPY.unavailable);
    } finally {
      setSaving(false);
    }
  };

  const publishing = useRef(false);
  const [publishing_, setPublishing] = useState(false);
  const confirmStatus = dirty ? COPY.unsavedDraft : (refusal?.message ?? savedPreview?.blocking?.message ?? "");
  const blocked = dirty || !!savedPreview?.blocking;

  const publish = async () => {
    if (publishing.current || blocked) return;
    publishing.current = true;
    setPublishing(true);
    say("Publishing.");
    try {
      const done = await post<{ number: string; version: NoticeVersion }>(`/api/editor/notices/${draft.id}/publish`, { baseRevision: revision });
      say(`Notice ${done.number} version ${done.version.version} published.`);
      setConfirm(false);
      onPublished(done.number, done.version);
    } catch (error) {
      if (error instanceof ApiFailure) {
        setRefusal(error.body);
        say(error.body.message);
      } else say(COPY.unavailable);
    } finally {
      publishing.current = false;
      setPublishing(false);
    }
  };

  const closeConfirm = () => {
    if (publishing.current) return;
    setConfirm(false);
    const first = [...named][0];
    requestAnimationFrame(() => {
      const target = first ? document.getElementById(fieldId(first)) : opener.current;
      (target ?? opener.current)?.focus();
    });
  };

  const stickerBatches = [...new Set((savedPreview?.rows ?? []).flatMap((r) => r.stickerBatches))];
  const set = (patch: Partial<Values>) => {
    setValues((v) => ({ ...v, ...patch }));
    setRefusal(null);
  };

  return (
    <div role="group" aria-label={`Draft ${draft.id}`} class="draft">
      <div class="fields">
        <label for={`t-${draft.id}`}>Notice title</label>
        <input id={`t-${draft.id}`} ref={title} type="text" value={values.title} onInput={(e) => set({ title: (e.currentTarget as HTMLInputElement).value })} />
        <label for={`d-${draft.id}`}>Effective date</label>
        <input id={`d-${draft.id}`} type="text" inputMode="numeric" value={values.date} onInput={(e) => set({ date: (e.currentTarget as HTMLInputElement).value })} />
        <label for={`r-${draft.id}`}>Old wrappers until</label>
        <input id={`r-${draft.id}`} type="text" inputMode="numeric" value={values.runOut} onInput={(e) => set({ runOut: (e.currentTarget as HTMLInputElement).value })} />
        {base.rows.map((row) => (
          <div class="price-row" key={row.skuCode}>
            <label for={fieldId(row.skuCode)}>Revised MRP for {row.skuCode}</label>
            <span class="live-name">{draft.rows.find((r) => r.skuCode === row.skuCode)?.name ?? row.name}</span>
            <input
              id={fieldId(row.skuCode)}
              type="text"
              inputMode="decimal"
              value={values.prices[row.skuCode] ?? ""}
              aria-invalid={named.has(row.skuCode) ? "true" : undefined}
              aria-describedby={named.has(row.skuCode) ? `why-${draft.id}-${row.skuCode}` : undefined}
              onInput={(e) => set({ prices: { ...values.prices, [row.skuCode]: (e.currentTarget as HTMLInputElement).value } })}
            />
            {named.has(row.skuCode) && (
              <p id={`why-${draft.id}-${row.skuCode}`} class="field-error">
                {blockMessage}
              </p>
            )}
          </div>
        ))}
      </div>
      <PreviewPanel
        id={draft.id}
        preview={preview}
        refusal={refusal}
        statusRef={(el) => (statusEl.current = el)}
        fieldId={fieldId}
        onFix={(sku) => {
          fixFocused.current = true;
          document.getElementById(fieldId(sku))?.focus();
        }}
      />
      <div class="actions">
        <button type="button" class="rect-button" aria-disabled={saving ? "true" : undefined} onClick={() => void save()}>
          Save draft
        </button>
        <button ref={opener} type="button" class="rect-button" onClick={() => setConfirm(true)}>
          Publish {snapshot.title}
        </button>
      </div>
      {confirm && (
        <Modal label="Confirm publish" initialFocus="[data-first]" onEscape={closeConfirm}>
          <h2>Confirm publish</h2>
          <ul role="list" aria-label="Packs that take the sticker" class="sticker-packs">
            {stickerBatches.length ? stickerBatches.map((b) => <li key={b}>{b}</li>) : <li>{COPY.noStickerPacks}</li>}
          </ul>
          <p class="warning">{COPY.confirmWarning}</p>
          <div role="status" aria-label="Confirm status" class="status">
            {confirmStatus}
          </div>
          <div class="actions">
            <button type="button" class="rect-button" aria-disabled={blocked || publishing_ ? "true" : undefined} onClick={() => void publish()}>
              Publish notice now
            </button>
            <button type="button" class="rect-button" data-first onClick={closeConfirm}>
              Keep editing
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
