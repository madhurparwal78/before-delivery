// Campaign and Loadout views: encounter gates, manifests and device selection.
import { state, navigate, announceStatus, handleApiError, disabledWhilePending, clearError } from '../app.js';
import { api } from '../api.js';
import type { CampaignShape, EncounterShape } from '../api.js';
import { DEVICES, deviceById } from '../../shared/seed.js';
import { formatMilliCharge } from '../format.js';

export function renderCampaign(main: HTMLElement): void {
  main.innerHTML = `
    <h1>Campaign</h1>
    <section aria-label="Campaign encounters" id="campaign-encounters" class="panel encounter-list">
      <p id="campaign-loading">Loading harbour records…</p>
    </section>
    <section aria-label="Encounter manifest" id="encounter-manifest" class="panel manifest">
      <p>Select an encounter to inspect its manifest.</p>
    </section>
    <section aria-label="Verified progress" id="verified-progress" class="panel">
      <h2 class="section-heading">Verified progress</h2>
      <p id="progress-text">Sign in to track verified completions.</p>
      <button id="refresh-progress" class="secondary">Refresh progress</button>
    </section>
  `;
  const list = document.getElementById('campaign-encounters')!;
  api<CampaignShape>('GET', '/api/campaign')
    .then(({ data }) => {
      renderEncounters(data.encounters);
      renderProgress(data.progress);
    })
    .catch((e) => {
      handleApiError(e);
      list.innerHTML = '<p>Encounters are unavailable right now.</p>';
    });

  function renderEncounters(encounters: EncounterShape[]): void {
    announceStatus('Harbour records loaded.');
    list.innerHTML = encounters
      .map(
        (encounter) => `
        <article class="encounter-card" data-encounter="${encounter.id}">
          <h3 class="encounter-title">${escapeHtml(encounter.title)}</h3>
          <p class="encounter-difficulty">${encounter.definition.difficulty}</p>
          <p class="encounter-gate">${encounter.completed ? 'Completed.' : encounter.unlocked ? 'Unlocked.' : 'Complete the preceding encounter first.'}</p>
          <button class="inspect-encounter" data-encounter="${encounter.id}" ${encounter.unlocked ? '' : 'aria-disabled="true"'}>Inspect ${escapeHtml(encounter.title)}</button>
          <button class="choose-loadout" data-encounter="${encounter.id}" ${encounter.unlocked && state.account ? '' : 'disabled'}>Choose loadout</button>
        </article>`,
      )
      .join('');
    list.querySelectorAll<HTMLButtonElement>('.inspect-encounter').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.encounter!;
        state.selectedEncounterId = id;
        const encounter = encounters.find((e) => e.id === id);
        if (encounter) renderManifest(encounter);
      });
    });
    list.querySelectorAll<HTMLButtonElement>('.choose-loadout').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedEncounterId = button.dataset.encounter!;
        navigate('loadout');
      });
    });
  }

  function renderManifest(encounter: EncounterShape): void {
    const manifest = document.getElementById('encounter-manifest')!;
    const waves = encounter.definition.waves
      .map((wave, index) => `Wave ${index + 1}: ${wave.creature} ×${wave.count} every ${wave.interval} ticks from tick ${wave.tick} in lane ${wave.lane === 0 ? 'random' : wave.lane}`)
      .join('<br>');
    manifest.innerHTML = `
      <h2 class="section-heading">${escapeHtml(encounter.title)}</h2>
      <dl class="manifest-grid">
        <dt>Title</dt><dd>${escapeHtml(encounter.title)}</dd>
        <dt>Seed</dt><dd>${encounter.definition.seed}</dd>
        <dt>Digest</dt><dd class="digest">${encounter.digest.slice(0, 16)}…</dd>
        <dt>Ruleset</dt><dd>orrel-1</dd>
        <dt>Waves</dt><dd>${encounter.definition.waves.length}</dd>
        <dt>Gate</dt><dd>${encounter.unlocked ? (encounter.completed ? 'Completed — replayable.' : 'Unlocked.') : 'Locked: complete the preceding encounter first.'}</dd>
      </dl>
      <p class="wave-list">${waves}</p>
    `;
  }

  function renderProgress(progress: { completed: string[]; unlocked: string[] }): void {
    const text = document.getElementById('progress-text')!;
    if (!state.account) {
      text.textContent = 'Sign in to track verified completions.';
      return;
    }
    const completedTitles = progress.completed
      .map((id) => encountersByTitle(id))
      .filter(Boolean)
      .join(', ');
    const unlockedTitles = progress.unlocked.map((id) => encountersByTitle(id)).filter(Boolean).join(', ');
    text.textContent = `Completed: ${completedTitles || 'none yet'}. Unlocked: ${unlockedTitles || 'none'}.`;
  }

  document.getElementById('refresh-progress')?.addEventListener('click', async () => {
    const button = document.getElementById('refresh-progress') as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Loading harbour records…');
    try {
      const { data } = await api<{ completed: string[]; unlocked: string[] }>('GET', '/api/progress');
      const completedTitles = data.completed.map((id) => encountersByTitle(id)).filter(Boolean).join(', ');
      const unlockedTitles = data.unlocked.map((id) => encountersByTitle(id)).filter(Boolean).join(', ');
      const text = document.getElementById('progress-text');
      if (text) {
        text.textContent = `Completed: ${completedTitles || 'none yet'}. Unlocked: ${unlockedTitles || 'none'}.`;
      }
      announceStatus('Harbour records loaded.');
    } catch (e) {
      handleApiError(e);
    } finally {
      restore();
    }
  });

  function encountersByTitle(id: string): string {
    const found = CAMPAIGN_TITLES[id];
    return found ?? '';
  }
}

