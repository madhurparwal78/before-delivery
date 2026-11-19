// Shared browser helpers: the session token, API calls, return paths and formatting.

const TOKEN_KEY = 'hub_token';
const LAST_CHANNEL_KEY = 'hub_last_channel';
const SESSION_ENDED_KEY = 'hub_session_ended';

let clockOffsetMs = 0;

export function token() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch (error) {
    return null;
  }
}

export function setToken(value) {
  window.localStorage.setItem(TOKEN_KEY, value);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

export function rememberChannel(path) {
  window.localStorage.setItem(LAST_CHANNEL_KEY, path);
}

export function lastChannel() {
  return window.localStorage.getItem(LAST_CHANNEL_KEY);
}

export function markSessionEnded() {
  window.sessionStorage.setItem(SESSION_ENDED_KEY, '1');
}

export function takeSessionEnded() {
  const value = window.sessionStorage.getItem(SESSION_ENDED_KEY);
  window.sessionStorage.removeItem(SESSION_ENDED_KEY);
  return value === '1';
}

// The server's clock, learned from the Date header of its answers.
export function serverNow() {
  return Date.now() + clockOffsetMs;
}

function readServerClock(response) {
  const header = response.headers.get('date');
  if (!header) return;
  const stamp = Date.parse(header);
  if (!Number.isNaN(stamp)) clockOffsetMs = stamp - Date.now();
}

export async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  const bearer = options.token === undefined ? token() : options.token;
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.form) body = options.form;
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body,
    credentials: 'same-origin',
    signal: options.signal,
  });
  readServerClock(response);
  let data = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = null;
      }
    }
  }
  return { status: response.status, ok: response.ok, data, headers: response.headers };
}

// Return paths: written exactly as encodeURIComponent writes them.
export function encodeNext(path) {
  return encodeURIComponent(path);
}

export function readNext() {
  const raw = new URLSearchParams(window.location.search).get('next');
  return followable(raw) ? raw : null;
}

function followable(raw) {
  if (!raw || raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') return false;
  if (raw.includes('\\')) return false;
  for (const character of raw) {
    const code = character.codePointAt(0);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return raw.length > 1;
}

export function thousands(value) {
  return Number(value).toLocaleString('en-US');
}

export function signed(value) {
  const number = Number(value);
  return (number >= 0 ? '+' : '') + number + '%';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// A week date is a calendar day: it reads the same in every time zone.
export function weekLabel(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return MONTHS[Number(month) - 1] + ' ' + Number(day) + ', ' + year;
}

export function clockText(totalSeconds) {
  const whole = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return minutes + ':' + String(seconds).padStart(2, '0');
}

export function floorClock(totalSeconds) {
  const whole = Math.max(0, Math.floor(totalSeconds || 0));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return minutes + ':' + String(seconds).padStart(2, '0');
}

export function localTime(isoInstant) {
  const when = new Date(isoInstant);
  return when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) +
    ' ' + when.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// A guard that draws only the newest answer, whatever order answers arrive in.
export function latestInputGuard() {
  let newest = 0;
  return {
    start() {
      newest += 1;
      return newest;
    },
    current(ticket) {
      return ticket === newest;
    },
  };
}

export function element(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'text') node.textContent = value;
    else if (name === 'class') node.className = value;
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) node.appendChild(child);
  return node;
}
