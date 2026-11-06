import type { ReactNode } from 'react';
import type { Order, Stage, StageStatus } from '../../shared/types.js';
import { Money, type Word } from './Money.js';

const STAGE_WORD: Record<StageStatus, Word> = { scheduled: 'scheduled', pending: 'pending', paid: 'paid', failed: 'failed', overdue: 'overdue' };
export const stageWord = (status: StageStatus): Word => STAGE_WORD[status];

function lineWord(order: Order, line: Order['lines'][number]): Word {
  if (order.refunds.some((r) => r.lineId === line.id && r.status === 'pending')) return 'pending';
  if (line.grossCents > 0 && line.collectedCents >= line.grossCents) return 'paid';
  return order.state === 'quoted' ? 'quoted' : 'scheduled';
}

export function KitLines({ order }: { order: Order }): ReactNode {
  return (
    <table className="ruled-table ledger" role="table" aria-label="Kit lines">
      <thead role="rowgroup"><tr role="row">
        <th role="columnheader" scope="col">Line</th><th role="columnheader" scope="col">Gross</th><th role="columnheader" scope="col">VAT</th>
        <th role="columnheader" scope="col">Collected</th><th role="columnheader" scope="col">Returned</th>
      </tr></thead>
      <tbody role="rowgroup">
        {order.lines.map((line) => (
          <tr role="row" key={line.id}>
            <td role="cell" data-label="Line">{line.name}</td>
            <td role="cell" data-label="Gross"><Money cents={line.grossCents} word={lineWord(order, line)} /></td>
            <td role="cell" data-label="VAT"><span className="cell-stack"><Money cents={line.vatCents} word={lineWord(order, line)} /><span className="hint num">at {line.vatRatePct} percent</span></span></td>
            <td role="cell" data-label="Collected"><Money cents={line.collectedCents} word={line.collectedCents > 0 ? 'paid' : 'scheduled'} /></td>
            <td role="cell" data-label="Returned">{line.refundedCents > 0 ? <Money cents={line.refundedCents} word="returned" /> : <span className="hint">none</span>}</td>
          </tr>
        ))}
        <tr role="row" className="total-row">
          <td role="cell" data-label="Line"><strong>Total</strong></td>
          <td role="cell" data-label="Gross"><Money cents={order.totalCents} word={order.state === 'quoted' ? 'quoted' : 'scheduled'} /></td>
          <td role="cell" data-label="VAT"><Money cents={order.vatCents} word={order.state === 'quoted' ? 'quoted' : 'scheduled'} /></td>
          <td role="cell" data-label="Collected" /><td role="cell" data-label="Returned" />
        </tr>
      </tbody>
    </table>
  );
}

export function ScheduleTable({ stages }: { stages: Stage[] }): ReactNode {
  return (
    <table className="ruled-table ledger" role="table" aria-label="Payment schedule">
      <thead role="rowgroup"><tr role="row">
        <th role="columnheader" scope="col">Stage</th><th role="columnheader" scope="col">Due</th><th role="columnheader" scope="col">Amount</th>
        <th role="columnheader" scope="col">VAT</th><th role="columnheader" scope="col">Attempts</th>
      </tr></thead>
      <tbody role="rowgroup">
        {stages.map((s) => (
          <tr role="row" key={s.stage}>
            <td role="cell" data-label="Stage">{s.label}</td>
            <td role="cell" data-label="Due" className="num">{s.dueDate}</td>
            <td role="cell" data-label="Amount"><Money cents={s.amountCents} word={stageWord(s.status)} /></td>
            <td role="cell" data-label="VAT">
              <span className="cell-stack">
                <Money cents={s.vatCents} word={stageWord(s.status)} />
                {s.vatCorrectedCents !== 0 ? <Money cents={s.vatCorrectedCents} word="corrected" /> : null}
              </span>
            </td>
            <td role="cell" data-label="Attempts" className="num">{s.attempts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AllocationTable({ order }: { order: Order }): ReactNode {
  return (
    <table className="ruled-table ledger" role="table" aria-label="Allocation">
      <thead role="rowgroup"><tr role="row">
        <th role="columnheader" scope="col">Line</th>
        {order.schedule.map((s) => <th role="columnheader" scope="col" key={s.stage}>{s.label}</th>)}
      </tr></thead>
      <tbody role="rowgroup">
        {order.lines.map((line) => (
          <tr role="row" key={line.id}>
            <td role="cell" data-label="Line">{line.name}</td>
            {order.schedule.map((s) => {
              const part = s.allocations.find((a) => a.lineId === line.id);
              return <td role="cell" key={s.stage} data-label={s.label}>{part ? <Money cents={part.grossCents} word={stageWord(s.status)} /> : null}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
