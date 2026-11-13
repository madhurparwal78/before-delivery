// Tutorial view: guided local practice that cannot create verified progress.
import { announceStatus } from '../app.js';
import { Simulation } from '../../shared/sim.js';
import { CAMPAIGN_ENCOUNTERS, DEVICES, INITIAL_RESERVE, INITIAL_HEALTH } from '../../shared/seed.js';
import { formatMilliCharge } from '../format.js';
import { contactCell } from '../../shared/sim.js';

interface TutorialStep {
  title: string;
  body: string;
}

const STEPS: TutorialStep[] = [
  {
    title: 'Select your lantern',
    body: 'Choose the Wickwarden device from the crew rack. It fires one same-lane hit for 12 along a 3500-unit range.',
  },
  {
    title: 'Pick an active lane cell',
    body: 'The first wave approaches lane 3. Select a buildable cell in lane 3 on the harbour chart.',
  },
  {
    title: 'Preview the placement',
    body: 'Open Planning and preview the Lantern Cast to compare a placed Wickwarden against doing nothing.',
  },
  {
    title: 'Place and watch',
    body: 'Confirm the placement, then let the encounter resolve to its local outcome.',
  },
];

export interface PracticeState {
  sim: Simulation;
  device: string | null;
  selectedLane: number;
  selectedCell: number;
  stepIndex: number;
  finished: boolean;
}

let practice: PracticeState | null = null;

