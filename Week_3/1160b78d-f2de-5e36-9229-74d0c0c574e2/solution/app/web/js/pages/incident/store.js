// The incident record, kept fresh: the REST read first, then the incident and countdown messages of the socket.
// Everything shown comes from the server; nothing here ticks or reads the device clock.
import { useState, useEffect, useRef, useCallback } from '../../lib/html.js';
import { api } from '../../lib/api.js';
import { live } from '../../lib/live.js';

const COALESCE_MS = 120;

// shownOf is the part of an incident the figure and the Holder region draw from.
function shownOf(incident) {
  return {
    kind: incident.countdown.kind,
    remaining: incident.countdown.remaining_seconds,
    level: incident.level,
    cycle: incident.cycle,
    holders: incident.holders.map((h) => h.name),
    status: incident.status,
  };
}

// useIncident returns {incident, shown, missing, refresh, adopt, onIncidentMessage}.
// `shown` is the latest of the REST value and the last countdown message, so every open tab draws the same figures.
export function useIncident(id, onMessage) {
  const [incident, setIncident] = useState(null);
  const [shown, setShown] = useState(null);
  const [missing, setMissing] = useState(false);
  const current = useRef(null);
  const asked = useRef(0);
  const applied = useRef(0);
  const refreshTimer = useRef(null);

  const install = useCallback((data) => {
    current.current = data;
    setIncident(data);
    setShown(shownOf(data));
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++asked.current;
    const res = await api.get(`/api/incidents/${id}`);
    if (res.status === 404) {
      setMissing(true);
      return null;
    }
    if (!res.ok || mine < applied.current) return current.current;
    applied.current = mine;
    install(res.data);
    return res.data;
  }, [id, install]);

  // adopt takes the incident an action answered with, unless a newer record is already on screen.
  const adopt = useCallback((data) => {
    if (current.current && data.version < current.current.version) return;
    applied.current = ++asked.current;
    install(data);
  }, [install]);

  const soon = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      refresh();
    }, COALESCE_MS);
  }, [refresh]);

  useEffect(() => {
    refresh();
    live.watch('incident', id);
    const offIncident = live.on('incident', (data) => {
      if (data.incident_id !== id) return;
      if (onMessage) onMessage(data);
      soon();
    });
    const offCountdown = live.on('countdown', (data) => {
      if (data.scope !== 'incident' || data.id !== id) return;
      const next = data.countdown;
      const have = current.current;
      setShown({
        kind: next.kind, remaining: next.remaining_seconds, level: next.level, cycle: next.cycle,
        holders: next.holders, status: next.status,
      });
      if (have && (have.status !== next.status || have.level !== next.level || have.cycle !== next.cycle
        || have.holders.map((h) => h.name).join(', ') !== next.holders.join(', '))) soon();
    });
    return () => {
      offIncident();
      offCountdown();
      clearTimeout(refreshTimer.current);
    };
  }, [id]);

  return { incident, shown, missing, refresh, adopt };
}

// The label above the timer, by the brief's six-line rule (the kind already follows it; the last two lines split on
// whether a high-urgency triggered incident has finished escalating).
export function countdownLabel(incident, shown) {
  switch (shown.kind) {
    case 'snooze': return 'Snooze ends in';
    case 'ack_timeout': return 'Back to triggered in';
    case 'escalation': return 'Escalates in';
    case 'auto_resolve': return 'Auto-resolves in';
    default:
      return incident.status === 'triggered' && incident.urgency === 'high' ? 'Escalation finished' : 'No timer running';
  }
}

export function holderText(names) {
  return names.length ? names.join(', ') : 'Nobody';
}

export function capitalised(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : '';
}

// decisionSentence reads a refusal body: who decided first, or why the move is illegal. Null when it is neither.
export function decisionSentence(res) {
  const body = res.data ?? {};
  if (body.error === 'already_decided') return `Already ${body.decision} by ${body.decided_by}.`;
  if (body.error === 'illegal_transition' && body.message) return body.message;
  return null;
}
