import { DEVICES } from '../../shared/constants.js';
import type { Ticket } from '../../shared/types.js';
import { api } from '../api.js';
import { button, h, region } from '../dom.js';
import { formatCharge, formatTick } from '../../shared/format.js';
import { PENDING_COPY, SUCCESS_COPY, feedback } from '../feedback.js';
import type { Encounter, Progress, Shell } from '../shell.js';
import { startDefenceSession } from './defence.js';

export async function loadCampaign(shell: Shell, announce: boolean): Promise<void> {
  if (announce) feedback.pending(PENDING_COPY.inspection);
  const response = await api.get<{ encounters: Encounter[]; progress: Progress }>('/api/campaign');
  shell.state.campaign = response;
  shell.state.progress = response.progress;
  if (shell.state.selectedEncounter === null) {
    shell.state.selectedEncounter = response.encounters[0].id;
  }
  if (announce) feedback.succeed(SUCCESS_COPY.inspection);
}

export async function loadProgress(shell: Shell): Promise<void> {
  feedback.pending(PENDING_COPY.inspection);
  shell.state.progress = await api.get<Progress>('/api/progress');
  feedback.succeed(SUCCESS_COPY.inspection);
  shell.render();
}

function encounterOf(shell: Shell): Encounter | null {
  const encounters = shell.state.campaign?.encounters ?? [];
  return encounters.find((entry) => entry.id === shell.state.selectedEncounter) ?? null;
}

function manifestPanel(shell: Shell): HTMLElement {
  const encounter = encounterOf(shell);
  if (encounter === null) {
    return region('Encounter manifest', 'panel paper manifest', [
      h('h2', {}, ['Encounter manifest']),
      h('p', {}, ['Inspect an encounter to read its manifest.']),
    ]);
  }
  const scheduled = encounter.definition.waves.reduce((total, wave) => total + wave.count, 0);
  return region('Encounter manifest', 'panel paper manifest', [
    h('h2', {}, ['Encounter manifest']),
    h('dl', { class: 'manifest-list' }, [
      h('dt', {}, ['Title']),
      h('dd', {}, [encounter.title]),
      h('dt', {}, ['Teaching topic']),
      h('dd', {}, [encounter.definition.description]),
      h('dt', {}, ['Difficulty']),
      h('dd', {}, [encounter.definition.difficulty]),
      h('dt', {}, ['Seed']),
      h('dd', { class: 'numeric' }, [String(encounter.definition.seed)]),
      h('dt', {}, ['Digest']),
      h('dd', { class: 'digest' }, [encounter.digest]),
      h('dt', {}, ['Ruleset']),
      h('dd', {}, ['orrel-1']),
      h('dt', {}, ['Waves']),
      h('dd', {}, [
        h(
          'ul',
          {},
          encounter.definition.waves.map((wave, index) =>
            h('li', {}, [
              `Wave ${index + 1}: ${wave.count} × ${wave.creature} from ${formatTick(wave.tick)} every ${formatTick(wave.interval)} in lane ${wave.lane === 0 ? 'random' : wave.lane}`,
            ]),
          ),
        ),
      ]),
      h('dt', {}, ['Scheduled creatures']),
      h('dd', { class: 'numeric' }, [String(scheduled)]),
      h('dt', {}, ['Gate']),
      h('dd', {}, [
        encounter.unlocked
          ? encounter.completed
            ? 'Completed — unlocked'
            : 'Unlocked'
          : 'Locked: complete the preceding encounter first.',
      ]),
    ]),
  ]);
}

