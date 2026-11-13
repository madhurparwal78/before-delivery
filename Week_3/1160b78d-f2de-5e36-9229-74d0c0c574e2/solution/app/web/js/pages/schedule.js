// /schedules/<id>: who is on call as the figure, range controls, layer rows and the final row with Handoff Cut.
import { html, useState, useEffect, useRef, useMemo } from '../lib/html.js';
import { boot, me } from '../lib/boot.js';
import { api } from '../lib/api.js';
import { live } from '../lib/live.js';
import { fmtLocal } from '../lib/format.js';
import { Empty, Problems, FieldError } from '../lib/ui.js';
import { serverNow } from './schedule/serverclock.js';
import { iso, isDate, addDays, mondayOf, startOfDay, dateIn } from './schedule/zonetime.js';
import { useCut } from './schedule/cut.js';
import { Grid } from './schedule/grid.js';
import { OverrideForm } from './schedule/override-form.js';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 35;
const RANGE_ERROR = 'Use the format YYYY-MM-DD.';

function parseDays(text) {
  const n = Number(text);
  return text && Number.isInteger(n) && n >= 1 && n <= MAX_DAYS ? n : DEFAULT_DAYS;
}

function holderName(answer) {
  if (!answer || answer.gap || !answer.holder) return 'Nobody';
  return typeof answer.holder === 'string' ? answer.holder : answer.holder.name;
}

