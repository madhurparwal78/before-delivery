import type { Cell, Line, LineStatus, UnitKind } from '../../shared/types.ts';

/** The crate's whole picture is derived from a line in this one place. */

export type TopColour = 'mine' | 'taken' | 'dropped';

export interface CrateModel {
  caseName: string;
  pack: number;
  columns: number;
  rows: number;
  unit: UnitKind;
  cells: Cell[];
  status: LineStatus;
  lidClosed: boolean;
  stamp: 'SEALED' | 'TAKEN UP' | 'DROPPED' | null;
  dropped: boolean;
  version: number;
}

/** The grid has the smallest divisor of the pack that is at least its square root. */
export function gridColumns(pack: number): number {
  const root = Math.sqrt(pack);
  for (let columns = Math.ceil(root); columns <= pack; columns += 1) {
    if (pack % columns === 0) return columns;
  }
  return pack;
}

export function stateWord(status: LineStatus): string {
  if (status === 'taken_up') return 'taken up';
  return status;
}

export function crateModelFromLine(line: Line): CrateModel {
  const columns = gridColumns(line.pack);
  return {
    caseName: line.case_name,
    pack: line.pack,
    columns,
    rows: line.pack / columns,
    unit: line.unit,
    cells: line.cells,
    status: line.status,
    lidClosed: line.status === 'sealed' || line.status === 'taken_up',
    stamp:
      line.status === 'sealed'
        ? 'SEALED'
        : line.status === 'taken_up'
          ? 'TAKEN UP'
          : line.status === 'dropped'
            ? 'DROPPED'
            : null,
    dropped: line.status === 'dropped',
    version: line.version,
  };
}

export function topColourOf(cell: Cell, dropped: boolean): TopColour | null {
  if (cell === 'empty') return null;
  if (dropped) return 'dropped';
  return cell === 'mine' ? 'mine' : 'taken';
}

export function gridLabel(line: Line): string {
  return `${line.pledged_units} of ${line.pack} units pledged`;
}

export function crateLabel(line: Line): string {
  return `Crate of ${line.case_name}: ${line.pledged_units} of ${line.pack} units pledged, ${stateWord(line.status)}`;
}
