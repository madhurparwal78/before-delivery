// Type page: the New <type> dialog and the grid of object cards that turn to show their properties.
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { api, fieldErrors, get, NetworkError } from '../api.ts';
import { Dialog } from '../Dialog.tsx';
import { Margin } from '../Frame.tsx';
import { QUIRE_CURVE_CSS, reducedMotion } from '../motion.ts';
import { navigate } from '../router.ts';
import { useSync } from '../sync.ts';
import type { FieldJson, ObjectJson, PropertyValue, TypeJson } from '../types.ts';
import {
  CARD_PERSPECTIVE_PX, CARD_ROW_MS, CARD_ROW_RISE_PX, CARD_TURN_MS, FADE_MS, cardRowDelay,
} from '../../shared/motion.ts';
import { compareIds, compareText } from '../../shared/query.ts';
import { NotFound } from './NotFound.tsx';
import '../styles/cards.css';

const LIVE_EVENTS = new Set(['backlinks.changed', 'object.saved', 'object.removed', 'sync.reset']);

const byTitle = (a: ObjectJson, b: ObjectJson): number => compareText(a.title, b.title) || compareIds(a.id, b.id);

interface PageData { type: TypeJson; objects: ObjectJson[]; titles: Map<string, string> }

/** The type, its objects in title order, and the titles of every relation target. */
async function loadPage(typeId: string): Promise<PageData | 'missing' | null> {
  const t = await get<{ types: TypeJson[] }>('/api/types');
  if (t.status !== 200) return null;
  const type = t.data.types.find((x) => x.id === typeId);
  if (!type) return 'missing';
  const o = await get<{ objects: ObjectJson[] }>(`/api/objects?type_id=${encodeURIComponent(typeId)}`);
  if (o.status !== 200) return null;
  const titles = new Map<string, string>();
  const targets = [...new Set(type.fields.filter((f) => f.kind === 'relation' && f.target_type_id).map((f) => f.target_type_id as string))];
  const lists = await Promise.all(targets.map((id) => (id === typeId ? Promise.resolve(o) : get<{ objects: ObjectJson[] }>(`/api/objects?type_id=${encodeURIComponent(id)}`))));
  for (const list of lists) if (list.status === 200) for (const x of list.data.objects) titles.set(x.id, x.title);
  return { type, objects: [...o.data.objects].sort(byTitle), titles };
}

