import { useState } from "react";
import type { ImportJson, ImportTable } from "../../../server/imports.js";
import { failureText, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { Button, Field, Page, Rest, StatusBlock } from "../../lib/ui.js";
import { FilePicker } from "./FilePicker.js";

type Phase = "idle" | "checking" | "importing";

const TABLE_NAMES: Array<{ value: ImportTable; label: string }> = [
  { value: "people", label: "People" },
  { value: "configuration_items", label: "Configuration items" },
];
const ACTION_WORDS: Record<ImportJson["rows"][number]["action"], string> = { create: "Create", update: "Update", unchanged: "Unchanged", error: "Error" };
const OUTCOME_WORDS: Record<NonNullable<ImportJson["results"]>[number]["outcome"], string> = { created: "Created", updated: "Updated", unchanged: "Unchanged", failed: "Failed" };

function checkedText(counts: ImportJson["counts"]): string {
  return `Import checked: ${counts.create} to create, ${counts.update} to update, ${counts.unchanged} unchanged, ${counts.error} with errors.`;
}

function finishedText(results: NonNullable<ImportJson["results"]>): string {
  const count = (outcome: string): number => results.filter((result) => result.outcome === outcome).length;
  return `Import finished: ${count("created")} created, ${count("updated")} updated, ${count("unchanged")} unchanged, ${count("failed")} failed.`;
}

export function Imports(): JSX.Element {
  const announce = useAnnounce();
  const [table, setTable] = useState<ImportTable>("people");
  const [mapping, setMapping] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<ImportJson | null>(null);
  const [summary, setSummary] = useState("");
  const [problem, setProblem] = useState("");

  const fail = (error: unknown): void => {
    const text = failureText(error);
    setProblem(text);
    announce(text);
    setPhase("idle");
  };

  const upload = (file: File): void => {
    if (phase !== "idle") return;
    const body = new FormData();
    body.set("file", file);
    body.set("table", table);
    if (mapping.trim() !== "") body.set("mapping", mapping);
    setPhase("checking");
    setProblem("");
    setSummary("Checking import...");
    announce("Checking import...");
    post<{ import: ImportJson }>("/api/imports", body).then(({ import: checked }) => {
      const text = checkedText(checked.counts);
      setPreview(checked);
      setSummary(text);
      announce(text);
      setPhase("idle");
    }, (error: unknown) => {
      setSummary("");
      fail(error);
    });
  };

  const commit = (): void => {
    if (!preview || phase !== "idle" || preview.results !== undefined) return;
    setPhase("importing");
    setProblem("");
    setSummary("Importing...");
    announce("Importing...");
    post<{ import: ImportJson }>(`/api/imports/${preview.id}/commit`).then(({ import: done }) => {
      const text = finishedText(done.results ?? []);
      setPreview(done);
      setSummary(text);
      announce(text);
      setPhase("idle");
    }, (error: unknown) => {
      setSummary(checkedText(preview.counts));
      fail(error);
    });
  };

  const busy = phase !== "idle";
  const committed = preview?.results !== undefined;
  return (
    <Page subject="Imports">
      <Rest narrow>
        <div className="stack">
          <Field label="Table">
            <select value={table} onChange={(event) => setTable(event.target.value as ImportTable)}>
              {TABLE_NAMES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Column mapping (optional JSON)">
            <textarea value={mapping} placeholder='{"file column": "published column"}' onChange={(event) => setMapping(event.target.value)} />
          </Field>
          <div className="row">
            <FilePicker label="Upload import file" accept=".csv,text/csv,text/plain" busy={phase === "checking"} onFile={upload} />
          </div>
          {summary ? <p className="job-line">{summary}</p> : null}
          {problem ? <p className="form-error">{problem}</p> : null}
        </div>
      </Rest>
      {preview ? (
        <Rest label="Import result">
          <div className="stack">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Import rows">
              <table className="data-table" aria-label="Import preview">
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      Line
                    </th>
                    <th scope="col">Action</th>
                    <th scope="col">Key</th>
                    <th scope="col">Errors</th>
                    {committed ? <th scope="col">Result</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const result = preview.results?.find((entry) => entry.line === row.line);
                    return (
                      <tr key={row.line}>
                        <td className="num">{row.line}</td>
                        <td>
                          <StatusBlock outlined={row.action !== "error"}>{ACTION_WORDS[row.action]}</StatusBlock>
                        </td>
                        <td>{row.key}</td>
                        <td>
                          {row.errors.map((line) => (
                            <p key={line}>{line}</p>
                          ))}
                        </td>
                        {committed ? <td>{result ? OUTCOME_WORDS[result.outcome] : ""}</td> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row">
              <Button busy={phase === "importing"} aria-disabled={busy || committed || undefined} onClick={commit}>
                Commit import
              </Button>
            </div>
          </div>
        </Rest>
      ) : null}
    </Page>
  );
}
