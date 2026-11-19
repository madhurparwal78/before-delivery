// The "Send a brief" form at the end of the corridor (journey and private page).

import { byId, request } from "../lib/api.js";

interface Options {
  /** On a private page every brief carries the page's listen_token. */
  listenToken: string | null;
  /** The slug of the last station the director heard. */
  heardProject: () => string | null;
}

const FIELD_ORDER = ["name", "email", "studio", "brief", "preferred_month", "attachment"] as const;
const FIELD_INPUT: Record<(typeof FIELD_ORDER)[number], string> = {
  name: "brief-name",
  email: "brief-email",
  studio: "brief-studio",
  brief: "brief-brief",
  preferred_month: "brief-month",
  attachment: "brief-file",
};

const REFERENCE_LIMIT = 10_000_000;
const MONTH_REFRESH_MS = 2000;
const RETRY_DELAY_MS = 3000;
const AUTOMATIC_RETRIES = 5;

const COPY = {
  pending: "Sending your brief…",
  fields: "Check the highlighted fields.",
  tooLarge: "That file is too large. The limit is 10,000,000 bytes.",
  unsupported: "That file type isn’t accepted. Send WAV, OGG, MP3 or PDF.",
  storage: "Reference files can’t be stored right now. Send the brief without the file, or try again later.",
  notPcm: "That WAV isn’t PCM or float audio. Send WAV, OGG, MP3 or PDF.",
  channels: "That WAV must have one or two channels. Send a mono or stereo file.",
  sampleRate: "That WAV’s sample rate isn’t accepted. Use 22,050 to 96,000 Hz.",
  undecodable: "That WAV can’t be decoded. Send another file.",
  retrying: "Connection lost. Retrying your brief…",
  unconfirmed: "We couldn't confirm your brief was received. Press Send brief to try again. It won't be sent twice.",
  failed: "Something went wrong. Your brief was not sent.",
} as const;

/** Retry-After as copy: seconds below 120, otherwise minutes rounded up. */
function waitCopy(seconds: number): string {
  return seconds < 120 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}

const ascii = (view: DataView, offset: number, length: number): string =>
  String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));

const PCM = 1;
const IEEE_FLOAT = 3;
const EXTENSIBLE = 0xfffe;

/**
 * The browser's reference check, in the brief's order: size, then for a WAV its format chunk, channels, sample
 * rate and a full decode on an OfflineAudioContext. Returns the failing check's copy, or null to send.
 */
