// /analytics: the overall time to acknowledge, the date range, the running job's progress, the measures and the download.
import { html, useState, useEffect, useRef } from '../lib/html.js';
import { api, fieldErrors } from '../lib/api.js';
import { live } from '../lib/live.js';
import { Button, Problems, FieldError } from '../lib/ui.js';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const FORMAT_SENTENCE = 'Use the format YYYY-MM-DD.';
const POLL_MS = 2000;

function isDay(text) {
  const match = DAY.exec(text.trim());
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function addressFor(job) {
  return `/analytics?from=${job.from}&to=${job.to}&job=${job.id}`;
}

// A progress value never goes back within one job.
function advance(previous, next) {
  if (!previous || previous.id !== next.id) return next;
  return { ...next, done: Math.max(previous.done, next.done) };
}

function Measures({ job }) {
  const rows = job && job.rows ? job.rows : [];
  return html`<div class="table-scroll" tabindex="0" role="region" aria-label="Response measures table">
    <table aria-label="Response measures">
      <thead><tr>
        <th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Incidents</th>
        <th scope="col">Time to acknowledge (minutes)</th><th scope="col">Time to resolve (minutes)</th>
      </tr></thead>
      <tbody>
        ${rows.map((row) => html`<tr key=${`${row.kind}-${row.name}`}>
          <th scope="row">${row.name}</th><td data-label="Kind">${row.kind === 'team' ? 'Team' : 'Service'}</td>
          <td data-label="Incidents">${row.incidents}</td><td data-label="Time to acknowledge (minutes)">${row.mtta_minutes}</td><td data-label="Time to resolve (minutes)">${row.mttr_minutes}</td>
        </tr>`)}
        ${job && job.overall ? html`<tr key="all">
          <th scope="row">All services</th><td data-label="Kind">All</td>
          <td data-label="Incidents">${job.overall.incidents}</td><td data-label="Time to acknowledge (minutes)">${job.overall.mtta_minutes}</td><td data-label="Time to resolve (minutes)">${job.overall.mttr_minutes}</td>
        </tr>` : null}
      </tbody>
    </table>
  </div>`;
}

export default function Analytics() {
  const [job, setJob] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [errors, setErrors] = useState(null);
  const current = useRef(null);

  const show = (next) => {
    current.current = next;
    setJob(next);
    setFrom(next.from);
    setTo(next.to);
  };

  // follow reads the job with its rows once it has finished, or just its progress while it runs.
  const follow = async (id) => {
    const res = await api.get(`/api/analytics/jobs/${id}`);
    if (!res.ok || current.current?.id !== id) return;
    const next = advance(current.current, res.data);
    current.current = next;
    setJob(next);
  };

  const start = async (body) => {
    const res = await api.post('/api/analytics/jobs', body);
    if (!res.ok) {
      setErrors(fieldErrors(res) ?? { to: 'The analytics could not be started.' });
      return;
    }
    setErrors(null);
    show(res.data);
    history.replaceState(null, '', addressFor(res.data));
  };

  useEffect(() => {
    const wanted = new URLSearchParams(location.search).get('job');
    (async () => {
      if (wanted) {
        const res = await api.get(`/api/analytics/jobs/${wanted}`);
        if (res.ok) {
          show(res.data);
          return;
        }
      }
      await start({});
    })();
    const off = live.on('analytics', (data) => {
      const now = current.current;
      if (!now || data.job_id !== now.id) return;
      const next = advance(now, { ...now, state: data.state, done: data.done, total: data.total });
      current.current = next;
      setJob(next);
      if (data.state === 'done') follow(now.id);
    });
    const poll = setInterval(() => {
      if (current.current && current.current.state === 'running') follow(current.current.id);
    }, POLL_MS);
    return () => {
      off();
      clearInterval(poll);
    };
  }, []);

  const run = async () => {
    const problems = {};
    if (!isDay(from)) problems.from = FORMAT_SENTENCE;
    if (!isDay(to)) problems.to = FORMAT_SENTENCE;
    if (Object.keys(problems).length) {
      setErrors(problems);
      return;
    }
    await start({ from: from.trim(), to: to.trim() });
  };

  const done = job && job.state === 'done';
  const overall = done && job.overall ? job.overall.mtta_minutes : '—';

  return html`<div class="analytics">
    <h1>Analytics</h1>
    <section class="headline" aria-label="Overall time to acknowledge">
      <p class="figure-label">Overall time to acknowledge, in minutes</p>
      <p class="figure">${overall}</p>
    </section>
    <form class="range" onSubmit=${(event) => event.preventDefault()} noValidate>
      <${Problems} errors=${errors} />
      <div class="fields">
        <div class="field">
          <label for="from">From</label>
          <input id="from" type="text" inputmode="numeric" placeholder="YYYY-MM-DD" value=${from}
            onInput=${(event) => setFrom(event.target.value)} autocomplete="off" />
          <${FieldError} errors=${errors} name="from" />
        </div>
        <div class="field">
          <label for="to">To</label>
          <input id="to" type="text" inputmode="numeric" placeholder="YYYY-MM-DD" value=${to}
            onInput=${(event) => setTo(event.target.value)} autocomplete="off" />
          <${FieldError} errors=${errors} name="to" />
        </div>
        <div class="field act"><${Button} type="submit" class="tab-accent" onClick=${run}>Run analytics</${Button}></div>
      </div>
    </form>
    <section class="progress">
      ${job ? html`<div class="bar-track">
        <div class="progressbar" role="progressbar" aria-label="Analytics progress" aria-valuemin="0" aria-valuemax=${job.total}
          aria-valuenow=${job.done} aria-valuetext=${`${job.done} of ${job.total} services measured`}>
          <span class="fill" style=${`width: ${job.total ? Math.round((100 * job.done) / job.total) : 100}%`}></span>
        </div>
      </div>
      <p class="muted">${done ? 'Finished.' : `${job.done} of ${job.total} services measured.`}${job.cached ? ' Kept from an earlier run.' : ''}</p>` : null}
    </section>
    <section class="block">
      <h2>Response measures</h2>
      <${Measures} job=${job} />
      ${done ? html`<p class="download"><a class="linkbutton" href=${`/api/analytics/jobs/${job.id}/download`} download>Download CSV</a></p>` : null}
    </section>
  </div>`;
}
