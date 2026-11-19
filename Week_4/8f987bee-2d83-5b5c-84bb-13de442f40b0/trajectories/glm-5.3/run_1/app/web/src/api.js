const TOKEN_KEY = "wayline_token";

export function readToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function writeToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(status, code, fields, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = fields || {};
    this.extra = extra || {};
  }
}

async function parse(response) {
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
  }
  return body;
}

export async function api(path, { method = "GET", body, token, headers = {}, raw } = {}) {
  const init = { method, headers: { ...headers } };
  const session = token !== undefined ? token : readToken();
  if (session) init.headers.Authorization = `Bearer ${session}`;
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, "network_error");
  }
  if (response.status === 204) return { ok: true, status: 204, data: null, response };
  const data = await parse(response);
  if (!response.ok) {
    // a console request that answers 401 forgets its token and opens the login address
    if (response.status === 401 && path.startsWith("/api") && path !== "/api/auth/login"
        && path !== "/api/auth/accept-invite" && window.location.pathname.startsWith("/app")) {
      writeToken("");
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.history.replaceState(null, "", `/login?next=${next}`);
      window.location.replace(`/login?next=${next}`);
    }
    throw new ApiError(response.status, data.error || "unknown_error", data.fields, data);
  }
  return { ok: true, status: response.status, data, response };
}

/* ---------------------------------------------------------------- identity key */

export function newIdempotencyKey() {
  const bytes = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------------------------------------------------------------- next-run text */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function nextRunText(nextRunAt, timeZone) {
  if (!nextRunAt) return "—";
  const date = new Date(nextRunAt);
  const zone = timeZone || "UTC";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const weekday = get("weekday");
  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour").padStart(2, "0");
  const minute = get("minute").padStart(2, "0");
  const offsetName = get("timeZoneName").replace("GMT", "UTC");
  const dayNumber = day.replace(/^0/, "");
  return `${weekday} ${dayNumber} ${month} ${year}, ${hour}:${minute} ${zone} (${offsetName})`;
}

/* ---------------------------------------------------------------- zone names */

export function zoneNames() {
  const supported = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [];
  const names = ["UTC", ...supported.filter((z) => z !== "UTC")];
  return names.sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)));
}

/* ---------------------------------------------------------------- local time */

export function localTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/* ---------------------------------------------------------------- hooks */

export function useLiveRegion() {
  const [message, setMessage] = useState("");
  const timer = useRef(null);
  const announce = useCallback((text) => {
    setMessage("");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(text), 30);
  }, []);
  useEffect(() => () => timer.current && window.clearTimeout(timer.current), []);
  return { message, announce };
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
