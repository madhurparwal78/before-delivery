import { progressFor } from '../../shared/completeness.js';
import {
  countsLine,
  followed,
  followNoSignal,
  GLOBAL_COPY,
  PROGRAMS_COPY,
  unfollowed,
} from '../../shared/messages.js';
import type { Program } from '../../shared/types.js';
import { api } from '../api.js';
import { internalLink, workingScreen } from '../chrome.js';
import { rulesFor, viewSubjects } from '../derive.js';
import { el, setStatus } from '../dom.js';
import { journalEntries } from '../journal.js';
import { prefetchAccount } from '../prefetch.js';
import { regions } from '../regions.js';
import { onLeaveScreen } from '../router.js';
import { appState, subscribe, updateCopy } from '../state.js';

/** While offline, or with changes queued, counts come from the device. */
export function progressLineFor(program: Program): string {
  const state = appState();
  if (state.offline || journalEntries().length > 0) {
    const progress = progressFor(viewSubjects(), rulesFor(program));
    return countsLine(progress.qualifying, progress.total, progress.required);
  }
  return countsLine(program.progress.qualifying, program.progress.total, program.progress.required);
}

interface FollowRunner {
  press: (program: Program, wanted: boolean, paint: () => void) => void;
}

/** Each program has at most one follow request in flight; the newest press stands. */
function followRunner(): FollowRunner {
  const inFlight = new Set<string>();
  const wantedState = new Map<string, boolean>();

  const run = (program: Program, paint: () => void): void => {
    const wanted = wantedState.get(program.id);
    if (wanted === undefined || inFlight.has(program.id)) return;
    inFlight.add(program.id);
    void (async () => {
      const answer = wanted
        ? await api.post<{ following: boolean }>(`/api/programs/${program.id}/follow`)
        : await api.del<{ following: boolean }>(`/api/programs/${program.id}/follow`);
      inFlight.delete(program.id);
      const latest = wantedState.get(program.id);
      if (answer.offline || answer.status >= 500) {
        wantedState.delete(program.id);
        updateCopy((copy) => {
          copy.programs = copy.programs.map((entry) =>
            entry.id === program.id ? { ...entry, following: program.following } : entry,
          );
        });
        setStatus(
          regions.programsStatus,
          answer.offline ? followNoSignal(program.name) : GLOBAL_COPY.internal,
        );
        paint();
        return;
      }
      if (latest !== undefined && latest !== wanted) {
        run({ ...program, following: wanted }, paint);
        return;
      }
      wantedState.delete(program.id);
      updateCopy((copy) => {
        copy.programs = copy.programs.map((entry) =>
          entry.id === program.id ? { ...entry, following: wanted } : entry,
        );
      });
      setStatus(regions.programsStatus, wanted ? followed(program.name) : unfollowed(program.name));
      paint();
    })();
  };

  return {
    press: (program, wanted, paint) => {
      wantedState.set(program.id, wanted);
      updateCopy((copy) => {
        copy.programs = copy.programs.map((entry) =>
          entry.id === program.id ? { ...entry, following: wanted } : entry,
        );
      });
      paint();
      run(program, paint);
    },
  };
}

function programRow(program: Program, runner: FollowRunner, paint: () => void): HTMLElement {
  const label = program.following ? `Unfollow ${program.name}` : `Follow ${program.name}`;
  const toggle = el('button', {
    class: 'button row-button',
    text: label,
    attrs: { type: 'button' },
  });
  toggle.addEventListener('click', () => runner.press(program, !program.following, paint));
  return el('li', { class: 'row program-row' }, [
    internalLink(program.name, `/programs/${program.id}`, 'row-link'),
    el('span', { class: 'row-detail', text: progressLineFor(program) }),
    toggle,
  ]);
}

export async function renderPrograms(): Promise<HTMLElement> {
  const { root, content } = workingScreen('Programs');
  const status = el('div', {
    class: 'status-line',
    attrs: { role: 'status', 'aria-label': 'Programs status', 'aria-live': 'polite' },
  });
  regions.programsStatus = status;

  const yours = el('ul', { class: 'list', attrs: { role: 'list', 'aria-label': 'Your programs' } });
  const all = el('ul', { class: 'list', attrs: { role: 'list', 'aria-label': 'All programs' } });
  const empty = el('p', { class: 'banner', text: PROGRAMS_COPY.empty });
  const runner = followRunner();

  const paint = (): void => {
    const programs = appState().copy.programs;
    const following = programs.filter((program) => program.following);
    yours.replaceChildren(...following.map((program) => programRow(program, runner, paint)));
    all.replaceChildren(...programs.map((program) => programRow(program, runner, paint)));
    empty.classList.toggle('hidden', following.length > 0);
    yours.classList.toggle('hidden', following.length === 0);
  };

  content.append(
    el('h2', { class: 'subheading', text: 'Your programs' }),
    empty,
    yours,
    status,
    el('h2', { class: 'subheading', text: 'All programs' }),
    all,
  );

  paint();
  const unsubscribe = subscribe(paint);
  onLeaveScreen(unsubscribe);
  void prefetchAccount().then(paint);
  return root;
}