async function referenceProblem(file: File): Promise<string | null> {
  if (file.size > REFERENCE_LIMIT) return COPY.tooLarge;
  const bytes = await file.arrayBuffer();
  const view = new DataView(bytes);
  if (bytes.byteLength < 12 || ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") return null;
  let offset = 12;
  let format: { tag: number; channels: number; sampleRate: number } | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const size = view.getUint32(offset + 4, true);
    if (ascii(view, offset, 4) === "fmt " && size >= 16 && offset + 8 + size <= bytes.byteLength) {
      const start = offset + 8;
      let tag = view.getUint16(start, true);
      if (tag === EXTENSIBLE) tag = size >= 40 ? view.getUint16(start + 24, true) : 0;
      format = { tag, channels: view.getUint16(start + 2, true), sampleRate: view.getUint32(start + 4, true) };
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!format || (format.tag !== PCM && format.tag !== IEEE_FLOAT)) return COPY.notPcm;
  if (format.channels !== 1 && format.channels !== 2) return COPY.channels;
  if (format.sampleRate < 22_050 || format.sampleRate > 96_000) return COPY.sampleRate;
  try {
    await new OfflineAudioContext(format.channels, format.sampleRate, format.sampleRate).decodeAudioData(bytes);
  } catch {
    return COPY.undecodable;
  }
  return null;
}

interface Answer {
  status: number;
  body: { reference?: string; error?: string; errors?: Record<string, string>; retry_after_seconds?: number };
  retryAfter: number | null;
}

/** POSTs the brief with XHR so the upload's progress can be shown; no HTTP response is `status: 0`. */
function post(data: FormData, key: string, progress: (percent: number) => void): Promise<Answer> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/enquiries");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Idempotency-Key", key);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) progress(Math.floor((event.loaded / event.total) * 100));
    });
    const lost = () => resolve({ status: 0, body: {}, retryAfter: null });
    xhr.addEventListener("error", lost);
    xhr.addEventListener("abort", lost);
    xhr.addEventListener("timeout", lost);
    xhr.addEventListener("load", () => {
      let body: Answer["body"] = {};
      try {
        body = xhr.responseText ? (JSON.parse(xhr.responseText) as Answer["body"]) : {};
      } catch {
        body = {};
      }
      const retryAfter = Number.parseInt(xhr.getResponseHeader("Retry-After") ?? "", 10);
      resolve({ status: xhr.status, body, retryAfter: Number.isFinite(retryAfter) ? retryAfter : null });
    });
    xhr.send(data);
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function setupBriefForm({ listenToken, heardProject }: Options): void {
  const form = byId<HTMLFormElement>("brief-form");
  const status = byId("brief-status");
  const submit = byId<HTMLButtonElement>("brief-submit");
  const submitLabel = byId("brief-submit-label");
  const months = byId<HTMLSelectElement>("brief-month");
  const fileInput = byId<HTMLInputElement>("brief-file");
  const upload = byId("brief-upload");
  const uploadFill = byId("brief-upload-fill");
  const uploadValue = byId("brief-upload-value");

  const say = (copy: string, success = false): void => {
    status.classList.toggle("success", success);
    status.textContent = copy;
  };

  // Live month options: on load, on focus and every two seconds; a chosen month that fills falls back to No preference.
  let monthKeys = "";
  const loadMonths = async (): Promise<void> => {
    const answer = await request<{ months: { month: string; label: string }[] }>("/api/months");
    if (answer.status !== 200) return;
    const keys = answer.body.months.map((month) => month.month).join(",");
    if (keys === monthKeys) return;
    monthKeys = keys;
    const chosen = months.selectedOptions[0];
    const options = [new Option("No preference", ""), ...answer.body.months.map((month) => new Option(month.label, month.month))];
    months.replaceChildren(...options);
    if (chosen && chosen.value !== "" && !answer.body.months.some((month) => month.month === chosen.value)) {
      months.value = "";
      say(`${chosen.textContent} is now fully booked. Choose another month or No preference.`);
    } else {
      months.value = chosen?.value ?? "";
    }
  };
  void loadMonths();
  months.addEventListener("focus", () => void loadMonths());
  setInterval(() => void loadMonths(), MONTH_REFRESH_MS);

  const clearErrors = (): void => {
    for (const field of FIELD_ORDER) {
      byId(`brief-${field}-error`).textContent = "";
      byId(FIELD_INPUT[field]).removeAttribute("aria-invalid");
    }
  };

  const setPending = (pending: boolean): void => {
    submit.disabled = pending;
    submitLabel.textContent = pending ? "Sending…" : "Send brief";
  };

  const showProgress = (percent: number | null): void => {
    upload.hidden = percent === null;
    const value = percent ?? 0;
    upload.setAttribute("aria-valuenow", String(value));
    uploadValue.textContent = `${value}%`;
    uploadFill.style.transform = `scaleX(${value / 100})`;
  };

  /** What the director typed and chose; a change since the last request sent means a new brief and a new key. */
  const signature = (file: File | undefined): string => JSON.stringify([
    ...(["name", "email", "studio", "brief"] as const).map((field) => byId<HTMLInputElement>(FIELD_INPUT[field]).value),
    months.value,
    file ? [file.name, file.size, file.lastModified] : null,
  ]);

  /** The brief held under one Idempotency-Key: the same key and the same body for every retry and later press. */
  let held: { key: string; signature: string; data: FormData; withFile: boolean } | null = null;

  const briefFor = (file: File | undefined): NonNullable<typeof held> => {
    const current = signature(file);
    if (held && held.signature === current) return held;
    const data = new FormData();
    for (const field of ["name", "email", "studio", "brief"] as const) {
      data.set(field, byId<HTMLInputElement>(FIELD_INPUT[field]).value);
    }
    if (months.value) data.set("preferred_month", months.value);
    if (file) data.set("attachment", file, file.name);
    if (listenToken) data.set("listen_token", listenToken);
    else {
      const heard = heardProject();
      if (heard) data.set("project_slug", heard);
    }
    held = { key: crypto.randomUUID(), signature: current, data, withFile: Boolean(file) };
    return held;
  };

  const showFieldErrors = (errors: Record<string, string>): void => {
    let first: HTMLElement | null = null;
    for (const field of FIELD_ORDER) {
      const message = errors[field];
      if (!message) continue;
      byId(`brief-${field}-error`).textContent = message;
      const input = byId(FIELD_INPUT[field]);
      input.setAttribute("aria-invalid", "true");
      first ??= input;
    }
    say(COPY.fields);
    first?.focus();
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    clearErrors();
    const file = fileInput.files?.[0];
    if (file) {
      submit.disabled = true;
      const problem = await referenceProblem(file);
      submit.disabled = false;
      if (problem) {
        say(problem);
        fileInput.focus();
        return;
      }
    }
    const brief = briefFor(file);
    setPending(true);
    say(COPY.pending);
    let answer: Answer = { status: 0, body: {}, retryAfter: null };
    for (let attempt = 0; attempt <= AUTOMATIC_RETRIES; attempt += 1) {
      if (attempt > 0) {
        say(COPY.retrying);
        await sleep(RETRY_DELAY_MS);
      }
      if (brief.withFile) showProgress(0);
      answer = await post(brief.data, brief.key, (percent) => showProgress(percent));
      showProgress(null);
      const lost = answer.status === 0 || (answer.status === 409 && answer.body.error === "request_in_progress");
      if (!lost) break;
    }
    setPending(false);
    if (answer.status === 201) {
      held = null;
      form.reset();
      months.value = "";
      say(`Brief ${answer.body.reference} received. A receipt will follow by email.`, true);
      return;
    }
    if (answer.status === 0 || (answer.status === 409 && answer.body.error === "request_in_progress")) {
      say(COPY.unconfirmed);
      return;
    }
    if (answer.status === 422) {
      showFieldErrors(answer.body.errors ?? {});
      return;
    }
    say(answer.status === 429
      ? `You have sent several briefs in a short time. Try again in ${waitCopy(answer.retryAfter ?? answer.body.retry_after_seconds ?? 60)}.`
      : answer.status === 413 ? COPY.tooLarge
      : answer.status === 415 ? COPY.unsupported
      : answer.status === 503 ? COPY.storage
      : COPY.failed);
  });
}
