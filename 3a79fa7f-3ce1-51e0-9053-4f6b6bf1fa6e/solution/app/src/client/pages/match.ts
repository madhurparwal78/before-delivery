// The fit quiz /match (brief: Match, Interactions/Quiz): progress lives in the address; the step transition
// slides out left and in from the right (Back mirrors), focus moves to the new heading and it is announced.
import { api } from "../api.ts";
import { boot } from "../boot.ts";
import { bezier, CURVES, h, reducedMotion, replace } from "../dom.ts";
import { busy } from "../forms.ts";
import type { PageContext } from "../router.ts";
import { announce } from "../state.ts";
import type { Catalog } from "../catalog.ts";
import { onward } from "../ui.ts";

interface Result {
  id: string;
  answers: string[];
  recommended: string;
  scores: Record<string, number>;
  reasons: number[];
}

interface QuizState {
  step: number;
  answers: string[];
}

const QUIZ = boot.quiz;
/** The rider weight "Build this board" carries for each answer to question 5 (brief: Interactions, Quiz). */
const RIDER_KG: Record<string, number> = { "under-70": 65, "70-90": 80, "over-90": 95 };

function readAddress(): QuizState | { result: string } | null {
  const q = new URLSearchParams(location.search);
  const result = q.get("result");
  if (result) return { result };
  const answers = (q.get("answers") ?? "").split(",").filter(Boolean);
  const step = q.has("step") ? Number(q.get("step")) : 1;
  const valid = answers.length <= QUIZ.length && answers.every((a, i) => QUIZ[i]?.options.some((o) => o.key === a));
  if (!valid || !Number.isInteger(step) || step < 1 || step > Math.min(QUIZ.length, answers.length + 1)) return null;
  return { step, answers };
}

// Outgoing accelerating over 0.2 s, then incoming over 0.3 s on a gentler deceleration so it is still fading in
// at 0.35 s (brief: Motion and effects, Quiz step). Frames follow requestAnimationFrame and the page clock.
const LEAVE_MS = 200;
const ENTER_MS = 300;
const settle = bezier(0, 0, 0.58, 1);

function address(state: QuizState): string {
  return `/match?step=${state.step}${state.answers.length ? `&answers=${state.answers.join(",")}` : ""}`;
}

