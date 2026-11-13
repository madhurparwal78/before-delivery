// /admin: people and roles, API keys, and the operator clock.
import { html } from '../lib/html.js';
import { People } from './admin/people.js';
import { ApiKeys } from './admin/keys.js';
import { OperatorClock } from './admin/clock.js';
import { useReveal } from '../lib/reveal.js';

export default function Admin() {
  const [ready, loaded] = useReveal(3);
  return html`<div class=${ready ? 'admin' : 'admin pending'}>
    <h1>Admin</h1>
    <${People} onLoaded=${() => loaded('people')} />
    <${ApiKeys} onLoaded=${() => loaded('keys')} />
    <${OperatorClock} onLoaded=${() => loaded('clock')} />
  </div>`;
}
