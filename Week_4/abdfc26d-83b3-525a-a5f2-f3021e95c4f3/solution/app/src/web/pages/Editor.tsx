import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from "react";
import { ASPECTS, EASINGS, RENDER_SECONDS, renderCost, type Aspect, type Easing, type Format, type Resolution } from "../../shared/rules";
import { api, IdempotentAction, type Asset, type Credits, type Piece, type Render, type Timeline as TimelineData, type Uniform } from "../api";
import { LiveCanvas, type LiveCanvasHandle } from "../components/LiveCanvas";
import { Dialog, ErrorSummary, FieldError, Icon, LiveStatus, PixelPanel, useAnnouncer, type Announcer, type AssistantState } from "../components/ui";
import { copy } from "../copy";
import { validate } from "../gl/renderer";
import { Link, takeHandoff } from "../router";
import { useReducedMotion } from "../session";
import { NotFound } from "./NotFound";

const EASING_LABELS: Record<Easing, string> = { linear: "Linear", "ease-in": "Ease in", "ease-out": "Ease out", "ease-in-out": "Ease in-out" };
const UPLOAD_LIMIT = 20_000_000;
const UNSETTLED: Render["state"][] = ["accepted", "queued", "rendering", "stored"];

interface Key {
  id: number;
  time: number;
  value: number;
  easing: Easing;
}

let nextKey = 1;
const round1 = (t: number): number => Math.round(t * 10) / 10;
const sameTime = (a: number, b: number): boolean => Math.abs(a - b) < 0.05;

function eased(easing: Easing, x: number): number {
  if (easing === "ease-in") return x * x * x;
  if (easing === "ease-out") return 1 - (1 - x) ** 3;
  if (easing === "ease-in-out") return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  return x;
}

/** A track's value at time t: each keyframe's easing shapes the segment that starts at it. */
function valueAt(keys: Key[], t: number): number | null {
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;
  if (t <= first.time) return first.value;
  if (t >= last.time) return last.value;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i] as Key;
    const b = sorted[i + 1] as Key;
    if (t >= a.time && t <= b.time) return a.value + (b.value - a.value) * eased(a.easing, (t - a.time) / (b.time - a.time || 1));
  }
  return last.value;
}

/** The render state's announcement, or none for accepted and stored. */
function renderLines(render: Render, index: number): string[] {
  const state = render.history[index]?.state;
  if (state === "queued") return [copy.queued(render.cost_credits)];
  if (state === "rendering") return [copy.rendering(render.aspect, render.resolution)];
  if (state === "ready") return [copy.ready(render.cost_credits)];
  if (state === "failed") return [copy.renderFailed];
  if (state === "timed_out") return [copy.timedOut];
  if (state === "credits_released") {
    return render.failure_reason === "cancelled" ? [copy.cancelled, copy.returned(render.cost_credits)] : [copy.returned(render.cost_credits)];
  }
  return [];
}

function assistantFor(render: Render | null): AssistantState {
  if (!render) return "idle";
  if (UNSETTLED.includes(render.state)) return "rendering";
  if (render.history.some((h) => h.state === "failed" || h.state === "timed_out")) return "error";
  return "idle";
}

export function Editor({ slug }: { slug: string }) {
  const [piece, setPiece] = useState<Piece | null>(null);
  const [missing, setMissing] = useState(false);
  const studio = useAnnouncer(takeHandoff());
  useEffect(() => {
    void api<Piece>("GET", `/api/pieces/${slug}`).then((result) => {
      if (result.ok && result.data.fragment_source !== undefined) setPiece(result.data);
      else setMissing(true);
    });
  }, [slug]);
  if (missing) return <NotFound />;
  return (
    <div className="page editor-page">
      <LiveStatus label="Studio status" announcer={studio} className="studio-status" />
      {piece ? <Workbench key={piece.slug} initial={piece} studio={studio} /> : <div className="editor-skeleton" aria-busy="true" />}
    </div>
  );
}