function loadoutPanel(shell: Shell): HTMLElement {
  const encounter = encounterOf(shell);
  const group = h('div', { role: 'group', 'aria-label': 'Crew loadout', class: 'crew-rack' });
  for (const device of DEVICES) {
    const id = `loadout-${device.id}`;
    const checkbox = h('input', {
      type: 'checkbox',
      id,
      class: 'crew-checkbox',
      onchange: (event: Event) => {
        const checked = (event.target as HTMLInputElement).checked;
        const current = new Set(shell.state.loadout);
        if (checked) current.add(device.id);
        else current.delete(device.id);
        shell.state.loadout = DEVICES.filter((entry) => current.has(entry.id)).map((entry) => entry.id);
        shell.render();
      },
    }) as HTMLInputElement;
    checkbox.checked = shell.state.loadout.includes(device.id);
    group.append(
      h('div', { class: 'crew-choice' }, [
        checkbox,
        h('label', { for: id }, [`${device.name} ${formatCharge(device.cost)}`]),
        h('p', { class: 'crew-effect' }, [device.effect]),
        h('p', { class: 'crew-effect' }, [
          `Upgrade ${formatCharge(device.upgradeCost)} · ${device.range === null ? 'no range' : `range ${device.range}`} · ${device.cooldown === null ? 'no attack' : `cooldown ${device.cooldown} ticks`}`,
        ]),
      ]),
    );
  }

  const startButton = button('Start defence', async () => {
    if (encounter === null) return;
    startButton.disabled = true;
    feedback.pending(PENDING_COPY.startDefence);
    try {
      const response = await api.post<{ ticket: Ticket }>('/api/runs', {
        mode: 'campaign',
        sourceId: encounter.id,
        revision: null,
        loadout: shell.state.loadout,
      });
      await api.post(`/api/runs/${response.ticket.id}/start`, {});
      feedback.succeed(SUCCESS_COPY.startDefence);
      startDefenceSession(shell, response.ticket, encounter.definition, 'campaign');
    } catch (error) {
      feedback.fail(error);
      startButton.disabled = false;
    }
  });
  startButton.disabled =
    encounter === null ||
    !encounter.unlocked ||
    shell.state.loadout.length < 1 ||
    shell.state.loadout.length > 4;

  return h('div', { class: 'panel paper' }, [
    h('h2', {}, ['Loadout']),
    h('p', {}, ['Choose one to four devices. Device effects below apply at base tier.']),
    group,
    h('div', { class: 'actions-row' }, [startButton]),
  ]);
}

export function renderCampaign(shell: Shell): void {
  const encounters = shell.state.campaign?.encounters ?? [];
  const progress = shell.state.progress;

  const cards = region('Campaign encounters', 'panel sea encounters', [
    h('h2', {}, ['Campaign encounters']),
    ...encounters.map((encounter) =>
      h('article', { class: `encounter-card ${encounter.unlocked ? 'unlocked' : 'locked'}` }, [
        h('h3', {}, [encounter.title]),
        h('p', {}, [encounter.definition.description]),
        h('p', { class: 'gate' }, [
          encounter.unlocked
            ? encounter.completed
              ? 'Completed'
              : 'Unlocked'
            : 'Locked: complete the preceding encounter first.',
        ]),
        button(`Inspect ${encounter.title}`, () => {
          shell.state.selectedEncounter = encounter.id;
          shell.render();
        }, { label: encounter.title }),
      ]),
    ),
  ]);

  const progressPanel = region('Verified progress', 'panel paper', [
    h('h2', {}, ['Verified progress']),
    h('p', {}, [
      `Completed: ${
        progress === null || progress.completed.length === 0
          ? 'none'
          : progress.completed
              .map((id) => encounters.find((entry) => entry.id === id)?.title ?? id)
              .join(', ')
      }`,
    ]),
    h('p', {}, [
      `Unlocked: ${
        progress === null
          ? 'none'
          : progress.unlocked
              .map((id) => encounters.find((entry) => entry.id === id)?.title ?? id)
              .join(', ')
      }`,
    ]),
    button('Refresh progress', () => void loadProgress(shell)),
  ]);

  const actions = h('div', { class: 'panel paper' }, [
    button('Choose loadout', () => shell.navigate('Loadout')),
  ]);

  shell.surface.set([
    { name: 'board', node: cards },
    { name: 'manifest', node: manifestPanel(shell) },
    { name: 'summary', node: progressPanel },
    { name: 'actions', node: actions },
  ]);
  shell.main.append(shell.surface.element);
}

export function renderLoadout(shell: Shell): void {
  shell.surface.set([
    { name: 'board', node: loadoutPanel(shell) },
    { name: 'manifest', node: manifestPanel(shell) },
  ]);
  shell.main.append(shell.surface.element);
}
