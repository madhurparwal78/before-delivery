import {
  deliveryAnnouncement,
  retirementAnnouncement,
} from '../shared/messages.js';
import type { DeliveryItem, MatchState } from '../shared/types.js';
import { announce, find, make, must, reducedMotion } from './dom.js';

export interface TickConfig {
  tick_ms: number;
  tick_stagger_ms: number;
}

export interface ViewContext {
  scoring: boolean;
  tick: TickConfig;
  logoFor(teamId: string): string | null;
  onChange?(item: DeliveryItem): void;
}

export function announcementFor(state: MatchState): string | null {
  const newest = state.commentary[0];
  if (!newest) return null;
  const team = state.batting_team?.name ?? '';
  if (newest.kind === 'retirement') {
    return retirementAnnouncement({
      short: newest.line.replace(' retired hurt', ''),
      team,
      runs: state.runs,
      wickets: state.wickets,
    });
  }
  const overEnd = newest.kind === 'over-end' ? newest.line : null;
  const delivery = state.commentary.find((item) => item.kind === 'delivery');
  if (!delivery) return null;
  return deliveryAnnouncement({
    line: delivery.line,
    team,
    runs: state.runs,
    wickets: state.wickets,
    overEndLine: overEnd,
    breakText: state.innings_break ? state.innings_break.text : null,
    result: state.result,
  });
}

interface DigitGroup {
  container: HTMLElement;
  text: string;
}

export class StateView {
  private rendered: MatchState | null = null;
  private groups = new Map<string, DigitGroup>();

  constructor(private readonly ctx: ViewContext) {}

  get state(): MatchState | null {
    return this.rendered;
  }

  show(
    state: MatchState,
    options: { direction?: 'up' | 'down'; announce?: string | null } = {},
  ): void {
    const first = this.rendered === null;
    this.renderScoreboard(state, {
      animate: !first && !reducedMotion(),
      mark: !first,
      direction: options.direction ?? 'up',
    });
    this.renderBatters(state);
    this.renderBowler(state);
    this.renderRates(state);
    this.renderThisOver(state);
    this.renderFreeHit(state);
    this.renderBreak(state);
    this.renderResult(state);
    this.renderCommentary(state);
    this.rendered = state;
    if (options.announce) announce(options.announce);
  }

  private renderScoreboard(
    state: MatchState,
    motion: { animate: boolean; mark: boolean; direction: 'up' | 'down' },
  ): void {
    const box = must('#scoreboard');
    box.dataset.runs = String(state.runs);
    box.dataset.wickets = String(state.wickets);
    box.dataset.legalBalls = String(state.legal_balls);
    if (state.innings) box.dataset.innings = state.innings;
    else delete box.dataset.innings;

    const team = state.batting_team?.name ?? '';
    const logo = state.batting_team ? this.ctx.logoFor(state.batting_team.id) : null;
    if (this.groups.size === 0 || box.dataset.team !== team || box.dataset.logo !== String(logo)) {
      box.textContent = '';
      this.groups.clear();
      if (logo && state.batting_team) {
        const image = make('img', { src: logo, alt: `${team} logo`, class: 'scoreboard-logo' });
        box.append(image);
      }
      box.append(make('span', { class: 'team' }, team));
      box.append(document.createTextNode(' '));
      const score = make('span', { class: 'score' });
      score.append(this.group('runs'), make('span', { class: 'slash' }, '/'), this.group('wickets'));
      box.append(score);
      const overs = make('span', { class: 'overs' });
      overs.append(document.createTextNode(' ('), this.group('overs'), document.createTextNode(' ov)'));
      box.append(overs);
      box.dataset.team = team;
      box.dataset.logo = String(logo);
    }

    this.updateGroup('runs', String(state.runs), motion, 0);
    this.updateGroup('wickets', String(state.wickets), motion, this.ctx.tick.tick_stagger_ms);
    this.updateGroup('overs', state.overs_text, motion, this.ctx.tick.tick_stagger_ms * 2);
  }

  private group(name: string): HTMLElement {
    const container = make('span', { class: 'digits', 'data-group': name });
    this.groups.set(name, { container, text: '' });
    return container;
  }

  private updateGroup(
    name: string,
    text: string,
    motion: { animate: boolean; mark: boolean; direction: 'up' | 'down' },
    delay: number,
  ): void {
    const group = this.groups.get(name);
    if (!group) return;
    const characters = [...text];
    const changed: HTMLElement[] = [];
    const existing = [...group.container.children] as HTMLElement[];
    if (existing.length !== characters.length) {
      group.container.textContent = '';
      for (const character of characters) {
        const element = make(
          'span',
          { class: /\d/.test(character) ? 'digit' : 'sep' },
          character,
        );
        group.container.append(element);
        if (/\d/.test(character)) changed.push(element);
      }
    } else {
      characters.forEach((character, index) => {
        const element = existing[index];
        if (element.textContent !== character) {
          element.textContent = character;
          if (element.classList.contains('digit')) changed.push(element);
        }
      });
    }
    for (const element of [...group.container.children] as HTMLElement[]) {
      element.classList.toggle('changed', motion.mark && changed.includes(element));
    }
    group.text = text;
    if (!motion.animate) return;
    for (const element of changed) {
      element.dataset.ticking = 'true';
      const from = motion.direction === 'up' ? '100%' : '-100%';
      const animation = element.animate(
        [
          { transform: `translateY(${from})` },
          { transform: 'translateY(0)' },
        ],
        {
          duration: this.ctx.tick.tick_ms,
          delay,
          easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
          id: 'ball-tick',
          fill: 'none',
        },
      );
      void animation.finished
        .then(() => {
          delete element.dataset.ticking;
        })
        .catch(() => {
          delete element.dataset.ticking;
        });
    }
  }

