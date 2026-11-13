import { ApiCallError, PreflightResponse, send } from '../api';
import { clear, el, on } from '../dom';
import { Epoch } from '../viewport';
import { money } from '../../shared/numbers';
import { Values } from '../values';

export const PROCESS_LABELS: { id: string; label: string; lead: string }[] = [
  { id: 'fdm-04', label: 'FDM print, 0.4 mm nozzle', lead: '2–4 working days' },
  { id: 'mill-3', label: 'Three-axis mill', lead: '5–10 working days' },
  { id: 'laser-sheet', label: 'Laser-cut sheet', lead: '3–6 working days' },
];

export const ESTIMATE_LINE =
  'Estimate from geometry alone. Not a quote: no supplier has seen this part.';
export const STALE_BANNER =
  'This report describes an earlier configuration. Run pre-flight again to update it.';
export const SIGN_IN_FOR_MORE = 'Sign in to run more pre-flight reports.';

export type PreflightState = 'unrun' | 'running' | 'complete' | 'unsupported' | 'stale';

export type PreflightOptions = {
  slug: string;
  revisionId: string;
  signedIn: boolean;
  limit: number;
  left: number | null;
  valuesNow: () => Values;
  announce: (message: string) => void;
  onReport: () => void;
};

/** The Pre-flight group: process choice, the run button and the report region. */
export class PreflightPanel {
  readonly root: HTMLElement;
  readonly region: HTMLElement;
  readonly runButton: HTMLButtonElement;
  private readonly processGroup: HTMLElement;
  private readonly allowanceNote: HTMLElement;
  private readonly epoch: Epoch;
  private processId = 'fdm-04';
  private state: PreflightState = 'unrun';
  private report: PreflightResponse | null = null;
  private reportValues: Values | null = null;
  private left: number | null;

  constructor(private readonly options: PreflightOptions) {
    this.left = options.left;
    this.epoch = new Epoch(`tinework:epoch:report:${options.slug}`);
    this.processGroup = el('div', { role: 'radiogroup', 'aria-label': 'Process', class: 'radio-column' });
    for (const [index, process] of PROCESS_LABELS.entries()) {
      const radio = el(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': index === 0 ? 'true' : 'false',
          tabindex: index === 0 ? '0' : '-1',
          class: 'radio-option',
          'data-process': process.id,
        },
        [process.label],
      );
      on(radio, 'click', () => this.chooseProcess(process.id, true));
      on(radio, 'keydown', (event) => {
        const keyboard = event as KeyboardEvent;
        const current = PROCESS_LABELS.findIndex((candidate) => candidate.id === this.processId);
        if (keyboard.key === 'ArrowDown' || keyboard.key === 'ArrowRight') {
          keyboard.preventDefault();
          this.chooseProcess(PROCESS_LABELS[(current + 1) % PROCESS_LABELS.length].id, true);
        } else if (keyboard.key === 'ArrowUp' || keyboard.key === 'ArrowLeft') {
          keyboard.preventDefault();
          this.chooseProcess(
            PROCESS_LABELS[(current - 1 + PROCESS_LABELS.length) % PROCESS_LABELS.length].id,
            true,
          );
        }
      });
      this.processGroup.append(radio);
    }