export function TypePage({ typeId }: { typeId: string }) {
  const [data, setData] = useState<PageData | null>(null);
  const [missing, setMissing] = useState(false);
  const [creating, setCreating] = useState(false);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await loadPage(typeId);
      if (mine !== seq.current || next === null) return;
      if (next === 'missing') setMissing(true);
      else {
        setMissing(false);
        setData(next);
      }
    } catch {
      // offline: keep what is shown; sync.reset refetches
    }
  }, [typeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useSync((event) => {
    if (LIVE_EVENTS.has(event)) void reload();
  });

  if (missing) return <NotFound />;
  if (!data) return <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>;
  const { type, objects, titles } = data;
  const daily = type.builtin && type.name === 'Daily note';
  return (
    <>
      <h1>{type.name}</h1>
      {!daily && (
        <div className="type-actions">
          <button type="button" className="primary" onClick={() => setCreating(true)}>New {type.name}</button>
        </div>
      )}
      <div className="card-grid">
        {objects.map((o) => <ObjectCard key={o.id} object={o} fields={type.fields} titles={titles} />)}
      </div>
      <Margin>
        <section className="margin-section type-summary" aria-labelledby="type-summary-head">
          <h2 id="type-summary-head" className="margin-head small-caps">Fields</h2>
          {type.fields.length === 0 ? <p className="margin-empty muted">This type has no fields.</p> : (
            <dl className="type-fields">
              {type.fields.map((f) => (
                <div key={f.name}>
                  <dt>{f.name}</dt>
                  <dd className="muted">{f.kind}{f.required ? ', required' : ''}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </Margin>
      {creating && (
        <NewObjectDialog
          type={type}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}
    </>
  );
}

/** Dialog `New <type name>`: a title, then Create. */
function NewObjectDialog({ type, onClose, onCreated }: { type: TypeJson; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const label = `New ${type.name}`;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const r = await api<ObjectJson>('POST', '/api/objects', { type_id: type.id, title, properties: {} });
      if (r.status === 201) {
        onCreated();
        return;
      }
      const errs = fieldErrors(r);
      setErrors(errs);
      if (errs.title) titleRef.current?.focus();
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
    } finally {
      setPending(false);
    }
  };

  const others = Object.entries(errors).filter(([k]) => k !== 'title');
  return (
    <Dialog label={label} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <h2>{label}</h2>
        <div className="field">
          <label htmlFor="new-object-title">Title</label>
          <input
            id="new-object-title" ref={titleRef} type="text" value={title} autoComplete="off"
            aria-describedby={errors.title ? 'new-object-title-error' : undefined} aria-invalid={errors.title ? true : undefined}
            onChange={(e) => setTitle(e.target.value)}
          />
          {errors.title && <p id="new-object-title-error" className="field-error">{errors.title}</p>}
        </div>
        {others.map(([k, msg]) => <p key={k} className="field-error">{msg}</p>)}
        <div className="dialog-actions">
          <button type="submit" className="primary" aria-busy={pending || undefined}>Create</button>
        </div>
      </form>
    </Dialog>
  );
}

/** A property value as the card's back shows it. */
function shownValue(field: FieldJson, value: PropertyValue | undefined, titles: Map<string, string>): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field.kind === 'relation') return titles.get(String(value)) ?? '—';
  return String(value);
}

type Side = 'front' | 'back';

const angle = (side: Side): string => `rotateY(${side === 'back' ? 180 : 0}deg)`;

/** One object card: front with title and numeral, back with the property list; turns on its vertical centre line. */
function ObjectCard({ object, fields, titles }: { object: ObjectJson; fields: FieldJson[]; titles: Map<string, string> }) {
  const [side, setSide] = useState<Side>('front');
  const inner = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const showBtn = useRef<HTMLButtonElement>(null);
  const frontBtn = useRef<HTMLButtonElement>(null);
  const turn = useRef<Animation | null>(null);
  const rows = useRef<Animation[]>([]);
  const sideNow = useRef<Side>('front');

  useEffect(() => () => {
    turn.current?.cancel();
    for (const a of rows.current) a.cancel();
  }, []);

  const press = (): void => {
    const el = inner.current;
    if (!el) return;
    const from = sideNow.current;
    const to: Side = from === 'front' ? 'back' : 'front';
    sideNow.current = to;
    const midTurn = turn.current !== null && turn.current.playState === 'running';
    flushSync(() => setSide(to));
    el.style.transform = angle(to);
    if (reducedMotion()) {
      turn.current?.cancel();
      turn.current = null;
      for (const a of rows.current) a.cancel();
      rows.current = [];
      const face = to === 'back' ? back.current : front.current;
      face?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'linear' });
    } else if (midTurn && turn.current) {
      // Back the way it came, from the angle now drawn, over the time it had run.
      turn.current.reverse();
      for (const a of rows.current) if (a.playState === 'running') a.reverse();
    } else {
      for (const a of rows.current) a.cancel();
      rows.current = [];
      turn.current = el.animate([{ transform: angle(from) }, { transform: angle(to) }], { duration: CARD_TURN_MS, easing: QUIRE_CURVE_CSS });
      if (to === 'back' && back.current) {
        const items = back.current.querySelectorAll<HTMLElement>('[data-card-row]');
        rows.current = [...items].map((row, k) => row.animate(
          [{ opacity: 0, transform: `translateY(${CARD_ROW_RISE_PX}px)` }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: CARD_ROW_MS, delay: cardRowDelay(k), easing: QUIRE_CURVE_CSS, fill: 'backwards' },
        ));
      }
    }
    (to === 'back' ? frontBtn.current : showBtn.current)?.focus();
  };

  const open = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(`/o/${object.id}`, { titleFrom: e.currentTarget.getBoundingClientRect() });
  };

  const title = object.title;
  return (
    <article className="object-card" aria-label={title}>
      <div className="card-turn" style={{ perspective: `${CARD_PERSPECTIVE_PX}px` }}>
        <div className="card-inner" data-card-inner="" ref={inner}>
          <div className="card-face card-front" data-card-face="front" ref={front} inert={side !== 'front'} aria-hidden={side !== 'front' || undefined}>
            <div className="card-head">
              <a className="card-title" href={`/o/${object.id}`} onClick={open}>{title}</a>
              <span className="card-count">
                <span className="card-numeral" data-backlink-count={object.backlinks}>{object.backlinks}</span>
                <span className="card-noun">{object.backlinks === 1 ? 'backlink' : 'backlinks'}</span>
              </span>
            </div>
            <div className="card-body" />
            <div className="card-foot">
              <button type="button" className="turn" ref={showBtn} onClick={press}>Show properties<span className="sr-only"> of {title}</span></button>
            </div>
          </div>
          <div className="card-face card-back" data-card-face="back" ref={back} inert={side !== 'back'} aria-hidden={side !== 'back' || undefined}>
            <h2 className="card-back-title">{title}</h2>
            <dl className="card-props">
              {fields.map((f) => (
                <div className="card-row" data-card-row="" key={f.name}>
                  <dt>{f.name}</dt>
                  <dd>{shownValue(f, object.properties[f.name], titles)}</dd>
                </div>
              ))}
            </dl>
            <div className="card-foot">
              <button type="button" className="turn" ref={frontBtn} onClick={press}>Show front<span className="sr-only"> of {title}</span></button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
