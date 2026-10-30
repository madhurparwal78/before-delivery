import { h } from '../../html.js';
import { consolePage } from '../../layout.js';
import { NO_ACCESS } from '../../messages.js';
import { displayTime } from './parts.js';

export function chainStatusLine(chain) {
  return chain.valid ? `Chain verified: ${chain.events} events` : `Chain broken at event ${chain.first_broken_seq}`;
}

export function renderAudit({ session, data, toasts, awaiting }) {
  const content = `
    <h1>Audit</h1>
    <section class="panel">
      <div class="tabs" role="tablist" aria-label="Audit views">
        <button type="button" class="tab" role="tab" id="tab-audit" aria-selected="true" aria-controls="panel-audit">Audit trail</button>
        <button type="button" class="tab" role="tab" id="tab-signed" aria-selected="false" aria-controls="panel-signed">Signed events</button>
      </div>
      <div class="inline-actions" style="align-items:center;gap:1rem">
        <p class="result-line" role="status" aria-label="Chain status" data-chain-status>${h(chainStatusLine(data.chain))}</p>
        <form method="post" action="/console/audit" data-verify-form>
          <input type="hidden" name="__action" value="verify-chain">
          <button type="submit" class="capsule capsule-light">Verify chain</button>
        </form>
      </div>
      <div role="tabpanel" id="panel-audit" aria-labelledby="tab-audit" data-tabpanel>
        <table class="stacked">
          <caption>Audit trail</caption>
          <thead><tr><th scope="col">Seq</th><th scope="col">Time</th><th scope="col">Type</th><th scope="col">Actor</th><th scope="col">Subject</th><th scope="col">Hash</th></tr></thead>
          <tbody>
            ${data.events.map((event) => `
              <tr>
                <td data-label="Seq">${event.seq}</td>
                <td data-label="Time">${h(displayTime(event.at))}</td>
                <td data-label="Type">${h(event.type)}</td>
                <td data-label="Actor">${h(event.actor)}</td>
                <td data-label="Subject"><span class="mono">${h(event.subject_id || '')}</span></td>
                <td data-label="Hash"><span class="mono">${h(event.hash.slice(0, 12))}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div role="tabpanel" id="panel-signed" aria-labelledby="tab-signed" hidden data-tabpanel>
        <table class="stacked">
          <caption>Signed events</caption>
          <thead><tr><th scope="col">Seq</th><th scope="col">Type</th><th scope="col">Time</th><th scope="col">Signature</th></tr></thead>
          <tbody>
            ${data.signed.map((event) => `
              <tr>
                <td data-label="Seq">${event.seq}</td>
                <td data-label="Type">${h(event.type)}</td>
                <td data-label="Time">${h(displayTime(event.created_at))}</td>
                <td data-label="Signature"><span class="mono">${h(event.signature)}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>`;

  return consolePage({ title: 'Audit — Corvo console', session, active: '/console/audit', content, toasts, awaiting });
}

export function renderNoAccess({ session, toasts, awaiting }) {
  return consolePage({
    title: 'Audit — Corvo console',
    session,
    active: '/console/audit',
    content: `<h1>Audit</h1><p>${h(NO_ACCESS)}</p>`,
    toasts,
    awaiting
  });
}
