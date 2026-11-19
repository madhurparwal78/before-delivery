import type { NodeKind } from '../types';

/** Three-by-three pixel glyphs (rounded squares), one per node kind. */
const PATTERNS: Record<NodeKind, string> = {
  form: '111101111',
  schedule: '010111010',
  webhook: '101010111',
  row_added: '010111101',
  manual: '111010010',
  set: '110101011',
  filter: '111010010',
  branch: '010101101',
  loop: '111101111',
  wait: '111010111',
  send_email: '111111101',
  add_row: '010111010',
  update_row: '101111101',
  call_webhook: '011101110',
};

export function KindIcon({ kind, size = 20 }: { kind: NodeKind; size?: number }) {
  const pattern = PATTERNS[kind];
  return (
    <svg className="kind-icon" viewBox="0 0 15 15" width={size} height={size} aria-hidden="true">
      {[...pattern].map((on, index) =>
        on === '1' ? <rect key={index} x={(index % 3) * 5} y={Math.floor(index / 3) * 5} width="4" height="4" rx="1" /> : null,
      )}
    </svg>
  );
}
