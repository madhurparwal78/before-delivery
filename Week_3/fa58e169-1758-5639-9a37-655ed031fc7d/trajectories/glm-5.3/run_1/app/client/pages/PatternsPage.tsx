import { useEffect, useState } from "react";
import type { JSX } from "react";
import { api, ApiFail, type MeData, type PatternEntry } from "../lib/api";
import { s, fieldErrors } from "../../common/copy";
import { NewPatternDialog } from "../components/NewPatternDialog";

export function PatternsPage(props: { me: MeData; layout: string }): JSX.Element {
  const [patterns, setPatterns] = useState<PatternEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    void api<{ patterns: PatternEntry[] }>("/api/patterns")
      .then((data) => {
        setPatterns(data.patterns);
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const open = () => setDialogOpen(true);
    window.addEventListener("open-new-pattern", open);
    return () => window.removeEventListener("open-new-pattern", open);
  }, []);

  if (loading) {
    return (
      <>
        <h1 className="lead">{s.loading}</h1>
        <div className="panel" />
      </>
    );
  }

  if (failed) {
    return (
      <>
        <h1 className="lead">{s.pageError}</h1>
        <div className="panel" />
      </>
    );
  }

  return (
    <>
      <h1 className="lead">{patterns.length === 0 ? "Your patterns" : "Your patterns"}</h1>
      <div className="panel">
        {patterns.length === 0 ? (
          <>
            <p>{s.noPatterns}</p>
            <UseSampleButton />
            <button type="button" className="button-primary" onClick={() => setDialogOpen(true)} style={{ marginLeft: 8 }}>
              New pattern
            </button>
          </>
        ) : (
          <ul className="pattern-cards" role="list" aria-label="Patterns">
            {patterns.map((pattern) => (
              <li key={`${pattern.id}-${pattern.role}`}>
                <a className="kind-card" href={pattern.role === "tester" ? `/follow/${pattern.id}` : `/patterns/${pattern.id}`}>
                  <span className="line-tile">{pattern.state === "published" ? "Pub" : "Draft"}</span>
                  <span>{pattern.name}</span>
                  <span className="arrow" aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {patterns.length > 0 ? (
          <p style={{ marginTop: 12 }}>
            <button type="button" className="button-primary" onClick={() => setDialogOpen(true)}>
              New pattern
            </button>
          </p>
        ) : null}
      </div>
      {dialogOpen ? <NewPatternDialog onClose={() => setDialogOpen(false)} /> : null}
    </>
  );
}

function UseSampleButton(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="button-plain"
        aria-busy={busy}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await api<{ id: string }>("/api/patterns", {
              method: "POST",
              body: JSON.stringify({ sample: true }),
            });
            window.location.href = `/patterns/${result.id}`;
          } catch (error) {
            setError(error instanceof ApiFail ? String(error.payload.message ?? "") : fieldErrors.patternNameEmpty);
            setBusy(false);
          }
        }}
      >
        {s.useSample}
      </button>
      {error ? (
        <p className="alert" role="alert" aria-label="Pattern error">
          {error}
        </p>
      ) : null}
    </>
  );
}
