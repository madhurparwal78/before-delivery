import { api } from '../api.ts';
import { motionEnabled } from '../shell.ts';
import {
  springState,
  rulesState,
  classifierState,
  classifierTrainCopy,
  neighboursState,
  type SpringSeed,
  type RulesSeed,
  type ClassifierSeed,
  type NeighboursSeed,
  type ExhibitSeed,
} from './index.ts';
import type { Rule, TrainingPoint } from '../../shared/exhibits.ts';

/** Exhibit wiring: every control updates its result in place and announces it. */

async function seedFor(key: string): Promise<ExhibitSeed | null> {
  try {
    return await api.get<ExhibitSeed>(`/api/exhibits/${key}`);
  } catch {
    return null;
  }
}

export async function initSpringExhibit(): Promise<void> {
  const seedOrNull = (await seedFor('spring')) as SpringSeed | null;
  const region = document.querySelector<HTMLElement>('[data-exhibit="spring"]');
  if (!seedOrNull || !region) return;
  const seed: SpringSeed = seedOrNull;
  const stiffness = region.querySelector<HTMLInputElement>('[data-role="stiffness"]');
  const damping = region.querySelector<HTMLInputElement>('[data-role="damping"]');
  const pluck = region.querySelector<HTMLButtonElement>('[data-role="pluck"]');
  const status = region.querySelector<HTMLElement>('[data-role="spring-status"]');
  const canvas = region.querySelector<HTMLCanvasElement>('[data-role="spring-canvas"]');

  let stiffnessValue = seed.stiffness.initial;
  let dampingValue = seed.damping.initial;

  function draw(offset = 0): void {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#131410';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2b2d24';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    const chains = 9;
    const amplitude = (h / 2) * 0.55;
    for (let i = 0; i < chains; i++) {
      const cx = ((i + 0.5) / chains) * w;
      const displacement = offset * amplitude * Math.cos((i / chains) * Math.PI * 1.5);
      ctx.fillStyle = i % 2 === 0 ? '#e8e2d4' : '#8d8878';
      ctx.save();
      ctx.translate(cx, h / 2 + displacement);
      ctx.rotate(offset * (i / chains));
      ctx.fillRect(-6, -16, 12, 32);
      ctx.restore();
    }
  }

  function update(): void {
    const state = springState(stiffnessValue, dampingValue);
    if (status) status.textContent = state.copy;
    draw(0);
  }

  stiffness?.addEventListener('input', () => {
    stiffnessValue = Number(stiffness.value);
    update();
  });
  damping?.addEventListener('input', () => {
    dampingValue = Number(damping.value);
    update();
  });

  let animating = false;
  pluck?.addEventListener('click', () => {
    if (!motionEnabled()) {
      draw(0);
      return;
    }
    if (animating) return;
    animating = true;
    const start = performance.now();
    const duration = 4000;
    const step = (now: number): void => {
      const t = (now - start) / duration;
      if (t >= 1) {
        animating = false;
        draw(0);
        return;
      }
      const decay = Math.exp(-t * (dampingValue / 8));
      const omega = Math.sqrt(stiffnessValue / 20);
      const offset = decay * Math.cos(t * omega * 8) * 0.9;
      draw(offset);
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  });

  update();
}

export async function initRulesExhibit(): Promise<void> {
  const seedOrNull = (await seedFor('rules')) as RulesSeed | null;
  const region = document.querySelector<HTMLElement>('[data-exhibit="rules"]');
  if (!seedOrNull || !region) return;
  const seed: RulesSeed = seedOrNull;
  let rules: Rule[] = seed.rules.map((r) => ({ ...r }));
  const rulesSlot = region.querySelector<HTMLElement>('[data-role="rules-list"]');
  const addButton = region.querySelector<HTMLButtonElement>('[data-role="add-rule"]');
  const tableBody = region.querySelector<HTMLTableSectionElement>('[data-role="specimens-body"]');
  const status = region.querySelector<HTMLElement>('[data-role="rules-status"]');

  function renderRules(): void {
    if (!rulesSlot) return;
    rulesSlot.textContent = '';
    rules.forEach((rule, index) => {
      const group = document.createElement('div');
      group.className = 'rule-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', `Rule ${index + 1}`);
      const row = document.createElement('div');
      row.className = 'rule-row';

      const attrLabel = document.createElement('label');
      attrLabel.textContent = 'Attribute';
      const attr = document.createElement('select');
      attr.setAttribute('aria-label', 'Attribute');
      for (const name of ['legs', 'wings', 'feathers']) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name === 'legs' ? 'Legs' : name === 'wings' ? 'Wings' : 'Feathers';
        if (rule.attribute === name) option.selected = true;
        attr.appendChild(option);
      }
      attr.addEventListener('change', () => {
        const next = attr.value as Rule['attribute'];
        rule.attribute = next;
        rule.value = next === 'legs' ? 4 : true;
        renderRules();
        update();
      });

      const valueWrap = document.createElement('label');
      valueWrap.textContent = 'Value';
      let valueControl: HTMLElement;
      if (rule.attribute === 'legs') {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = String(rule.value);
        input.min = String(seed.attributes.legs.min);
        input.max = String(seed.attributes.legs.max);
        input.setAttribute('aria-label', 'Value');
        input.addEventListener('input', () => {
          rule.value = Number(input.value);
          update();
        });
        valueControl = input;
      } else {
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Value');
        const values = rule.attribute === 'wings' ? seed.attributes.wings : seed.attributes.feathers;
        for (const v of values) {
          const option = document.createElement('option');
          option.value = v ? 'yes' : 'no';
          option.textContent = v ? 'Yes' : 'No';
          if (rule.value === v) option.selected = true;
          select.appendChild(option);
        }
        select.addEventListener('change', () => {
          rule.value = select.value === 'yes';
          update();
        });
        valueControl = select;
      }
      valueWrap.appendChild(valueControl);

      const labelWrap = document.createElement('label');
      labelWrap.textContent = 'Label';
      const labelSelect = document.createElement('select');
      labelSelect.setAttribute('aria-label', 'Label');
      for (const name of seed.labels) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        if (rule.label === name) option.selected = true;
        labelSelect.appendChild(option);
      }
      labelSelect.addEventListener('change', () => {
        rule.label = labelSelect.value;
        update();
      });
      labelWrap.appendChild(labelSelect);

      const remove = document.createElement('button');
      remove.textContent = `Remove rule ${index + 1}`;
      remove.addEventListener('click', () => {
        rules.splice(index, 1);
        renderRules();
        update();
      });

      row.append(attr, valueWrap, labelWrap, remove);
      group.appendChild(row);
      rulesSlot.appendChild(group);
    });
    if (addButton) addButton.disabled = rules.length >= seed.max_rules;
  }

  function update(): void {
    const state = rulesState(seed, rules);
    if (status) status.textContent = state.copy;
    if (tableBody) {
      tableBody.textContent = '';
      for (const specimen of seed.specimens) {
        const tr = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = specimen.name;
        const labelCell = document.createElement('td');
        labelCell.textContent = state.labels.get(specimen.name) ?? 'Unclassified';
        tr.append(nameCell, labelCell);
        tableBody.appendChild(tr);
      }
    }
  }

  addButton?.addEventListener('click', () => {
    if (rules.length >= seed.max_rules) return;
    rules.push({ ...seed.new_rule });
    renderRules();
    update();
  });

  renderRules();
  update();
}