const CAMPAIGN_TITLES: Record<string, string> = {
  c1: 'First Lantern',
  c2: 'Cup of Tide',
  c3: 'Bellwater',
  c4: 'Shingle Reach',
  c5: 'Crossing Foam',
  c6: 'Hinged Breakwater',
  c7: 'Storm Choir',
  c8: 'Orrel Unbroken',
};

// ---------- Loadout ----------

export interface LoadoutSelection {
  devices: string[];
}

export const loadout: LoadoutSelection = { devices: ['wick'] };

export function renderLoadout(main: HTMLElement): void {
  const encounterId = state.selectedEncounterId;
  main.innerHTML = `
    <h1>Loadout</h1>
    <p class="loadout-intro">Choose one to four devices for ${escapeHtml(CAMPAIGN_TITLES[encounterId ?? ''] ?? 'your defence')}.</p>
    <section aria-label="Crew loadout" id="crew-loadout" class="panel" role="group">
      ${DEVICES.map(
        (device) => `
        <div class="device-choice">
          <input type="checkbox" id="device-${device.id}" data-device="${device.id}" ${loadout.devices.includes(device.id) ? 'checked' : ''}>
          <label for="device-${device.id}">${device.name}</label>
          <p class="device-effect">${deviceEffect(device.id)}</p>
        </div>`,
      ).join('')}
    </section>
    <div class="loadout-actions">
      <button id="start-defence" class="primary">Start defence</button>
    </div>
  `;
  main.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const device = checkbox.dataset.device!;
      if (checkbox.checked) {
        if (!loadout.devices.includes(device)) loadout.devices.push(device);
      } else {
        loadout.devices = loadout.devices.filter((d) => d !== device);
      }
      const start = document.getElementById('start-defence') as HTMLButtonElement;
      start.disabled = loadout.devices.length < 1 || loadout.devices.length > 4;
    });
  });
  const start = document.getElementById('start-defence') as HTMLButtonElement;
  start.disabled = loadout.devices.length < 1 || loadout.devices.length > 4;
  start.addEventListener('click', async () => {
    clearError();
    const restore = disabledWhilePending(start);
    announceStatus('Preparing the encounter…');
    try {
      const { data } = await api<{ ticket: import('../api.js').Ticket }>('POST', '/api/runs', {
        mode: 'campaign',
        sourceId: encounterId,
        revision: null,
        loadout: loadout.devices,
      });
      state.ticket = data.ticket;
      await api('POST', `/api/runs/${data.ticket.id}/start`, {});
      announceStatus('Encounter ready.');
      import('../app.js').then((m) => m.navigate('defence'));
    } catch (e) {
      handleApiError(e);
      restore();
    }
  });
}

function deviceEffect(deviceId: string): string {
  const device = deviceById(deviceId);
  if (!device) return '';
  const parts: string[] = [];
  if (device.damage > 0) {
    parts.push(`${device.maxTargets > 1 ? `Up to ${device.maxTargets} targets` : 'One target'} — ${device.damage} damage${device.ignoresArmour ? ', ignoring armour' : ''}`);
  }
  if (device.generation > 0) {
    parts.push(`Generates ${formatMilliCharge(device.generation)} every 20 ticks`);
  }
  if (device.slowdownDivisor) {
    parts.push(`Divides creature speed by ${device.slowdownDivisor} (upgraded ${device.upgradedSlowdownDivisor})`);
  }
  if (device.range) {
    parts.push(`Range ${device.range}`);
  }
  return `Cost ${formatMilliCharge(device.cost)}, upgrade ${formatMilliCharge(device.upgradeCost)}. ${parts.join('. ')}.`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
