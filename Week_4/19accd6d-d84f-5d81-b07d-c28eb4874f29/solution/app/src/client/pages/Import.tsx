import { useEffect, useRef, useState } from "react";
import type { ImportResult } from "../../shared/api";
import { pluralize } from "../workbench/InputPane";
import { api, ApiFailure } from "../api";
import { Link } from "../router";
import { session } from "../session";
import { useStore } from "../store";
import { Screen } from "../ui/Screen";
import { FileUp } from "lucide-react";

type Report =
  | { kind: "created"; name: string; lines: number; recipeId: string }
  | { kind: "already"; message: string; recipeId: string }
  | { kind: "rejected"; message: string; lines: string[] }
  | { kind: "error"; message: string };

export function Import() {
  const user = useStore(session, (state) => state.user);
  const teams = useStore(session, (state) => state.teams);
  const [text, setText] = useState("");
  const [saveTo, setSaveTo] = useState("personal");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);

  useEffect(() => setReport(null), [text]);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const answer = await api<{ import: ImportResult }>("POST", "/api/imports", {
        text,
        owner: saveTo === "personal" ? { type: "user", id: user?.id } : { type: "team", id: saveTo },
      });
      const result = answer.import;
      setReport(
        result.status === "created"
          ? { kind: "created", name: result.recipe.name, lines: result.lineCount as number, recipeId: result.recipe.id }
          : { kind: "already", message: result.message as string, recipeId: result.recipe.id },
      );
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setReport(
        error.code === "import_unmatched"
          ? { kind: "rejected", message: error.message, lines: error.details?.lines ?? [] }
          : { kind: "error", message: error.message },
      );
    }
    setBusy(false);
  };

  return (
    <Screen label="Import recipes" title="Import recipes" strip="Wring Line v1 text">
      {!user ? (
        <p className="empty"><Link to="/signin">Sign in</Link> to import recipes.</p>
      ) : (
        <form className="form import-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="form-field">
            <label htmlFor="wring-text">Wring Line text</label>
            <textarea id="wring-text" className="mono" rows={10} spellCheck={false} placeholder={"wringline 1\n# name: Webhook body\nunb64\ngunzip"} value={text} onChange={(event) => setText(event.target.value)} />
          </div>
          <input
            ref={chooser}
            type="file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void file.text().then(setText);
            }}
          />
          <div className="form-row">
            <button type="button" onClick={() => chooser.current?.click()}>
              <FileUp size={18} aria-hidden="true" />
              <span>Choose file</span>
            </button>
            <div className="form-field inline">
              <label htmlFor="import-save-to">Save to</label>
              <select id="import-save-to" value={saveTo} onChange={(event) => setSaveTo(event.target.value)}>
                <option value="personal">Personal</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="primary" aria-busy={busy}>Import</button>
          </div>
        </form>
      )}
      <div role="region" aria-label="Import report" className="report" tabIndex={-1}>
        {report?.kind === "created" && (
          <p>
            Created {report.name} (version 1) from {pluralize(report.lines, "line")}.{" "}
            <Link to={`/w?recipe=${report.recipeId}`}>Open in workbench</Link>
          </p>
        )}
        {report?.kind === "already" && (
          <p>
            {report.message} <Link to={`/w?recipe=${report.recipeId}`}>Open in workbench</Link>
          </p>
        )}
        {report?.kind === "rejected" && (
          <>
            <p>{report.message}</p>
            <ul className="report-lines mono">
              {report.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
        {report?.kind === "error" && <p>{report.message}</p>}
      </div>
    </Screen>
  );
}

