// Rules view: the complete published rules reference.
import { api } from '../api.js';
import { handleApiError } from '../app.js';

interface RulesShape {
  ruleset: string;
  tickRate: number;
  arithmetic: Record<string, unknown>;
  randomness: Record<string, unknown> & { example: { seed: number; draws: number[]; lanes: number[] } };
  tickOrder: string[];
  devices: Array<Record<string, unknown>>;
  creatures: Array<Record<string, unknown>>;
  limits: Record<string, number>;
  commandRules: Record<string, unknown>;
  rankingRules: Record<string, unknown>;
  seasonRules: Record<string, unknown>;
  transitions: { run: Array<Record<string, string>>; challenge: Array<Record<string, string>>; proof: Array<Record<string, string>> };
}

export function renderRules(main: HTMLElement): void {
  main.innerHTML = `
    <h1>Rules</h1>
    <section aria-label="Rules reference" id="rules-reference" class="panel rules-region">
      <p>Loading the published rules…</p>
    </section>
  `;
  api<RulesShape>('GET', '/api/rules')
    .then(({ data }) => {
      const region = document.getElementById('rules-reference')!;
      region.innerHTML = `
        <h2 class="section-heading">Ruleset ${escapeHtml(data.ruleset)}</h2>
        <p>Simulation runs at ${data.tickRate} fixed ticks per second with integer arithmetic only.</p>
        <h3 class="section-subheading">Arithmetic</h3>
        <dl class="rules-grid">${dlEntries(data.arithmetic)}</dl>
        <h3 class="section-subheading">Randomness</h3>
        <dl class="rules-grid">${dlEntries(data.randomness)}</dl>
        <p>Worked example — seed ${data.randomness.example.seed} produces draws ${data.randomness.example.draws.join(', ')}, choosing lanes ${data.randomness.example.lanes.join(', ')}.</p>
        <h3 class="section-subheading">Tick order</h3>
        <ol class="tick-order">${data.tickOrder.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
        <h3 class="section-subheading">Devices</h3>
        <table class="rules-table"><thead><tr><th>Device</th><th>Cost</th><th>Upgrade</th><th>Range</th><th>Cooldown</th><th>Damage</th><th>Targets</th></tr></thead>
          <tbody>${data.devices
            .map(
              (device) =>
                `<tr><td>${escapeHtml(String(device.name))}</td><td>${device.cost}</td><td>${device.upgradeCost}</td><td>${device.range ?? '—'}</td><td>${device.cooldown ?? '—'}</td><td>${device.damage}</td><td>${device.maxTargets}</td></tr>`,
            )
            .join('')}</tbody></table>
        <h3 class="section-subheading">Creatures</h3>
        <table class="rules-table"><thead><tr><th>Creature</th><th>Health</th><th>Speed</th><th>Armour</th></tr></thead>
          <tbody>${data.creatures
            .map((creature) => `<tr><td>${escapeHtml(String(creature.name))}</td><td>${creature.health}</td><td>${creature.speed}</td><td>${creature.armour}</td></tr>`)
            .join('')}</tbody></table>
        <h3 class="section-subheading">Limits</h3>
        <dl class="rules-grid">${Object.entries(data.limits).map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${value}</dd>`).join('')}</dl>
        <h3 class="section-subheading">Command rules</h3>
        <dl class="rules-grid">${dlEntries(data.commandRules)}</dl>
        <h3 class="section-subheading">Ranking rules</h3>
        <dl class="rules-grid">${dlEntries(data.rankingRules)}</dl>
        <h3 class="section-subheading">Season rules</h3>
        <dl class="rules-grid">${dlEntries(data.seasonRules)}</dl>
        <h3 class="section-subheading">Run transitions</h3>
        <table class="rules-table"><thead><tr><th>Source</th><th>Actor/action</th><th>Destination</th></tr></thead>
          <tbody>${transitionRows(data.transitions.run)}</tbody></table>
        <h3 class="section-subheading">Challenge transitions</h3>
        <table class="rules-table"><thead><tr><th>Source</th><th>Actor/action</th><th>Destination</th></tr></thead>
          <tbody>${transitionRows(data.transitions.challenge)}</tbody></table>
        <h3 class="section-subheading">Proof transitions</h3>
        <table class="rules-table"><thead><tr><th>Source</th><th>Actor/action</th><th>Destination</th></tr></thead>
          <tbody>${transitionRows(data.transitions.proof)}</tbody></table>
      `;
    })
    .catch(handleApiError);
}

function dlEntries(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, entry]) => {
      if (entry === null) return `<dt>${escapeHtml(key)}</dt><dd>null</dd>`;
      if (Array.isArray(entry)) {
        return `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(entry.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join('; '))}</dd>`;
      }
      if (typeof entry === 'object') {
        return `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(JSON.stringify(entry))}</dd>`;
      }
      return `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(entry))}</dd>`;
    })
    .join('');
}

function transitionRows(rows: Array<Record<string, string>>): string {
  return rows.map((row) => `<tr><td>${escapeHtml(row.source)}</td><td>${escapeHtml(row.actorAction)}</td><td>${escapeHtml(row.destinationCondition)}</td></tr>`).join('');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
