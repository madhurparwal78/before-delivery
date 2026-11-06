// The Run screen: catalogue rail, credit meter, schema-generated run form, queue lanes and lineage strip.

import { useEffect, useRef, useState } from "preact/hooks";
import { amountFor, formatCredits, formatRate } from "../shared/money";
import { fieldKind, validateInput, type SchemaProperty } from "../shared/schema";
import { UNIT_RULES, unitsPhrase } from "../shared/units";
import {
  ApiError, get, query, refreshAll, request, serverNow,
  type Asset, type Job, type MeterSnapshot, type Model,
} from "./api";
import { Dialog } from "./dialog";
import { day, usePoll, useSecondTick } from "./hooks";
import { Icon } from "./icons";
import { JobDialog, canCancel, cancelJob } from "./jobs";
import { LineageStrip } from "./lineage";
import { CreditMeter } from "./meter";
import { modelNameOf, teamNameOf, useSession, type Session } from "./session";
import { Alert, Figures } from "./ui";

export interface RunState {
  model: string;
  /** Focus the form's first field once it is built (the user chose a model). */
  focus: boolean;
  /** An `asset:<id>` reference for the model's first media field ("Use as input"). */
  prefill: string | null;
  /** Bumped on every choice so the form rebuilds even for the same model. */
  version: number;
}

const MODALITIES: { key: Model["modality"]; heading: string }[] = [
  { key: "image", heading: "Image" },
  { key: "video", heading: "Video" },
  { key: "audio", heading: "Audio" },
];

const blockedHere = (model: Model): boolean => model.access?.playground === "blocked";

const firstFieldId = (model: Model): string => `field-${model.slug}-${Object.keys(model.input_schema.properties)[0]}`;

