// /oncall: who holds the pager now on the chosen schedule, when that changes, and everyone else's holder.
import { html, useState, useEffect, useRef } from '../lib/html.js';
import { boot, me } from '../lib/boot.js';
import { api } from '../lib/api.js';
import { live } from '../lib/live.js';
import { fmtLocal, fmtCountdown } from '../lib/format.js';
import { Bar, Empty } from '../lib/ui.js';
import { serverNow } from './schedule/serverclock.js';
import { useReveal } from '../lib/reveal.js';

const SLOWER = 'Figures are coming straight from the record, so this page may load more slowly.';
const PARALLEL = 6;
const BYPASS_RETRY = 5;

function holderName(answer) {
  if (!answer || answer.gap || !answer.holder) return 'Nobody';
  return typeof answer.holder === 'string' ? answer.holder : answer.holder.name;
}

export default function OnCall() {
  const [schedules, setSchedules] = useState(null);
  const [answers, setAnswers] = useState({});
  const [bypass, setBypass] = useState(false);
  const [chosen, setChosen] = useState(new URLSearchParams(location.search).get('schedule'));
  const [told, setTold] = useState(null);
  const asked = useRef({});
  const busy = useRef(new Set());
  const latest = useRef(null);
  // the page appears whole once every schedule's holder has answered, so no row or figure pushes the next one down
  const [ready, loaded] = useReveal(1);

  const fetchOne = async (id) => {
    const mine = (asked.current[id] = (asked.current[id] ?? 0) + 1);
    busy.current.add(id);
    const res = await api.get(`/api/oncall?schedule_id=${encodeURIComponent(id)}`);
    busy.current.delete(id);
    if (!res.ok || mine !== asked.current[id]) return;
    setBypass(res.headers.get('X-Switchlamp-Cache') === 'bypass');
    setAnswers((before) => ({ ...before, [id]: res.data }));
  };
  const fetchMany = async (ids) => {
    const queue = [...ids];
    const worker = async () => {
      while (queue.length) await fetchOne(queue.shift());
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
  };
  const loadSchedules = async () => {
    const res = await api.get('/api/schedules');
    if (!res.ok) return;
    const list = [...res.data.items].sort((a, b) => a.name.localeCompare(b.name));
    setSchedules(list);
    const known = latest.current.answers;
    const selected = latest.current.chosenId ?? list[0]?.id;
    const missing = list.map((s) => s.id).filter((id) => !(id in known));
    fetchMany(selected && missing.includes(selected) ? [selected, ...missing.filter((id) => id !== selected)] : missing);
  };

  const chosenId = chosen && schedules?.some((s) => s.id === chosen) ? chosen : schedules?.[0]?.id;
  latest.current = { answers, chosenId, loadSchedules, fetchOne, bypass, counted: latest.current?.counted ?? 0 };

  useEffect(() => {
    latest.current.loadSchedules();
    const offSchedule = live.on('schedule', (message) => {
      latest.current.loadSchedules();
      if (message && message.schedule_id) latest.current.fetchOne(message.schedule_id);
    });
    // Each second the server's clock tells which holders have just changed on any schedule.
    const offClock = live.on('clock', (message) => {
      const nowMs = Date.parse(message.now);
      for (const [id, answer] of Object.entries(latest.current.answers)) {
        if (answer.until && Date.parse(answer.until) <= nowMs && !busy.current.has(id)) latest.current.fetchOne(id);
      }
    });
    const offCountdown = live.on('countdown', (message) => {
      if (message.scope !== 'oncall' || message.id !== latest.current.chosenId) return;
      const current = latest.current.answers[message.id];
      setTold({ id: message.id, seconds: message.countdown.remaining_seconds });
      if (holderName(message.countdown) !== holderName(current)) latest.current.fetchOne(message.id);
      else if (latest.current.bypass && ++latest.current.counted % BYPASS_RETRY === 0) latest.current.fetchOne(message.id);
    });
    return () => {
      offSchedule();
      offClock();
      offCountdown();
    };
  }, []);

  useEffect(() => {
    if (chosenId) live.watch('oncall', chosenId);
  }, [chosenId]);

  useEffect(() => {
    if (schedules && schedules.every((s) => s.id in answers)) loaded('holders');
  }, [schedules, answers]);

  if (!schedules) return html`<div aria-busy="true"></div>`;
  if (!schedules.length) return html`<${Empty}>No schedules yet.</${Empty}>`;

  const current = schedules.find((s) => s.id === chosenId);
  const answer = answers[chosenId];
  let remaining = null;
  if (told && told.id === chosenId) remaining = told.seconds;
  else if (answer && answer.until) remaining = Math.max(0, Math.round((Date.parse(answer.until) - serverNow()) / 1000));

  const choose = (event) => {
    const id = event.target.value;
    setChosen(id);
    setTold(null);
    history.replaceState(null, '', `${location.pathname}?${new URLSearchParams({ schedule: id })}`);
    if (!(id in answers)) fetchOne(id);
  };

  return html`<div class=${ready ? 'oncall' : 'oncall pending'}>
    <section aria-label="On call now" class="on-call-now">
      ${bypass ? html`<${Bar}>${SLOWER}</${Bar}>` : null}
      <p class="figure-label">${current.name}</p>
      <h1 class="figure holder-figure">${answer ? holderName(answer) : ' '}</h1>
    </section>

    <div class="countdown-row">
      <p class="figure-label">Next handoff in</p>
      <div role="timer" aria-label="Handoff countdown" class="countdown">${fmtCountdown(remaining)}</div>
    </div>

    <div class="field chooser">
      <label for="schedule">Schedule</label>
      <select id="schedule" value=${chosenId} onChange=${choose}>
        ${schedules.map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}
      </select>
    </div>

    <h2 class="list-title">Every schedule</h2>
    <ul class="holder-list">
      ${schedules.map((s) => html`<li key=${s.id} class=${s.id === chosenId ? 'holder-row current' : 'holder-row'}>
        <a href=${`/schedules/${s.id}`}>${s.name}</a>
        <span class="holder-name">${answers[s.id] ? holderName(answers[s.id]) : ''}</span>
        <span class="holder-until">${answers[s.id] && answers[s.id].until ? `until ${fmtLocal(answers[s.id].until, me?.timezone ?? boot.user?.timezone)}` : ''}</span>
      </li>`)}
    </ul>
  </div>`;
}