export default function Schedule() {
  const id = boot.params.id;
  const [search, setSearch] = useState(location.search);
  const [schedule, setSchedule] = useState(null);
  const [missing, setMissing] = useState(false);
  const [people, setPeople] = useState([]);
  const [data, setData] = useState(null);
  const [onCall, setOnCall] = useState(null);
  const [cutFor, setCutFor] = useState(me?.id ?? '');
  const [formOpen, setFormOpen] = useState(false);
  const [rangeText, setRangeText] = useState('');
  const [rangeError, setRangeError] = useState(null);
  const opener = useRef(null);
  const finalSeq = useRef(0);

  useEffect(() => {
    const onPop = () => setSearch(location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const params = new URLSearchParams(search);
  const scheduleZone = schedule?.zone;
  const defaultFrom = useMemo(() => (scheduleZone ? mondayOf(dateIn(serverNow(), scheduleZone)) : null), [scheduleZone]);
  const zone = boot.zones?.includes(params.get('zone')) ? params.get('zone') : scheduleZone;
  const days = parseDays(params.get('days'));
  const fromDate = isDate(params.get('from') ?? '') ? params.get('from') : defaultFrom;
  const fromMs = zone && fromDate ? startOfDay(fromDate, zone) : null;
  const toMs = zone && fromDate ? startOfDay(addDays(fromDate, days), zone) : null;

  const navigate = (changes) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    history.pushState(null, '', `${location.pathname}?${next}`);
    setSearch(location.search);
  };

  const loadSchedule = async () => {
    const res = await api.get(`/api/schedules/${id}`);
    if (res.status === 404) setMissing(true);
    else if (res.ok) setSchedule(res.data);
  };
  const loadOnCall = async () => {
    const res = await api.get(`/api/oncall?schedule_id=${encodeURIComponent(id)}`);
    if (res.ok) setOnCall(res.data);
  };
  const view = useRef(null);
  view.current = fromMs === null ? null : { fromMs, toMs, zone };
  const loadFinal = async () => {
    const v = view.current;
    if (!v) return;
    const mine = ++finalSeq.current;
    const query = new URLSearchParams({ from: iso(v.fromMs), to: iso(v.toMs), zone: v.zone });
    const res = await api.get(`/api/schedules/${id}/final?${query}`);
    if (mine === finalSeq.current && res.ok) setData(res.data);
  };

  const latest = useRef(null);
  latest.current = { loadSchedule, loadOnCall, loadFinal, shown: holderName(onCall) };

  useEffect(() => {
    latest.current.loadSchedule();
    latest.current.loadOnCall();
    api.get('/api/users').then((res) => {
      if (res.ok) {
        setPeople(res.data.items.filter((p) => p.role !== 'stakeholder').sort((a, b) => a.name.localeCompare(b.name)));
      }
    });
    live.watch('oncall', id);
    const offSchedule = live.on('schedule', (message) => {
      if (message && message.schedule_id && message.schedule_id !== id) return;
      latest.current.loadSchedule();
      latest.current.loadOnCall();
      latest.current.loadFinal();
    });
    const offCountdown = live.on('countdown', (message) => {
      if (message.scope !== 'oncall' || message.id !== id) return;
      if (holderName(message.countdown) !== latest.current.shown) latest.current.loadOnCall();
    });
    return () => {
      offSchedule();
      offCountdown();
    };
  }, [id]);

  useEffect(() => {
    loadFinal();
  }, [id, fromMs, toMs, zone]);

  useEffect(() => {
    if (fromDate) {
      setRangeText(fromDate);
      setRangeError(null);
    }
  }, [fromDate]);

  const applyRange = (text) => {
    const value = text.trim();
    if (!isDate(value)) {
      setRangeError(RANGE_ERROR);
      return;
    }
    setRangeError(null);
    if (value !== fromDate) navigate({ from: value });
  };

  const cutPerson = people.find((p) => p.id === cutFor)?.name ?? 'Nobody';
  const geometry = data ? { fromMs: Date.parse(data.from), toMs: Date.parse(data.to), zone: data.zone } : { fromMs: 0, toMs: 1, zone: zone ?? 'UTC' };
  const cut = useCut({
    ...geometry, scheduleId: id, scheduleZone, cutFor, cutForName: cutPerson, reload: loadFinal,
  });

  if (missing) return html`<${Empty}>We could not find that page.</${Empty}>`;
  if (!schedule || !zone) return html`<div aria-busy="true"></div>`;

  const name = holderName(onCall);
  return html`<div class="schedule">
    <section aria-label="On call now" class="on-call-now">
      <p class="figure-label">${schedule.name} · ${schedule.zone}</p>
      <h1 class="figure holder-figure">${onCall ? name : ' '}</h1>
      ${onCall && onCall.until ? html`<p class="until">On call until ${fmtLocal(onCall.until, zone)}</p>` : null}
    </section>

    <div class="range-bar">
      <button type="button" class="secondary" onClick=${() => navigate({ from: addDays(fromDate, -7) })}>Previous week</button>
      <div class="field">
        <label for="from">Range start</label>
        <input id="from" name="from" type="text" autocomplete="off" inputmode="numeric" value=${rangeText}
          aria-invalid=${rangeError ? 'true' : undefined} aria-describedby=${rangeError ? 'from-error' : undefined}
          onInput=${(event) => setRangeText(event.target.value)} onChange=${(event) => applyRange(event.target.value)} />
        <${FieldError} errors=${rangeError ? { from: rangeError } : null} name="from" />
      </div>
      <button type="button" class="secondary" onClick=${() => navigate({ from: addDays(fromDate, 7) })}>Next week</button>
      <div class="field">
        <label for="view-zone">View zone</label>
        <select id="view-zone" value=${zone} onChange=${(event) => navigate({ zone: event.target.value })}>
          ${boot.zones.map((z) => html`<option key=${z} value=${z}>${z}</option>`)}
        </select>
      </div>
    </div>
    <${Problems} errors=${rangeError ? { from: rangeError } : null} />

    <div class="cut-bar">
      <div class="field">
        <label for="cut-for">Cut for</label>
        <select id="cut-for" value=${cutFor} onChange=${(event) => setCutFor(event.target.value)}>
          ${people.map((p) => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
          <option value="">Nobody</option>
        </select>
      </div>
      <button type="button" class="override-open" ref=${opener} onClick=${() => setFormOpen(true)}>Schedule an override</button>
    </div>

    ${data ? html`<${Grid} data=${data} zone=${data.zone} cut=${cut} cutLabel=${cutPerson} />` : null}
    <p id="cut-help" class="sr-only">Left and Right move the cursor by 15 minutes. Enter starts a cut and Enter again saves it. Escape cancels.</p>
    <div class="sr-only" aria-live="polite">${cut.spoken}</div>
    <div role="region" aria-label="Cut preview" aria-live="polite" class="cut-preview">${cut.preview}</div>

    ${formOpen ? html`<${OverrideForm} scheduleId=${id} scheduleZone=${schedule.zone} zone=${zone} people=${people}
      defaultPerson=${me?.id ?? ''} opener=${opener} onClose=${() => setFormOpen(false)} reload=${loadFinal} />` : null}
  </div>`;
}
