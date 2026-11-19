import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { layoutDoc } from '../../shared/layout.ts';
import type { AudiencePayload, AudienceTopic, DocTopic, MapDoc } from '../../shared/model.ts';
import { emptyDoc } from '../../shared/engine.ts';
import { fitView, formatPan, formatZoom, type View } from '../../shared/viewport.ts';
import { api } from '../api.ts';
import { motionOk } from '../editor/session.ts';

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const SWIPE_PX = 50;

type Slide = NonNullable<AudiencePayload['slide']>;

const colourVar = (colour: string): string => (colour.startsWith('#') ? colour : colour === 'accent' ? 'var(--accent)' : `var(--c-${colour})`);

function docOfSlide(slide: Slide, payload: AudiencePayload): MapDoc {
  const doc = emptyDoc();
  slide.topics.forEach((t: AudienceTopic, at) => {
    const topic: DocTopic = {
      id: t.id,
      parent_id: t.parent_id,
      rank: t.rank,
      floating: false,
      x: null,
      y: null,
      title: t.title,
      note: '',
      icon: t.icon,
      colour: null,
      shape: null,
      side_pin: null,
      task: null,
      locked_by: null,
      restricted: false,
      attachments: [],
      n: at,
    };
    doc.topics[t.id] = topic;
  });
  doc.layout = payload.layout;
  doc.theme = payload.theme;
  return doc;
}

