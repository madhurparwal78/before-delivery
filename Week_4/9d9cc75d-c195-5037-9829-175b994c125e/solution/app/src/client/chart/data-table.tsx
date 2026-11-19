import { buildTwin } from '../../shared/twin.ts';
import { TableWrap } from '../ui/table-wrap.tsx';
import type { DataTableProps } from './props.ts';
import './chart.css';

export function DataTable({ sheetName, result, highlighted = null }: DataTableProps) {
  const twin = buildTwin(result);
  return (
    <TableWrap>
      <table className="twin" role="grid" aria-label={`${sheetName} table`}>
        <thead>
          <tr>
            {twin.dimensions.map((name, i) => (
              <th key={`d${i}`} scope="col">
                {name}
              </th>
            ))}
            {twin.measures.map((name, i) => (
              <th key={`m${i}`} scope="col" className="num">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {twin.rows.map((row, index) => {
            const markId = row.heads.length > 0 ? row.heads.join(' | ') : 'all';
            return (
              <tr key={index} data-kind={row.kind} data-highlight={row.kind === 'mark' && highlighted?.has(markId) ? 'true' : undefined}>
                {row.heads.map((head, i) =>
                  head === '' && row.kind !== 'mark' ? (
                    <td key={i} role="presentation" />
                  ) : (
                    <th key={i} scope="row">
                      {head}
                    </th>
                  ),
                )}
                {row.cells.map((cell, i) => (
                  <td key={i} className="num" data-value={cell.value}>
                    {cell.text}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
