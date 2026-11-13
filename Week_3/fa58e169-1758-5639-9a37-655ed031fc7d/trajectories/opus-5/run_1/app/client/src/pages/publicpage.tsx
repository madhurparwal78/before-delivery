import { useEffect, useMemo, useState } from 'react';
import { api, type PublicData } from '../api';
import { useApp } from '../app';
import { analyse, cellKey, cellMap } from '../chartstate';
import { ChartGrid } from '../components/chartgrid';
import { Instructions } from '../components/instructions';
import { Shell } from '../shell';

export function PublicScreen({ id }: { id: string }): JSX.Element {
  const { config } = useApp();
  const [data, setData] = useState<PublicData | null>(null);
  const [missing, setMissing] = useState(false);
  const [pin, setPin] = useState<number | null>(null);
  const [hover, setHover] = useState<{ row: number; index: number } | null>(null);

  const limits = config?.limits;
  const colourLimits = useMemo(
    () => ({ coloursPerRow: limits?.coloursPerRow ?? 2, maxFloat: limits?.maxFloat ?? 5 }),
    [limits?.coloursPerRow, limits?.maxFloat],
  );

  useEffect(() => {
    void (async () => {
      try {
        setData(await api.get<PublicData>(`/api/public/${id}`));
      } catch {
        setMissing(true);
      }
    })();
  }, [id]);

  const cells = useMemo(() => (data ? cellMap(data.cells) : new Map()), [data]);
  const analysis = useMemo(
    () => (data ? analyse({ ...data, cells: data.cells }, colourLimits) : null),
    [data, colourLimits],
  );

  if (missing) {
    return (
      <Shell lead="This page is not here.">
        <h1>Not found.</h1>
      </Shell>
    );
  }
  if (!data || !analysis) return <Shell lead="Loading..." />;

  const liftedCells = new Set<string>();
  const liftedTokens = new Set<string>();
  const pinnedTokens = new Set<string>();
  const pinnedCells = new Set<string>();
  const addRow = (which: number, into: { cells: Set<string>; tokens: Set<string> }): void => {
    const row = analysis.rows.find((entry) => entry.row === which);
    row?.tokens.forEach((token, index) => {
      into.tokens.add(`${which}:${index}`);
      for (const cell of token.cells) into.cells.add(cellKey(cell.row, cell.col));
    });
  };
  if (pin !== null) {
    addRow(pin, { cells: pinnedCells, tokens: pinnedTokens });
    for (const key of pinnedCells) liftedCells.add(key);
    for (const key of pinnedTokens) liftedTokens.add(key);
  }
  if (hover) {
    const row = analysis.rows.find((entry) => entry.row === hover.row);
    const token = row?.tokens[hover.index];
    if (token) {
      liftedTokens.add(`${hover.row}:${hover.index}`);
      for (const cell of token.cells) liftedCells.add(cellKey(cell.row, cell.col));
    }
  }

  return (
    <Shell wide lead={`${data.name}, version ${data.version}.`}>
      <h1>{data.name}</h1>
      <a className="sheet-link" href={`/api/patterns/${data.id}/sheet.pdf`}>
        Download sheet
      </a>
      <ChartGrid
        name="Stitch chart"
        shape={data}
        cells={cells}
        rows={data.rows.map((row) => ({
          row: row.row,
          side: row.side,
          used: row.used,
          made: row.made,
          state: row.state,
        }))}
        cursor={{ row: 1, col: 1 }}
        lifted={liftedCells}
        pinned={pinnedCells}
      />
      <Instructions
        rows={analysis.rows}
        lines={new Map(data.rows.map((row) => [row.row, row.text]))}
        liftedTokens={liftedTokens}
        pinnedTokens={pinnedTokens}
        editable={false}
        editing={null}
        onTokenHover={setHover}
        onTokenFocus={setHover}
        onPinToken={(row) => setPin(pin === row ? null : row)}
        onPinRow={(row) => setPin(pin === row ? null : row)}
      />
    </Shell>
  );
}
