import { useEffect, useState } from "react";
import type { JSX } from "react";
import { api, ApiFail, type MeData, type VersionSummary } from "../lib/api";
import { StitchGrid } from "../components/Chart";
import { s } from "../../common/copy";

interface CompareResult {
  a: number;
  b: number;
  rowsChanged: number;
  rowsAdded: number;
  rowsRemoved: number;
  cellsChanged: number;
  stitchesFrom: number;
  stitchesTo: number;
  summary: string;
  cells: { row: number; col: number; stitch: string; colour: string; diff: string }[];
  width: number;
  height: number;
  craft: "knit" | "crochet";
  mode: "flat" | "round";
  terms: string | null;
  castOn: number;
  colours: { letter: string; name: string; hex: string }[];
  repeats: { id: string; fromCol: number; toCol: number; fromRow: number; toRow: number; times: number }[];
}

function buildRowShapes(result: CompareResult): never[] {
  const byRow = new Map<number, number>();
  for (const cell of result.cells) {
    byRow.set(cell.row, (byRow.get(cell.row) ?? 0) + 1);
  }
  const rows: unknown[] = [];
  for (let row = 1; row <= result.height; row++) {
    rows.push({ row, side: "RS", used: byRow.get(row) ?? 0, made: byRow.get(row) ?? 0, state: "ok", errors: [], text: "", notes: 0 });
  }
  return rows as never[];
}

export function ComparePage(props: { me: MeData; layout: string; id: string; query: URLSearchParams }): JSX.Element {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api<{ versions: VersionSummary[] }>(`/api/patterns/${props.id}/versions`)
      .then((data) => {
        const list = data.versions;
        setVersions(list);
        const queryA = Number.parseInt(props.query.get("a") ?? "", 10);
        const queryB = Number.parseInt(props.query.get("b") ?? "", 10);
        if (Number.isFinite(queryA) && Number.isFinite(queryB)) {
          setFrom(queryA);
          setTo(queryB);
          void runCompare(queryA, queryB);
        } else if (list.length > 0) {
          const defaultFrom = list.length >= 2 ? list[list.length - 2]!.version : list[0]!.version;
          const defaultTo = list[list.length - 1]!.version;
          setFrom(defaultFrom);
          setTo(defaultTo);
          void runCompare(defaultFrom, defaultTo);
        } else {
          setLoading(false);
        }
      })
      .catch(() => {
        setMissing(true);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.id]);

  const runCompare = async (a: number, b: number): Promise<void> => {
    setLoading(true);
    try {
      const data = await api<CompareResult>(`/api/patterns/${props.id}/compare?a=${a}&b=${b}`);
      setResult(data);
    } catch (error) {
      if (error instanceof ApiFail && error.status === 404) setMissing(true);
    } finally {
      setLoading(false);
    }
  };

  if (missing) {
    return (
      <div className="panel">
        <h1 className="lead">{s.notFound}</h1>
      </div>
    );
  }

  const chart = result
    ? {
        id: props.id,
        name: "",
        craft: result.craft,
        mode: result.mode,
        terms: null,
        castOn: result.castOn,
        width: result.width,
        height: result.height,
        colours: result.colours,
        repeats: result.repeats,
        cells: result.cells.map((cell) => ({ ...cell, repeat: "", rev: 1 })),
        rows: buildRowShapes(result),
      }
    : null;

  return (
    <>
      <div className="panel">
        <div className="field">
          <label htmlFor="from-version">From version</label>
          <select
            id="from-version"
            aria-label="From version"
            value={from ?? ""}
            disabled={versions.length === 0}
            onChange={(event) => setFrom(Number(event.target.value))}
          >
            {versions.map((version) => (
              <option key={version.version} value={version.version}>{`Version ${version.version}`}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="to-version">To version</label>
          <select
            id="to-version"
            aria-label="To version"
            value={to ?? ""}
            disabled={versions.length === 0}
            onChange={(event) => setTo(Number(event.target.value))}
          >
            {versions.map((version) => (
              <option key={version.version} value={version.version}>{`Version ${version.version}`}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="button-primary"
          disabled={versions.length === 0 || from === null || to === null}
          onClick={() => {
            if (from !== null && to !== null) {
              window.history.replaceState(null, "", `/patterns/${props.id}/compare?a=${from}&b=${to}`);
              void runCompare(from, to);
            }
          }}
        >
          Compare
        </button>
        <p className="status" role="status" aria-live="polite" aria-label="Compare result">
          {result?.summary ?? ""}
        </p>
      </div>
      {loading ? <h1 className="lead">{s.loading}</h1> : null}
      {chart && result ? (
        <div className="panel">
          <StitchGrid
            pattern={chart}
            cursor={null}
            selection={null}
            peers={{}}
            readOnly
            gridName="Compare chart"
            diffByCell={new Map(result.cells.map((cell) => [`${cell.row}:${cell.col}`, cell.diff]))}
          />
        </div>
      ) : null}
    </>
  );
}
