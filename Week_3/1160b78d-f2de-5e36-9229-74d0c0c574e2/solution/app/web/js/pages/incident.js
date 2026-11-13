// /incidents/<id>: the near-black field with the holder and the countdown, then the actions and everything the
// incident holds. It never reloads; the socket redraws it in place.
import { html, useState, useEffect, useRef } from '../lib/html.js';
import { boot } from '../lib/boot.js';
import { api } from '../lib/api.js';
import { live } from '../lib/live.js';
import { Button, Bar, Empty } from '../lib/ui.js';
import { useIncident, decisionSentence } from './incident/store.js';
import { Field } from './incident/field.js';
import { Alerts, Steps, Policy, Timeline, Impacted, Responders, RequestBar } from './incident/sections.js';
import { NoteBox } from './incident/note.js';
import { SnoozeDialog, ReassignDialog, MergeDialog, ResponderDialog, readDirectory } from './incident/dialogs.js';

// Only this incident's decided events are announced in Live updates.
export function announce(data) {
  return data.incident_id === boot.params.id;
}

const LEADS = new Set(['lead', 'admin']);
const TRY_AGAIN = 'That did not work. Try again.';
const LAST_ALERT = 'The last alert of an incident cannot be split off.';

// useMailDown: whether mail is unreachable, read on arrival and after every change of this incident.
function useMailDown(id) {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let timer = null;
    const look = async () => {
      const res = await api.get('/api/system');
      if (res.ok) setDown(res.data.mail === 'down');
    };
    look();
    const off = live.on('incident', (data) => {
      if (data.incident_id !== id) return;
      clearTimeout(timer);
      timer = setTimeout(look, 150);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [id]);
  return down;
}

// A focused field on a phone sits fully above the fixed action bar.
function useActionBar(ready) {
  useEffect(() => {
    if (!ready) return undefined;
    const bar = document.querySelector('[data-action-bar]');
    const size = () => document.documentElement.style.setProperty('--bar-height', `${bar.offsetHeight}px`);
    size();
    const watch = new ResizeObserver(size);
    watch.observe(bar);
    const lift = (event) => {
      const target = event.target;
      if (getComputedStyle(bar).position !== 'fixed' || target.closest('dialog') || bar.contains(target)) return;
      const gap = target.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
      if (gap > 0) window.scrollBy(0, gap + 16);
    };
    document.addEventListener('focusin', lift);
    return () => {
      watch.disconnect();
      document.removeEventListener('focusin', lift);
    };
  }, [ready]);
}

// After a busy button is enabled again, give it back the focus it lost while it was disabled.
function refocus(button) {
  let tries = 0;
  const attempt = () => {
    if (!button.isConnected || tries > 20) return;
    tries += 1;
    if (button.disabled) {
      requestAnimationFrame(attempt);
    } else if (!document.activeElement || document.activeElement === document.body) {
      button.focus();
    }
  };
  requestAnimationFrame(attempt);
}

export default function Incident() {
  const id = boot.params.id;
  const { incident, shown, missing, refresh, adopt } = useIncident(id);
  const [dialog, setDialog] = useState(null);
  const [focusAlert, setFocusAlert] = useState(null);
  const mailDown = useMailDown(id);
  useActionBar(Boolean(incident));
  useEffect(() => { readDirectory(); }, []);

  if (missing) return html`<${Empty}>We could not find that page.</${Empty}>`;
  if (!incident) return html`<section class="night-field" aria-hidden="true"></section>`;

  const canLead = LEADS.has(boot.user.role);
  const queued = incident.steps.filter((s) => s.status === 'queued').length;
  const open = (name) => (event) => setDialog({ name, opener: event.currentTarget });
  const close = () => setDialog(null);

  const decide = (verb) => async (event) => {
    const button = event.currentTarget;
    const res = await api.post(`/api/incidents/${id}/${verb}`);
    if (res.ok) {
      adopt(res.data);
    } else {
      live.announce(decisionSentence(res) ?? TRY_AGAIN);
      await refresh();
    }
    refocus(button);
  };

  const split = {
    run: async (alert, index) => {
      const res = await api.post(`/api/incidents/${id}/alerts/${alert.id}/split`);
      if (res.ok) {
        await refresh();
        setFocusAlert(index);
        return;
      }
      live.announce(res.data?.error === 'last_alert' ? LAST_ALERT : decisionSentence(res) ?? TRY_AGAIN);
      await refresh();
    },
    settled: () => setFocusAlert(null),
  };

  const primary = incident.status === 'triggered' ? 'acknowledge' : incident.status === 'resolved' ? '' : 'resolve';
  const accent = (verb) => (primary === verb ? 'tab-accent' : undefined);
  const props = { incident, adopt, refresh, opener: dialog?.opener, close };

  return html`
    ${mailDown && queued > 0 ? html`<${Bar}>Mail is unreachable. ${queued} notification steps are queued and will go out when it returns.</${Bar}>` : null}
    <${RequestBar} incident=${incident} refresh=${refresh} />
    <${Field} incident=${incident} shown=${shown} />
    <div class="incident-body">
      <div role="toolbar" aria-label="Incident actions" class="action-bar" data-action-bar>
        <${Button} class=${accent('acknowledge')} onClick=${decide('acknowledge')}>Acknowledge</${Button}>
        <button type="button" onClick=${open('snooze')}>Snooze</button>
        <${Button} class=${accent('resolve')} onClick=${decide('resolve')}>Resolve</${Button}>
        <button type="button" onClick=${open('reassign')}>Reassign</button>
        ${canLead ? html`<button type="button" onClick=${open('merge')}>Merge</button>` : null}
      </div>
      <div class="body-main">
        <${Alerts} incident=${incident} canSplit=${canLead} focusAlert=${focusAlert} onSplit=${split} />
        <${Steps} incident=${incident} />
        <${Policy} incident=${incident} />
        <${Timeline} incident=${incident} />
        <${NoteBox} incident=${incident} refresh=${refresh} />
      </div>
      <div class="body-side">
        <${Impacted} incident=${incident} />
        <${Responders} incident=${incident} onAsk=${open('responder')} />
      </div>
    </div>
    ${dialog?.name === 'snooze' ? html`<${SnoozeDialog} ...${props} />` : null}
    ${dialog?.name === 'reassign' ? html`<${ReassignDialog} ...${props} />` : null}
    ${dialog?.name === 'merge' ? html`<${MergeDialog} ...${props} />` : null}
    ${dialog?.name === 'responder' ? html`<${ResponderDialog} ...${props} />` : null}
  `;
}