export async function initClassifierExhibit(): Promise<void> {
  const seedOrNull = (await seedFor('classifier')) as ClassifierSeed | null;
  const region = document.querySelector<HTMLElement>('[data-exhibit="classifier"]');
  if (!seedOrNull || !region) return;
  const seed: ClassifierSeed = seedOrNull;
  const training: TrainingPoint[] = seed.training.map((p) => ({ ...p }));
  const pointsSlot = region.querySelector<HTMLElement>('[data-role="training-points"]');
  const moveLeft = region.querySelector<HTMLButtonElement>('[data-role="move-left"]');
  const moveRight = region.querySelector<HTMLButtonElement>('[data-role="move-right"]');
  const moveUp = region.querySelector<HTMLButtonElement>('[data-role="move-up"]');
  const moveDown = region.querySelector<HTMLButtonElement>('[data-role="move-down"]');
  const trainButton = region.querySelector<HTMLButtonElement>('[data-role="train"]');
  const accuracyText = region.querySelector<HTMLElement>('[data-role="held-out-accuracy"]');
  const confusion = region.querySelector<HTMLElement>('[data-role="confusion"]');
  const status = region.querySelector<HTMLElement>('[data-role="classifier-status"]');
  const canvas = region.querySelector<HTMLCanvasElement>('[data-role="classifier-canvas"]');

  let selectedIndex = 0;

  function renderPoints(): void {
    if (!pointsSlot) return;
    pointsSlot.textContent = '';
    training.forEach((p, i) => {
      const button = document.createElement('button');
      button.className = 'point';
      if (p.label === 'signal') button.classList.add('signal');
      button.setAttribute('aria-pressed', String(i === selectedIndex));
      button.setAttribute('aria-label', `Point ${i + 1}, ${p.label === 'signal' ? 'Signal' : 'Noise'}, at ${p.x}, ${p.y}`);
      button.dataset.index = String(i);
      button.addEventListener('click', () => {
        selectedIndex = i;
        renderPoints();
      });
      pointsSlot.appendChild(button);
    });
  }

  function draw(): void {
    const state = classifierState(training, seed.max_epochs, seed.held_out);
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = '#131410';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#2b2d24';
        for (let g = 0; g <= 10; g++) {
          const x = (g / 10) * w;
          const y = (g / 10) * h;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        // The decision line: w1 x + w2 y + b = 0
        const { w1, w2, b } = state.model;
        if (w1 !== 0 || w2 !== 0) {
          ctx.strokeStyle = '#ff7a1a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          const x1 = 0;
          const y1 = -(b) / (w2 || 1);
          const x2 = 10;
          const y2 = -(w1 * 10 + b) / (w2 || 1);
          ctx.moveTo((x1 / 10) * w, h - (y1 / 10) * h);
          ctx.lineTo((x2 / 10) * w, h - (y2 / 10) * h);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
        for (const p of training) {
          ctx.fillStyle = p.label === 'signal' ? '#e8e2d4' : '#8d8878';
          ctx.beginPath();
          ctx.arc((p.x / 10) * w, h - (p.y / 10) * h, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function update(announceCopy: string): void {
    const state = classifierState(training, seed.max_epochs, seed.held_out);
    if (status) status.textContent = announceCopy;
    if (accuracyText) accuracyText.textContent = `Held-out accuracy ${state.score.accuracy}%`;
    if (confusion) {
      const cells = confusion.querySelectorAll<HTMLElement>('[data-cell]');
      const map: Record<string, number> = {
        'signal-signal': state.score.predictedSignalSignal,
        'signal-noise': state.score.predictedSignalNoise,
        'noise-signal': state.score.predictedNoiseSignal,
        'noise-noise': state.score.predictedNoiseNoise,
      };
      for (const cell of cells) {
        const key = cell.dataset.cell ?? '';
        cell.textContent = String(map[key] ?? 0);
      }
    }
    draw();
  }

  function move(dx: number, dy: number): void {
    const p = training[selectedIndex];
    if (!p) return;
    const nx = Math.min(seed.grid.max, Math.max(seed.grid.min, p.x + dx));
    const ny = Math.min(seed.grid.max, Math.max(seed.grid.min, p.y + dy));
    if (nx === p.x && ny === p.y) return;
    p.x = nx;
    p.y = ny;
    renderPoints();
    update(`Held-out accuracy ${classifierState(training, seed.max_epochs, seed.held_out).score.accuracy}%.`);
  }

  moveLeft?.addEventListener('click', () => move(-1, 0));
  moveRight?.addEventListener('click', () => move(1, 0));
  moveUp?.addEventListener('click', () => move(0, 1));
  moveDown?.addEventListener('click', () => move(0, -1));

  pointsSlot?.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (!target.dataset['index']) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1, 0); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); move(1, 0); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(0, 1); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); move(0, -1); }
  });

  // Dragging a point with a pointer moves it to the nearest grid position.
  let draggingIndex: number | null = null;
  pointsSlot?.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset['index'] === undefined) return;
    draggingIndex = Number(target.dataset['index']);
    selectedIndex = draggingIndex;
    renderPoints();
  });
  window.addEventListener('pointerup', () => {
    draggingIndex = null;
  });

  trainButton?.addEventListener('click', () => {
    if (motionEnabled()) {
      // Replay the training epoch by epoch, about a quarter of a second each.
      const model = classifierState(training, seed.max_epochs, seed.held_out).model;
      let epoch = 0;
      const timer = window.setInterval(() => {
        epoch++;
        draw();
        if (epoch >= model.epochs) {
          window.clearInterval(timer);
          update(classifierTrainCopy(training, seed.max_epochs, seed.held_out));
        }
      }, 250);
    } else {
      update(classifierTrainCopy(training, seed.max_epochs, seed.held_out));
    }
  });

  renderPoints();
  update(`Held-out accuracy ${classifierState(training, seed.max_epochs, seed.held_out).score.accuracy}%.`);
}