export async function match(ctx: PageContext): Promise<void> {
  document.title = "Find my board | Tern Foils";
  const { main } = ctx;
  const panel = h("div", { class: "quiz-panel card" });
  main.append(h("div", { class: "wrap quiz-wrap" }, h("h1", { tabindex: "-1", class: "quiz-title" }, "Find my board"), panel));
  let state: QuizState = { step: 1, answers: [] };
  let pushed = 0;

  const stage = h("div", { class: "quiz-stage" });
  const back = h("button", { type: "button", class: "pill pill-outline" }, "Back");
  const next = h("button", { type: "button", class: "pill" }, "Next");
  const controls = h("div", { class: "quiz-controls" }, back, next);
  let stopStep: (() => void) | null = null;

  function questionView(): HTMLElement {
    const q = QUIZ[state.step - 1]!;
    const textId = `quiz-q-${state.step}`;
    const name = `quiz-${state.step}`;
    return h("div", { class: "quiz-question" },
      h("h2", { tabindex: "-1", class: "quiz-heading" }, `Question ${state.step} of ${QUIZ.length}`),
      h("p", { class: "quiz-text", id: textId }, q.text),
      h("div", { role: "radiogroup", "aria-labelledby": textId, class: "choice-list" },
        q.options.map((o) => {
          const id = `${name}-${o.key}`;
          const radio = h("input", { type: "radio", name, id, value: o.key, class: "sr-radio", checked: state.answers[state.step - 1] === o.key });
          radio.addEventListener("change", () => {
            state.answers[state.step - 1] = o.key;
            history.replaceState(history.state, "", address(state));
            syncControls();
          });
          return h("div", { class: "choice" }, radio, h("label", { for: id }, o.label));
        })));
  }

  function syncControls(): void {
    back.disabled = state.step === 1;
    next.disabled = state.answers[state.step - 1] === undefined;
    next.textContent = state.step === QUIZ.length ? "See my match" : "Next";
  }

  function showQuestion(direction: "forward" | "back" | "none"): void {
    if (!stage.isConnected) replace(panel, stage, controls);
    stopStep?.();
    const outgoing = stage.firstElementChild instanceof HTMLElement ? stage.firstElementChild : null;
    const incoming = questionView();
    syncControls();
    if (direction === "none" || reducedMotion() || !outgoing) {
      replace(stage, incoming);
    } else {
      // The outgoing question leaves on an inert overlay while the incoming one waits in place for its turn.
      const sign = direction === "forward" ? 1 : -1;
      outgoing.classList.add("quiz-leaving");
      outgoing.setAttribute("aria-hidden", "true");
      outgoing.toggleAttribute("inert", true);
      stage.append(incoming);
      const pose = (el: HTMLElement, offset: number, opacity: number): void => {
        el.style.transform = `translateX(${offset}%)`;
        el.style.opacity = String(opacity);
      };
      pose(incoming, 33 * sign, 0);
      let start: number | null = null;
      let frame = 0;
      const end = (): void => {
        cancelAnimationFrame(frame);
        outgoing.remove();
        incoming.style.removeProperty("transform");
        incoming.style.removeProperty("opacity");
        stopStep = null;
      };
      const tick = (now: number): void => {
        start ??= now;
        const t = now - start;
        const out = CURVES.accelerate(Math.min(1, t / LEAVE_MS));
        pose(outgoing, -33 * sign * out, 1 - out);
        const into = settle(Math.min(1, Math.max(0, t - LEAVE_MS) / ENTER_MS));
        pose(incoming, 33 * sign * (1 - into), into);
        if (t >= LEAVE_MS + ENTER_MS) end();
        else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      stopStep = end;
    }
    if (direction === "none") return;
    incoming.querySelector<HTMLElement>(".quiz-heading")?.focus({ preventScroll: true });
    announce(`Question ${state.step} of ${QUIZ.length}: ${QUIZ[state.step - 1]!.text}`);
  }

  async function showResult(id: string): Promise<void> {
    const [r, cat] = await Promise.all([api<Result>("GET", `/api/match/${encodeURIComponent(id)}`), api<Catalog>("GET", "/api/catalog")]);
    if (!r.ok) {
      replace(panel, h("div", { class: "quiz-result" }, h("h2", { tabindex: "-1" }, "We could not find that match."), h("a", { href: "/match", class: "pill" }, "Retake")));
      return;
    }
    const res = r.data;
    const firstSku = cat.ok ? cat.data.boards.find((b) => b.name === res.recommended)?.sku : undefined;
    const heading = h("h2", { tabindex: "-1" }, `Your match: ${res.recommended}`);
    replace(panel, h("div", { class: "quiz-result" },
      h("p", { class: "eyebrow" }, "Your result"),
      heading,
      h("ul", { class: "scores" }, Object.entries(res.scores).map(([board, points]) => h("li", { class: board === res.recommended ? "winner" : "" }, `${board}: ${points} points`))),
      h("h3", null, "Why this board"),
      h("ul", { class: "reasons" }, res.reasons.map((q) => h("li", null, `Question ${q}: ${QUIZ[q - 1]?.text ?? ""}`))),
      h("div", { class: "actions" }, h("a", { href: `/build?board=${firstSku ?? ""}&rider=${RIDER_KG[res.answers[4] ?? ""] ?? 80}`, class: "pill" }, "Build this board"), onward("/match", "Retake"))));
    heading.focus({ preventScroll: true });
  }

  back.addEventListener("click", () => {
    if (state.step === 1) return;
    if (pushed > 0) {
      history.back();
      return;
    }
    state = { ...state, step: state.step - 1 };
    history.replaceState(null, "", address(state));
    showQuestion("back");
  });

  next.addEventListener("click", async () => {
    if (state.answers[state.step - 1] === undefined) return;
    if (state.step < QUIZ.length) {
      state = { ...state, step: state.step + 1 };
      pushed += 1;
      history.pushState({ quiz: pushed }, "", address(state));
      showQuestion("forward");
      return;
    }
    const r = await busy(next, "Scoring...", () => api<Result>("POST", "/api/match", { answers: state.answers.slice(0, QUIZ.length) }));
    if (!r.ok) {
      announce(r.error.message);
      return;
    }
    history.pushState({ quiz: pushed + 1 }, "", `/match?result=${r.data.id}`);
    await showResult(r.data.id);
  });

  function fromAddress(animate: boolean): void {
    const read = readAddress();
    if (!read) {
      history.replaceState(null, "", "/match");
      state = { step: 1, answers: [] };
      pushed = 0;
      showQuestion("none");
      return;
    }
    if ("result" in read) {
      void showResult(read.result);
      return;
    }
    const before = state.step;
    state = read;
    pushed = Math.max(0, typeof history.state?.quiz === "number" ? history.state.quiz : 0);
    showQuestion(!animate || !stage.isConnected ? "none" : read.step > before ? "forward" : read.step < before ? "back" : "none");
  }

  ctx.onLocation(() => fromAddress(true));
  fromAddress(false);
}