function Rail({ current, onChoose }: { current: string; onChoose: (slug: string) => void }) {
  const { models } = useSession();
  return (
    <nav class="rail" aria-label="Catalogue">
      {MODALITIES.map(({ key, heading }) => (
        <div key={key} class="rail__group">
          <h3 class="rail__heading">{heading}</h3>
          <ul class="rail__list">
            {models.filter((m) => m.modality === key).map((model) => {
              const blocked = blockedHere(model);
              return (
                <li key={model.slug} class={`rail__item${blocked ? " is-blocked" : ""}`}>
                  <button type="button" class="rail__model" aria-label={model.name}
                    aria-describedby={blocked ? `rail-rate-${model.slug} rail-blocked-${model.slug}` : `rail-rate-${model.slug}`}
                    aria-pressed={model.slug === current ? "true" : "false"} aria-disabled={blocked ? "true" : undefined}
                    onClick={() => {
                      if (!blocked) onChoose(model.slug);
                    }} />
                  <span class="rail__name" aria-hidden="true">{model.name}</span>
                  <span class="rail__meta" id={`rail-rate-${model.slug}`} aria-hidden="true">
                    <span class="num">{formatRate(BigInt(model.current_rate.micro_per_unit))}</span>
                    <span>credits per {model.unit_label.replace(/s$/, "")}</span>
                  </span>
                  {blocked && <span class="rail__blocked" id={`rail-blocked-${model.slug}`} aria-hidden="true">Blocked for playground</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Field values as the schema types them: whole numbers for integer fields, empty fields left out. */
function typedInput(model: Model, values: Record<string, string>): Record<string, string | number> {
  const input: Record<string, string | number> = {};
  for (const [name, property] of Object.entries(model.input_schema.properties)) {
    const raw = values[name] ?? "";
    if (raw.trim() === "") continue;
    input[name] = property.type === "integer" && /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  }
  return input;
}

function estimateCopy(model: Model, values: Record<string, string>): string | null {
  const { input } = validateInput(model.input_schema, typedInput(model, values));
  try {
    const rule = UNIT_RULES[model.slug];
    const units = rule.estimate(input);
    const amount = amountFor(units, BigInt(model.current_rate.micro_per_unit));
    return `Estimated ${formatCredits(amount)} credits for ${unitsPhrase(units, rule.unit)}`;
  } catch {
    return null;
  }
}

async function refusalCopy(error: ApiError, model: Model, session: Session): Promise<string> {
  const team = teamNameOf(session, session.teamId);
  const body = error.body;
  switch (body.code) {
    case "insufficient_credits":
      return `Not enough credits: this run needs ${formatCredits(BigInt(Number(body.required_micro)))} and ${formatCredits(BigInt(Number(body.available_micro)))} are available.`;
    case "budget_hard_cap": {
      const meter = await get<MeterSnapshot>(`/api/teams/${session.teamId}/meter`).catch(() => null);
      const label = meter?.period.label ?? "";
      return `${team} reached its hard cap for ${label}. New jobs are throttled until ${day(String(body.period_ends_at))}.`;
    }
    case "model_blocked":
      return `${model.name} is blocked for playground runs in ${team}.`;
    case "storage_unavailable":
      return "Storage is unreachable, so the image could not be saved. Nothing was reserved.";
    default:
      return error.message;
  }
}

function MediaField({ id, title, value, onValue, describedBy, invalid, onError, notify }: {
  id: string;
  title: string;
  value: string;
  onValue: (value: string) => void;
  describedBy: string;
  invalid: boolean;
  onError: (text: string | null) => void;
  notify: (text: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    notify("Uploading…");
    onError(null);
    try {
      const { data } = await request<{ asset: Asset }>("POST", "/api/uploads", {
        raw: file, headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
      });
      onValue(`asset:${data.asset.id}`);
      notify(`Uploaded ${file.name}.`);
    } catch (error) {
      notify("");
      const status = error instanceof ApiError ? error.status : 0;
      onError(status === 413 ? "That file is larger than the upload limit."
        : status === 415 ? "Use a PNG, JPEG or WebP image."
          : status === 503 ? "Storage is unreachable. Try the upload again when it returns."
            : error instanceof ApiError ? error.message : "The upload did not reach Dispatch. Try again.");
    }
  };
  return (
    <div class="media-field">
      <input id={id} name={id} type="text" class="input" value={value} placeholder="https://… or asset:a_1"
        aria-describedby={describedBy} aria-invalid={invalid ? "true" : undefined}
        onInput={(e) => onValue(e.currentTarget.value)} />
      <div class="media-field__actions">
        <button type="button" class="btn btn--secondary" aria-label={`Upload image for ${title}`}
          onClick={() => picker.current?.click()}>
          <Icon name="upload" size={18} /><span>Upload</span>
        </button>
        <button type="button" class="btn btn--quiet" aria-label={`Clear ${title}`} onClick={() => onValue("")}>Clear</button>
      </div>
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" hidden tabIndex={-1}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void upload(file);
        }} />
    </div>
  );
}

function RunForm({ model, run }: { model: Model; run: RunState }) {
  const session = useSession();
  const properties = Object.entries(model.input_schema.properties);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {};
    let filled = false;
    for (const [name, property] of properties) {
      start[name] = property.default === undefined ? "" : String(property.default);
      if (!filled && run.prefill && fieldKind(property) === "media") {
        start[name] = run.prefill;
        filled = true;
      }
    }
    return start;
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (run.focus) document.getElementById(firstFieldId(model))?.focus();
  }, [run.version]);

  const setValue = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  const fieldId = (name: string) => `field-${model.slug}-${name}`;

  const focusFirst = (errors: Record<string, string>) => {
    const first = properties.find(([name]) => errors[name]);
    if (first) document.getElementById(fieldId(first[0]))?.focus();
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    const input = typedInput(model, values);
    const { errors } = validateInput(model.input_schema, input);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setAlert("Fix the highlighted fields.");
      focusFirst(errors);
      return;
    }
    setFieldErrors({});
    setAlert(null);
    setBusy(true);
    session.notify("Submitting…");
    const key = crypto.randomUUID();
    const send = () => request<{ job: Job }>("POST", "/api/jobs", {
      body: { model: model.slug, input }, headers: { "Idempotency-Key": key },
    });
    try {
      let reply;
      try {
        reply = await send();
      } catch (error) {
        if (error instanceof ApiError) throw error;
        reply = await send();
      }
      const job = reply.data.job;
      session.notify(reply.headers.get("Idempotent-Replayed") === "true"
        ? `Job ${job.id} was already submitted; nothing new was reserved.`
        : `Job ${job.id} queued — ${formatCredits(BigInt(job.reserved_micro))} credits reserved.`);
      refreshAll();
    } catch (error) {
      session.notify("");
      if (error instanceof ApiError && error.body.code === "validation_failed") {
        const fields: Record<string, string> = {};
        const other: string[] = [];
        for (const [path, message] of Object.entries(error.body.fields ?? {})) {
          if (path.startsWith("input.")) fields[path.slice("input.".length)] = message;
          else other.push(message);
        }
        setFieldErrors(fields);
        setAlert(["Fix the highlighted fields.", ...other].join(" "));
        focusFirst(fields);
      } else if (error instanceof ApiError) {
        setAlert(await refusalCopy(error, model, session));
      } else {
        setAlert("The run could not reach Dispatch. Check the connection and press Run again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const estimate = estimateCopy(model, values);
  return (
    <form ref={form} class="panel run-form" aria-label={`Run ${model.name}`} onSubmit={submit} noValidate>
      <header class="panel__head">
        <h2 class="panel__title">{model.name}</h2>
        <span class="panel__meta"><span class="num">{formatRate(BigInt(model.current_rate.micro_per_unit))}</span> credits per {model.unit_label.replace(/s$/, "")}</span>
      </header>
      <div class="run-form__fields">
        {properties.map(([name, property]) => (
          <Field key={name} id={fieldId(name)} name={name} property={property}
            required={model.input_schema.required.includes(name)} value={values[name] ?? ""}
            error={fieldErrors[name]} onValue={(v) => setValue(name, v)}
            onMediaError={(text) => setFieldErrors((f) => {
              const next = { ...f };
              if (text) next[name] = text;
              else delete next[name];
              return next;
            })} notify={session.notify} />
        ))}
      </div>
      <Alert text={alert} />
      <div class="run-form__submit">
        <button type="submit" class="btn btn--primary" disabled={busy}>{busy ? "Submitting…" : "Run"}</button>
        {estimate && <p class="estimate"><Figures text={estimate} /></p>}
      </div>
    </form>
  );
}

function Field({ id, name, property, required, value, error, onValue, onMediaError, notify }: {
  id: string;
  name: string;
  property: SchemaProperty;
  required: boolean;
  value: string;
  error: string | undefined;
  onValue: (value: string) => void;
  onMediaError: (text: string | null) => void;
  notify: (text: string) => void;
}) {
  const kind = fieldKind(property);
  const help = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = error ? `${errorId} ${help}` : help;
  const common = { id, name, "aria-describedby": describedBy, "aria-invalid": error ? ("true" as const) : undefined };
  let control;
  if (kind === "textarea") {
    control = <textarea {...common} class="input input--area" rows={3} value={value} onInput={(e) => onValue(e.currentTarget.value)} />;
  } else if (kind === "select") {
    control = (
      <select {...common} value={value} onChange={(e) => onValue(e.currentTarget.value)}>
        {(property.enum ?? []).map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
      </select>
    );
  } else if (kind === "number" && property.type === "integer") {
    control = <input {...common} type="number" class="input num" inputMode="numeric" step={1} min={property.minimum}
      max={property.maximum} value={value} onInput={(e) => onValue(e.currentTarget.value)} />;
  } else if (kind === "media") {
    control = <MediaField id={id} title={property.title} value={value} onValue={onValue} describedBy={describedBy}
      invalid={Boolean(error)} onError={onMediaError} notify={notify} />;
  } else {
    control = <input {...common} type="text" class="input" value={value} onInput={(e) => onValue(e.currentTarget.value)} />;
  }
  return (
    <div class={`field${error ? " field--invalid" : ""}${kind === "textarea" || kind === "media" ? " field--wide" : ""}`}
      data-field={name}>
      <div class="field__label-row">
        <label for={id}>{property.title}</label>
        {required && <span class="field__required">Required</span>}
      </div>
      {control}
      {error && <p id={errorId} class="field__error">{error}</p>}
      <p id={help} class="field__help">{property.description && <Figures text={property.description} />}</p>
    </div>
  );
}

interface Lane {
  model: string;
  queued: Job[];
  running: Job[];
}

function Queue({ teamId }: { teamId: string }) {
  const session = useSession();
  const [lanes, setLanes] = useState<Lane[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  useSecondTick();
  usePoll(async () => {
    const { lanes: fresh } = await get<{ lanes: Lane[] }>(`/api/queue${query({ team: teamId })}`);
    setLanes(fresh);
  }, 1000, [teamId]);

  const elapsed = (job: Job) =>
    Math.max(0, Math.floor((serverNow() - Date.parse(job.started_at ?? job.submitted_at)) / 1000));

  return (
    <section class="panel queue" role="region" aria-label="Queue">
      <header class="panel__head"><h2 class="panel__title">Queue</h2></header>
      <Alert text={alert} />
      <div class="lanes">
        {session.models.map((model) => {
          const lane = lanes?.find((l) => l.model === model.slug);
          const jobs = lane ? [...lane.running, ...lane.queued] : [];
          return (
            <div key={model.slug} class="lane">
              <h3 class="lane__title">{model.name}</h3>
              <ul class="lane__list" aria-label={`${model.name} lane`}>
                {jobs.length === 0 && <li class="lane__empty">{lanes ? "No jobs in this lane." : "Loading…"}</li>}
                {jobs.map((job) => (
                  <li key={job.id} class={`lane__item lane__item--${job.status}`}>
                    <button type="button" class="lane__open" aria-label={`Open job ${job.id}`} onClick={() => setOpen(job.id)}>
                      <span class="num">{job.status === "queued"
                        ? `${job.id} · queued #${job.queue_position ?? "—"}`
                        : `${job.id} · ${job.status} · ${elapsed(job)}s`}</span>
                      {job.waiting_reason && <span class="lane__waiting">Waiting for storage</span>}
                    </button>
                    {canCancel(session.me, job) && (
                      <button type="button" class="btn btn--quiet lane__cancel" aria-label={`Cancel job ${job.id}`}
                        onClick={async () => setAlert(await cancelJob(job.id, session.notify))}>
                        <Icon name="close" size={18} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <JobDialog jobId={open} onClose={() => setOpen(null)} />
    </section>
  );
}

export function RunScreen({ run, choose, catalogueOpen, closeCatalogue, wide }: {
  run: RunState;
  choose: (slug: string) => void;
  catalogueOpen: boolean;
  closeCatalogue: () => void;
  wide: boolean;
}) {
  const session = useSession();
  const teamId = session.teamId;
  const [openJob, setOpenJob] = useState<string | null>(null);
  const chosen = useRef(false);
  const model = session.models.find((m) => m.slug === run.model) ?? session.models[0];
  if (!model) return <p class="muted">Loading the catalogue…</p>;

  const fromDialog = (slug: string) => {
    chosen.current = true;
    choose(slug);
    closeCatalogue();
  };

  return (
    <div class="run">
      {wide && <aside class="run__rail"><Rail current={model.slug} onChoose={choose} /></aside>}
      <div class="run__main">
        <CreditMeter teamId={teamId} teamName={teamNameOf(session, teamId)} onOpenJob={setOpenJob} />
        <div class="run__grid">
          <RunForm key={`${model.slug}:${run.version}`} model={model} run={run} />
          <Queue teamId={teamId} />
        </div>
        <LineageStrip teamId={teamId} modelName={(slug) => modelNameOf(session, slug)} />
      </div>
      {!wide && (
        <Dialog open={catalogueOpen} title="Catalogue" onClose={() => {
          chosen.current = false;
          closeCatalogue();
        }} returnFocusTo={() => {
          const target = chosen.current ? document.getElementById(firstFieldId(model)) : null;
          chosen.current = false;
          return target;
        }}>
          <Rail current={model.slug} onChoose={fromDialog} />
        </Dialog>
      )}
      <JobDialog jobId={openJob} onClose={() => setOpenJob(null)} />
    </div>
  );
}