export async function initNeighboursExhibit(): Promise<void> {
  const seedOrNull = (await seedFor('neighbours')) as NeighboursSeed | null;
  const region = document.querySelector<HTMLElement>('[data-exhibit="neighbours"]');
  if (!seedOrNull || !region) return;
  const seed: NeighboursSeed = seedOrNull;
  const wordSelect = region.querySelector<HTMLSelectElement>('[data-role="word"]');
  const contextSelect = region.querySelector<HTMLSelectElement>('[data-role="context"]');
  const tableBody = region.querySelector<HTMLTableSectionElement>('[data-role="neighbours-body"]');
  const status = region.querySelector<HTMLElement>('[data-role="neighbours-status"]');

  if (wordSelect) {
    for (const w of seed.words) {
      const option = document.createElement('option');
      option.value = w.word;
      option.textContent = w.word;
      wordSelect.appendChild(option);
    }
  }
  if (contextSelect) {
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'None';
    contextSelect.appendChild(none);
    for (const c of seed.contexts) {
      const option = document.createElement('option');
      option.value = c;
      option.textContent = c;
      contextSelect.appendChild(option);
    }
  }

  function update(): void {
    const word = wordSelect?.value ?? seed.words[0]!.word;
    const context = contextSelect?.value ? contextSelect.value : null;
    const state = neighboursState(seed, word, context);
    if (status) status.textContent = state.copy;
    if (tableBody) {
      tableBody.textContent = '';
      for (const row of state.rows) {
        const tr = document.createElement('tr');
        const wordCell = document.createElement('td');
        wordCell.textContent = row.word;
        const simCell = document.createElement('td');
        simCell.className = 'num';
        simCell.textContent = row.similarity;
        tr.append(wordCell, simCell);
        tableBody.appendChild(tr);
      }
    }
  }

  wordSelect?.addEventListener('change', update);
  contextSelect?.addEventListener('change', update);
  update();
}
