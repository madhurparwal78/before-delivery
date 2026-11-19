import { api, ApiCallError, fetchBytes, type SnapshotBody } from '../api.js';
import { decodeLossy, isValidUtf8, toHexLower } from '../../shared/bytes.js';
import { byteLineStatus, formatStamp } from '../../shared/format.js';
import { Baker } from '../baker.js';
import { clear, downloadBytes, h } from '../dom.js';
import { plainButton } from '../dialogs.js';
import type { Screen, Shell } from '../main.js';

function sentenceFor(snapshot: SnapshotBody): string {
  if (snapshot.status === 'pending') return 'Pending: storage has not confirmed the input yet.';
  if (snapshot.status === 'active') return `Active until ${formatStamp(snapshot.expiresAt)}.`;
  if (snapshot.status === 'expired') return `This snapshot expired on ${formatStamp(snapshot.expiresAt)}.`;
  return 'This snapshot was revoked.';
}

function asDisplayText(bytes: Uint8Array): string {
  if (isValidUtf8(bytes)) return decodeLossy(bytes);
  return toHexLower(bytes).replace(/(..)(?=.)/g, '$1 ');
}

/** The read-only snapshot page at /s/<token>. Its status always comes from the server. */
export function renderSnapshot(host: HTMLElement, shell: Shell, token: string): Screen {
  const status = h('div', {
    class: 'snapshot-status',
    role: 'status',
    'aria-live': 'off',
    'aria-label': 'Snapshot status',
  });
  const stepList = h('div', { class: 'step-list', role: 'list', 'aria-label': 'Recipe steps' });
  const inputArea = h('textarea', { class: 'editor mono', 'aria-label': 'Input', readonly: true });
  const outputArea = h('textarea', { class: 'editor mono', 'aria-label': 'Output', readonly: true });
  const inputStatus = h('div', { class: 'status-strip' });
  const outputStatus = h('div', { class: 'status-strip' });
  const downloadInput = plainButton('Download input', () => void download('input'));
  const downloadOutput = plainButton('Download output', () => void download('output'));
  const pane = h('section', { class: 'pane single-pane snapshot-pane' }, [
    h('div', { class: 'pane-title' }, [
      h('h1', { class: 'pane-title-text library-heading', text: 'Shared snapshot' }),
    ]),
    status,
    h('div', { class: 'pane-body' }, [
      h('div', { class: 'snapshot-section' }, [h('h2', { class: 'pane-title-text', text: 'Recipe' }), stepList]),
      h('div', { class: 'snapshot-section' }, [
        h('h2', { class: 'pane-title-text', text: 'Input' }),
        inputArea,
        inputStatus,
        downloadInput,
      ]),
      h('div', { class: 'snapshot-section' }, [
        h('h2', { class: 'pane-title-text', text: 'Output' }),
        outputArea,
        outputStatus,
        downloadOutput,
      ]),
    ]),
  ]);
  host.append(pane);

  const baker = new Baker(shell.config.regexBudgetMs);
  let latest: SnapshotBody | null = null;

  function showStatus(snapshot: SnapshotBody): void {
    clear(status);
    const badge = snapshot.status.charAt(0).toUpperCase() + snapshot.status.slice(1);
    status.append(
      h('span', { class: `badge badge-${snapshot.status}`, text: badge }),
      document.createTextNode(` ${sentenceFor(snapshot)}`),
    );
  }

  function showSteps(snapshot: SnapshotBody): void {
    clear(stepList);
    const steps = snapshot.recipe?.steps ?? [];
    if (steps.length === 0) {
      stepList.append(h('p', { class: 'muted-note', text: 'No steps in this snapshot.' }));
      return;
    }
    steps.forEach((step, index) => {
      stepList.append(
        h('div', { class: 'step-card', role: 'listitem', 'aria-label': `Step ${index + 1}: ${step.op}` }, [
          h('div', { class: 'step-header' }, [
            h('span', { class: 'step-number', text: String(index + 1) }),
            h('span', { class: 'step-name', text: step.op }),
          ]),
        ]),
      );
    });
  }

  async function load(): Promise<void> {
    try {
      const read = await api.snapshot(token);
      latest = read.snapshot;
      showStatus(read.snapshot);
      showSteps(read.snapshot);
      const active = read.snapshot.status === 'active';
      downloadInput.disabled = !active;
      downloadOutput.disabled = !active;
      if (!active) {
        inputArea.value = '';
        outputArea.value = '';
        inputStatus.textContent = '';
        outputStatus.textContent = '';
        return;
      }
      const inputBytes = await fetchBytes(`/api/snapshots/${token}/input`);
      const text = asDisplayText(inputBytes);
      inputArea.value = text;
      inputArea.textContent = text;
      inputStatus.textContent = byteLineStatus(inputBytes.length, countLines(inputBytes));
      const result = await baker.run(inputBytes, read.snapshot.recipe?.steps ?? [], null);
      if (result !== null) {
        const shown = result.error === null ? asDisplayText(result.output) : '';
        outputArea.value = shown;
        outputArea.textContent = shown;
        outputStatus.textContent = byteLineStatus(result.output.length, countLines(result.output));
      }
    } catch (cause) {
      if (!(cause instanceof ApiCallError)) throw cause;
      clear(status);
      status.textContent = cause.failure.message;
    }
  }

  function countLines(bytes: Uint8Array): number {
    if (bytes.length === 0) return 0;
    let lines = 1;
    for (const byte of bytes) if (byte === 0x0a) lines += 1;
    return lines;
  }

  async function download(which: 'input' | 'output'): Promise<void> {
    try {
      const read = await api.snapshot(token);
      latest = read.snapshot;
      showStatus(read.snapshot);
      if (read.snapshot.status !== 'active') return;
      const bytes = await fetchBytes(`/api/snapshots/${token}/${which}`);
      downloadBytes(bytes, `${which}.bin`);
    } catch (cause) {
      if (!(cause instanceof ApiCallError)) throw cause;
      clear(status);
      status.textContent = cause.failure.message;
    }
  }

  void load();
  const timer = window.setInterval(() => {
    if (latest?.status === 'active' || latest?.status === 'pending') void load();
  }, 60000);
  window.addEventListener('popstate', () => window.clearInterval(timer));

  return {};
}
