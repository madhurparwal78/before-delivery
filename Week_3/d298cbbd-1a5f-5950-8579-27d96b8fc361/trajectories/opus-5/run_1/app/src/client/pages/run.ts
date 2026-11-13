import { api, type StoredRun } from '../api.js';
import { COPY, notCountedSeal, proofStub } from '../copy.js';
import { el } from '../dom.js';
import type { Page } from '../router.js';
import { renderCertificate } from '../certificate.js';
import { heading } from '../shell.js';
import { kindOfMode, type LogEntry } from '../../shared/engine.js';

function logEntries(value: unknown): LogEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: LogEntry[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Record<string, unknown>;
    if (typeof record['k'] !== 'string' || typeof record['t'] !== 'number') return null;
    entries.push({ k: record['k'], t: record['t'] });
  }
  return entries;
}

export class RunPage implements Page {
  private readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  async render(container: HTMLElement): Promise<void> {
    container.textContent = '';
    const folder = el('div', { class: 'folder open' });
    container.append(folder);
    const response = await api.get<StoredRun>(`/api/runs/${this.id}`);
    if (response.status !== 200 || !response.body) {
      folder.append(heading(1, COPY.noSuchRun));
      return;
    }
    const run = response.body;
    const entries = logEntries(run.log);
    const hasCarbon =
      run.verdict === 'counted' &&
      entries !== null &&
      run.perSecond !== null &&
      run.errorsByKey !== null &&
      run.duration !== null &&
      run.words.length > 0;

    const parameter = new URLSearchParams(window.location.search).get('at');
    const maxPosition = hasCarbon ? Math.ceil((run.duration as number) / 1000) : 0;
    let initial: number | null = null;
    let replaceWith: number | null = null;
    if (hasCarbon && parameter !== null) {
      const value = Number(parameter);
      if (!Number.isInteger(value)) {
        initial = maxPosition;
        replaceWith = maxPosition;
      } else if (value < 0) {
        initial = 0;
        replaceWith = 0;
      } else if (value > maxPosition) {
        initial = maxPosition;
        replaceWith = maxPosition;
      } else {
        initial = value;
      }
    }

    // The address already shows this position, so only a real move replaces it.
    let reported: number | null = replaceWith === null ? (initial ?? maxPosition) : null;
    const certificate = renderCertificate({
      figures: {
        speed: run.speed,
        raw: run.raw,
        accuracy: run.accuracy,
        consistency: run.consistency,
        duration: run.duration,
        characters: run.characters,
      },
      replay: hasCarbon
        ? {
            words: run.words,
            log: entries as LogEntry[],
            kind: kindOfMode(run.mode),
            durationMs: run.duration as number,
            perSecond: run.perSecond ?? [],
            errorsByKey: run.errorsByKey ?? {},
          }
        : null,
      finishedAt: run.finishedAt,
      showNextTest: false,
      initialPosition: initial,
      onPosition: (second) => {
        if (second === reported) return;
        reported = second;
        window.history.replaceState(null, '', `/runs/${this.id}?at=${second}`);
      },
    });
    folder.append(certificate.root);
    certificate.refresh();
    certificate.seal.textContent =
      run.verdict === 'counted' ? COPY.counted : notCountedSeal(run.reason ?? '');
    if (run.proofKey) certificate.proofKey.textContent = proofStub(run.proofKey);
  }
}
