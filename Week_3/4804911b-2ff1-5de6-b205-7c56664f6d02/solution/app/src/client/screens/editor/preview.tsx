import { useEffect, useRef, useState } from "preact/hooks";
import { COPY, rupees } from "../../../shared/copy";
import type { ApiError, Preview } from "../../../shared/types";
import { DataTable } from "../../lib/DataTable";
import { useEvery, useWide } from "../../lib/hooks";
import { post } from "../../lib/net";

/** Live preview of typed values: on input after a short pause, and again every 5 seconds. The latest answer always wins. */
export function usePreview(url: string, body: () => unknown, key: string, enabled = true): Preview | null {
  const [preview, setPreview] = useState<Preview | null>(null);
  const token = useRef(0);
  const latest = useRef(body);
  latest.current = body;
  const run = () => {
    const mine = ++token.current;
    void post<Preview>(url, latest.current())
      .then((answer) => {
        if (mine === token.current) setPreview((old) => (old && JSON.stringify(old) === JSON.stringify(answer) ? old : answer));
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    if (!enabled) return;
    const id = setTimeout(run, 400);
    return () => clearTimeout(id);
  }, [key, enabled]);
  useEvery(enabled ? 5000 : null, run);
  return preview;
}

export function namedSkus(blocking: ApiError | null): string[] {
  const rows = blocking?.["rows"];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => (typeof r === "string" ? r : ((r as { skuCode?: string }).skuCode ?? ""))).filter(Boolean);
}

export function PreviewPanel({ id, preview, refusal, onFix, statusRef, fieldId }: { id: string; preview: Preview | null; refusal: ApiError | null; onFix: (sku: string) => void; statusRef: (el: HTMLElement | null) => void; fieldId: (sku: string) => string }) {
  const wide = useWide();
  const named = namedSkus(preview?.blocking ?? refusal);
  return (
    <section role="region" class="preview" aria-label={`Publish preview ${id}`}>
      {preview && preview.rows.length > 0 && (
        <DataTable
          label={`Preview rows ${id}`}
          wide={wide}
          columns={[{ head: "Pack", lead: true }, { head: "Old MRP" }, { head: "Ceiling" }, { head: "Packs that take the sticker" }]}
          rows={preview.rows.map((r) => ({
            key: r.skuCode,
            cells: [r.name, `Rs ${rupees(r.oldMrpPaise)}`, r.ceilingPaise === null ? "None" : `Rs ${rupees(r.ceilingPaise)}`, r.stickerBatches.length ? r.stickerBatches.join(", ") : "None"],
          }))}
        />
      )}
      <div role="status" aria-label={`Preview status ${id}`} class="status" tabIndex={-1} ref={statusRef}>
        {preview ? (preview.blocking ? preview.blocking.message : COPY.previewClear) : ""}
      </div>
      {named.length > 0 && (
        <ul role="list" aria-label={`Refused rows ${id}`} class="refused">
          {named.map((sku) => (
            <li key={sku}>
              <a
                href={`#${fieldId(sku)}`}
                onClick={(e) => {
                  e.preventDefault();
                  onFix(sku);
                }}
              >
                Fix {sku}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