  private renderBatters(state: MatchState): void {
    const list = must('#batters');
    list.textContent = '';
    for (const batter of state.batters) {
      const item = make('li', {
        'data-player': batter.player,
        'data-on-strike': String(batter.on_strike),
      });
      item.textContent = batter.text;
      list.append(item);
    }
  }

  private renderBowler(state: MatchState): void {
    must('#bowler').textContent = state.bowler ? state.bowler.text : '';
  }

  private renderRates(state: MatchState): void {
    must('#run-rate').textContent = state.run_rate;
    const existing = find('#chase');
    if (state.chase) {
      if (existing) existing.textContent = state.chase.text;
      else {
        const line = make('p', { id: 'chase' }, state.chase.text);
        must('#run-rate').after(line);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  private renderThisOver(state: MatchState): void {
    const list = must('#this-over');
    list.textContent = '';
    for (const chip of state.this_over) {
      list.append(make('li', { class: 'chip' }, chip));
    }
  }

  private renderFreeHit(state: MatchState): void {
    const slot = must('#free-hit-slot');
    const existing = find('#free-hit');
    if (state.free_hit && !existing) {
      slot.append(make('p', { id: 'free-hit' }, 'FREE HIT'));
    } else if (!state.free_hit && existing) {
      existing.remove();
    }
  }

  private renderBreak(state: MatchState): void {
    const slot = must('#innings-break-slot');
    slot.textContent = '';
    if (!state.innings_break) return;
    const region = make('section', { id: 'innings-break', 'aria-labelledby': 'innings-break-heading' });
    region.append(make('h2', { id: 'innings-break-heading' }, state.innings_break.heading));
    region.append(make('p', {}, state.innings_break.text));
    slot.append(region);
  }

  private renderResult(state: MatchState): void {
    const slot = must('#result-slot');
    const existing = find('#result');
    if (state.result) {
      if (existing) existing.textContent = state.result;
      else slot.append(make('p', { id: 'result', class: 'band' }, state.result));
    } else if (existing) {
      existing.remove();
    }
  }

  private renderCommentary(state: MatchState): void {
    const list = must('#commentary');
    list.textContent = '';
    for (const item of state.commentary) {
      const element = make('li', { 'data-kind': item.kind });
      if (item.kind === 'delivery') {
        element.dataset.seq = String(item.seq);
        element.dataset.over = String(item.over);
        element.dataset.ball = String(item.ball);
        element.dataset.label = item.label;
        element.dataset.runs = String(item.runs);
        element.dataset.batRuns = String(item.bat_runs);
        element.dataset.extra = item.extra;
        element.dataset.extraRuns = String(item.extra_runs);
        element.dataset.wicket = item.wicket;
        element.dataset.freeHit = String(item.free_hit);
        element.dataset.striker = item.striker;
        element.dataset.bowler = item.bowler;
        element.append(make('span', { class: 'line' }, item.line));
        if (this.ctx.scoring) {
          const button = make('button', { type: 'button', class: 'change-button' }, `Change delivery ${item.seq}`);
          button.addEventListener('click', () => this.ctx.onChange?.(item));
          element.append(button);
        }
      } else if (item.kind === 'over-end') {
        element.dataset.over = String(item.over);
        element.classList.add('over-end');
        element.append(this.overMap(state, item.over));
        element.append(make('span', { class: 'line' }, item.line));
      } else {
        element.dataset.player = item.player;
        element.append(make('span', { class: 'line' }, item.line));
      }
      list.append(element);
    }
  }

  private overMap(state: MatchState, over: number): HTMLElement {
    const marks = state.commentary.filter(
      (item): item is DeliveryItem => item.kind === 'delivery' && item.over === over,
    );
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'over-map');
    svg.setAttribute('viewBox', '0 0 120 40');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const strip = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    strip.setAttribute('x', '0');
    strip.setAttribute('y', '14');
    strip.setAttribute('width', '120');
    strip.setAttribute('height', '12');
    strip.setAttribute('class', 'over-map-strip');
    svg.append(strip);
    marks.reverse().forEach((item, index) => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(8 + index * 13));
      dot.setAttribute('cy', '20');
      dot.setAttribute('r', String(2 + item.runs));
      dot.setAttribute('class', 'over-map-dot');
      svg.append(dot);
    });
    return svg as unknown as HTMLElement;
  }
}
