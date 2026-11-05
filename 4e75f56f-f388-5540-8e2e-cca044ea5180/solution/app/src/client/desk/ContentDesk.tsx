import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { call } from "../api.js";
import { ErrorSummary, Live, Page } from "../ui/kit.js";
import { StaffSignIn, useStaff } from "../ui/StaffSignIn.js";
import { SeatsRegion } from "./Seats.js";
import { HANDS_ON_ERROR, handsOnPercent, handsOnShareHolds, handsOnTotals, type AgendaSession } from "../../shared/handsOn.js";

type Kind = "sessions" | "hospitality" | "hotels" | "faq";
type Item = Record<string, string | number> & { id: string };
type FieldSpec = {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "radio" | "textarea";
  options?: { value: string; label: string }[];
};

type Spec = { kind: Kind; tab: string; list: string; item: (item: Item) => string; add: string; fields: FieldSpec[] };

const choices = (...values: string[]) => values.map((value) => ({ value, label: value }));

const KINDS: readonly [Spec, ...Spec[]] = [
  {
    kind: "sessions",
    tab: "Agenda",
    list: "Sessions",
    item: (item) => `Session ${item.number}: ${item.title}`,
    add: "New session",
    fields: [
      { name: "number", label: "Number", type: "number" },
      { name: "day", label: "Day", type: "number" },
      {
        name: "format",
        label: "Format",
        type: "radio",
        options: [
          { value: "lecture", label: "Lecture" },
          { value: "hands-on", label: "Hands-on" },
        ],
      },
      { name: "minutes", label: "Minutes", type: "number" },
      { name: "title", label: "Title", type: "text" },
      { name: "outcomes", label: "Outcomes", type: "textarea" },
    ],
  },
  {
    kind: "hospitality",
    tab: "Evenings",
    list: "Evenings",
    item: (item) => `Day ${item.day} · ${item.starts_at} · ${item.title}`,
    add: "New evening",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "day", label: "Day", type: "select", options: choices("1", "2") },
      { name: "starts_at", label: "Starts at (HH:MM)", type: "text" },
      { name: "venue", label: "Venue", type: "text" },
      { name: "tier", label: "Tier", type: "select", options: choices("all", "atelier") },
      { name: "description", label: "Description", type: "textarea" },
    ],
  },
  {
    kind: "hotels",
    tab: "Hotels",
    list: "Hotels",
    item: (item) => String(item.name),
    add: "New hotel",
    fields: [
      { name: "name", label: "Name", type: "text" },
      { name: "distance", label: "Distance", type: "text" },
      { name: "rate", label: "Rate", type: "text" },
      { name: "map_url", label: "Map link (https)", type: "text" },
    ],
  },
  {
    kind: "faq",
    tab: "FAQ",
    list: "Questions",
    item: (item) => `${item.sort} · ${item.question}`,
    add: "New question",
    fields: [
      { name: "question", label: "Question", type: "text" },
      { name: "answer", label: "Answer", type: "textarea" },
      { name: "sort", label: "Sort", type: "number" },
    ],
  },
];

const NUMERIC = new Set(["number", "day", "minutes", "sort"]);

function toBody(fields: FieldSpec[], draft: Record<string, string>): Record<string, string | number> {
  const body: Record<string, string | number> = {};
  for (const field of fields) {
    const raw = draft[field.name] ?? "";
    body[field.name] = NUMERIC.has(field.name) && /^-?\d+$/.test(raw.trim()) ? Number.parseInt(raw, 10) : raw;
  }
  return body;
}

/** Minutes as typed: an empty or non-numeric field counts as 0. */
function typedMinutes(raw: string): number {
  return /^\d+$/.test(raw.trim()) ? Number.parseInt(raw, 10) : 0;
}

/**
 * The agenda as it would be if the form were saved now: the edited session counts once with the
 * form's minutes and format, a new session is added, and a session awaiting delete is left out.
 */
function projectedAgenda(items: readonly Item[], selected: string | null, draft: Record<string, string>, deleting: boolean): AgendaSession[] {
  const typed = { format: draft.format ?? "", minutes: typedMinutes(draft.minutes ?? "") };
  const others = items.filter((item) => item.id !== selected).map((item) => ({ format: String(item.format), minutes: Number(item.minutes) }));
  if (deleting) return others;
  return [...others, typed];
}

