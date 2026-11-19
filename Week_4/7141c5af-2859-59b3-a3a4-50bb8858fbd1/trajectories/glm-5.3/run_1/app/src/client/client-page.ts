import { announce, ApiFail } from "./core.js";

type Copy = Record<string, string>;

/** Client page: touch-first, all four languages, its own copy from the server-rendered page. */
export function installClientPage(): void {
  const token = document.body.dataset.token ?? "";
  const lang = document.body.dataset.lang ?? "en";
  const copy: Copy = copyTable[lang] ?? copyTable.en!;
  const rtl = lang === "ar";

  const busy = async (button: HTMLButtonElement, fn: () => Promise<void>): Promise<void> => {
    if (button.getAttribute("aria-disabled") === "true") return;
    const original = button.textContent ?? "";
    button.textContent = copy.C22;
    button.setAttribute("aria-disabled", "true");
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiFail) {
        announce(e.message || copy.C52);
      }
    } finally {
      button.textContent = original;
      button.removeAttribute("aria-disabled");
    }
  };

  const call = async <T>(path: string, json?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: json === undefined ? "GET" : "POST",
      headers: json === undefined ? {} : { "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
      credentials: "same-origin",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
      throw new ApiFail(res.status, err?.code ?? "", err?.message ?? "", err?.fields);
    }
    return data as T;
  };

  // The sheet: opens on Your answer, closes on outside tap or Escape.
  const sheet = document.getElementById("answer-sheet") as HTMLElement | null;
  const opener = document.getElementById("your-answer");
  const closeBtn = document.getElementById("answer-close");
  const openSheet = (): void => {
    if (!sheet) return;
    sheet.hidden = false;
    sheet.dataset.open = "true";
    const panel = sheet.querySelector(".sheet-panel") as HTMLElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      panel.style.transition = "transform 320ms";
      panel.style.transform = "translateY(100%)";
      requestAnimationFrame(() => {
        panel.style.transform = "translateY(0)";
      });
    }
    (sheet.querySelector("input") as HTMLElement | null)?.focus();
  };
  const closeSheet = (): void => {
    if (!sheet) return;
    sheet.hidden = true;
    sheet.dataset.open = "false";
    opener?.focus();
  };
  opener?.addEventListener("click", openSheet);
  closeBtn?.addEventListener("click", closeSheet);
  sheet?.addEventListener("click", (e) => {
    if (e.target === sheet) closeSheet();
  });
  sheet?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeSheet();
    }
  });

  // The slider: arrows 1%, Shift 10%, value in the URL replacing the entry, aria-valuetext in the page's words.
  const slider = document.getElementById("ba-slider") as HTMLInputElement | null;
  const afterImg = document.getElementById("ba-after") as HTMLImageElement | null;
  const apply = (v: number, announceValue = false): void => {
    if (afterImg) {
      afterImg.style.clipPath = rtl ? `inset(0 ${100 - v}% 0 0)` : `inset(0 0 0 ${v}%)`;
    }
    if (slider) slider.setAttribute("aria-valuetext", copy.C29.replace("<n>", String(v)));
    const url = new URLSearchParams(location.search);
    url.set("before", String(v));
    history.replaceState({}, "", `${location.pathname}?${url}`);
    void announceValue;
  };
  const current = (): number => Number(slider?.value ?? 50);
  slider?.addEventListener("input", () => apply(current()));
  slider?.addEventListener("keydown", (e) => {
    const delta = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft") { e.preventDefault(); slider.value = String(Math.max(0, current() - delta)); apply(current()); }
    else if (e.key === "ArrowRight") { e.preventDefault(); slider.value = String(Math.min(100, current() + delta)); apply(current()); }
  });
  const initial = new URLSearchParams(location.search).get("before");
  if (slider && initial !== null) slider.value = String(Math.max(0, Math.min(100, Number(initial))));
  apply(current());

  // The two forms act separately.
  const answerForm = document.getElementById("answer-form") as HTMLFormElement | null;
  answerForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = answerForm.querySelector("button[type=submit]") as HTMLButtonElement;
    void busy(btn, async () => {
      const input = answerForm.querySelector<HTMLInputElement>("input[name=seatHeight]")!;
      await call(`/api/client-pages/${token}/answer`, { seatHeight: input.value });
      const summary = document.getElementById("answer-summary");
      if (summary) summary.innerHTML = `<p>${copy.C15}</p>`;
      input.value = "";
    });
  });

  const signoffForm = document.getElementById("signoff-form") as HTMLFormElement | null;
  signoffForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = signoffForm.querySelector("button[type=submit]") as HTMLButtonElement;
    void busy(btn, async () => {
      const input = signoffForm.querySelector<HTMLInputElement>("input[name=typedName]")!;
      const estimateId = signoffForm.querySelector<HTMLInputElement>("input[name=estimateId]")!.value;
      const res = await call<{ signOff: { at: string } }>(`/api/client-pages/${token}/sign-off`, { typedName: input.value, estimateId });
      const summary = document.getElementById("answer-summary");
      if (summary) {
        const town = document.body.dataset.town ?? "";
        const at = res.signOff.at;
        const time = at.slice(11, 16);
        summary.innerHTML = `<p>${copy.C16.replace("<time>", time).replace("<town>", town)}</p>`;
      }
    });
  });
}

const copyTable: Record<string, Copy> = {
  en: { C15: "Your answer is with the conservator.", C16: "Approved at <time> <town> time.", C22: "Working…", C29: "<n>% before", C52: "Your answer could not be sent. Try again." },
  it: { C15: "La tua risposta è arrivata al restauratore.", C16: "Approvato alle <time>, ora di <town>.", C22: "Attendi…", C29: "<n>% prima", C52: "Invio non riuscito. Riprova." },
  ja: { C15: "回答を修復担当者に届けました。", C16: "<time>（<town>時間）に承認しました。", C22: "処理中…", C29: "施工前 <n>%", C52: "回答を送信できませんでした。もう一度お試しください。" },
  ar: { C15: "وصلت إجابتك إلى المرمِّم.", C16: "تمت الموافقة في الساعة <time> بتوقيت <town>.", C22: "جارٍ العمل…", C29: "<n>% قبل", C52: "تعذر إرسال إجابتك. حاول مرة أخرى." },
};
