// Spoor Pipe: type a pipe, run it, read the typed result table.
import { useState, type FormEvent } from "react";
import { api, ApiFailure } from "../lib/api";
import { useBusy } from "../lib/ui";

interface PipeResult {
  columns: Array<{ name: string; type: string }>;
  rows: unknown[][];
  partial: boolean;
  skipped_generations: number;
}

const cell = (value: unknown): string => (value === null ? "null" : String(value));

export function PipesPage() {
  const [pipe, setPipe] = useState("");
  const [result, setResult] = useState<PipeResult | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        setFailure(null);
        setResult(await api.post<PipeResult>("/api/pipe", { pipe }));
      } catch (error) {
        setResult(null);
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <div className="stack">
      <h1>Pipes</h1>
      <form onSubmit={submit} className="stack" noValidate>
        <div className="field">
          <label htmlFor="pipe">Spoor Pipe</label>
          <textarea id="pipe" className="mono" rows={3} value={pipe} placeholder="FROM web | WHERE level:error | STATS count(*) AS n BY host" onChange={(event) => setPipe(event.target.value)} spellCheck={false} />
        </div>
        <div><button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Run</button></div>
      </form>
      {failure ? <div role="alert" aria-label="Pipe error" className="error-box"><p>{failure.message}</p></div> : null}
      {result?.partial ? (
        <p role="status" aria-label="Partial results" className="notice">
          Partial results: {result.skipped_generations} archived {result.skipped_generations === 1 ? "generation" : "generations"} skipped because storage is unavailable.
        </p>
      ) : null}
      {result ? (
        <div className="table-wrap">
          <table className="data" aria-label="Result">
            <thead><tr>{result.columns.map((column) => <th scope="col" key={column.name} data-type={column.type}>{column.name}</th>)}</tr></thead>
            <tbody>
              {result.rows.map((row, k) => (
                <tr key={k}>{row.map((value, at) => <td key={at} className={`mono${typeof value === "number" ? " num" : ""}`}>{cell(value)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
