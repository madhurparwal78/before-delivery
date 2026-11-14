import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AlertView, SessionStateView } from '../../shared/types.js';

export type LayoutMode = 'desktop' | 'tablet' | 'phone';

function modeFor(width: number): LayoutMode {
  if (width >= 1024) return 'desktop';
  if (width >= 600) return 'tablet';
  return 'phone';
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState(() => modeFor(window.innerWidth));
  useLayoutEffect(() => {
    const onResize = () => setMode(modeFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mode;
}

export function Tabs(props: { label: string; tabs: string[]; selected: string; onSelect(tab: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const idFor = (tab: string) => `${props.label}-${tab}`.toLowerCase().replace(/\W+/g, '-');
  return (
    <div role="tablist" aria-label={props.label} class="tabs" ref={ref}>
      {props.tabs.map((tab, index) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`${idFor(tab)}-tab`}
          aria-selected={tab === props.selected ? 'true' : 'false'}
          aria-controls={`${idFor(tab)}-panel`}
          tabIndex={tab === props.selected ? 0 : -1}
          onClick={() => props.onSelect(tab)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const next = props.tabs[(index + (event.key === 'ArrowRight' ? 1 : props.tabs.length - 1)) % props.tabs.length]!;
            props.onSelect(next);
            ref.current?.querySelector<HTMLElement>(`#${idFor(next)}-tab`)?.focus();
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function TabPanel(props: { label: string; tab: string; children: ComponentChildren }) {
  const id = `${props.label}-${props.tab}`.toLowerCase().replace(/\W+/g, '-');
  return (
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab`} class="tab-panel">
      {props.children}
    </div>
  );
}

export function StatusItems({ state }: { state: SessionStateView }) {
  const label = state.status === 'running' ? 'Running' : state.status === 'paused' ? 'Paused' : 'Ended';
  return (
    <div class="status-bar">
      <p class="status-item">
        <span class="label">Exercise</span>
        <span role="status" aria-label="Exercise state" class="status-value">
          {label}
        </span>
      </p>
      <p class="status-item">
        <span class="label">Sim clock</span>
        <span role="status" aria-label="Sim clock" aria-live="off" data-speed={String(state.speed)} class="status-value tabular big">
          {state.simTime}
        </span>
      </p>
      <p class="status-item">
        <span class="label">Runway in use</span>
        <span role="status" aria-label="Runway in use" class="status-value">
          {state.runwayInUse}
        </span>
      </p>
      <p class="status-item">
        <span class="label">Wind</span>
        <span role="status" aria-label="Wind" class="status-value">
          {`${String(state.wind.dir).padStart(3, '0')} at ${state.wind.kt} kt`}
        </span>
      </p>
      <p class="status-item notice-item">
        <span class="label">Notice</span>
        <span role="status" aria-label="Runway notice" class="status-value">
          {state.notice}
        </span>
      </p>
    </div>
  );
}

function AlertRow({ alert, fresh, reduced }: { alert: AlertView; fresh: boolean; reduced: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!fresh || reduced || !element) return;
    element.setAttribute('data-motion', 'alert');
    setTimeout(() => {
      if (element.getAttribute('data-motion') === 'alert') element.removeAttribute('data-motion');
    }, 250);
  }, []);
  return (
    <li ref={ref} data-rule={alert.rule} data-severity={alert.severity} class={`alert-row severity-${alert.severity}`}>
      {`${alert.simTime} ${alert.rule} ${alert.text}`}
    </li>
  );
}

export function AlertsList({ alerts, seenCount, reduced }: { alerts: AlertView[]; seenCount: number; reduced: boolean }) {
  const rows = alerts.map((alert, index) => ({ alert, index })).reverse();
  return (
    <section aria-labelledby="alerts-heading" class="alerts-cell cell">
      <h2 id="alerts-heading">Alerts</h2>
      <ul aria-label="Alerts" class="alert-list">
        {rows.map(({ alert, index }) => (
          <AlertRow key={index} alert={alert} fresh={index >= seenCount} reduced={reduced} />
        ))}
      </ul>
      {alerts.length === 0 ? <p class="empty">No alerts yet.</p> : null}
    </section>
  );
}

export function LiveRegions(props: { urgent: string; polite: string; notice: string; lost: boolean }) {
  return (
    <div class="live-regions">
      <div role="status" aria-label="Connection" class={props.lost ? 'hatched-cell' : 'live-empty'}>
        {props.lost ? 'Connection lost. Reconnecting...' : ''}
      </div>
      <div role="alert" aria-label="Urgent alerts" aria-live="assertive" class="visually-hidden">
        {props.urgent}
      </div>
      <div role="status" aria-label="Alert announcements" aria-live="polite" class="visually-hidden">
        {props.polite}
      </div>
      <div role="alert" aria-label="Strip notice" class={props.notice ? 'hatched-cell' : 'live-empty'}>
        {props.notice}
      </div>
    </div>
  );
}