function Editor({ spec, say }: { spec: Spec; say: (text: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);
  const [offline, setOffline] = useState(false);
  const agenda = spec.kind === "sessions";
  const load = async () => {
    const reply = await call<{ items: Item[] }>("GET", `/api/desk/content/${spec.kind}`);
    setOffline(!reply.ok);
    if (reply.ok) {
      setItems(
        agenda ? [...reply.data.items].sort((a, b) => Number(a.day) - Number(b.day) || Number(a.number) - Number(b.number)) : reply.data.items,
      );
    }
  };
  useLayoutEffect(() => {
    void load();
  }, [spec.kind]);
  const pick = (item: Item | null) => {
    setSelected(item?.id ?? null);
    setErrors({});
    setDeleting(false);
    setDraft(Object.fromEntries(spec.fields.map((f) => [f.name, item ? String(item[f.name] ?? "") : ""])));
  };
  const projected = agenda && items ? projectedAgenda(items, selected, draft, deleting) : null;
  const share = projected && handsOnTotals(projected);
  const shareBroken = projected !== null && !handsOnShareHolds(projected);
  const shown = shareBroken ? { ...errors, minutes: HANDS_ON_ERROR } : errors;
  const save = async () => {
    const body = toBody(spec.fields, draft);
    const reply = selected
      ? await call<{ item: Item }>("PATCH", `/api/desk/content/${spec.kind}/${selected}`, body)
      : await call<{ item: Item }>("POST", `/api/desk/content/${spec.kind}`, body);
    if (reply.ok) {
      setErrors({});
      setSelected(reply.data.item.id);
      say("Saved. The public site shows it on the next load.");
      await load();
    } else if (reply.error.errors) {
      setErrors(reply.error.errors);
      say(reply.error.errors.minutes ?? "Some fields need attention.");
    } else say(reply.error.message);
  };
  const remove = async () => {
    if (!selected) return;
    const reply = await call("DELETE", `/api/desk/content/${spec.kind}/${selected}`);
    if (reply.ok) {
      say("Deleted. The public site shows it on the next load.");
      pick(null);
      await load();
    } else if (reply.error.errors) {
      setErrors(reply.error.errors);
      say(reply.error.errors.minutes ?? reply.error.message);
    } else say(reply.error.message);
  };
  const ids = Object.fromEntries(spec.fields.map((f) => [f.name, `content-${f.name}`]));
  // until the list arrives, hold the space: the list, share and form then paint together and nothing shifts
  if (items === null && !offline) return <div class="editor editor--loading" aria-busy="true" />;
  return (
    <div class="editor">
      <div class="editor__list">
        {offline && <p class="slow">The programme is loading slowly. Refresh in a moment.</p>}
        <ul aria-label={spec.list}>
          {items?.map((item) => (
            <li key={item.id}>
              <button type="button" class={`editor__item ${item.id === selected ? "is-selected" : ""}`} aria-pressed={item.id === selected} onClick={() => pick(item)}>
                {spec.item(item)}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" class="button button--quiet" onClick={() => pick(null)}>
          {spec.add}
        </button>
      </div>
      <div class="editor__side">
        {share && (
          <p class={`share ${shareBroken ? "share--low" : ""}`} role="status" aria-label="Hands-on share">
            Hands-on <span class="num">{share.h}</span> of <span class="num">{share.t}</span> minutes (<span class="num">{handsOnPercent(share.h, share.t)}%</span>)
          </p>
        )}
        <form
          class="form editor__form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2 class="card__title">{selected ? "Edit" : "New"}</h2>
          <ErrorSummary errors={errors} ids={ids} />
          {spec.fields.map((field) => {
            const id = `content-${field.name}`;
            const value = draft[field.name] ?? "";
            const set = (v: string) => {
              setDraft((current) => ({ ...current, [field.name]: v }));
              if (errors[field.name]) setErrors(({ [field.name]: _cleared, ...rest }) => rest);
            };
            const error = shown[field.name];
            const described = error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};
            if (field.type === "radio") {
              return (
                <fieldset class={`choice ${error ? "field--error" : ""}`} key={field.name} role="radiogroup" aria-label={field.label} {...described}>
                  <legend>{field.label}</legend>
                  {field.options?.map((option) => (
                    // A pointer press picks the format without taking focus, so typing in Minutes carries on.
                    <label class="choice__option" key={option.value} onMouseDown={(event) => event.preventDefault()}>
                      <input type="radio" name={id} value={option.value} checked={value === option.value} onChange={() => set(option.value)} />
                      {option.label}
                    </label>
                  ))}
                  {error && (
                    <p class="field__error" id={`${id}-error`}>
                      {error}
                    </p>
                  )}
                </fieldset>
              );
            }
            return (
              <div class={`field ${error ? "field--error" : ""}`} key={field.name}>
                <label for={id}>{field.label}</label>
                {field.type === "textarea" ? (
                  <textarea id={id} rows={3} value={value} {...described} onInput={(e) => set((e.target as HTMLTextAreaElement).value)} />
                ) : field.type === "select" ? (
                  <select id={id} value={value} {...described} onChange={(e) => set((e.target as HTMLSelectElement).value)}>
                    <option value="">Choose…</option>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    type="text"
                    class={field.type === "number" ? "num" : undefined}
                    inputMode={field.type === "number" ? "numeric" : undefined}
                    value={value}
                    {...described}
                    onInput={(e) => set((e.target as HTMLInputElement).value)}
                  />
                )}
                {error && (
                  <p class="field__error" id={`${id}-error`}>
                    {error}
                  </p>
                )}
              </div>
            );
          })}
          <div class="form__actions">
            <button type="submit" class="button button--primary">
              Save
            </button>
            {agenda && deleting ? (
              <>
                <button type="button" class="button button--danger" onClick={() => void remove()}>
                  Confirm delete
                </button>
                <button
                  type="button"
                  class="button button--quiet"
                  onClick={() => {
                    setDeleting(false);
                    setErrors({});
                  }}
                >
                  Keep session
                </button>
              </>
            ) : (
              <button
                type="button"
                class="button button--quiet button--danger"
                disabled={!selected}
                onClick={() => (agenda ? setDeleting(true) : void remove())}
              >
                Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export function ContentDesk() {
  const { me, refresh } = useStaff("director");
  const [tab, setTab] = useState<Kind>("sessions");
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const tabs = useRef(new Map<Kind, HTMLButtonElement>());
  if (me === undefined) return <Page title="Content desk">{null}</Page>;
  if (me === null) {
    return (
      <Page title="Content desk">
        <h1 class="page-title">Content desk</h1>
        <StaffSignIn heading="Event director sign-in" onSignedIn={refresh} />
      </Page>
    );
  }
  const select = (kind: Kind) => {
    setTab(kind);
    tabs.current.get(kind)?.focus();
  };
  const spec = KINDS.find((k) => k.kind === tab) ?? KINDS[0];
  return (
    <Page title="Content desk" wide>
      <div class="desk">
        <div class="desk__main">
          <h1 class="page-title">Content desk</h1>
          <p class="muted">Changes save to the programme and show on the public site on the next load.</p>
          <div class="content-tabs" role="tablist" aria-label="Content">
            {KINDS.map((k, index) => (
              <button
                key={k.kind}
                type="button"
                role="tab"
                id={`content-tab-${k.kind}`}
                aria-selected={tab === k.kind}
                aria-controls="content-panel"
                tabIndex={tab === k.kind ? 0 : -1}
                ref={(el) => {
                  if (el) tabs.current.set(k.kind, el);
                }}
                onClick={() => select(k.kind)}
                onKeyDown={(event) => {
                  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                  if (!step) return;
                  event.preventDefault();
                  select((KINDS[(index + step + KINDS.length) % KINDS.length] ?? KINDS[0]).kind);
                }}
              >
                {k.tab}
              </button>
            ))}
          </div>
          <Live label="Desk updates" message={message} />
          {message && <p class="echo">{message}</p>}
          <div role="tabpanel" id="content-panel" aria-labelledby={`content-tab-${tab}`}>
            <Editor
              key={tab}
              spec={spec}
              say={(text) => {
                setMessage(text);
                setTick((n) => n + 1);
              }}
            />
          </div>
        </div>
        <aside class="desk__side">
          <SeatsRegion refresh={tick} />
        </aside>
      </div>
    </Page>
  );
}
