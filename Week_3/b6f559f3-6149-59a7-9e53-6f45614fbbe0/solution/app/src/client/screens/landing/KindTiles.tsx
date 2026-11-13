import { Box, Layers3, Shapes, Sparkles, Type, Waves } from 'lucide-react';
import type { ReactNode } from 'react';
import { Reveal } from './Reveal';

const KINDS: { title: string; text: string; icon: ReactNode }[] = [
  { title: 'Primitives', text: 'Cube, sphere, cylinder, torus and plane with exact transforms.', icon: <Box size={20} aria-hidden="true" /> },
  { title: 'Extruded type', text: 'Block letters and one-path SVGs pushed into depth.', icon: <Type size={20} aria-hidden="true" /> },
  { title: 'Models', text: 'Upload a small glTF and play its clips on the timeline.', icon: <Layers3 size={20} aria-hidden="true" /> },
  { title: 'Particles', text: 'A seeded swarm that emits, orbits or forms your wordmark.', icon: <Sparkles size={20} aria-hidden="true" /> },
  { title: 'Cloth', text: 'A pinned banner stepped at a fixed rate, wind included.', icon: <Waves size={20} aria-hidden="true" /> },
  { title: 'Effects', text: 'Blur, grain, bloom, glow, aberration, displacement, pixelate.', icon: <Shapes size={20} aria-hidden="true" /> },
];

export function KindTiles() {
  return (
    <Reveal className="kinds-panel" aria-label="Layer kinds">
      <div className="section-head">
        <h2>
          Six kinds of layer, <span className="serif-word">one</span> scene
        </h2>
        <p className="muted">Every layer reports exact numbers at any clock time.</p>
      </div>
      <ul className="kind-grid">
        {KINDS.map((kind) => (
          <li key={kind.title} className="kind-card">
            <span className="icon-square">{kind.icon}</span>
            <p className="kind-title">{kind.title}</p>
            <p className="muted">{kind.text}</p>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
