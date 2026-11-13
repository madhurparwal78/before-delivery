import { VNode } from './jsx/jsx-runtime.js';
import { EngravedSystem, VoiceEvent } from './api.js';

export interface EditorProps {
  systems: EngravedSystem[];
  events: VoiceEvent[];
  entryStaffId: string | null;
  entryVoice: number;
  selectedStaves: string[];
  onCaretMove(index: number): void;
  onNoteClick(index: number): void;
}

/**
 * The score editor: it shows the server-engraved systems with the caret and
 * current note highlighted, and hosts keyboard note entry.
 */
export class ScoreEditor {
  private host: HTMLElement | null = null;
  private caretIndex = -1;
  private events: VoiceEvent[];
  private hostRef: { current: HTMLElement | null } | null = null;

  constructor(private props: EditorProps) {
    this.events = props.events;
  }

  setEvents(events: VoiceEvent[]): void {
    this.events = events;
    this.paint();
  }

  setCaret(index: number): void {
    this.caretIndex = index;
    this.props.onCaretMove(index);
    this.paint();
  }

  attach(): void {
    this.paint();
  }

  node(): VNode {
    this.hostRef = { current: null };
    return {
      type: 'div',
      props: {
        class: 'score-svg-holder',
        role: 'application',
        'aria-label': 'Score editor',
        tabindex: '0',
        ref: this.hostRef,
        onclick: () => this.props.onNoteClick(this.caretIndex),
      },
      children: this.props.systems.map((sys) => ({
        type: 'div',
        props: {
          role: 'group',
          class: 'system-group',
          'aria-label': `System ${sys.index}, measures ${sys.firstMeasure}–${sys.lastMeasure}`,
        },
        children: [
          { type: 'div', props: { dangerouslySetInnerHTML: { __html: sys.svg } } },
        ],
      })),
    };
  }

  /** Clicks pick the nearest event inside the clicked system's measures. */
  bindClick(): void {
    const host = this.hostRef?.current;
    if (!host || host.dataset.bound === '1') return;
    host.dataset.bound = '1';
    host.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const system = target.closest('.system-group');
      if (system && this.events.length > 0) {
        const match = /measures (\d+)–(\d+)/.exec(system.getAttribute('aria-label') ?? '');
        if (match) {
          const first = Number(match[1]);
          const last = Number(match[2]);
          const found = this.events.findIndex((e) => e.measure >= first && e.measure <= last);
          if (found >= 0) {
            this.caretIndex = found;
            this.props.onNoteClick(found);
          }
        }
      }
    });
  }

  private paint(): void {
    this.host = this.hostRef?.current ?? this.host;
    if (!this.host) return;
    const holder = this.host;
    this.host.querySelector('.current-note-marker')?.remove();
    if (this.caretIndex < 0 || this.caretIndex >= this.events.length) return;
    const event = this.events[this.caretIndex];
    const systems = holder.querySelectorAll<HTMLElement>('.system-group');
    for (const system of systems) {
      const label = system.getAttribute('aria-label') ?? '';
      const m = /measures (\d+)–(\d+)/.exec(label);
      if (!m) continue;
      const first = Number(m[1]);
      const last = Number(m[2]);
      if (event.measure >= first && event.measure <= last) {
        system.style.position = 'relative';
        const marker = document.createElement('div');
        marker.className = 'current-note-marker';
        marker.style.position = 'absolute';
        marker.style.left = '0';
        marker.style.top = '0';
        marker.style.bottom = '0';
        marker.style.width = '3px';
        marker.style.background = '#c33c1e';
        marker.style.pointerEvents = 'none';
        system.appendChild(marker);
        break;
      }
    }
  }
}
