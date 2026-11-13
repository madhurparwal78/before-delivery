// The white sections under the field: alerts, notification steps, the opened-with policy, the timeline, impacted
// services and responders.
import { html, useRef, useEffect } from '../../lib/html.js';
import { boot } from '../../lib/boot.js';
import { api } from '../../lib/api.js';
import { live } from '../../lib/live.js';
import { fmtLocal, plural } from '../../lib/format.js';
import { Button, Tone } from '../../lib/ui.js';
import { capitalised, decisionSentence } from './store.js';

const ZONE = boot.user.timezone;
const CHANNELS = { in_app: 'In app', email: 'Mail' };

function Heading({ id, children }) {
  return html`<h2 id=${id}>${children}</h2>`;
}

export function Alerts({ incident, canSplit, focusAlert, onSplit }) {
  const list = useRef(null);
  const alerts = incident.alerts;
  useEffect(() => {
    if (focusAlert === null) return;
    const buttons = list.current.querySelectorAll('button');
    const target = buttons[Math.min(focusAlert, buttons.length - 1)];
    if (target) target.focus();
    onSplit.settled();
  }, [focusAlert, alerts.length]);
  return html`<section class="block" aria-labelledby="alerts-heading">
    <${Heading} id="alerts-heading">Alerts</${Heading}>
    <ul aria-label="Alerts" class="rows" ref=${list}>
      ${alerts.map((alert, index) => html`<li key=${alert.id} class="row alert-row">
        <div class="alert-main">
          <p class="alert-key"><code>${alert.dedup_key}</code></p>
          <p class="alert-summary">${alert.summary}</p>
          <p class="muted alert-meta">${alert.source} · ${capitalised(alert.severity)} · ${plural(alert.event_count, 'event', 'events')}</p>
        </div>
        <div class="alert-side">
          <${Tone} status=${capitalised(alert.status)} />
          ${canSplit ? html`<${Button} class="secondary" onClick=${() => onSplit.run(alert, index)}>Split off</${Button}>` : null}
        </div>
      </li>`)}
    </ul>
  </section>`;
}

export function Steps({ incident }) {
  return html`<section class="block" aria-labelledby="steps-heading">
    <${Heading} id="steps-heading">Notification steps</${Heading}>
    <ul aria-label="Notification steps" class="rows">
      ${incident.steps.map((step) => html`<li key=${step.id} class="row step-row">
        <span class="step-person">${step.person}</span>
        <span>${CHANNELS[step.channel] ?? step.channel}</span>
        <span class="step-due">${step.due_local ?? fmtLocal(step.due_at, ZONE)}</span>
        <${Tone} status=${capitalised(step.status)}>${step.status_text ?? capitalised(step.status)}</${Tone}>
      </li>`)}
    </ul>
  </section>`;
}

export function Policy({ incident }) {
  const policy = incident.policy_snapshot;
  return html`<section class="block on-surface" role="region" aria-label="Opened-with policy">
    <${Heading}>Opened with policy</${Heading}>
    <p class="policy-name">${policy.name}</p>
    <p class="muted">Version ${policy.version} · ${policy.repeats === 0 ? 'No repeats' : `Repeats ${plural(policy.repeats, 'time', 'times')}`}</p>
    <ol class="rows policy-levels">
      ${policy.levels.map((level, index) => html`<li key=${index} class="row level-row" aria-current=${incident.level === index + 1 ? 'step' : undefined}>
        <span class="level-number">Level ${index + 1}</span>
        <span>${plural(level.timeout_minutes, 'minute', 'minutes')}</span>
        <span class="level-targets">${level.targets.map((target) => target.name).join(', ')}</span>
      </li>`)}
    </ol>
  </section>`;
}

export function Timeline({ incident }) {
  return html`<section class="block" aria-labelledby="timeline-heading">
    <${Heading} id="timeline-heading">Timeline</${Heading}>
    <ul aria-label="Timeline" class="rows timeline">
      ${incident.timeline.map((entry) => html`<li key=${entry.id} class=${'row entry entry-' + entry.kind}>
        <span class="entry-time">${fmtLocal(entry.at, ZONE)}</span>
        <span class="entry-text">
          ${entry.kind === 'note' ? html`<strong class="entry-author">${entry.actor}</strong> ` : null}
          ${entry.text}
          ${entry.from_number ? html` <span class="muted entry-from">from #${entry.from_number}</span>` : null}
        </span>
      </li>`)}
    </ul>
  </section>`;
}

export function Impacted({ incident }) {
  const services = incident.impacted_services;
  return html`<section class="block" aria-labelledby="impacted-heading">
    <${Heading} id="impacted-heading">Impacted services</${Heading}>
    <ul aria-label="Impacted services" class="rows">
      ${services.length ? services.map((service) => html`<li key=${service.id} class="row">${service.name}</li>`)
        : html`<li class="row muted">None besides ${incident.service.name}.</li>`}
    </ul>
  </section>`;
}

export function Responders({ incident, onAsk }) {
  const people = incident.responders;
  return html`<section class="block" aria-labelledby="responders-heading">
    <${Heading} id="responders-heading">Responders</${Heading}>
    <ul aria-label="Responders" class="rows">
      ${people.length ? people.map((person) => html`<li key=${person.id} class="row">${person.name}</li>`)
        : html`<li class="row muted">Nobody has joined.</li>`}
    </ul>
    <button type="button" class="secondary ask" onClick=${onAsk}>Add responder</button>
  </section>`;
}

// RequestBar is what the person asked to join sees: Accept and Decline, once.
export function RequestBar({ incident, refresh }) {
  const mine = incident.responder_requests.find((r) => r.state === 'requested' && r.person === boot.user.name);
  if (!mine) return null;
  const answer = (verb) => async () => {
    const res = await api.post(`/api/responder-requests/${mine.id}/${verb}`);
    if (!res.ok && !decisionSentence(res) && res.data?.error !== 'already_answered') live.announce('That did not work. Try again.');
    await refresh();
  };
  return html`<section class="request-band" role="region" aria-label="Responder request">
    <p>You were asked to join this incident.</p>
    <div class="toolbar">
      <${Button} onClick=${answer('accept')}>Accept</${Button}>
      <${Button} class="secondary" onClick=${answer('decline')}>Decline</${Button}>
    </div>
  </section>`;
}
