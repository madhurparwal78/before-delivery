import { useState } from "react";
import type { DiscountCode } from "../../shared/api";
import { inr, shortDateTime } from "../../shared/format";
import { Loading } from "../components/Panel";
import { api } from "../lib/api";
import { useData } from "../lib/useData";
import { ErrorAlert, PageTitle, SelectField, TableWrap, TextField, useAction } from "./ui";

const COLLECTIONS = [
  { value: "", label: "Every line" },
  { value: "luggage", label: "Luggage" },
  { value: "backpacks", label: "Backpacks" },
  { value: "totes", label: "Totes" },
  { value: "wallets", label: "Wallets" },
  { value: "accessories", label: "Accessories" },
];

/** A whole number goes as a number; anything else goes as typed so the API names the problem. */
function amount(text: string): number | string {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : text;
}

/** `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` read as India Standard Time and sent as UTC; an ISO instant is sent as it is. */
function instant(text: string): string {
  const match = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (!match) return text.trim();
  const [, y, mo, d, h = "00", mi = "00"] = match;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - (5 * 60 + 30) * 60_000;
  return new Date(utc).toISOString().replace(".000Z", "Z");
}

const EMPTY = { code: "", kind: "percent", value: "", collection: "", minimum: "", starts: "", ends: "", limit: "" };

export function Promotions() {
  const { data, loading, reload } = useData<DiscountCode[]>("/api/admin/discount-codes");
  const [form, setForm] = useState(EMPTY);
  const { pending, error, run } = useAction();
  const set = (patch: Partial<typeof EMPTY>) => setForm({ ...form, ...patch });

  const create = async () => {
    const ok = await run(async () => {
      const created = await api.post<DiscountCode>("/api/admin/discount-codes", {
        code: form.code,
        kind: form.kind,
        value: amount(form.value),
        collection: form.collection === "" ? null : form.collection,
        minimum: form.minimum.trim() === "" ? 0 : amount(form.minimum),
        starts_at: instant(form.starts),
        ends_at: instant(form.ends),
        usage_limit: form.limit.trim() === "" ? null : amount(form.limit),
      });
      await reload();
      return `Code ${created.code} created.`;
    });
    if (ok) setForm(EMPTY);
  };

  const fields = error?.fields ?? {};
  return (
    <>
      <PageTitle>Promotions</PageTitle>
      <form
        className="staff-section"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <h2>New code</h2>
        <TextField label="Code" value={form.code} onChange={(code) => set({ code })} error={fields.code} />
        <fieldset className="field" role="radiogroup" aria-label="Kind" aria-describedby={fields.kind ? "kind-error" : undefined}>
          <legend>Kind</legend>
          <label className="check">
            <input type="radio" name="kind" checked={form.kind === "percent"} onChange={() => set({ kind: "percent" })} />
            Percentage
          </label>
          <label className="check">
            <input type="radio" name="kind" checked={form.kind === "fixed"} onChange={() => set({ kind: "fixed" })} />
            Fixed amount
          </label>
          {fields.kind && (
            <p id="kind-error" className="field-error">
              {fields.kind}
            </p>
          )}
        </fieldset>
        <TextField label="Value" inputMode="numeric" value={form.value} onChange={(value) => set({ value })} error={fields.value} />
        <SelectField label="Applies to" value={form.collection} onChange={(collection) => set({ collection })} options={COLLECTIONS} error={fields.collection} />
        <TextField label="Minimum spend" inputMode="numeric" value={form.minimum} onChange={(minimum) => set({ minimum })} error={fields.minimum} />
        <TextField label="Starts" value={form.starts} onChange={(starts) => set({ starts })} error={fields.starts_at} hint="India Standard Time, as YYYY-MM-DD HH:MM" />
        <TextField label="Ends" value={form.ends} onChange={(ends) => set({ ends })} error={fields.ends_at} hint="India Standard Time, as YYYY-MM-DD HH:MM" />
        <TextField label="Usage limit" inputMode="numeric" value={form.limit} onChange={(limit) => set({ limit })} error={fields.usage_limit} />
        <ErrorAlert error={error && error.code !== "validation_failed" ? error : null} />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving" : "Create code"}
        </button>
      </form>

      {loading || !data ? (
        <Loading />
      ) : (
        <TableWrap>
          <table className="tbl" aria-label="Discount codes">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Value</th>
                <th scope="col">Applies to</th>
                <th scope="col">Minimum</th>
                <th scope="col">Starts</th>
                <th scope="col">Ends</th>
                <th scope="col">Used</th>
              </tr>
            </thead>
            <tbody>
              {data.map((code) => (
                <tr key={code.code}>
                  <th scope="row">{code.code}</th>
                  <td>{code.kind === "percent" ? `${code.value}%` : inr(code.value)}</td>
                  <td>{COLLECTIONS.find((c) => c.value === (code.collection ?? ""))?.label ?? code.collection}</td>
                  <td>{inr(code.minimum)}</td>
                  <td>{shortDateTime(code.starts_at)}</td>
                  <td>{shortDateTime(code.ends_at)}</td>
                  <td>{code.usage_limit === null ? `${code.used}` : `${code.used} of ${code.usage_limit}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