function Workbench({ initial, studio }: { initial: Piece; studio: Announcer }) {
  const reduced = useReducedMotion();
  const source = initial.fragment_source ?? "";
  const [piece, setPiece] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(initial.uniforms.map((u) => [u.name, u.value])));
  const [layers, setLayers] = useState<Record<string, Key[]>>(() => {
    const out: Record<string, Key[]> = {};
    for (const u of initial.uniforms) out[u.name] = [];
    for (const track of initial.timeline.tracks) out[track.uniform] = track.keyframes.map((k) => ({ id: nextKey++, time: k.time_s, value: k.value, easing: k.easing }));
    return out;
  });
  const [audio, setAudio] = useState<string | null>(initial.timeline.audio_asset_id);
  const [assets, setAssets] = useState<Asset[]>(initial.assets ?? []);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<LiveCanvasHandle>(null);
  const duration = initial.timeline.duration_s;
  const draft = piece.state === "draft";
  const editable = draft;

  const valuesRef = useRef(values);
  valuesRef.current = values;
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const redraw = () => requestAnimationFrame(() => canvas.current?.redraw());

  // faders of animated uniforms follow their track to the playhead
  const seek = useCallback(
    (time: number) => {
      const t = Math.min(Math.max(0, time), duration);
      setPlayhead(t);
      playheadRef.current = t;
      setValues((current) => {
        const next = { ...current };
        for (const [name, keys] of Object.entries(layersRef.current)) {
          const v = valueAt(keys, t);
          if (v !== null) next[name] = v;
        }
        valuesRef.current = next;
        return next;
      });
      canvas.current?.redraw();
    },
    [duration],
  );
  const layersRef = useRef(layers);
  layersRef.current = layers;

  useEffect(() => {
    if (!playing) return;
    if (reduced) {
      const timer = window.setInterval(() => seek(round1(playheadRef.current + 0.1 > duration ? 0 : playheadRef.current + 0.1)), 1000);
      return () => window.clearInterval(timer);
    }
    let frame = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const next = playheadRef.current + (now - last) / 1000;
      last = now;
      seek(next > duration ? 0 : next);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, reduced, duration, seek]);

  const setValue = (name: string, value: number) => {
    const next = { ...valuesRef.current, [name]: value };
    valuesRef.current = next;
    setValues(next);
    setDirty(true);
    canvas.current?.redraw();
  };

  const updateLayers = (name: string, keys: Key[]) => {
    const next = { ...layersRef.current, [name]: keys };
    layersRef.current = next;
    setLayers(next);
    setDirty(true);
    canvas.current?.redraw();
  };

  const timeline = (): TimelineData => ({
    duration_s: duration,
    tracks: piece.uniforms
      .filter((u) => (layers[u.name]?.length ?? 0) > 0 || initial.timeline.tracks.some((t) => t.uniform === u.name))
      .map((u) => ({
        uniform: u.name,
        keyframes: [...(layers[u.name] ?? [])].sort((a, b) => a.time - b.time).map((k) => ({ time_s: k.time, value: k.value, easing: k.easing })),
      })),
    audio_asset_id: audio,
  });

  const save = async () => {
    setSaving(true);
    const result = await api<Piece>("PUT", `/api/pieces/${piece.slug}`, { title, uniforms: values, timeline: timeline() }, { "If-Match": `"${piece.version}"` });
    setSaving(false);
    if (result.ok) {
      setPiece(result.data);
      setDirty(false);
      studio.say(copy.saved(result.data.version));
    } else if (result.status === 412) {
      studio.say(copy.saveConflict(Number(result.error.current_version)));
    } else studio.say(result.error.fields ? Object.values(result.error.fields).join(" ") : result.error.message);
  };

  const validation = useMemo(() => validate(source), [source]);

  return (
    <div className="workbench">
      <div className="workbench-head">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-name">
              {piece.state === "draft" ? "Draft" : piece.state === "published" ? "Published" : "Withdrawn"} · version {piece.version}
              {piece.remix_of ? ` · remix of ${piece.remix_of.title} by ${piece.remix_of.creator_display_name}` : ""}
            </span>
          </p>
          <label className="title-field">
            <span className="visually-hidden">Title</span>
            <input type="text" value={title} maxLength={120} disabled={!editable} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
          </label>
        </div>
        <div className="head-actions">
          {draft ? (
            <button type="button" className="button button-accent" disabled={saving} onClick={() => void save()}>
              <Icon name="save" size={16} />
              Save
            </button>
          ) : null}
          <PublishControls piece={piece} studio={studio} onPiece={setPiece} />
        </div>
      </div>
      {!draft ? <p className="banner">This piece is {piece.state}. Its shader, faders and timeline are fixed; remix it to make changes.</p> : null}
      <div className="editor-grid">
        <div className="canvas-zone">
          <div className="editor-canvas-frame">
            <LiveCanvas
              ref={canvas}
              program={{ kind: "source", source }}
              slug={piece.slug}
              still={reduced}
              className="editor-canvas"
              noteFallback
              scene={() => ({
                seed: 0,
                uniforms: valuesRef.current,
                time: (elapsed) => (reduced || playingRef.current ? playheadRef.current : elapsed),
              })}
            />
          </div>
          <section className="validator" aria-label="Validator">
            <p className="validator-title">Validator</p>
            <pre className="mono">{validation.ok ? `Compiled fragment shader. ${piece.uniforms.length + 3} uniforms bound, 0 errors.` : validation.log || "The shader did not compile."}</pre>
          </section>
        </div>
        <section className="instrument-panel" aria-label="Instrument panel">
          <p className="panel-title">Instrument panel</p>
          <div className="faders">
            {piece.uniforms.map((u) => (
              <Fader key={u.name} uniform={u} value={values[u.name] ?? u.value} disabled={!editable} onChange={(v) => setValue(u.name, v)} />
            ))}
          </div>
        </section>
        <TimelinePanel
          piece={piece}
          layers={layers}
          values={values}
          playhead={playhead}
          playing={playing}
          dirty={dirty}
          editable={editable}
          studio={studio}
          audio={audio}
          assets={assets}
          peaks={peaks}
          onLayers={updateLayers}
          onSeek={(t) => seek(round1(t))}
          onPlay={() => setPlaying((p) => !p)}
          onAsset={(asset, wave) => {
            setAssets((list) => [...list, asset]);
            if (asset.kind === "audio") {
              setAudio(asset.id);
              setPeaks(wave);
              setDirty(true);
            }
          }}
          redraw={redraw}
        />
      </div>
    </div>
  );
}

