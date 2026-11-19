import { useLayoutEffect, useRef } from 'preact/hooks';
import { Glyph } from './glyphs.tsx';
import { motionOk, type MapSession } from './session.ts';
import { api } from '../api.ts';
import { useSession } from './useSession.ts';
import { banner as bannerText } from './banner.ts';

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** The status line for assistive technology: every announcement lands here. */
export function Announcer(props: { session: MapSession }) {
  useSession(props.session);
  return (
    <div role="status" aria-label="Map announcements" aria-live="polite" class="visually-hidden">
      {props.session.announcement}
    </div>
  );
}

function ToastView(props: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (motionOk()) ref.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: EASE, id: 'toast-enter' });
  }, []);
  return (
    <div ref={ref} class="notice-band">
      <Glyph name="alert" size={20} />
      <p>{props.text}</p>
    </div>
  );
}

/** Toasts and notice bands. */
export function Notices(props: { session: MapSession }) {
  const { session } = props;
  useSession(session);
  return (
    <div role="region" aria-label="Notices" class="notices">
      {session.toasts.map((toast) => (
        <ToastView key={toast.id} text={toast.text} />
      ))}
    </div>
  );
}

export function ConnectionBanner(props: { session: MapSession }) {
  const { session } = props;
  useSession(session);
  const text = bannerText(session);
  if (!text) return null;
  return (
    <div role="region" aria-label="Connection" class="notice-band connection">
      <Glyph name="wifi" size={20} />
      <p class="figure">{text}</p>
    </div>
  );
}

export function RecoveredBand(props: { session: MapSession }) {
  const { session } = props;
  useSession(session);
  if (session.recovered.length === 0) return null;
  const forget = async (id: string, verb: 'reapply' | 'dismiss'): Promise<void> => {
    session.recovered = session.recovered.filter((e) => e.id !== id);
    session.notify();
    if (verb === 'reapply') await api('POST', `/api/maps/${session.mapId}/recovered/${id}/reapply`);
    else await api('DELETE', `/api/maps/${session.mapId}/recovered/${id}`);
  };
  return (
    <div role="region" aria-label="Recovered edits" class="notice-band recovered band">
      <Glyph name="alert" size={20} />
      <div>
        <h2 class="band-title">Recovered edits</h2>
        <ul>
          {session.recovered.map((entry) => (
            <li key={entry.id}>
              <span class="recovered-text">{entry.text}</span>
              <span class="muted"> from {entry.from_title}</span>
              <button type="button" class="btn btn-secondary btn-small" onClick={() => void forget(entry.id, 'reapply')}>
                Re-apply
              </button>
              <button type="button" class="btn btn-secondary btn-small" onClick={() => void forget(entry.id, 'dismiss')}>
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function People(props: { session: MapSession }) {
  const { session } = props;
  useSession(session);
  return (
    <ul aria-label="People here" class="people">
      {session.people.map((person) => (
        <li key={person.id} class="person" style={{ '--branch': `var(--c-${person.colour})` }}>
          <span class="person-dot" aria-hidden="true" />
          <span class="person-name">
            {person.name}
            {person.guest ? ' (guest)' : ''}
          </span>
          <span class="muted person-role">{person.role}</span>
          {person.id !== session.me.id ? (
            <button
              type="button"
              class="btn btn-secondary btn-small"
              aria-pressed={session.following === person.name}
              aria-label={`Follow ${person.name}`}
              onClick={() => (session.following === person.name ? session.stopFollowing() : session.follow(person.name))}
            >
              Follow
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function FindBar(props: { session: MapSession; onClose: () => void }) {
  const { session } = props;
  useSession(session);
  const first = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => first.current?.focus(), []);
  const found = session.matches();
  const f = session.find;
  const count = f.query.trim() === '' ? '' : found.length === 0 ? 'No matches' : `${f.current + 1} of ${found.length}`;
  const editable = session.canEdit;
  return (
    <div
      role="search"
      aria-label="Find in map"
      class="find"
      data-region="panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }
      }}
    >
      <label class="field-col">
        <span>Find</span>
        <input ref={first} type="text" aria-label="Find" value={f.query} onInput={(event) => session.setFind({ query: event.currentTarget.value })} />
      </label>
      <p class="find-count figure" aria-live="polite">
        {count}
      </p>
      <button type="button" class="btn btn-secondary btn-small" aria-label="Previous match" onClick={() => session.stepMatch(-1)}>
        <Glyph name="previous" size={16} />
      </button>
      <button type="button" class="btn btn-secondary btn-small" aria-label="Next match" onClick={() => session.stepMatch(1)}>
        <Glyph name="next" size={16} />
      </button>
      {editable ? (
        <>
          <label class="field-col">
            <span>Replace with</span>
            <input type="text" aria-label="Replace with" value={f.replace} onInput={(event) => session.setFind({ replace: event.currentTarget.value })} />
          </label>
          <button type="button" class="btn btn-primary btn-small" onClick={() => session.replaceAll()}>
            Replace all
          </button>
        </>
      ) : null}
      <select aria-label="Filter by assignee" value={f.assignee} onChange={(event) => session.setFind({ assignee: event.currentTarget.value })}>
        <option value="">Anyone</option>
        {session.roster.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select aria-label="Filter by icon" value={f.icon} onChange={(event) => session.setFind({ icon: event.currentTarget.value })}>
        <option value="">Any icon</option>
        {ICON_NAMES.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select aria-label="Filter by task state" value={f.state} onChange={(event) => session.setFind({ state: event.currentTarget.value })}>
        <option value="">Any state</option>
        <option value="open">Open</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>
    </div>
  );
}

import { ICONS } from '../../shared/model.ts';
const ICON_NAMES = ICONS;

export interface MenuAction {
  name: string;
  run: () => void;
}

/** The long-press and context menu for a topic. */
export function TopicMenu(props: { session: MapSession; topicId: string; actions: MenuAction[]; onClose: () => void; anchor: { x: number; y: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  useLayoutEffect(() => {
    const away = (event: Event): void => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', escape, true);
    };
  });
  const close = (): void => {
    props.onClose();
    queueMicrotask(() => opener.current?.focus({ preventScroll: true }));
  };
  const items = (): HTMLElement[] => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Topic actions"
      class="topic-menu"
      style={{ left: `${props.anchor.x}px`, top: `${props.anchor.y}px` }}
      onKeyDown={(event) => {
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
          event.preventDefault();
          list[(at + 1) % list.length]?.focus();
        } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
          event.preventDefault();
          list[(at - 1 + list.length) % list.length]?.focus();
        }
      }}
    >
      {props.actions.map((action) => (
        <button
          key={action.name}
          type="button"
          role="menuitem"
          class="menu-item"
          onClick={() => {
            props.onClose();
            action.run();
          }}
        >
          {action.name}
        </button>
      ))}
    </div>
  );
}