    this.runButton = el('button', { type: 'button', class: 'button-primary' }, ['Run pre-flight']);
    this.allowanceNote = el('p', { class: 'muted' });
    this.region = el('section', {
      role: 'region',
      'aria-label': 'Pre-flight report',
      'data-state': 'unrun',
      'data-epoch': this.epoch.current(),
      class: 'preflight-report',
    });
    this.root = el('div', { class: 'preflight-panel' }, [
      this.processGroup,
      this.runButton,
      this.allowanceNote,
      this.region,
    ]);
    on(this.runButton, 'click', () => void this.run());
    this.paintRunButton();
  }

  processLabel(): string {
    return PROCESS_LABELS.find((process) => process.id === this.processId)!.label;
  }

  currentReport(): PreflightResponse | null {
    return this.report;
  }

  currentState(): PreflightState {
    return this.state;
  }

  private chooseProcess(id: string, focus: boolean): void {
    this.processId = id;
    for (const radio of this.processGroup.children) {
      const chosen = radio.getAttribute('data-process') === id;
      radio.setAttribute('aria-checked', chosen ? 'true' : 'false');
      radio.setAttribute('tabindex', chosen ? '0' : '-1');
      if (chosen && focus) (radio as HTMLElement).focus();
    }
    this.refreshStaleness();
    this.options.onReport();
  }

  private paintRunButton(): void {
    if (this.options.signedIn || this.left === null) {
      this.runButton.textContent = 'Run pre-flight';
      this.allowanceNote.textContent = '';
      this.runButton.disabled = false;
      return;
    }
    this.runButton.textContent = `Run pre-flight (${this.left} of ${this.options.limit} left this session)`;
    if (this.left <= 0) {
      this.runButton.disabled = true;
      this.allowanceNote.textContent = SIGN_IN_FOR_MORE;
    } else {
      this.runButton.disabled = false;
      this.allowanceNote.textContent = '';
    }
  }

  /** Changing a parameter or process after a report marks it stale without re-running it. */
  refreshStaleness(): void {
    if (this.state !== 'complete' && this.state !== 'unsupported' && this.state !== 'stale') return;
    if (!this.report || !this.reportValues) return;
    const same =
      this.report.process === this.processId && sameValues(this.reportValues, this.options.valuesNow());
    if (same && this.state === 'stale') {
      this.state = this.report.status;
      this.paintReport();
    } else if (!same && this.state !== 'stale') {
      this.state = 'stale';
      this.paintReport();
    }
  }

  private setState(state: PreflightState): void {
    this.state = state;
    this.region.setAttribute('data-state', state);
  }

  async run(): Promise<void> {
    const previous = this.state;
    const values = { ...this.options.valuesNow() };
    const processId = this.processId;
    this.setState('running');
    this.options.announce(`Checking against ${this.processLabel()}...`);
    try {
      const answer = await send<PreflightResponse>('/api/preflight', {
        method: 'POST',
        body: {
          partSlug: this.options.slug,
          revisionId: this.options.revisionId,
          values,
          process: processId,
        },
      });
      this.report = answer.data;
      this.reportValues = values;
      if (this.left !== null) {
        this.left = Math.max(0, this.left - 1);
        this.paintRunButton();
      }
      const same = processId === this.processId && sameValues(values, this.options.valuesNow());
      this.setState(same ? answer.data.status : 'stale');
      this.paintReport();
      this.region.setAttribute('data-epoch', String(this.epoch.advance()));
      const blocking = answer.data.findings.filter((finding) => finding.severity === 'Blocking').length;
      const advisory = answer.data.findings.filter((finding) => finding.severity === 'Advisory').length;
      this.options.announce(`Pre-flight complete: ${blocking} blocking, ${advisory} advisory.`);
      this.options.onReport();
    } catch (error) {
      this.setState(previous);
      this.paintReport();
      if (error instanceof ApiCallError) {
        if (error.failure.status === 429) {
          this.left = 0;
          this.paintRunButton();
          this.options.announce(SIGN_IN_FOR_MORE);
        } else {
          this.options.announce(error.failure.message);
        }
      }
    }
  }

  private paintReport(): void {
    clear(this.region);
    this.region.setAttribute('data-state', this.state);
    if (!this.report) return;
    if (this.state === 'stale') {
      this.region.append(el('p', { class: 'stale-banner', 'data-ui': 'stale-banner' }, [STALE_BANNER]));
    }
    if (this.report.status === 'unsupported') {
      this.region.append(el('p', {}, [this.report.message ?? '']));
      return;
    }
    const blocking = this.report.findings.filter((finding) => finding.severity === 'Blocking').length;
    const advisory = this.report.findings.filter((finding) => finding.severity === 'Advisory').length;
    this.region.append(
      el('p', { class: 'report-summary' }, [
        `Pre-flight complete: ${blocking} blocking, ${advisory} advisory.`,
      ]),
    );
    const bands = el('ul', { class: 'cost-bands' });
    for (const band of this.report.costBands) {
      bands.append(
        el('li', {}, [
          el('span', { class: 'band-quantity' }, [`Quantity ${band.quantity}`]),
          el('span', { class: 'band-text' }, [band.text]),
        ]),
      );
    }
    this.region.append(bands);
    const process = PROCESS_LABELS.find((candidate) => candidate.id === this.report!.process)!;
    this.region.append(el('p', {}, [`Typical lead time ${process.lead}`]));
    if (this.report.confidence) {
      this.region.append(el('p', { class: 'confidence' }, [`Confidence: ${this.report.confidence}`]));
    }
    this.region.append(el('p', { class: 'muted estimate-line' }, [ESTIMATE_LINE]));
    void money;
  }

  isStale(): boolean {
    return this.state === 'stale';
  }
}

export function sameValues(a: Values, b: Values): boolean {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const name of names) {
    if (a[name] !== b[name]) return false;
  }
  return true;
}
