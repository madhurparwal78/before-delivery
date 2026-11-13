import { evaluate, type Query } from '../../../shared/evaluator';
import { readoutScene } from './demoScenes';
import { countText, useCountUp } from './hooks';
import { Reveal } from './Reveal';

const QUERY: Omit<Query, 'layerId'> = { frame: 0, breakpoint: 'desktop', scroll: 0, reducedMotion: false };

interface Row {
  label: string;
  value: string;
}

/** The demo rows are real readouts: the shared evaluator answers for a demo scene, as the inspector does. */
function rows(): Row[] {
  const doc = readoutScene();
  const scene = doc.scenes[0]!;
  const read = (layerId: string, extra: Partial<Query> = {}): Record<string, string> =>
    evaluate(doc, scene, { ...QUERY, layerId, ...extra }, new Map(), { particleMax: 2000 }).readouts;
  const cube = read('cube', { vertex: '+x +y +z' });
  const word = read('word');
  const far = read('probe');
  const strip = (text: string | undefined, prefix: string): string => (text ?? '').replace(prefix, '');
  return [
    { label: 'Screen point', value: cube['screen-point'] ?? '' },
    { label: 'Vertex +x +y +z', value: cube['vertex-point'] ?? '' },
    { label: 'Vertex world', value: cube['vertex-world'] ?? '' },
    { label: 'Triangles', value: strip(cube['triangles'], 'Triangles ') },
    { label: 'Bounds HALO', value: strip(word['bounds'], 'Bounds ') },
    { label: 'Far probe', value: far['screen-point'] ?? '' },
  ];
}

const READOUT_ROWS = rows();

function ReadoutBody({ entered }: { entered: boolean }) {
  const progress = useCountUp(entered);
  return (
    <>
      <div className="section-head">
        <h2>
          Every number, <span className="serif-word">provable</span>
        </h2>
        <p className="muted">The inspector reads the same evaluator the embed runs, at any clock time and breakpoint.</p>
      </div>
      <dl className="readout-panel panel" aria-label="Sample readouts">
        {READOUT_ROWS.map((row) => (
          <div key={row.label} className="readout-row">
            <dt className="muted">{row.label}</dt>
            <dd className={`num ${row.value === 'Not visible' ? 'warn' : ''}`}>{row.value === 'Not visible' ? row.value : countText(row.value, progress)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function ReadoutDemo() {
  return <Reveal className="demo-panel" aria-label="Inspector readouts demo" render={(entered) => <ReadoutBody entered={entered} />} />;
}
