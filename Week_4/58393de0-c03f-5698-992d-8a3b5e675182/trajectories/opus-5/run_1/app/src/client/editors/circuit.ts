import type { CircuitComponent, CircuitWire, SceneObject, Snapshot, SnapshotCircuit } from '../../shared/types.js';
import { FIELD_COPY, UI_COPY } from '../../shared/copy.js';
import { el } from '../dom.js';
import { fieldError } from '../dialog.js';
import { say } from '../status.js';
import { timers } from '../runtime.js';
import { solveCircuit, stateWords, type Reading } from '../circuit/solver.js';
import type { EditorBody, EditorHooks } from './editor-kinds.js';

interface HistoryStep {
  components: CircuitComponent[];
  wires: CircuitWire[];
}

const PREFIX: Record<CircuitComponent['type'], string> = {
  battery: 'BAT',
  led: 'LED',
  resistor: 'R',
  switch: 'SW',
};

/** Terminal ends read like `BAT-1 +` and `BAT-1 −`. */
const terminalText = (terminal: string): string =>
  `${terminal.slice(0, -1)} ${terminal.slice(-1) === '-' ? '\u2212' : '+'}`;

/** The Circuit Bench: parts, wiring and a live solve. */
export const createCircuitBench = (snapshot: SnapshotCircuit, hooks: EditorHooks): EditorBody => {
  let components: CircuitComponent[] = snapshot.components.map((component) => ({ ...component }));
  let wires: CircuitWire[] = snapshot.wires.map((wire) => ({ ...wire }));
  let running = false;
  let readOnly = false;
  let pendingTerminal: string | null = null;
  let dragFrom: string | null = null;
  let tick = 0;
  const history: HistoryStep[] = [];
  const future: HistoryStep[] = [];
  let lastStatus = new Map<string, string>();

  const hidden = el('div', { id: 'qy-circuit', class: 'qy-sr-only', 'data-sim': 'stopped' });
  const componentList = el('ul', { class: 'qy-components', 'aria-label': 'Components' });
  const wireList = el('ul', { class: 'qy-wires', 'aria-label': 'Wires' });
  const readouts = el('section', { class: 'qy-readouts', role: 'region', 'aria-label': 'Readouts' });
  const board = el('div', { class: 'qy-breadboard' });
  const startButton = el('button', { type: 'button', class: 'qy-pill qy-pill-solid', text: 'Start Simulation' });

  const pushHistory = (): void => {
    history.push({ components: components.map((c) => ({ ...c })), wires: wires.map((w) => ({ ...w })) });
    if (history.length > 100) history.shift();
    future.length = 0;
  };

  let burnCurrents = new Map<string, number>();

  const readingsNow = (): Map<string, Reading> => {
    if (!running) {
      const stopped = new Map<string, Reading>();
      for (const component of components) {
        stopped.set(component.label, {
          label: component.label,
          status:
            component.type === 'led'
              ? component.broken
                ? 'broken'
                : 'off'
              : component.type === 'switch'
                ? component.closed
                  ? 'closed'
                  : 'open'
                : 'ok',
          currentMa: 0,
          voltage: 0,
          brightness: component.type === 'led' ? 0 : null,
        });
      }
      return stopped;
    }
    const solved = solveCircuit(components, wires);
    burnCurrents = solved.burnCurrents;
    return solved.readings;
  };

  const paint = (): void => {
    const readings = readingsNow();
    hidden.dataset.sim = running ? 'running' : 'stopped';
    hidden.replaceChildren();
    componentList.replaceChildren();
    board.replaceChildren();
    readouts.replaceChildren(el('h2', { class: 'qy-panel-heading', text: 'Readouts' }));

    for (const component of components) {
      const reading = readings.get(component.label);
      const state = el('div');
      state.dataset.component = component.label;
      state.dataset.status = reading?.status ?? 'ok';
      state.dataset.currentMa = (reading?.currentMa ?? 0).toFixed(1);
      state.dataset.voltage = (reading?.voltage ?? 0).toFixed(2);
      if (component.type === 'led') state.dataset.brightness = (reading?.brightness ?? 0).toFixed(2);
      hidden.append(state);

      const group = el('li', { class: 'qy-component' }, [
        el('div', { role: 'group', tabindex: '-1', 'aria-label': `${component.label}, ${stateWords(component, reading)}` }, [
          el('p', { class: 'qy-component-label', text: component.label }),
          ...terminalButtons(component),
          ...componentControls(component, reading),
        ]),
      ]);
      componentList.append(group);

      const brightness = component.type === 'led' ? (reading?.brightness ?? 0) : 0;
      board.append(
        el('div', {
          class: `qy-chip qy-chip-${component.type}`,
          style: component.type === 'led' ? `--qy-glow:${brightness.toFixed(2)}` : null,
          text: component.label,
        }),
      );

      readouts.append(
        el('p', { class: 'qy-readout qy-figures' }, [
          el('span', { text: `${component.label}: ` }),
          el('span', { text: `${(reading?.currentMa ?? 0).toFixed(1)} mA · ${(reading?.voltage ?? 0).toFixed(2)} V` }),
          component.type === 'led'
            ? el('span', { text: ` · ${reading?.status === 'broken' ? 'burnt out' : reading?.status ?? 'off'}` })
            : null,
        ]),
      );
    }

    wireList.replaceChildren();
    for (const wire of wires) {
      const name = `${terminalText(wire.from)} to ${terminalText(wire.to)}`;
      const remove = el('button', { type: 'button', class: 'qy-tool', 'aria-label': `Delete wire ${name}`, text: 'Delete' });
      remove.addEventListener('click', () => {
        pushHistory();
        wires = wires.filter((candidate) => candidate !== wire);
        changed();
      });
      wireList.append(el('li', { class: 'qy-wire', 'aria-label': name }, [el('span', { text: name }), remove]));
    }

    if (running) announce(readings);
  };

  const announce = (readings: Map<string, Reading>): void => {
    const next = new Map<string, string>();
    for (const component of components) {
      const reading = readings.get(component.label);
      if (!reading) continue;
      const key = `${reading.status}:${reading.currentMa.toFixed(1)}`;
      next.set(component.label, key);
      const before = lastStatus.get(component.label);
      if (before === key) continue;
      const statusChanged = before === undefined || before.split(':')[0] !== reading.status;
      if (component.type === 'led') {
        if (reading.status === 'broken' && statusChanged) {
          const burnt = burnCurrents.get(component.label) ?? reading.currentMa;
          say(UI_COPY.ledBurnt(component.label, burnt.toFixed(1)));
          markBroken(component.label);
        } else if (reading.status === 'lit') {
          say(UI_COPY.ledLit(component.label, reading.currentMa.toFixed(1)));
        }
      }
      if (component.type === 'battery' && reading.status === 'shorted' && statusChanged) {
        say(UI_COPY.shorted(component.label));
      }
    }
    lastStatus = next;
  };

  const markBroken = (label: string): void => {
    components = components.map((component) =>
      component.label === label ? { ...component, broken: true } : component,
    );
    hooks.onEdit();
  };

  const terminalButtons = (component: CircuitComponent): HTMLElement[] =>
    (['+', '−'] as const).map((sign) => {
      const terminal = `${component.label}${sign === '+' ? '+' : '-'}`;
      const control = el('button', {
        type: 'button',
        class: 'qy-terminal',
        'aria-label': `${component.label} ${sign} terminal`,
        'aria-pressed': pendingTerminal === terminal ? 'true' : 'false',
        'data-terminal': terminal,
        text: sign,
      });
      control.addEventListener('click', () => chooseTerminal(terminal, sign));
      // Wiring by pointer: a drag from one terminal to another draws the wire.
      control.addEventListener('pointerdown', () => {
        dragFrom = terminal;
      });
      control.addEventListener('pointerup', () => {
        if (dragFrom !== null && dragFrom !== terminal) {
          const from = dragFrom;
          dragFrom = null;
          pendingTerminal = from;
          chooseTerminal(terminal, sign);
          return;
        }
        dragFrom = null;
      });
      return control;
    });

  const chooseTerminal = (terminal: string, sign: '+' | '−'): void => {
    if (readOnly) return;
    if (pendingTerminal === null) {
      pendingTerminal = terminal;
      say(UI_COPY.wiringFrom(terminal.slice(0, -1), sign));
      paint();
      return;
    }
    if (pendingTerminal === terminal) {
      pendingTerminal = null;
      paint();
      return;
    }
    const from = pendingTerminal;
    pendingTerminal = null;
    if (
      wires.some(
        (wire) =>
          (wire.from === from && wire.to === terminal) || (wire.from === terminal && wire.to === from),
      )
    ) {
      say(UI_COPY.alreadyWired);
      paint();
      return;
    }
    pushHistory();
    wires = [...wires, { from, to: terminal }];
    say(UI_COPY.wired(terminalText(from), terminalText(terminal)));
    changed();
  };

  const componentControls = (component: CircuitComponent, reading: Reading | undefined): HTMLElement[] => {
    const controls: HTMLElement[] = [];
    if (component.type === 'battery') {
      const id = `volts-${component.label}`;
      const input = el('input', {
        id,
        class: 'qy-input qy-input-small',
        'aria-label': 'Voltage (V)',
        value: String(component.volts ?? 9),
        autocomplete: 'off',
      });
      input.addEventListener('input', () => {
        const value = Number(input.value);
        fieldError(input, null);
        if (!Number.isFinite(value) || value < 1 || value > 12) {
          fieldError(input, FIELD_COPY.voltage);
          say(FIELD_COPY.voltage);
          return;
        }
        components = components.map((candidate) =>
          candidate.label === component.label ? { ...candidate, volts: value } : candidate,
        );
        hooks.onEdit();
        if (!running) paint();
      });
      controls.push(el('div', { class: 'qy-field qy-field-inline' }, [el('label', { for: id, text: 'Voltage (V)' }), input]));
    }
    if (component.type === 'resistor') {
      const id = `ohms-${component.label}`;
      const input = el('input', {
        id,
        class: 'qy-input qy-input-small',
        'aria-label': 'Resistance (Ω)',
        value: String(component.ohms ?? 1000),
        autocomplete: 'off',
      });
      input.addEventListener('input', () => {
        const value = Number(input.value);
        fieldError(input, null);
        if (!Number.isFinite(value) || value < 1 || value > 10_000_000) {
          fieldError(input, FIELD_COPY.resistance);
          say(FIELD_COPY.resistance);
          return;
        }
        components = components.map((candidate) =>
          candidate.label === component.label ? { ...candidate, ohms: value } : candidate,
        );
        hooks.onEdit();
        if (!running) paint();
      });
      controls.push(
        el('div', { class: 'qy-field qy-field-inline' }, [el('label', { for: id, text: 'Resistance (Ω)' }), input]),
      );
    }
    if (component.type === 'switch') {
      const toggle = el('button', {
        type: 'button',
        class: 'qy-switch',
        role: 'switch',
        'aria-label': component.label,
        'aria-checked': component.closed ? 'true' : 'false',
        text: component.closed ? 'Closed' : 'Open',
      });
      toggle.addEventListener('click', () => {
        if (readOnly) return;
        pushHistory();
        components = components.map((candidate) =>
          candidate.label === component.label ? { ...candidate, closed: !candidate.closed } : candidate,
        );
        changed();
      });
      controls.push(toggle);
    }
    if (component.type === 'led') {
      const reset = el('button', { type: 'button', class: 'qy-tool', text: 'Reset LED', 'aria-label': 'Reset LED' });
      reset.disabled = reading?.status !== 'broken' && component.broken !== true;
      reset.addEventListener('click', () => {
        pushHistory();
        components = components.map((candidate) =>
          candidate.label === component.label ? { ...candidate, broken: false } : candidate,
        );
        lastStatus.delete(component.label);
        say(UI_COPY.ledReset(component.label));
        changed();
      });
      controls.push(reset);
    }
    const remove = el('button', {
      type: 'button',
      class: 'qy-tool',
      'aria-label': `Delete ${component.label}`,
      text: 'Delete',
    });
    remove.addEventListener('click', () => {
      pushHistory();
      components = components.filter((candidate) => candidate.label !== component.label);
      wires = wires.filter(
        (wire) => !wire.from.startsWith(component.label) && !wire.to.startsWith(component.label),
      );
      changed();
    });
    controls.push(remove);
    return controls;
  };

  const changed = (): void => {
    paint();
    hooks.onEdit();
  };

  const addComponent = (type: CircuitComponent['type']): void => {
    if (readOnly) return;
    pushHistory();
    const count = components.filter((component) => component.type === type).length + 1;
    const label = `${PREFIX[type]}-${count}`;
    const component: CircuitComponent = { label, type };
    if (type === 'battery') component.volts = 9;
    if (type === 'resistor') component.ohms = 1000;
    if (type === 'switch') component.closed = false;
    if (type === 'led') component.broken = false;
    components = [...components, component];
    changed();
    componentList.querySelector<HTMLElement>(`[aria-label^="${label},"]`)?.focus();
  };

  const partsToolbar = el('div', { class: 'qy-toolbar', role: 'toolbar', 'aria-label': 'Parts' }, [
    partButton('Battery', 'battery'),
    partButton('LED', 'led'),
    partButton('Resistor', 'resistor'),
    partButton('Switch', 'switch'),
  ]);

  function partButton(label: string, type: CircuitComponent['type']): HTMLButtonElement {
    const control = el('button', { type: 'button', class: 'qy-tool', text: label });
    control.addEventListener('click', () => addComponent(type));
    return control;
  }

  const setRunning = (next: boolean): void => {
    running = next;
    startButton.textContent = next ? 'Stop Simulation' : 'Start Simulation';
    window.clearInterval(tick);
    lastStatus = new Map();
    if (next) {
      say(UI_COPY.simStarted);
      paint();
      tick = window.setInterval(paint, timers().simTickMs);
    } else {
      say(UI_COPY.simStopped);
      paint();
    }
  };

  startButton.addEventListener('click', () => setRunning(!running));

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || pendingTerminal === null) return;
    pendingTerminal = null;
    paint();
  };
  document.addEventListener('keydown', onKeyDown);

  const element = el('div', { class: 'qy-editor-circuit' }, [
    el('div', { class: 'qy-editor-left' }, [partsToolbar, startButton]),
    el('div', { class: 'qy-circuit-middle' }, [board, hidden]),
    el('div', { class: 'qy-editor-right' }, [
      el('section', { class: 'qy-panel' }, [el('h2', { class: 'qy-panel-heading', text: 'Components' }), componentList]),
      el('section', { class: 'qy-panel' }, [el('h2', { class: 'qy-panel-heading', text: 'Wires' }), wireList]),
      readouts,
    ]),
  ]);

  paint();

  return {
    element,
    snapshot: (): Snapshot => ({
      kind: 'circuit',
      components: components.map((component) => ({ ...component })),
      wires: wires.map((wire) => ({ ...wire })),
    }),
    undo: () => {
      const step = history.pop();
      if (!step) return;
      future.push({ components: components.map((c) => ({ ...c })), wires: wires.map((w) => ({ ...w })) });
      components = step.components.map((c) => ({ ...c }));
      wires = step.wires.map((w) => ({ ...w }));
      changed();
    },
    redo: () => {
      const step = future.pop();
      if (!step) return;
      history.push({ components: components.map((c) => ({ ...c })), wires: wires.map((w) => ({ ...w })) });
      components = step.components.map((c) => ({ ...c }));
      wires = step.wires.map((w) => ({ ...w }));
      changed();
    },
    setReadOnly: (next) => {
      readOnly = next;
      if (next) {
        for (const control of element.querySelectorAll('button, input')) control.setAttribute('disabled', '');
      }
    },
    loadSnapshot: (next) => {
      if (next.kind !== 'circuit') return;
      components = next.components.map((component) => ({ ...component }));
      wires = next.wires.map((wire) => ({ ...wire }));
      paint();
    },
    exportObjects: (): SceneObject[] => [],
    circuit: () => ({ components, wires }),
    focus: () => startButton.focus(),
    stop: () => {
      window.clearInterval(tick);
      document.removeEventListener('keydown', onKeyDown);
    },
  };
};
