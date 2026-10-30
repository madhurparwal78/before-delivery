import { WorkbookSnapshotDto } from '../../shared/api';
import { splitQualified } from '../../shared/refs';
import { WorkbookState } from '../../shared/workbook';

/** Rebuilds the evaluable workbook state from a server snapshot. */
export function stateFromSnapshot(snapshot: WorkbookSnapshotDto): WorkbookState {
  return {
    sheets: snapshot.sheets.map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      position: sheet.position,
      cells: new Map(
        Object.entries(sheet.cells).map(([ref, cell]) => [
          ref,
          {
            input: cell.input,
            numberFormat: cell.format.numberFormat,
            bold: cell.format.bold,
            lastSeq: 0,
            lastAuthorId: '',
          },
        ]),
      ),
    })),
    charts: snapshot.charts.map((chart) => ({
      id: chart.id,
      sheetId: chart.sheetId,
      chartType: chart.type,
      title: chart.title,
      range: splitQualified(chart.range)?.rest ?? chart.range,
    })),
  };
}
