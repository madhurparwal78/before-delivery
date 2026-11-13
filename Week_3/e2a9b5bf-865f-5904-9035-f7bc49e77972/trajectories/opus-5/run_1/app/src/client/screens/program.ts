import { progressFor, representativeQualifying } from '../../shared/completeness.js';
import { countsLine, editionLine, GLOBAL_COPY } from '../../shared/messages.js';
import { formatAperture } from '../../shared/optics.js';
import type { Packet, ProgramDetail } from '../../shared/types.js';
import { api } from '../api.js';
import { missingScreen, notFoundScreen, workingScreen } from '../chrome.js';
import { rulesFor, viewObservation, viewSubjects } from '../derive.js';
import { el, setStatus } from '../dom.js';
import { journalEntries } from '../journal.js';
import { prefetchAccount } from '../prefetch.js';
import { regions } from '../regions.js';
import { navigate, onLeaveScreen, type ScreenContext } from '../router.js';
import { appState, subscribe, updateCopy } from '../state.js';
import { draftObservationIdsFor } from '../packet-draft.js';

export async function renderProgram(context: ScreenContext): Promise<HTMLElement> {
  const programId = context.params.id ?? '';
  const answer = await api.get<ProgramDetail>(`/api/programs/${encodeURIComponent(programId)}`);
  if (answer.status === 404) return notFoundScreen();
  if (answer.ok && answer.body) {
    const detail = answer.body;
    updateCopy((copy) => {
      copy.programs = copy.programs.some((entry) => entry.id === detail.id)
        ? copy.programs.map((entry) => (entry.id === detail.id ? { ...entry, ...detail } : entry))
        : [...copy.programs, detail];
      copy.program_objects[detail.id] = detail.objects;
    });
  }

  const stored = appState().copy.programs.find((entry) => entry.id === programId);
  const objects = appState().copy.program_objects[programId];
  if (!stored || !objects) return missingScreen();

  const { root, content } = workingScreen(stored.name);
  const bar = el('div', {
    class: 'progress',
    attrs: {
      role: 'progressbar',
      'aria-label': `Progress toward ${stored.name}`,
      'aria-valuemin': '0',
    },
  });
  const barFill = el('div', { class: 'progress-fill' });
  bar.append(barFill);
  const counts = el('p', { class: 'counts' });
  const rules = el('div', {
    class: 'status-line',
    attrs: { role: 'status', 'aria-label': 'Program rules', 'aria-live': 'polite' },
  });
  regions.programRules = rules;
  const checklist = el('ul', {
    class: 'list',
    attrs: { role: 'list', 'aria-label': 'Checklist' },
  });
  const build = el('button', { class: 'button', text: 'Build packet', attrs: { type: 'button' } });
  const buildStatus = el('div', { class: 'status-line' });

  if (stored.editions.length > 1) {
    const newest = stored.editions[stored.editions.length - 1];
    if (newest) setStatus(rules, editionLine(newest.edition, newest.effective_from));
  } else {
    rules.classList.add('hidden');
  }

  const paint = (): void => {
    const state = appState();
    const program = state.copy.programs.find((entry) => entry.id === programId) ?? stored;
    const list = state.copy.program_objects[programId] ?? objects;
    const onDevice = state.offline || journalEntries().length > 0;
    const subjects = viewSubjects();
    const programRules = rulesFor(program);
    const progress = onDevice ? progressFor(subjects, programRules) : program.progress;

    setStatus(counts, countsLine(progress.qualifying, progress.total, progress.required));
    bar.setAttribute('aria-valuenow', String(progress.qualifying));
    bar.setAttribute('aria-valuemax', String(progress.total));
    barFill.style.width = `${progress.total === 0 ? 0 : (progress.qualifying / progress.total) * 100}%`;

    checklist.replaceChildren(
      ...list.map((entry) => {
        const chosenId = onDevice
          ? (representativeQualifying(subjects, entry.object_id, programRules)?.id ?? null)
          : entry.qualifying_observation_id;
        const observation = chosenId ? viewObservation(chosenId) : null;
        const detail = observation
          ? `${observation.evening_date} · ${formatAperture(observation.derived.aperture_mm)} mm · ${observation.derived.magnification}×`
          : 'not yet';
        return el('li', { class: 'row' }, [
          el('span', { class: 'row-name', text: `${entry.designation}, ${entry.name}` }),
          el('span', { class: 'row-detail', text: detail }),
        ]);
      }),
    );
  };

  let building = false;
  build.addEventListener('click', () => {
    if (building) return;
    building = true;
    void (async () => {
      const ids = draftObservationIdsFor(programId);
      const created = await api.post<Packet>('/api/packets', {
        program_id: programId,
        observation_ids: ids,
      });
      building = false;
      if (created.offline) {
        setStatus(buildStatus, GLOBAL_COPY.needs_signal);
        return;
      }
      if (created.status !== 201 || !created.body) {
        setStatus(buildStatus, GLOBAL_COPY.internal);
        return;
      }
      const packet = created.body;
      updateCopy((copy) => {
        copy.packets[packet.id] = packet;
      });
      navigate(`/packets/${packet.id}`);
    })();
  });

  content.append(bar, counts, rules, checklist, build, buildStatus);
  paint();
  const unsubscribe = subscribe(paint);
  onLeaveScreen(unsubscribe);
  void prefetchAccount().then(paint);
  return root;
}