function Fader({ uniform, value, disabled, onChange }: { uniform: Uniform; value: number; disabled: boolean; onChange: (v: number) => void }) {
  const id = useId();
  const range = uniform.max - uniform.min;
  const clamp = (v: number) => Math.round(Math.min(uniform.max, Math.max(uniform.min, v)) * 1e6) / 1e6;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const steps: Record<string, number> = { ArrowRight: 0.01, ArrowUp: 0.01, ArrowLeft: -0.01, ArrowDown: -0.01, PageUp: 0.1, PageDown: -0.1 };
    let next: number | null = null;
    if (event.key in steps) next = value + (steps[event.key] ?? 0) * range;
    else if (event.key === "Home") next = uniform.min;
    else if (event.key === "End") next = uniform.max;
    if (next === null) return;
    event.preventDefault();
    onChange(clamp(next));
  };
  return (
    <div className="fader">
      <label htmlFor={id} className="fader-label">
        <span>{uniform.label}</span>
        <span className="fader-value tabular">{value.toFixed(2)}</span>
      </label>
      <input
        id={id}
        type="range"
        aria-label={uniform.label}
        min={uniform.min}
        max={uniform.max}
        step={range / 100}
        value={value}
        aria-valuenow={value}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(clamp(Number(e.target.value)))}
      />
    </div>
  );
}

// ---- the keyframe timeline and export panel ----

