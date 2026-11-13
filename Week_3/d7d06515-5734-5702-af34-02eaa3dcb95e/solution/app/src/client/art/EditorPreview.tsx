// The editor window preview: a hard-edged desktop window with a property panel and a magenta contour plan, drawn in code.
import { useMemo } from 'react';
import { contourMap } from './contours.ts';

const PROPERTY_ROWS = ['Layer', 'Color', 'Linetype', 'Lineweight', 'Dimension style', 'Text style'] as const;
const CANVAS = { x: 126, y: 30, width: 434, height: 250 } as const;

export function EditorPreview() {
  const map = useMemo(() => contourMap(5, CANVAS.width, CANVAS.height, 7, 21), []);
  return (
    <div role="img" aria-label="Corbel Draft editor preview" className="editor-preview">
      <svg viewBox="0 0 560 316" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="preview-canvas"><rect x={CANVAS.x} y={CANVAS.y} width={CANVAS.width} height={CANVAS.height} /></clipPath>
        </defs>
        <rect width="560" height="316" fill="#1b212b" />
        <rect width="560" height="10" fill="#e3e3e3" />
        {[7, 15, 23].map((x) => <circle key={x} cx={x} cy="5" r="2" fill="#8c8c8c" />)}
        <rect y="10" width="560" height="20" fill="#151a21" />
        <text x="64" y="23" className="pv-text pv-strong">Studio plan.dxf</text>
        {[430, 446, 462, 478].map((x) => <rect key={x} x={x} y="14" width="10" height="10" fill="none" stroke="#5a6472" />)}
        <rect x="500" y="14" width="48" height="12" fill="#e3e3e3" />
        <text x="506" y="23" className="pv-text pv-dark">Share</text>

        <rect y="30" width="24" height="250" fill="#10151b" />
        {[40, 62, 84, 106, 128, 150].map((y) => <rect key={y} x="6" y={y} width="12" height="12" fill="none" stroke="#5a6472" />)}
        <rect x="24" y="30" width="102" height="250" fill="#232a35" />
        <text x="32" y="44" className="pv-text pv-strong">Object Properties</text>
        {PROPERTY_ROWS.map((label, index) => (
          <g key={label}>
            <text x="32" y={60 + index * 22} className="pv-text">{label}</text>
            <rect x="32" y={64 + index * 22} width="88" height="9" fill="#10151b" stroke="#3a4350" />
          </g>
        ))}
        <text x="32" y="204" className="pv-text pv-strong">Model Properties</text>
        <rect x="32" y="210" width="88" height="9" fill="#10151b" stroke="#3a4350" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x={32 + i * 15} y="232" width="12" height="12" fill="none" stroke="#6f7b8c" />
        ))}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x={32 + i * 15} y="250" width="12" height="12" fill="none" stroke="#6f7b8c" />
        ))}

        <rect x={CANVAS.x} y={CANVAS.y} width={CANVAS.width} height={CANVAS.height} fill="var(--canvas)" />
        <g clipPath="url(#preview-canvas)" transform={`translate(${CANVAS.x} ${CANVAS.y})`} fill="none">
          <path d={map.minor} stroke="#e040c0" strokeWidth="0.7" opacity="0.85" />
          <path d={map.major} stroke="#ffffff" strokeWidth="0.9" />
          <path d={map.features} stroke="#ffe14d" strokeWidth="0.8" />
          <rect x="262" y="118" width="8" height="8" fill="var(--vertex)" />
          <rect x="318" y="150" width="8" height="8" fill="var(--vertex)" />
        </g>
        <text x={CANVAS.x + 8} y={CANVAS.y + 14} className="pv-text pv-link">Top | 2D Wireframe</text>

        <rect y="280" width="560" height="36" fill="#151a21" />
        <text x="32" y="293" className="pv-text">Command: Type a command</text>
        {['Model', 'Layout1', 'OSNAP', 'ORTHO', 'POLAR'].map((label, index) => (
          <g key={label}>
            <rect x={30 + index * 54} y="298" width="48" height="12" fill={index === 2 ? '#2a5f8f' : '#232a35'} stroke="#3a4350" />
            <text x={36 + index * 54} y="307" className="pv-text">{label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
