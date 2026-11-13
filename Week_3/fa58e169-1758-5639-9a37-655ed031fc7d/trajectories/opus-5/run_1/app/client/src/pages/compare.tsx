import { useEffect, useMemo, useState } from 'react';
import type { Cell } from '../../../src/domain/types';
import { api, ApiFailure, type CompareData, type PatternData, type VersionData } from '../api';
import { useApp } from '../app';
import { analyse, cellKey, cellMap } from '../chartstate';
import { ChartGrid } from '../components/chartgrid';
import { Shell } from '../shell';

export function CompareScreen({ id }: { id: string }): JSX.Element {
  const { query, navigate, config } = useApp();
  const colourLimits = useMemo(
    () => ({
      coloursPerRow: config?.limits.coloursPerRow ?? 2,
      maxFloat: config?.limits.maxFloat ?? 5,
    }),
    [config?.limits.coloursPerRow, config?.limits.maxFloat],
  );
  const [versions, setVersions] = useState<VersionData[]>([]);
  const [pattern, setPattern] = useState<PatternData | null>(null);
  const [result, setResult] = useState<CompareData | null>(null);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const askedA = query.get('a');
  const askedB = query.get('b');

  useEffect(() => {
    void (async () => {
      try {
        const [list, data] = await Promise.all([
          api.get<{ versions: VersionData[] }>(`/api/patterns/${id}/versions`),
          api.get<PatternData>(`/api/patterns/${id}`),
        ]);
        setVersions(list.versions);
        setPattern(data);
        const numbers = list.versions.map((entry) => String(entry.version));
        const latest = numbers[numbers.length - 1] ?? '';
        const second = numbers[numbers.length - 2] ?? latest;
        const a = askedA ?? second;
        const b = askedB ?? latest;
        setFrom(a);
        setTo(b);
        if (a === '' || b === '') return;
        try {
          setResult(await api.get<CompareData>(`/api/patterns/${id}/compare?a=${a}&b=${b}`));
        } catch {
          setNotFound(true);
        }
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.status === 404) setNotFound(true);
        else setFailed(true);
      }
    })();
  }, [id, askedA, askedB]);

  const cells = useMemo(() => {
    if (!result) return new Map<string, Cell>();
    return cellMap(
      result.cells.map((cell) => ({
        row: cell.row,
        col: cell.col,
        stitch: cell.stitch,
        colour: cell.colour,
        repeat: null,
        rev: 0,
      })),
    );
  }, [result]);

  const diff = useMemo(() => {
    const map = new Map<string, string>();
    for (const cell of result?.cells ?? []) map.set(cellKey(cell.row, cell.col), cell.diff);
    return map;
  }, [result]);

  if (notFound) {
    return (
      <Shell lead="This page is not here.">
        <h1>Not found.</h1>
      </Shell>
    );
  }
  if (failed) return <Shell lead="This page could not be loaded. Reload to try again." />;
  if (!pattern) return <Shell lead="Loading..." />;

  const height = Math.max(...(result?.cells.map((cell) => cell.row) ?? [1]), 1);
  const width = Math.max(...(result?.cells.map((cell) => cell.col) ?? [1]), 1);
  const shape = {
    craft: pattern.craft,
    mode: pattern.mode,
    terms: pattern.terms,
    castOn: pattern.castOn,
    width,
    height,
    colours: pattern.colours,
    repeats: [],
  };
  const analysis = result ? analyse({ ...shape, cells: [...cells.values()] }, colourLimits) : null;

  return (
    <Shell wide lead="Compare two saved versions.">
      <h1>{`Compare ${pattern.name}`}</h1>
      <div className="row-of-buttons">
        <label className="field">
          <span>From version</span>
          <select aria-label="From version" value={from} onChange={(event) => setFrom(event.target.value)}>
            {versions.map((version) => (
              <option key={version.version} value={String(version.version)}>
                {`Version ${version.version}`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>To version</span>
          <select aria-label="To version" value={to} onChange={(event) => setTo(event.target.value)}>
            {versions.map((version) => (
              <option key={version.version} value={String(version.version)}>
                {`Version ${version.version}`}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={versions.length === 0}
          onClick={() => navigate(`/patterns/${id}/compare?a=${from}&b=${to}`)}
        >
          Compare
        </button>
      </div>
      <p role="status" aria-label="Compare result" className="status-line">
        {result?.summary ?? ''}
      </p>
      {result ? (
        <ChartGrid
          name="Compare chart"
          shape={shape}
          cells={cells}
          rows={(analysis?.rows ?? []).map((row) => ({
            row: row.row,
            side: row.side,
            used: row.used,
            made: row.made,
            state: row.state,
          }))}
          cursor={{ row: 1, col: 1 }}
          diff={diff}
        />
      ) : null}
    </Shell>
  );
}