function TimelinePanel(props: {
  piece: Piece;
  layers: Record<string, Key[]>;
  values: Record<string, number>;
  playhead: number;
  playing: boolean;
  dirty: boolean;
  editable: boolean;
  studio: Announcer;
  audio: string | null;
  assets: Asset[];
  peaks: number[] | null;
  onLayers: (name: string, keys: Key[]) => void;
  onSeek: (t: number) => void;
  onPlay: () => void;
  onAsset: (asset: Asset, peaks: number[] | null) => void;
  redraw: () => void;
}) {
  const { piece, layers, values, playhead, playing, editable, studio, onLayers } = props;
  const duration = piece.timeline.duration_s;
  const [selected, setSelected] = useState(piece.uniforms[0]?.name ?? "");
  const [current, setCurrent] = useState<number | null>(null);
  const [roving, setRoving] = useState<Record<string, number>>({});
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const layerButtons = useRef(new Map<string, HTMLButtonElement>());
  const lanes = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<{ layer: string; id: number; moved: boolean } | null>(null);
  const label = (name: string) => piece.uniforms.find((u) => u.name === name)?.label ?? name;
  const ordered = (name: string) => [...(layers[name] ?? [])].sort((a, b) => a.time - b.time);
  const currentKey = current === null ? null : Object.values(layers).flat().find((k) => k.id === current) ?? null;
  const currentLayer = current === null ? null : Object.keys(layers).find((name) => layers[name]?.some((k) => k.id === current)) ?? null;

  const moveKey = (layer: string, key: Key, to: number) => {
    const target = round1(Math.min(Math.max(0, to), duration));
    if ((layers[layer] ?? []).some((k) => k.id !== key.id && sameTime(k.time, target))) {
      studio.say(copy.keyBlocked(label(layer), target));
      return;
    }
    if (sameTime(target, key.time)) return;
    onLayers(layer, (layers[layer] ?? []).map((k) => (k.id === key.id ? { ...k, time: target } : k)));
    studio.say(copy.keyMoved(label(layer), target));
  };

  const addKey = () => {
    if (!editable || !selected) return;
    const time = round1(playhead);
    if ((layers[selected] ?? []).some((k) => sameTime(k.time, time))) {
      studio.say(copy.keyBlocked(label(selected), time));
      return;
    }
    const key: Key = { id: nextKey++, time, value: values[selected] ?? 0, easing: "linear" };
    onLayers(selected, [...(layers[selected] ?? []), key]);
    setCurrent(key.id);
    setRoving((r) => ({ ...r, [selected]: key.id }));
    studio.say(copy.keyAdded(label(selected), time));
  };

  const removeKey = (layer: string, key: Key) => {
    const list = ordered(layer);
    const index = list.findIndex((k) => k.id === key.id);
    const next = list[index + 1] ?? list[index - 1] ?? null;
    onLayers(layer, (layers[layer] ?? []).filter((k) => k.id !== key.id));
    studio.say(copy.keyRemoved(label(layer)));
    if (next) {
      setRoving((r) => ({ ...r, [layer]: next.id }));
      setCurrent(next.id);
      requestAnimationFrame(() => buttons.current.get(next.id)?.focus());
      buttons.current.get(next.id)?.focus();
    } else {
      setCurrent(null);
      layerButtons.current.get(layer)?.focus();
    }
  };

  const onKeyKeyDown = (event: KeyboardEvent<HTMLButtonElement>, layer: string, key: Key) => {
    if (!editable) return;
    const list = ordered(layer);
    const index = list.findIndex((k) => k.id === key.id);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      moveKey(layer, key, key.time + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 1 : 0.1));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeKey(layer, key);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const other = list[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (other) buttons.current.get(other.id)?.focus();
    }
  };

  const onRegionKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "k" && event.key !== "K") return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && (target.type === "text" || target.type === "number")) return;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    event.preventDefault();
    addKey();
  };

  const setEasing = (easing: Easing) => {
    if (!currentKey || !currentLayer || !editable) return;
    onLayers(currentLayer, (layers[currentLayer] ?? []).map((k) => (k.id === currentKey.id ? { ...k, easing } : k)));
    studio.say(copy.keyEased(label(currentLayer), EASING_LABELS[easing]));
  };

  const onLanePointer = (event: PointerEvent<HTMLButtonElement>, layer: string, key: Key) => {
    if (!editable) return;
    if (event.type === "pointerdown") {
      drag.current = { layer, id: key.id, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const active = drag.current;
    if (!active || active.id !== key.id) return;
    const lane = lanes.current.get(layer)?.getBoundingClientRect();
    if (event.type === "pointerup" || event.type === "pointercancel") {
      drag.current = null;
      if (active.moved && lane) moveKey(layer, key, ((event.clientX - lane.left - 22) / Math.max(1, lane.width - 44)) * duration);
      return;
    }
    if (lane && Math.abs(event.movementX) > 0) active.moved = true;
  };

  return (
    <section className="timeline-panel" aria-label="Timeline" onKeyDown={onRegionKeyDown}>
      <div className="timeline-head">
        <p className="panel-title">Keyframe timeline</p>
        <button type="button" className="button button-ghost" onClick={props.onPlay}>
          <Icon name={playing ? "pause" : "play"} size={16} />
          {playing ? "Pause preview" : "Play preview"}
        </button>
      </div>
      <div className="tracks">
        <div className="layer-buttons">
          {piece.uniforms.map((u, row) => (
            <button
              key={u.name}
              ref={(el) => {
                if (el) layerButtons.current.set(u.name, el);
              }}
              type="button"
              className="layer-button"
              style={{ gridRow: row + 1, order: row * 2 }}
              aria-pressed={selected === u.name}
              onClick={() => setSelected(u.name)}
            >
              <span className="visually-hidden">Select {u.label} layer</span>
              <span aria-hidden="true">{u.label}</span>
            </button>
          ))}
        </div>
        <div className="lanes">
          {piece.uniforms.map((u, row) => {
            const keys = layers[u.name] ?? [];
            const sorted = ordered(u.name);
            const stop = selected === u.name ? (roving[u.name] && keys.some((k) => k.id === roving[u.name]) ? roving[u.name] : sorted[0]?.id) : undefined;
            return (
              <div
                key={u.name}
                ref={(el) => {
                  if (el) lanes.current.set(u.name, el);
                }}
                className="lane"
                style={{ gridRow: row + 1, order: row * 2 + 1 }}
              >
                <span className="lane-label" aria-hidden="true">{u.label}</span>
                {keys.length === 0 ? <span className="lane-empty muted">No keyframes. Press K to add one at the playhead.</span> : null}
                {keys.map((key) => (
                  <button
                    key={key.id}
                    ref={(el) => {
                      if (el) buttons.current.set(key.id, el);
                      else buttons.current.delete(key.id);
                    }}
                    type="button"
                    className={`keyframe ${current === key.id ? "is-current" : ""}`}
                    style={{ "--t": key.time / duration, order: sorted.findIndex((k) => k.id === key.id) } as React.CSSProperties}
                    tabIndex={stop === key.id ? 0 : -1}
                    aria-label={`Keyframe ${u.label} at ${key.time.toFixed(1)} s`}
                    onFocus={() => {
                      setCurrent(key.id);
                      setSelected(u.name);
                      setRoving((r) => ({ ...r, [u.name]: key.id }));
                    }}
                    onKeyDown={(event) => onKeyKeyDown(event, u.name, key)}
                    onPointerDown={(event) => onLanePointer(event, u.name, key)}
                    onPointerMove={(event) => onLanePointer(event, u.name, key)}
                    onPointerUp={(event) => onLanePointer(event, u.name, key)}
                    onPointerCancel={(event) => onLanePointer(event, u.name, key)}
                  >
                    <span className="diamond" aria-hidden="true" />
                    <span className="keyframe-row-text" aria-hidden="true">
                      {key.time.toFixed(1)} s · {key.value.toFixed(2)} · {EASING_LABELS[key.easing]}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
          <div className="playhead-line" style={{ "--t": props.playhead / duration, gridRow: `1 / span ${piece.uniforms.length}` } as React.CSSProperties} aria-hidden="true" />
        </div>
      </div>
      <label className="playhead">
        <span className="control-label">Playhead <span className="tabular">{playhead.toFixed(1)} s</span></span>
        <input
          type="range"
          aria-label="Playhead"
          min={0}
          max={duration}
          step={0.1}
          value={playhead}
          aria-valuenow={round1(playhead)}
          aria-valuetext={`${playhead.toFixed(1)} seconds`}
          onChange={(e) => props.onSeek(Number(e.target.value))}
        />
      </label>
      <div className="timeline-controls">
        <fieldset className="easing">
          <legend id="easing-legend">Easing</legend>
          <div role="radiogroup" aria-labelledby="easing-legend" className="segmented">
            {EASINGS.map((easing) => (
              <label key={easing} className="segment">
                <input type="radio" name="easing" value={easing} checked={currentKey?.easing === easing} disabled={!currentKey || !editable}
                  onChange={() => setEasing(easing)} />
                <span>{EASING_LABELS[easing]}</span>
              </label>
            ))}
          </div>
          <EasingCurve easing={currentKey?.easing ?? "linear"} />
        </fieldset>
        <AudioRow audio={props.audio} assets={props.assets} peaks={props.peaks} />
        <AssetUploads piece={piece} editable={editable} studio={studio} onAsset={props.onAsset} />
      </div>
      <hr className="panel-rule" />
      <RenderFooter piece={piece} dirty={props.dirty} editable={editable} />
    </section>
  );
}

function EasingCurve({ easing }: { easing: Easing }) {
  const points = Array.from({ length: 21 }, (_, i) => {
    const x = i / 20;
    return `${(4 + x * 56).toFixed(1)},${(36 - eased(easing, x) * 32).toFixed(1)}`;
  }).join(" ");
  return (
    <svg className="easing-curve" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
      <path d="M4 36H60M4 4V36" className="curve-axis" />
      <polyline points={points} className="curve-line" />
    </svg>
  );
}

function AudioRow({ audio, assets, peaks }: { audio: string | null; assets: Asset[]; peaks: number[] | null }) {
  const stem = assets.find((a) => a.id === audio);
  if (!stem) return <p className="audio-row muted">No audio stem.</p>;
  return (
    <div className="audio-row">
      {peaks ? (
        <svg role="img" aria-label="Audio waveform" className="waveform" viewBox={`0 0 ${peaks.length * 3} 40`} preserveAspectRatio="none">
          {peaks.map((p, i) => (
            <rect key={i} x={i * 3} y={20 - p * 18} width={2} height={Math.max(1, p * 36)} rx={1} />
          ))}
        </svg>
      ) : null}
      <p className="muted small">{stem.filename} · {stem.bytes.toLocaleString("en-US")} bytes</p>
    </div>
  );
}

async function waveformOf(file: File): Promise<number[] | null> {
  try {
    const context = new OfflineAudioContext(1, 1, 44_100);
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0);
    const bars = 96;
    const size = Math.max(1, Math.floor(data.length / bars));
    const peaks = Array.from({ length: bars }, (_, i) => {
      let max = 0;
      for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j++) max = Math.max(max, Math.abs(data[j] ?? 0));
      return max;
    });
    const top = Math.max(...peaks, 0.0001);
    return peaks.map((p) => p / top);
  } catch {
    return null;
  }
}

function AssetUploads({ piece, editable, studio, onAsset }: { piece: Piece; editable: boolean; studio: Announcer; onAsset: (asset: Asset, peaks: number[] | null) => void }) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const kinds = [
    { kind: "audio", label: "Upload audio stem", accept: ".wav,.mp3,audio/wav,audio/mpeg" },
    { kind: "font", label: "Upload font", accept: ".woff2,.ttf" },
    { kind: "model", label: "Upload model", accept: ".glb,model/gltf-binary" },
  ] as const;
  const upload = async (kind: string, file: File) => {
    if (file.size > UPLOAD_LIMIT) {
      studio.say(copy.tooLarge);
      return;
    }
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file, file.name);
    const result = await api<{ asset: Asset }>("POST", `/api/pieces/${piece.slug}/assets`, form);
    if (result.ok) {
      onAsset(result.data.asset, kind === "audio" ? await waveformOf(file) : null);
      studio.say(copy.uploaded(result.data.asset.filename));
    } else if (result.status === 413) studio.say(copy.tooLarge);
    else if (result.status === 503) studio.say("File storage is offline, so uploads are paused. Try again in a minute.");
    else studio.say(result.error.fields ? Object.values(result.error.fields).join(" ") : result.error.message);
  };
  return (
    <div className="uploads">
      {kinds.map(({ kind, label, accept }) => (
        <span key={kind}>
          <button type="button" className="button button-ghost" disabled={!editable} onClick={() => inputs.current.get(kind)?.click()}>
            <Icon name="upload" size={16} />
            {label}
          </button>
          <input
            ref={(el) => {
              if (el) inputs.current.set(kind, el);
            }}
            type="file"
            accept={accept}
            hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(kind, file);
            }}
          />
        </span>
      ))}
    </div>
  );
}

function RenderFooter({ piece, dirty, editable }: { piece: Piece; dirty: boolean; editable: boolean }) {
  const renderStatus = useAnnouncer();
  const { say } = renderStatus;
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [format, setFormat] = useState<Format>("mp4");
  const [seconds, setSeconds] = useState("10");
  const [credits, setCredits] = useState<Credits | null>(null);
  const [render, setRender] = useState<Render | null>(null);
  const [busy, setBusy] = useState(false);
  const announced = useRef(new Map<string, number>());
  const action = useRef(new IdempotentAction());
  const duration = Math.round(Number(seconds));
  const validDuration = Number.isInteger(duration) && duration >= RENDER_SECONDS.min && duration <= RENDER_SECONDS.max;
  const cost = renderCost(validDuration ? duration : RENDER_SECONDS.min, resolution);

  const loadCredits = useCallback(() => void api<Credits>("GET", "/api/me/credits").then((r) => r.ok && setCredits(r.data)), []);
  useEffect(() => {
    loadCredits();
    const timer = window.setInterval(loadCredits, 10_000);
    return () => window.clearInterval(timer);
  }, [loadCredits]);

  useEffect(() => {
    void api<{ renders: Render[] }>("GET", `/api/pieces/${piece.slug}/renders`).then((r) => {
      const latest = r.ok ? r.data.renders[0] : undefined;
      if (latest) {
        announced.current.set(latest.id, latest.history.length);
        setRender(latest);
      }
    });
  }, [piece.slug]);

  const announce = useCallback(
    (next: Render) => {
      const from = announced.current.get(next.id) ?? 0;
      const lines: string[] = [];
      for (let i = from; i < next.history.length; i++) lines.push(...renderLines(next, i));
      announced.current.set(next.id, next.history.length);
      if (lines.length) say(...lines);
      setRender(next);
    },
    [say],
  );

  // while a render is unsettled, re-read it every 2 seconds
  const unsettled = render && UNSETTLED.includes(render.state) ? render.id : null;
  useEffect(() => {
    if (!unsettled) return;
    const timer = window.setInterval(async () => {
      const result = await api<Render>("GET", `/api/renders/${unsettled}`);
      if (!result.ok) return;
      announce(result.data);
      if (!UNSETTLED.includes(result.data.state)) loadCredits();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [unsettled, announce, loadCredits]);

  const start = async () => {
    setBusy(true);
    const result = await action.current.send<{ render: Render }>("POST", `/api/pieces/${piece.slug}/renders`, { format, resolution, duration_s: duration, aspect });
    setBusy(false);
    if (result.ok) {
      announce(result.data.render);
      loadCredits();
    } else if (result.status === 402) say(copy.needsCredits(Number(result.error.needed), Number(result.error.available)));
    else say(result.error.fields ? Object.values(result.error.fields).join(" ") : result.error.message);
  };

  const cancel = async () => {
    if (!render) return;
    const result = await api<Render>("POST", `/api/renders/${render.id}/cancel`);
    if (result.ok) {
      announce(result.data);
      loadCredits();
    } else say(result.error.message);
  };

  const short = credits !== null && credits.available < cost;
  const disabled = !editable || busy || dirty || short || !validDuration;
  const groups: { name: string; options: readonly string[]; value: string; set: (v: string) => void; labels?: Record<string, string> }[] = [
    { name: "Aspect ratio", options: ASPECTS, value: aspect, set: (v) => setAspect(v as Aspect) },
    { name: "Resolution", options: ["720p", "1080p"], value: resolution, set: (v) => setResolution(v as Resolution) },
    { name: "Format", options: ["mp4", "webm"], value: format, set: (v) => setFormat(v as Format), labels: { mp4: "MP4", webm: "WebM" } },
  ];

  return (
    <div className="render-footer">
      <div className="export-choices">
        {groups.map((group) => (
          <fieldset key={group.name} className="choice">
            <legend id={`legend-${group.name.replace(/\W+/g, "-")}`}>{group.name}</legend>
            <div role="radiogroup" aria-labelledby={`legend-${group.name.replace(/\W+/g, "-")}`} className="segmented">
              {group.options.map((option) => (
                <label key={option} className="segment">
                  <input type="radio" name={group.name} value={option} checked={group.value === option} onChange={() => group.set(option)} />
                  <span>{group.labels?.[option] ?? option}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <label className="choice duration">
          <span className="control-label">Duration (seconds)</span>
          <input type="number" min={RENDER_SECONDS.min} max={RENDER_SECONDS.max} step={1} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
        </label>
      </div>
      <div className="render-row">
        <PixelPanel state={assistantFor(render)} size="small" />
        <div className="render-actions">
          <button type="button" className={`button render-button ${disabled ? "is-dim" : "button-accent"}`} disabled={disabled} onClick={() => void start()}>
            <Icon name="clapperboard" size={16} />
            Render {aspect} · {cost} credits
          </button>
          {render?.state === "queued" ? (
            <button type="button" className="button button-ghost" onClick={() => void cancel()}>
              Cancel render
            </button>
          ) : null}
          <p className="muted small">
            {dirty ? "Save your changes before rendering. " : ""}
            {credits ? `${credits.available} credits available` : ""}
            {short ? ` · `: ""}
            {short ? <Link to="/studio/credits">Top up credits</Link> : null}
          </p>
        </div>
        <LiveStatus label="Render status" announcer={renderStatus} className="render-status" />
      </div>
    </div>
  );
}

function PublishControls({ piece, studio, onPiece }: { piece: Piece; studio: Announcer; onPiece: (p: Piece) => void }) {
  const [open, setOpen] = useState(false);
  const [renders, setRenders] = useState<Render[]>([]);
  const [editions, setEditions] = useState("30");
  const [price, setPrice] = useState("15.00");
  const [exportId, setExportId] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const opener = useRef<HTMLButtonElement>(null);
  const ids = { edition_count: useId(), price_cents: useId(), export_render_id: useId() };

  const openDialog = async () => {
    const result = await api<{ renders: Render[] }>("GET", `/api/pieces/${piece.slug}/renders`);
    const ready = result.ok ? result.data.renders.filter((r) => r.state === "ready") : [];
    setRenders(ready);
    setExportId(ready[0]?.id ?? "");
    setFields({});
    setOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const count = Number(editions);
    const match = /^\$?\s*(\d{1,4}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(price.trim());
    const cents = match ? Number((match[1] ?? "0").replace(/,/g, "")) * 100 + Number((match[2] ?? "0").padEnd(2, "0")) : NaN;
    const result = await api<Piece>("POST", `/api/pieces/${piece.slug}/publish`, {
      edition_count: Number.isInteger(count) ? count : editions,
      price_cents: Number.isFinite(cents) ? cents : price,
      export_render_id: exportId,
    });
    if (result.ok) {
      setOpen(false);
      onPiece(result.data);
      studio.say(copy.published(result.data.edition_count ?? count));
    } else if (result.status === 422) setFields(result.error.fields ?? {});
    else {
      setOpen(false);
      studio.say(result.error.message);
    }
  };

  const withdraw = async () => {
    const result = await api<Piece>("POST", `/api/pieces/${piece.slug}/withdraw`);
    if (result.ok) {
      onPiece(result.data);
      studio.say(copy.withdrawn);
    } else studio.say(result.error.message);
  };

  if (piece.state === "published") {
    return (
      <>
        <Link to={`/pieces/${piece.slug}`} className="button button-ghost">View run</Link>
        <button type="button" className="button button-ghost" onClick={() => void withdraw()}>Withdraw</button>
      </>
    );
  }
  if (piece.state !== "draft") return null;
  return (
    <>
      <button ref={opener} type="button" className="button button-ghost" onClick={() => void openDialog()}>
        Publish
      </button>
      <Dialog open={open} label="Publish edition run" onClose={() => setOpen(false)} returnFocus={opener} initialFocus="[data-autofocus]">
        <form className="sheet-form" onSubmit={(event) => void submit(event)} noValidate>
          <ErrorSummary fields={fields} ids={ids} />
          <label htmlFor={ids.edition_count}>Editions</label>
          <input id={ids.edition_count} data-autofocus type="number" min={1} max={500} value={editions} onChange={(e) => setEditions(e.target.value)} aria-invalid={Boolean(fields.edition_count)} />
          <FieldError id={`${ids.edition_count}-error`} message={fields.edition_count} />
          <label htmlFor={ids.price_cents}>Price (USD)</label>
          <input id={ids.price_cents} type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={Boolean(fields.price_cents)} />
          <FieldError id={`${ids.price_cents}-error`} message={fields.price_cents} />
          <label htmlFor={ids.export_render_id}>Export</label>
          <select id={ids.export_render_id} value={exportId} onChange={(e) => setExportId(e.target.value)} aria-invalid={Boolean(fields.export_render_id)}>
            {renders.length === 0 ? <option value="">No ready export yet</option> : null}
            {renders.map((r) => (
              <option key={r.id} value={r.id}>
                {r.aspect} · {r.resolution} · {r.duration_s} s {r.format.toUpperCase()} · {r.created_at.slice(0, 16).replace("T", " ")}
              </option>
            ))}
          </select>
          <FieldError id={`${ids.export_render_id}-error`} message={fields.export_render_id} />
          <p className="muted small">Collectors pay this price plus VAT by billing country. Every number in the run carries its own seed.</p>
          <div className="sheet-actions">
            <button type="submit" className="button button-accent">Publish run</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