function Stage(props: { slide: Slide; payload: AudiencePayload; width: number; height: number; animate: boolean }) {
  const { slide, payload } = props;
  const stage = useRef<HTMLDivElement>(null);
  const last = useRef<View | null>(null);
  const doc = docOfSlide(slide, payload);
  const layout = layoutDoc(doc, new Set());
  const view = fitView(layout.boxes.values(), props.width, props.height);
  useLayoutEffect(() => {
    const from = last.current;
    last.current = view;
    if (!from || !props.animate || !motionOk() || !stage.current) return;
    stage.current.animate(
      [
        { transform: `translate(${from.panX.toFixed(2)}px, ${from.panY.toFixed(2)}px) scale(${from.zoom.toFixed(4)})` },
        { transform: `translate(${view.panX.toFixed(2)}px, ${view.panY.toFixed(2)}px) scale(${view.zoom.toFixed(4)})` },
      ],
      { duration: 400, easing: EASE, id: 'camera' },
    );
  }, [slide.topic_id, view.zoom, view.panX, view.panY, props.width, props.height]);
  const colours = new Map(slide.topics.map((t) => [t.id, t.derived]));
  return (
    <div
      ref={stage}
      class="stage audience-stage"
      data-zoom={formatZoom(view.zoom)}
      data-pan-x={formatPan(view.panX)}
      data-pan-y={formatPan(view.panY)}
      style={{ transform: `translate(${view.panX.toFixed(2)}px, ${view.panY.toFixed(2)}px) scale(${view.zoom.toFixed(4)})` }}
    >
      {[...layout.boxes.values()].map((box) => {
        const style = colours.get(box.id);
        const parent = doc.topics[box.id]?.parent_id;
        const parentBox = parent ? layout.boxes.get(parent) : undefined;
        return (
          <div key={box.id}>
            {parentBox ? (
              <svg class="layer" width="1" height="1" overflow="visible" aria-hidden="true">
                <path
                  d={`M${parentBox.x + (box.x >= parentBox.x ? 1 : -1) * Math.floor(parentBox.w / 2)},${parentBox.y} C${(parentBox.x + box.x) / 2},${parentBox.y} ${(parentBox.x + box.x) / 2},${box.y} ${box.x - (box.x >= parentBox.x ? 1 : -1) * Math.floor(box.w / 2)},${box.y}`}
                  fill="none"
                  stroke-width="4"
                  stroke-linecap="round"
                  style={{ stroke: colourVar(style?.colour ?? 'accent') }}
                />
              </svg>
            ) : null}
            <div
              class="topic"
              data-topic-id={box.id}
              data-shape={style?.shape ?? 'pill'}
              data-text={style?.text ?? 'ink'}
              style={{
                left: `${box.x - Math.floor(box.w / 2)}px`,
                top: `${box.y - Math.floor(box.h / 2)}px`,
                width: `${box.w}px`,
                height: `${box.h}px`,
                '--branch': colourVar(style?.colour ?? 'accent'),
              }}
            >
              <span class="topic-title">{box.lines.join('\n')}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function statusText(payload: AudiencePayload, shownIndex: number | null): string {
  if (payload.state === 'waiting') return `The presentation hasn't started yet. It will appear here when ${payload.presenter} goes live.`;
  if (payload.state === 'paused') return 'The presenter has stepped away. The show will continue here.';
  if (payload.state === 'ended') return 'This presentation has ended.';
  const at = (shownIndex ?? payload.slide_index) + 1;
  return `Slide ${at} of ${payload.slide_count}`;
}

/** The audience screen: it shows only what the server says, and lets a phone swipe back through slides it has seen. */
export function Audience(props: { code: string }) {
  const [payload, setPayload] = useState<AudiencePayload | null>(null);
  const [missing, setMissing] = useState(false);
  const [history, setHistory] = useState<Map<number, Slide>>(new Map());
  const [viewing, setViewing] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const card = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const accept = (next: AudiencePayload): void => {
    setPayload(next);
    if (next.slide) {
      const slide = next.slide;
      setHistory((prior) => new Map(prior).set(next.slide_index, slide));
    }
    if (next.state !== 'live') setViewing(null);
  };

  useLayoutEffect(() => {
    let socket: WebSocket | null = null;
    api<AudiencePayload>('GET', `/api/presentations/by-code/${props.code}`)
      .then((first) => {
        accept(first);
        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        socket = new WebSocket(`${scheme}://${window.location.host}/api/presentations/by-code/${props.code}/live`);
        socket.onmessage = (event) => accept(JSON.parse(String(event.data)) as AudiencePayload);
      })
      .catch(() => setMissing(true));
    return () => {
      if (socket) {
        socket.onmessage = null;
        socket.close();
      }
    };
  }, [props.code]);

  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return undefined;
    const measure = (): void => setSize({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [payload?.slide !== null && payload?.slide !== undefined]);

  if (missing) {
    return (
      <main class="gone">
        <h1>We couldn't find that page.</h1>
      </main>
    );
  }
  if (!payload) {
    return (
      <main class="loading" aria-busy="true">
        <p role="status">Opening presentation</p>
      </main>
    );
  }

  const live = payload.slide_index;
  const index = viewing ?? live;
  const slide = history.get(index) ?? payload.slide;
  const root = slide?.topics.find((t) => t.id === slide.topic_id);
  const border = colourVar(root?.derived.colour ?? 'accent');

  const swipe = (dx: number): void => {
    if (payload.state !== 'live') return;
    if (dx > 0) {
      const earlier = [...history.keys()].filter((i) => i < index).sort((a, b) => b - a)[0];
      if (earlier !== undefined) setViewing(earlier);
    } else if (viewing !== null) {
      const later = [...history.keys()].filter((i) => i > viewing && i <= live).sort((a, b) => a - b)[0];
      setViewing(later === undefined || later >= live ? null : later);
    }
  };

  return (
    <main class="audience">
      {slide ? (
        <div
          ref={card}
          role="region"
          aria-label="Slide"
          class="slide-card"
          style={{ borderColor: border }}
          onPointerDown={(event) => {
            touch.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            const start = touch.current;
            touch.current = null;
            if (!start) return;
            const dx = event.clientX - start.x;
            if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(event.clientY - start.y)) swipe(dx);
          }}
        >
          {size.w > 0 ? <Stage slide={slide} payload={payload} width={size.w} height={size.h} animate={viewing === null} /> : null}
        </div>
      ) : null}
      <div class="audience-foot">
        <p role="status" aria-label="Presentation status" class="audience-status">
          {statusText(payload, viewing)}
        </p>
        {viewing !== null ? (
          <button type="button" class="btn btn-primary" onClick={() => setViewing(null)}>
            Back to live
          </button>
        ) : null}
      </div>
    </main>
  );
}
