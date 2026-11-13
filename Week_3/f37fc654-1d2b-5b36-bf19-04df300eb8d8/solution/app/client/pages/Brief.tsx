// `/brief/new?step=1` and `/briefs/<brief id>?step=<n>` — the Cue-line Brief: one typed question per
// screen, answers saved on the server step by step, each saved answer reshaping the venue stage.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { ADD_ONS, AUDIENCES, DOOR_WALLS, DUST_BEFORE_ANSWER, INSTALLATIONS, VENUES, type AddOn, type Audience, type DoorWall, type InstallationType, type Venue } from "../../shared/catalog";
import { CueLine } from "../components/CueLine";
import { Icon } from "../components/icons";
import { AppLink } from "../components/Shell";
import { HttpError, call, signInHref } from "../lib/api";
import { clock, useReducedMotion } from "../lib/motion";
import { currentRoute, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import { store } from "../lib/store";
import { stage } from "../stage/state";
import { Missing, failureText, useScene } from "./common";

const INTRO = "Hi. Six questions, then your room.";
const QUESTIONS: Record<number, string> = {
  1: "What should stand in the room?",
  2: "Where will it stand?",
  3: "How big is the room?",
  4: "Which wall has the main door?",
  5: "How many people at once?",
  6: "Anything else to try?",
};
const PENDING_NEW = "spindrift.brief.pending-new";
const PENDING_STEP = "spindrift.brief.pending-step";

type Answer = Record<string, unknown>;
interface BriefData {
  id: string;
  answers: Record<string, Answer>;
  answeredThrough: number;
  nextStep: number | null;
  commissionId: string | null;
}

/** "Brief progress" survives the move from /brief/new to the draft's own address. */
const progress = store<{ text: string }>({ text: "" });
let replaying = false;

function applyToStage(answers: Record<string, Answer>): void {
  const room = answers["3"];
  const audience = answers["5"]?.audience as Audience | undefined;
  stage.set({
    silhouette: (answers["1"]?.installationType as InstallationType | undefined) ?? "none",
    roomW: typeof room?.widthM === "number" ? room.widthM : null,
    roomD: typeof room?.depthM === "number" ? room.depthM : null,
    dust: audience ? AUDIENCES[audience].dust : DUST_BEFORE_ANSWER,
  });
}

interface Form {
  installationType: InstallationType | "";
  title: string;
  venue: Venue | null;
  query: string;
  widthM: string;
  depthM: string;
  doorWall: DoorWall | "";
  audience: Audience | "";
  addOns: AddOn[];
  notes: string;
}

const EMPTY: Form = { installationType: "", title: "", venue: null, query: "", widthM: "", depthM: "", doorWall: "", audience: "", addOns: [], notes: "" };

function fromAnswers(answers: Record<string, Answer>, venue: Venue | null): Form {
  const a = (n: number): Answer => answers[String(n)] ?? {};
  return {
    installationType: (a(1).installationType as InstallationType) ?? "",
    title: String(a(1).title ?? ""),
    venue,
    query: venue?.name ?? "",
    widthM: a(3).widthM === undefined ? "" : String(a(3).widthM),
    depthM: a(3).depthM === undefined ? "" : String(a(3).depthM),
    doorWall: (a(4).doorWall as DoorWall) ?? "",
    audience: (a(5).audience as Audience) ?? "",
    addOns: (a(6).addOns as AddOn[]) ?? [],
    notes: String(a(6).notes ?? ""),
  };
}

const metres = (text: string): number | string => (/^\s*\d+(\.\d+)?\s*$/.test(text) ? Number(text) : text);

function answerFor(step: number, f: Form): Answer {
  switch (step) {
    case 1: return { installationType: f.installationType, title: f.title };
    case 2: return { venueId: f.venue?.id ?? "" };
    case 3: return { widthM: metres(f.widthM), depthM: metres(f.depthM) };
    case 4: return { doorWall: f.doorWall };
    case 5: return { audience: f.audience };
    default: return { addOns: f.addOns, notes: f.notes };
  }
}

function answered(step: number, f: Form): boolean {
  switch (step) {
    case 1: return Boolean(f.installationType && f.title.trim());
    case 2: return Boolean(f.venue);
    case 3: return Boolean(f.widthM.trim() && f.depthM.trim());
    case 4: return Boolean(f.doorWall);
    case 5: return Boolean(f.audience);
    default: return true;
  }
}

const saveStep = (id: string, n: number, answer: Answer): Promise<BriefData> =>
  call<BriefData>(`/api/briefs/${id}/steps/${n}`, { method: "PUT", json: { answer } });

const FIELD_IDS: Record<string, string> = {
  installationType: "chip-0", title: "field-title", venueId: "field-venue", widthM: "field-width", depthM: "field-depth",
  doorWall: "chip-0", audience: "chip-0", addOns: "chip-0", notes: "field-notes",
};

export function Brief({ briefId }: { briefId: string | null }) {
  useScene("brief");
  const { search } = useLocation();
  const session = useSession();
  const reduced = useReducedMotion();
  const requested = Number(new URLSearchParams(search).get("step"));
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"intro" | "leaving" | "question">(briefId ? "question" : "intro");
  const [readyKey, setReadyKey] = useState("");
  const [suggestions, setSuggestions] = useState<Venue[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const status = progress.use();
  const formRef = useRef<HTMLFormElement>(null);
  const searchSeq = useRef(0);
  const latestQuery = useRef("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const maxStep = brief ? brief.nextStep ?? 6 : 1;
  const step = briefId ? requested : 1;
  const validStep = Number.isInteger(step) && step >= 1 && step <= maxStep;
  const viewKey = `${phase}-${step}`;
  const ready = readyKey === viewKey;

  // Addresses: /brief/new is always step 1; a draft's address names a step from 1 to its nextStep.
  useEffect(() => {
    if (!briefId && search !== "?step=1") navigate("/brief/new?step=1", { replace: true });
  }, [briefId, search]);

  useEffect(() => {
    if (!briefId) return;
    call<BriefData>(`/api/briefs/${briefId}`).then((data) => {
      if (data.commissionId) {
        navigate(`/c/${data.commissionId}`, { replace: true });
        return;
      }
      const venue = VENUES.find((v) => v.id === data.answers["2"]?.venueId) ?? null;
      setBrief(data);
      setForm(fromAnswers(data.answers, venue));
      applyToStage(data.answers);
    }, (error: unknown) => {
      if (error instanceof HttpError && error.status === 401 && error.code === "unauthenticated") location.assign(signInHref(currentRoute()));
      else if (error instanceof HttpError && error.status === 404) setMissing(true);
    });
  }, [briefId]);

  useEffect(() => {
    if (briefId && brief && !validStep) navigate(`/briefs/${briefId}?step=${brief.nextStep ?? 6}`, { replace: true });
  }, [briefId, brief, validStep]);

  useEffect(() => {
    if (!briefId) applyToStage({});
  }, [briefId]);

  const leave = useCallback(() => navigate(session.status === "in" ? "/commissions" : "/"), [session.status]);

  const saved = useCallback((data: BriefData, n: number) => {
    setBrief(data);
    applyToStage(data.answers);
    setErrors({});
    progress.set({ text: `Answer saved. Question ${n + 1} of 6.` });
    navigate(`/briefs/${data.id}?step=${n + 1}`);
  }, []);

  const save = useCallback(async (n: number, answer: Answer) => {
    setBusy(true);
    try {
      if (!briefId) {
        if (session.status !== "in") {
          sessionStorage.setItem(PENDING_NEW, JSON.stringify(answer));
          location.assign(signInHref("/brief/new?step=1"));
          return;
        }
        const created = await call<BriefData>("/api/briefs", { json: {} });
        saved(await saveStep(created.id, n, answer), n);
        return;
      }
      const data = await saveStep(briefId, n, answer);
      if (n < 6) {
        saved(data, n);
        return;
      }
      applyToStage(data.answers);
      const commission = await call<{ id: string }>(`/api/briefs/${briefId}/complete`, { method: "POST" });
      progress.set({ text: "Brief complete. Your room is ready." });
      navigate(`/c/${commission.id}`, { state: { roomReady: true } });
    } catch (error) {
      if (error instanceof HttpError && error.code === "signed_out") {
        if (briefId) sessionStorage.setItem(PENDING_STEP, JSON.stringify({ route: currentRoute(), step: n, answer }));
        else sessionStorage.setItem(PENDING_NEW, JSON.stringify(answer));
      } else if (error instanceof HttpError && error.status === 422) {
        setErrors(error.errors);
        progress.set({ text: Object.values(error.errors)[0] ?? "" });
      } else {
        progress.set({ text: failureText(error) });
      }
    } finally {
      setBusy(false);
    }
  }, [briefId, session.status, saved]);

  // After signing in, the answer kept in the browser is saved once at the interrupted step.
  useEffect(() => {
    if (session.status !== "in" || replaying) return;
    const pendingNew = !briefId ? sessionStorage.getItem(PENDING_NEW) : null;
    const pendingStep = sessionStorage.getItem(PENDING_STEP);
    if (pendingNew) {
      replaying = true;
      sessionStorage.removeItem(PENDING_NEW);
      const answer = JSON.parse(pendingNew) as Answer;
      setForm((f) => ({ ...f, installationType: answer.installationType as InstallationType, title: String(answer.title ?? "") }));
      void save(1, answer).finally(() => {
        replaying = false;
      });
    } else if (pendingStep && briefId && brief) {
      const pending = JSON.parse(pendingStep) as { route: string; step: number; answer: Answer };
      if (pending.route !== currentRoute()) return;
      replaying = true;
      sessionStorage.removeItem(PENDING_STEP);
      void save(pending.step, pending.answer).finally(() => {
        replaying = false;
      });
    }
  }, [session.status, briefId, brief, save]);

  const submit = (event?: FormEvent): void => {
    event?.preventDefault();
    if (busy || !answered(step, form)) return;
    void save(step, answerFor(step, form));
  };

  // Escape anywhere leaves the brief (an open venue list closes first).
  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (listOpen) setListOpen(false);
      else leave();
    };
    addEventListener("keydown", onEscape);
    return () => removeEventListener("keydown", onEscape);
  }, [listOpen, leave]);

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    const target = event.target as HTMLElement;
    if (event.key !== "Enter" || target.tagName === "BUTTON") return;
    if (target.tagName === "TEXTAREA" && event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  const focusFirst = useCallback(() => {
    setReadyKey(viewKey);
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[data-first]")?.focus());
  }, [viewKey]);

  const onSettled = useCallback(() => {
    if (phase === "intro") {
      setTimeout(() => setPhase("leaving"), 800);
      setTimeout(() => setPhase("question"), 1100);
      return;
    }
    focusFirst();
  }, [phase, focusFirst]);

  // The controls rise into place one after another (60 ms apart, each 0.7 s), on the page clock.
  useLayoutEffect(() => {
    const items = Array.from(formRef.current?.querySelectorAll<HTMLElement>("[data-rise]") ?? []);
    if (!ready || reduced || !items.length) return undefined;
    const start = clock();
    let raf = 0;
    const tick = (): void => {
      const t = clock() - start;
      items.forEach((el, i) => {
        const p = Math.min(1, Math.max(0, (t - i * 0.06) / 0.7));
        const eased = 1 - (1 - p) ** 4;
        el.style.opacity = p >= 1 ? "" : String(eased);
        el.style.transform = p >= 1 ? "" : `translateY(${(12 * (1 - eased)).toFixed(2)}px)`;
      });
      if (t < (items.length - 1) * 0.06 + 0.7) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      items.forEach((el) => {
        el.style.opacity = "";
        el.style.transform = "";
      });
    };
  }, [ready, reduced, step]);

  const searchVenues = (text: string): void => {
    setForm((f) => ({ ...f, query: text, venue: null }));
    latestQuery.current = text;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const mine = ++searchSeq.current;
      void call<{ venues: Venue[] }>(`/api/venues?q=${encodeURIComponent(text)}`).then((r) => {
        if (mine !== searchSeq.current || text !== latestQuery.current) return;
        setSuggestions(r.venues);
        setListOpen(r.venues.length > 0);
        setActive(-1);
      }, () => undefined);
    }, 250);
  };

  const pick = (venue: Venue): void => {
    setForm((f) => ({ ...f, venue, query: venue.name }));
    setListOpen(false);
  };

  if (missing) return <Missing />;
  const heading = phase === "question" ? QUESTIONS[validStep ? step : 1] : INTRO;
  const chip = (type: "radio" | "checkbox", name: string, value: string, label: string, checked: boolean, onChange: () => void, index: number) => (
    <label key={value} className="chip" data-rise="">
      <input type={type} name={name} value={value} checked={checked} onChange={onChange} id={index === 0 ? "chip-0" : undefined} data-first={index === 0 ? "" : undefined} />
      <span className="chip-box"><Icon name="check" size={12} /></span>
      <span>{label}</span>
    </label>
  );
  const fieldError = (key: string) => (errors[key] ? <p className="field-error" id={`error-${key}`}>{errors[key]}</p> : null);
  const showControls = phase === "question" && validStep && (ready || reduced);
  const textHint = step === 2 || step === 3 || step === 6;

  return (
    <main className="brief">
      <AppLink href="/" className="wordmark brief-mark">Spindrift Rooms</AppLink>
      <button type="button" className="close-chip" aria-label="Close brief" onClick={leave}>CLOSE <Icon name="x" size={14} /></button>
      <div className="question-zone">
        <div className={phase === "leaving" ? "intro-out" : undefined}>
          <CueLine key={`${phase === "question" ? step : "intro"}`} text={heading} cursor className="question" onSettled={onSettled} />
        </div>
      </div>
      <div className="answer">
        <form ref={formRef} onSubmit={submit} onKeyDown={onKeyDown} noValidate className={showControls ? undefined : "pending"}>
          {Object.keys(errors).length > 0 && (
            <div role="region" aria-label="Problems" className="problems">
              <h2>Please check this answer</h2>
              <ul>{Object.entries(errors).map(([key, message]) => (
                <li key={key}>
                  <a href={`#${FIELD_IDS[key] ?? "chip-0"}`} onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(FIELD_IDS[key] ?? "chip-0")?.focus();
                  }}>{message}</a>
                </li>
              ))}</ul>
            </div>
          )}
          {step === 1 && (
            <>
              <div role="radiogroup" aria-label={QUESTIONS[1]} className="chips" style={{ "--chips": 3 } as CSSProperties}>
                {(Object.keys(INSTALLATIONS) as InstallationType[]).map((t, i) => chip("radio", "installationType", t, INSTALLATIONS[t].label, form.installationType === t, () => setForm({ ...form, installationType: t }), i))}
              </div>
              {fieldError("installationType")}
              <div className="field" data-rise="">
                <input id="field-title" className="input" aria-label="Name the piece" placeholder="Name the piece" value={form.title} maxLength={120}
                  aria-describedby={errors.title ? "error-title" : undefined} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                {fieldError("title")}
              </div>
            </>
          )}
          {step === 2 && (
            <div className="field combo" data-rise="">
              <input id="field-venue" data-first="" className="input" role="combobox" aria-label="Venue" aria-expanded={listOpen} aria-controls="venues-list"
                aria-autocomplete="list" aria-activedescendant={listOpen && active >= 0 ? `venue-${suggestions[active]?.id}` : undefined}
                placeholder="Start typing the venue or address" value={form.query} autoComplete="off"
                onChange={(e) => searchVenues(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    if (!suggestions.length) return;
                    setListOpen(true);
                    setActive((i) => (e.key === "ArrowDown" ? Math.min(suggestions.length - 1, i + 1) : Math.max(0, i - 1)));
                  } else if (e.key === "Enter" && listOpen && active >= 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    pick(suggestions[active]);
                  }
                }} />
              {listOpen && (
                <ul id="venues-list" role="listbox" aria-label="Venues">
                  {suggestions.map((v, i) => (
                    <li key={v.id} id={`venue-${v.id}`} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(v)}>
                      {v.name} <small>{v.address}, {v.city}</small>
                    </li>
                  ))}
                </ul>
              )}
              {fieldError("venueId")}
            </div>
          )}
          {step === 3 && (
            <div className="fields" data-rise="">
              <div className="field">
                <input id="field-width" data-first="" className="input" type="text" inputMode="decimal" aria-label="Width in metres" placeholder="Width in metres"
                  value={form.widthM} aria-describedby={errors.widthM ? "error-widthM" : undefined} onChange={(e) => setForm({ ...form, widthM: e.target.value })} />
                {fieldError("widthM")}
              </div>
              <div className="field">
                <input id="field-depth" className="input" type="text" inputMode="decimal" aria-label="Depth in metres" placeholder="Depth in metres"
                  value={form.depthM} aria-describedby={errors.depthM ? "error-depthM" : undefined} onChange={(e) => setForm({ ...form, depthM: e.target.value })} />
                {fieldError("depthM")}
              </div>
            </div>
          )}
          {step === 4 && (
            <>
              <div role="radiogroup" aria-label={QUESTIONS[4]} className="chips">
                {(Object.keys(DOOR_WALLS) as DoorWall[]).map((w, i) => chip("radio", "doorWall", w, DOOR_WALLS[w], form.doorWall === w, () => setForm({ ...form, doorWall: w }), i))}
              </div>
              {fieldError("doorWall")}
            </>
          )}
          {step === 5 && (
            <>
              <div role="radiogroup" aria-label={QUESTIONS[5]} className="chips">
                {(Object.keys(AUDIENCES) as Audience[]).map((a, i) => chip("radio", "audience", a, AUDIENCES[a].label, form.audience === a, () => setForm({ ...form, audience: a }), i))}
              </div>
              {fieldError("audience")}
            </>
          )}
          {step === 6 && (
            <>
              <div role="group" aria-label={QUESTIONS[6]} className="chips" style={{ "--chips": 3 } as CSSProperties}>
                {(Object.keys(ADD_ONS) as AddOn[]).map((a, i) => chip("checkbox", "addOns", a, ADD_ONS[a].label, form.addOns.includes(a),
                  () => setForm({ ...form, addOns: form.addOns.includes(a) ? form.addOns.filter((x) => x !== a) : [...form.addOns, a] }), i))}
              </div>
              {fieldError("addOns")}
              <div className="field" data-rise="">
                <textarea id="field-notes" className="input" aria-label="Notes for the studio" placeholder="Notes for the studio (optional)" rows={2}
                  value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                {fieldError("notes")}
              </div>
            </>
          )}
          <div className="ok-row" data-rise="">
            <button type="submit" className="button primary" disabled={!answered(step, form) || busy} aria-busy={busy || undefined}>
              OK <Icon name="arrowRight" size={16} />
            </button>
            <span className="hint" aria-hidden="true">{textHint ? "ENTER ↵ · SHIFT+ENTER new line" : "ENTER ↵ to continue"}</span>
          </div>
        </form>
        <p role="status" aria-label="Brief progress" className="visually-hidden">{status.text}</p>
      </div>
    </main>
  );
}
