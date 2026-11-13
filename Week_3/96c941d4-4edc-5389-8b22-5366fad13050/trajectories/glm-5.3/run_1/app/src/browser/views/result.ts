// Result view: local outcome vs authoritative verification, with retry.
import { state, navigate, announceStatus, handleApiError, disabledWhilePending } from '../app.js';
import { api } from '../api.js';
import type { ResultShape, RunShape } from '../api.js';
import { currentRuntime } from './defence.js';
import { formatMilliCharge, formatTicks } from '../format.js';

export function renderResult(main: HTMLElement): void {
  const rt = currentRuntime();
  main.innerHTML = `
    <h1>Result</h1>
    <section aria-label="Run result" id="run-result" class="panel">
      <p id="result-local">Local outcome pending.</p>
      <p id="result-verification">Verification has not started.</p>
      <p id="result-failure" class="result-failure"></p>
      <p id="result-metrics"></p>
    </section>
    <div class="result-actions">
      <button id="submit-result" class="primary">Submit result</button>
      <button id="retry-verification" disabled>Retry verification</button>
      <button id="refresh-result" disabled>Refresh result</button>
      <button id="return-campaign">Return to campaign</button>
    </div>
  `;
  const local = document.getElementById('result-local')!;
  const verification = document.getElementById('result-verification')!;
  const failure = document.getElementById('result-failure')!;
  const metrics = document.getElementById('result-metrics')!;

  if (rt) {
    const outcome = rt.sim.outcome ?? 'defeat';
    local.textContent = `Local outcome: ${outcome === 'victory' ? 'victory' : 'defeat'} at tick ${rt.sim.tick} (${formatTicks(rt.sim.tick)}).`;
    metrics.textContent = `Breaches ${rt.sim.breaches} — remaining charge ${formatMilliCharge(rt.sim.reserve)} — health ${rt.sim.health}.`;
  } else {
    local.textContent = 'No local encounter is active. Verification state comes from the harbour record.';
  }

  const submit = document.getElementById('submit-result') as HTMLButtonElement;
  const retry = document.getElementById('retry-verification') as HTMLButtonElement;
  const refresh = document.getElementById('refresh-result') as HTMLButtonElement;
  const ticketId = state.ticket?.id;

  if (!ticketId) {
    submit.disabled = true;
    verification.textContent = 'No ticket is bound to this result.';
  }

  async function performSubmit(path: 'submit' | 'retry'): Promise<void> {
    if (!rt || !ticketId) return;
    const button = (path === 'submit' ? submit : retry) as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Checking command evidence…');
    try {
      const body = path === 'submit' ? { commands: rt.commands, endTick: rt.endTick, claims: {} } : {};
      const { status, data } = await api<ResultShape>(path === 'submit' ? 'POST' : 'POST', `/api/runs/${ticketId}/${path}`, body);
      applyResult(data, status);
      announceStatus(outcomeCopy(data));
    } catch (e) {
      handleApiError(e);
      restore();
    }
  }

  function applyResult(data: ResultShape, status: number): void {
    if (status === 202) {
      verification.textContent = 'Evidence storage unavailable. Verification is pending; retry this result.';
      retry.disabled = false;
      refresh.disabled = false;
      return;
    }
    if (data.state === 'accepted') {
      verification.textContent =
        data.metrics?.outcome === 'victory'
          ? "Verified victory – your strategy's recorded."
          : 'Verified defence ended.';
      retry.disabled = false;
      refresh.disabled = false;
      return;
    }
    if (data.state === 'rejected') {
      verification.textContent = `Run rejected at tick ${data.failure?.tick}: ${data.failure?.reason}. Your account remains available.`;
      failure.textContent = `First failure at tick ${data.failure?.tick}${data.failure?.seq !== null && data.failure?.seq !== undefined ? `, command ${data.failure?.seq}` : ''}: ${data.failure?.reason}.`;
      retry.disabled = false;
      refresh.disabled = false;
      return;
    }
    verification.textContent = 'Verification is in progress.';
  }

  submit.addEventListener('click', () => performSubmit('submit'));
  retry.addEventListener('click', () => performSubmit('retry'));
  refresh.addEventListener('click', async () => {
    if (!ticketId) return;
    const restore = disabledWhilePending(refresh);
    announceStatus('Loading harbour records…');
    try {
      const { data } = await api<RunShape>('GET', `/api/runs/${ticketId}`);
      if (data.result) applyResult(data.result, 200);
      announceStatus('Harbour records loaded.');
    } catch (e) {
      handleApiError(e);
    } finally {
      restore();
    }
  });
  document.getElementById('return-campaign')?.addEventListener('click', () => navigate('campaign'));
}

function outcomeCopy(data: ResultShape): string {
  if (data.state === 'accepted') {
    return data.metrics?.outcome === 'victory' ? "Verified victory – your strategy's recorded." : 'Verified defence ended.';
  }
  if (data.state === 'rejected') {
    return `Run rejected at tick ${data.failure?.tick}: ${data.failure?.reason}. Your account remains available.`;
  }
  return 'Verification is pending.';
}
