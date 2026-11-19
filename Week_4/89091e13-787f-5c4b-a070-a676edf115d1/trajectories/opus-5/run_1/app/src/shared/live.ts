/** Events the live channel pushes to every open page of a workspace. */
export type LiveEvent =
  | { kind: 'block'; height: number; blobs: number; squareWidth: number }
  | {
      kind: 'rejected';
      height: number;
      reason: 'withheld' | 'bad-encoding';
      nodeName?: string;
      row?: number;
      col?: number;
      axis?: 'row' | 'column';
      index?: number;
    }
  | { kind: 'fraud-proof'; height: number; axis: 'row' | 'column'; index: number }
  | {
      kind: 'sample';
      nodeId: string;
      nodeName: string;
      height: number;
      index: number;
      row: number;
      col: number;
      served: boolean;
      confidence: string;
      verdict: string;
    }
  | { kind: 'transactions' }
  | { kind: 'producer'; nextBlock: string }
  | { kind: 'light-node'; nodeId: string };

/** The Network updates announcement for a produced block. */
export function blockAnnouncement(height: number, blobs: number, squareWidth: number): string {
  return `Block ${height} produced: ${blobs} ${blobs === 1 ? 'blob' : 'blobs'}, square ${squareWidth} × ${squareWidth}.`;
}

export function withheldRejectionCopy(height: number, nodeName: string, row: number, col: number): string {
  return `Block ${height} was rejected: shares were withheld. Light node ${nodeName} could not fetch share (${row}, ${col}).`;
}

export function badEncodingRejectionCopy(
  height: number,
  axis: 'row' | 'column',
  index: number,
): string {
  return `Block ${height} was rejected: ${axis} ${index} is not encoded correctly.`;
}

export function rejectionCopy(event: Extract<LiveEvent, { kind: 'rejected' }>): string {
  if (event.reason === 'withheld') {
    return withheldRejectionCopy(event.height, event.nodeName ?? '', event.row ?? 0, event.col ?? 0);
  }
  return badEncodingRejectionCopy(event.height, event.axis ?? 'row', event.index ?? 0);
}