export function renderTutorial(main: HTMLElement): void {
  main.innerHTML = `
    <h1>Tutorial</h1>
    <section aria-label="Tutorial instructions" id="tutorial-instructions" class="panel">
      <p id="tutorial-step-text"></p>
    </section>
    <section aria-label="Practice controls" class="panel practice-controls">
      <div class="crew-rack" role="group" aria-label="Practice crew">
        ${DEVICES_TUTORIAL()}
      </div>
      <div class="practice-actions">
        <button id="begin-practice">Begin practice</button>
        <button id="restart-practice">Restart practice</button>
        <button id="finish-practice" disabled>Finish practice</button>
      </div>
      <p id="practice-readout" class="practice-readout" aria-live="polite"></p>
    </section>
    <section aria-label="Practice board" id="practice-board" class="panel"></section>
  `;
  const stepText = document.getElementById('tutorial-step-text');
  const begin = document.getElementById('begin-practice') as HTMLButtonElement;
  const restart = document.getElementById('restart-practice') as HTMLButtonElement;
  const finish = document.getElementById('finish-practice') as HTMLButtonElement;
  const readout = document.getElementById('practice-readout');

  const beginClick = () => {
    beginPractice();
  };
  begin.addEventListener('click', beginClick);
  restart.addEventListener('click', () => {
    beginPractice();
    announceStatus('Practice restarted.');
  });
  finish.addEventListener('click', () => {
    announceStatus('Practice complete. No ranked result is submitted.');
  });

  function beginPractice(): void {
    const definition = CAMPAIGN_ENCOUNTERS[0].definition;
    practice = {
      sim: new Simulation(definition, TUTORIAL_LOADOUT(), INITIAL_RESERVE, INITIAL_HEALTH, definition.seed),
      device: null,
      selectedLane: 3,
      selectedCell: 5,
      stepIndex: 0,
      finished: false,
    };
    begin.disabled = true;
    finish.disabled = true;
    updateStep();
  }

  function updateStep(): void {
    if (!practice) return;
    const step = STEPS[Math.min(practice.stepIndex, STEPS.length - 1)];
    if (stepText) stepText.textContent = `${step.title}. ${step.body}`;
    if (readout) {
      readout.textContent = `Reserve ${formatMilliCharge(practice.sim.reserve)} — devices placed: ${practice.sim.installations().length}`;
    }
    renderPracticeBoard();
  }

  function advanceStep(): void {
    if (!practice) return;
    practice.stepIndex++;
    if (practice.stepIndex >= STEPS.length) {
      practice.finished = true;
      const finishButton = document.getElementById('finish-practice') as HTMLButtonElement;
      if (finishButton) finishButton.disabled = false;
    }
    updateStep();
  }

  function renderPracticeBoard(): void {
    const board = document.getElementById('practice-board');
    if (!board || !practice) return;
    // Local grid echoing the harbour chart layout (noninteractive simplification for practice).
    const lanes = [1, 2, 3, 4, 5];
    board.innerHTML = `
      <div class="chart-legend"><span>Practice chart — hover a cell to see coordinates; click to select.</span></div>
      <div class="practice-grid" role="grid" aria-label="Harbour chart">
        ${lanes
          .map(
            (lane) => `<div role="row" aria-label="Lane ${lane}" class="practice-row" data-lane="${lane}">
              ${Array.from({ length: 9 }, (_, index) => index + 1)
                .map((cell) => {
                  const install = practice!.sim.installAt(lane, cell);
                  const creatureHere = practice!.sim.creatureList().find((c) => c.lane === lane && contactCell(c.position) === cell);
                  const selected = practice!.selectedLane === lane && practice!.selectedCell === cell;
                  return `<div role="gridcell" aria-label="Lane ${lane}, cell ${cell}" class="practice-cell${selected ? ' selected' : ''}" data-lane="${lane}" data-cell="${cell}" tabindex="-1">
                    ${install ? `<span class="cell-device">${escapeText(install.device)}</span>` : creatureHere ? `<span class="cell-creature">${escapeText(creatureHere.creature)}</span>` : ''}
                  </div>`;
                })
                .join('')}
            </div>`,
          )
          .join('')}
      </div>
      <p class="practice-hint">Practice uses the first campaign definition with all devices and the common starting values.</p>
    `;
    board.querySelectorAll<HTMLElement>('.practice-cell').forEach((cell) => {
      cell.addEventListener('click', () => {
        if (!practice) return;
        practice.selectedLane = Number(cell.dataset.lane);
        practice.selectedCell = Number(cell.dataset.cell);
        renderPracticeBoard();
        if (practice.stepIndex === 1) advanceStep();
      });
    });
    board.querySelectorAll<HTMLElement>('.practice-cell').forEach((cell) => {
      cell.addEventListener('mouseenter', () => {
        if (readout) {
          readout.textContent = `Lane ${cell.dataset.lane}, cell ${cell.dataset.cell}${practice && practice.sim.installAt(Number(cell.dataset.lane), Number(cell.dataset.cell)) ? ' — occupied' : ' — empty'}`;
        }
      });
    });
    board.querySelectorAll<HTMLButtonElement>('.practice-device').forEach((button) => {
      button.addEventListener('click', () => {
        if (!practice) return;
        practice.device = button.dataset.device ?? null;
        if (practice.stepIndex === 0) advanceStep();
        renderPracticeBoard();
      });
    });
  }

  // Wire crew rack buttons after each board render.
  const observer = new MutationObserver(() => {
    boardBind();
  });
  observer.observe(document.getElementById('practice-board')!, { childList: true, subtree: true });

  function boardBind(): void {
    document.querySelectorAll<HTMLButtonElement>('.practice-device').forEach((button) => {
      if (button.dataset.bound === 'true') return;
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        if (!practice) return;
        practice.device = button.dataset.device ?? null;
        if (practice.stepIndex === 0) advanceStep();
        renderPracticeBoard();
      });
    });
    document.querySelectorAll<HTMLElement>('.practice-place').forEach((button) => {
      if (button.dataset.bound === 'true') return;
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        if (!practice || !practice.device) return;
        const command = {
          seq: practice.sim.installations().length + 1,
          tick: practice.sim.tick,
          type: 'deploy' as const,
          lane: practice.selectedLane,
          cell: practice.selectedCell,
          device: practice.device,
        };
        const reason = practice.sim.commandReason(command, null, null);
        if (reason !== null) {
          announceStatus(reason);
          return;
        }
        practice.sim.applyLegalCommand(command);
        if (practice.stepIndex >= 1) advanceStep();
        renderPracticeBoard();
      });
    });
  }

  updateStep();
}

function DEVICES_TUTORIAL(): string {
  return DEVICES.map(
    (device) =>
      `<button class="practice-device" data-device="${device.id}" aria-label="${device.name}">${device.name} — ${formatMilliCharge(device.cost)}</button>`,
  ).join('');
}

function TUTORIAL_LOADOUT(): import('../../shared/seed.js').DeviceId[] {
  return ['wick', 'chime', 'siphon', 'wall', 'prism', 'gong'];
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
