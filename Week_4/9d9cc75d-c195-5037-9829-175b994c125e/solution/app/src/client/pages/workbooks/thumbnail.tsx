import type { SheetShape } from '../../../shared/model.ts';
import { api } from '../../api/client.ts';
import type { WorkbookDetail } from '../../api/types.ts';
import { useLoad } from '../../api/use-load.ts';

/** A small deterministic number stream from a text, so a sheet always draws the same thumbnail. */
function stream(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pillName(pill: SheetShape['rows'][number]): string {
  return typeof pill === 'string' ? pill : pill.field;
}

/** The thumbnail of a sheet: bars, a line, dots or cells, drawn from the shape's chart choice and its shelves. */
function SheetThumbnail({ shape }: { shape: SheetShape | null }) {
  if (!shape) {
    return (
      <svg className="thumb" viewBox="0 0 120 80" aria-hidden="true" focusable="false">
        <rect x="14" y="30" width="92" height="20" rx="10" fill="#fff" stroke="#D9E13F" strokeWidth="4" />
      </svg>
    );
  }
  const seed = [shape.name, ...shape.rows.map(pillName), ...shape.columns.map(pillName)].join('|');
  const next = stream(seed);
  const values = Array.from({ length: 5 }, () => 0.25 + next() * 0.65);
  const ink = '#1A0A14';
  const body = (() => {
    if (shape.chart === 'line') {
      const points = values.map((value, index) => `${16 + index * 22},${64 - value * 44}`).join(' ');
      return <polyline points={points} fill="none" stroke={ink} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />;
    }
    if (shape.chart === 'scatter') {
      return values.map((value, index) => (
        <circle key={index} cx={16 + index * 22} cy={64 - value * 44} r="5.5" fill="#E9479F" stroke={ink} strokeWidth="2" />
      ));
    }
    if (shape.chart === 'heat_map' || shape.chart === 'text_table') {
      return values.flatMap((value, index) =>
        [0, 1].map((row) => (
          <rect
            key={`${index}-${row}`}
            x={14 + index * 18.5}
            y={18 + row * 22}
            width="16"
            height="19"
            rx="4"
            fill={shape.chart === 'heat_map' ? '#E9479F' : '#fff'}
            fillOpacity={shape.chart === 'heat_map' ? 0.25 + ((value + row * 0.3) % 1) * 0.75 : 1}
            stroke={ink}
            strokeWidth="1.5"
          />
        )),
      );
    }
    return values.map((value, index) => (
      <rect key={index} x={14 + index * 20} y={64 - value * 44} width="15" height={value * 44} rx="4" fill="#E9479F" stroke={ink} strokeWidth="2" />
    ));
  })();
  return (
    <svg className="thumb" viewBox="0 0 120 80" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="112" height="72" rx="14" fill="#FDF1F7" />
      <line x1="10" y1="64" x2="110" y2="64" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      {body}
    </svg>
  );
}

/** Looks up the workbook's first sheet and draws it. */
export function WorkbookThumbnail({ workbook }: { workbook: string }) {
  const shape = useLoad(async () => {
    const detail = await api.get<WorkbookDetail>(`/api/workbooks/${workbook}`);
    const first = detail.sheets[0];
    return first ? api.get<SheetShape>(`/api/sheets/${first.id}`) : null;
  }, [workbook]);
  return <SheetThumbnail shape={shape.data ?? null} />;
}
