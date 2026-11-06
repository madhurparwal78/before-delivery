import { type FormEvent, useState } from "react";
import type { IndexTableView } from "../../shared/api.js";
import { ApiFailure, api } from "../api.js";
import { Field, type FieldErrors, FixFields } from "../components/Forms.js";
import { EmptyState, LoadFailed, Skeleton, StatusRegion } from "../components/ui.js";
import { useRefresh } from "../hooks.js";
import { isStaff, useUser } from "../session.js";

/** Lines such as `SS 0.8270`, `SS=0.8270` or `SS: 0.8270` become a class-to-factor map. */
function parseFactors(text: string): Record<string, string> {
  const factors: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const [code, factor] = line.trim().split(/[\s:=,]+/);
    if (code) factors[code] = factor ?? "";
  }
  return factors;
}

export function IndexTables() {
  const user = useUser();
  const [tables, setTables] = useState<IndexTableView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const reload = useRefresh(
    async () => {
      try {
        setTables((await api.get<{ tables: IndexTableView[] }>("/api/index-tables")).tables);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    10,
    [],
  );
  return (
    <>
      <div className="page-head">
        <h1>Index tables</h1>
      </div>
      <StatusRegion name="Index table updates">{message}</StatusRegion>
      {isStaff(user, "chair") ? <LoadForm onMessage={setMessage} onLoaded={reload} /> : null}
      {tables === null ? (
        failed ? (
          <LoadFailed retry={reload} />
        ) : (
          <Skeleton />
        )
      ) : tables.length === 0 ? (
        <EmptyState next="The chair loads one with an effective date and its class factors.">No index table has been loaded yet.</EmptyState>
      ) : (
        <div className="table-grid">
          {[...tables].reverse().map((table) => (
            <table key={table.id} aria-label={`Index table effective ${table.effectiveDate}`} className="compact">
              <caption>Effective {table.effectiveDate}</caption>
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col" className="num">Factor</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(table.factors).map(([code, factor]) => (
                  <tr key={code}>
                    <td>{code}</td>
                    <td className="num">{factor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}
    </>
  );
}

function LoadForm({ onMessage, onLoaded }: { onMessage: (text: string) => void; onLoaded: () => void }) {
  const [effectiveDate, setEffectiveDate] = useState("");
  const [factors, setFactors] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    onMessage("Loading table");
    const date = effectiveDate.trim();
    try {
      await api.post("/api/index-tables", { effectiveDate: date, factors: parseFactors(factors) });
      onMessage(`Index table effective ${date} loaded.`);
      setEffectiveDate("");
      setFactors("");
      onLoaded();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setErrors(error.fields);
        onMessage("");
      } else onMessage(error instanceof ApiFailure ? error.message : "Could not load the table. Try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <form aria-label="Load index table" className="panel stack" onSubmit={(e) => void submit(e)} noValidate>
      <h2>Load a table</h2>
      <FixFields form="table" errors={errors} />
      <Field form="table" name="effectiveDate" label="Effective date" error={errors["effectiveDate"]} hint="YYYY-MM-DD">
        {(p) => <input type="text" inputMode="numeric" {...p} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />}
      </Field>
      <Field form="table" name="factors" label="Factors" error={errors["factors"]} hint="One class per line, for example SS 0.8270">
        {(p) => <textarea rows={6} {...p} value={factors} onChange={(e) => setFactors(e.target.value)} />}
      </Field>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
          Load table
        </button>
      </div>
    </form>
  );
}
