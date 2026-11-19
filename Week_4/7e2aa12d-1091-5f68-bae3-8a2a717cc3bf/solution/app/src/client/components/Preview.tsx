import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PREVIEW_MAX, PREVIEW_MIN, PREVIEW_STEP, edgesOf } from '../lib/scope.js';

/** The frame's own page: the generated code as written, with only a neutral outline so every area shows. */
function frameDocument(): string {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string): string => root.getPropertyValue(name).trim();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:${token('--field')};color:${token('--ink')};font:12.5px ${token('--font-mono')}}
.layout{box-sizing:border-box;min-height:100%}
.layout>*{box-sizing:border-box;min-width:0;padding:6px 8px;overflow:hidden;background:${token('--wash')};outline:1px solid ${token('--gridline')};outline-offset:-1px}
</style><style id="layout"></style></head><body></body></html>`;
}

interface PreviewProps {
  css: string;
  html: string;
  width: number;
  /** Receives the preview's computed column widths, rounded half up, whenever they may have changed. */
  onResolved: (columns: number[]) => void;
}

export function PreviewFrame({ css, html, width, onResolved }: PreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const written = useRef({ css: '', html: '' });
  const [frameSource] = useState(frameDocument);

  useLayoutEffect(() => {
    const view = frame.current?.contentWindow;
    const page = frame.current?.contentDocument;
    if (!loaded || !view || !page) return;
    const style = page.getElementById('layout');
    if (style && written.current.css !== css) style.textContent = css;
    if (written.current.html !== html) page.body.innerHTML = html;
    written.current = { css, html };
    const grid = page.querySelector('.layout');
    const columns = grid ? view.getComputedStyle(grid).gridTemplateColumns : 'none';
    onResolved(columns === 'none' ? [] : columns.split(' ').map((value) => Math.floor(Number.parseFloat(value) + 0.5)));
  }, [loaded, css, html, width, onResolved]);

  return (
    <div className="frame-scroll" tabIndex={0} role="region" aria-label="Preview scroll area">
      <iframe ref={frame} title="Layout preview" srcDoc={frameSource} style={{ width }} onLoad={() => setLoaded(true)} />
    </div>
  );
}

interface SliderProps {
  width: number;
  breakpoints: { min_width: number }[];
  onMove: (width: number) => void;
}

/** "Preview width": 320 to 1440, with the published keys. */
export function WidthSlider({ width, breakpoints, onMove }: SliderProps) {
  const keys = (event: KeyboardEvent<HTMLInputElement>): void => {
    const edges = edgesOf(breakpoints);
    const target: Record<string, number> = {
      ArrowRight: width + PREVIEW_STEP,
      ArrowUp: width + PREVIEW_STEP,
      ArrowLeft: width - PREVIEW_STEP,
      ArrowDown: width - PREVIEW_STEP,
      PageUp: edges.find((edge) => edge > width) ?? PREVIEW_MAX,
      PageDown: [...edges].reverse().find((edge) => edge < width) ?? PREVIEW_MIN,
      Home: PREVIEW_MIN,
      End: PREVIEW_MAX,
    };
    if (!(event.key in target)) return;
    event.preventDefault();
    onMove(target[event.key]);
  };
  return (
    <div className="slider-row">
      <label htmlFor="preview-width">Preview width</label>
      <input id="preview-width" type="range" min={PREVIEW_MIN} max={PREVIEW_MAX} step={1} value={width} aria-valuetext={`${width}px`} onChange={(event) => onMove(Number(event.target.value))} onKeyDown={keys} />
      <output htmlFor="preview-width" className="mono readout">{`${width}px`}</output>
    </div>
  );
}
