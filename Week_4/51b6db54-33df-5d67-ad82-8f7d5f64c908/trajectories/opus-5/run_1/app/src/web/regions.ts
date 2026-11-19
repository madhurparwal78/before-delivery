import { clear, el } from './dom.js';

export interface Regions {
  root: HTMLElement;
  stage(text: string): void;
  list(text: string): void;
  team(text: string): void;
  sync(lines: string[]): void;
  job(text: string): void;
  draft(text: string): void;
  notice(text: string): void;
  alert(text: string | null): void;
}

/** Every live region the product publishes, with their exact names. */
export function mountRegions(): Regions {
  const make = (name: string, extraClass = ''): HTMLElement =>
    el('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': name,
      class: `live-region ${extraClass}`.trim(),
    });

  const stage = make('Stage announcements');
  const list = make('List announcements');
  const team = make('Team announcements', 'team');
  const sync = make('Sync status');
  const job = make('Job progress');
  const draft = make('Draft status');
  const notices = make('Notices');
  const alertRegion = el('div', { role: 'alert', class: 'alert-region' });

  const root = el('div', { class: 'regions' }, [
    stage,
    list,
    team,
    sync,
    job,
    draft,
    notices,
    alertRegion,
  ]);

  const teamLines: string[] = [];

  return {
    root,
    stage: (text) => {
      stage.textContent = text;
    },
    list: (text) => {
      list.textContent = text;
    },
    team: (text) => {
      teamLines.push(text);
      while (teamLines.length > 20) teamLines.shift();
      clear(team);
      for (const line of teamLines) team.append(el('p', { text: line }));
    },
    sync: (lines) => {
      clear(sync);
      for (const line of lines) sync.append(el('p', { text: line }));
    },
    job: (text) => {
      job.textContent = text;
    },
    draft: (text) => {
      draft.textContent = text;
    },
    notice: (text) => {
      notices.textContent = text;
    },
    alert: (text) => {
      if (text === null) {
        clear(alertRegion);
        alertRegion.classList.remove('shown');
        return;
      }
      alertRegion.textContent = text;
      alertRegion.classList.add('shown');
    },
  };
}
