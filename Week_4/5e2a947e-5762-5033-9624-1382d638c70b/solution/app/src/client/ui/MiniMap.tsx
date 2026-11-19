import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { cascadeStyles, colourHex } from '../../shared/derive.ts';
import { connectorPath, layoutDoc, type Box, type Layout } from '../../shared/layout.ts';
import type { ApiTopic, DocTopic, LayoutMode, Link, MapDoc, ThemeName } from '../../shared/model.ts';
import { emptyDoc } from '../../shared/engine.ts';
import { boundsOf, fitView, FIT_MARGIN } from '../../shared/viewport.ts';

interface MiniMapProps {
  /** A map document, or ... */
  doc?: MapDoc;
  /** ... the topics of an API payload (with its links, layout and theme). One of the two is required. */
  topics?: readonly ApiTopic[];
  links?: readonly Link[];
  layout?: LayoutMode;
  theme?: ThemeName;
  /** Extra pixels kept clear around the map inside the box. */
  padding?: number;
  /** Never scale below this zoom: a wide map is then cropped at the edges of its box instead of shrinking to nothing. */
  minZoom?: number;
  /** Size assumed before the box is measured, so the first paint is already fitted. */
  initial?: { w: number; h: number };
  /** Topic ids collapsed for me. */
  collapsed?: readonly string[];
  class?: string;
}

/** A MapDoc from the topics of an API payload (the engine wants the document shape). */
function docFromTopics(topics: readonly ApiTopic[], layout: LayoutMode = 'map', theme: ThemeName = 'daylight', links: readonly Link[] = []): MapDoc {
  const doc = emptyDoc();
  topics.forEach((t, at) => {
    const { lock_inherited: _a, comment_count: _b, vote_count: _c, voted: _d, derived: _e, ...rest } = t;
    const topic: DocTopic = { ...rest, n: at };
    doc.topics[t.id] = topic;
  });
  doc.next_n = topics.length;
  doc.layout = layout;
  doc.theme = theme;
  doc.links = [...links];
  return doc;
}

interface Pen {
  d: string;
  colour: string;
  id: string;
}

const half = (n: number): number => Math.floor(n / 2);

/** Connector paths between each parent and child, following the layout mode. */
function connectors(doc: MapDoc, layout: Layout, mode: LayoutMode, colours: Map<string, { colour: string }>): Pen[] {
  const pens: Pen[] = [];
  for (const topic of Object.values(doc.topics)) {
    if (topic.parent_id === null) continue;
    const parent = layout.boxes.get(topic.parent_id);
    const child = layout.boxes.get(topic.id);
    if (!parent || !child) continue;
    const colour = colourHex(colours.get(topic.id)?.colour ?? 'accent');
    const d = connectorPath(mode, parent, child);
    pens.push({ d, colour, id: topic.id });
  }
  return pens;
}

/**
 * A read-only live miniature of a map, drawn with the real layout engine as page elements:
 * topic pills with a thick branch-colour border, ribbon connectors in SVG, scaled to fit its box.
 */
export function MiniMap(props: MiniMapProps) {
  const { padding = 16, minZoom = 0, initial = { w: 320, h: 200 }, collapsed = [], class: className } = props;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(initial);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = (): void => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setSize((old) => (Math.abs(old.w - width) < 0.5 && Math.abs(old.h - height) < 0.5 ? old : { w: width, h: height }));
    };
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);

  const doc = useMemo(
    () => props.doc ?? docFromTopics(props.topics ?? [], props.layout, props.theme, props.links),
    [props.doc, props.topics, props.layout, props.theme, props.links],
  );
  const collapsedKey = collapsed.join(',');
  const scene = useMemo(() => {
    const layout = layoutDoc(doc, new Set(collapsed));
    const styles = cascadeStyles(doc);
    return { layout, styles, pens: connectors(doc, layout, doc.layout, styles) };
  }, [doc, collapsedKey]);

  const boxes = [...scene.layout.boxes.values()];
  const bounds = boundsOf(boxes);
  // fitView keeps a fixed 96px margin; ask it for a box that is larger by that margin minus my own padding.
  const grow = FIT_MARGIN - 2 * padding;
  const fit = fitView(boxes, size.w + grow, size.h + grow);
  const zoom = Math.max(fit.zoom, minZoom);
  const cx = bounds ? (bounds.left + bounds.right) / 2 : 0;
  const cy = bounds ? (bounds.top + bounds.bottom) / 2 : 0;
  const panX = size.w / 2 - cx * zoom;
  const panY = size.h / 2 - cy * zoom;

  return (
    <div ref={box} class={`mapthumb${className ? ` ${className}` : ''}`} aria-hidden="true" data-topics={boxes.length} data-layout={doc.layout}>
      <div class="mm-stage" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}>
        <svg class="mm-links" width="1" height="1" focusable="false">
          {scene.pens.map((pen) => (
            <path key={pen.id} d={pen.d} fill="none" stroke={pen.colour} stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
          ))}
        </svg>
        {boxes.map((b) => (
          <MiniTopic key={b.id} box={b} title={doc.topics[b.id]?.title ?? ''} style={scene.styles.get(b.id)} />
        ))}
      </div>
    </div>
  );
}

function MiniTopic({ box, title, style }: { box: Box; title: string; style: { colour: string; shape: string; text: string } | undefined }) {
  const colour = colourHex(style?.colour ?? 'accent');
  return (
    <div
      class="mm-topic"
      data-shape={style?.shape ?? 'pill'}
      data-text={style?.text ?? 'ink'}
      data-root={box.level === 1 ? 'true' : 'false'}
      style={{ left: `${box.x - half(box.w)}px`, top: `${box.y - half(box.h)}px`, width: `${box.w}px`, height: `${box.h}px`, '--mm-colour': colour }}
    >
      {box.lines.join('\n') || title}
    </div>
  );
}
