// The private answer page in the request's language, with local number typing and evidence.

import { announce, api, el, withWorking } from "./api.js";
import type { RouteCtx } from "./app.js";
import type { Lang } from "./server-copy.js";

interface PageData {
  language: string;
  supplierName: string;
  labelName: string;
  styleName: string;
  town: string;
  townName: string;
  questions: string[];
  dueDate: string;
  endsAt: string;
  state: string;
  answeredAt: string | null;
}

export function registerAnswerScreen(ctx: RouteCtx): () => void {
  const token = location.pathname.split("/")[2];
  const main = ctx.main;
  const copyEl = document.documentElement;
  let data: PageData | null = null;
  let lang: Lang = "en";

  async function load(first: boolean): Promise<void> {
    try {
      const out = await api<PageData>(`/api/a/${token}`);
      data = out;
      lang = out.language as Lang;
      if (first) build(out);
      else refresh(out);
    } catch (err) {
      const failure = err as { status?: number; body?: { error?: { message?: string } } };
      if (failure.status === 410 || failure.status === 404) {
        const message = failure.body?.error?.message ?? `This page has ended.`;
        const h1 = el("h1", {}, message);
        main.textContent = "";
        main.append(h1);
        document.title = `${message} \u2014 Fio Contado Desk`;
      }
    }
  }

  function copy(): Record<string, string> {
    return ANSWER_COPY[lang];
  }

  function build(out: PageData): void {
    copyEl.setAttribute("lang", out.language);
    copyEl.setAttribute("dir", out.language === "ar" ? "rtl" : "ltr");
    document.title = `${copy().heading} \u2014 Fio Contado Desk`;
    const c = copy();
    const h1 = el("h1", {}, c.heading);
    const intro = el("p", {}, c.intro.replace("<labelName>", out.labelName).replace("<styleName>", out.styleName));
    const due = el("p", { class: "hint" }, c.dueLine.replace("<dueDate>", out.dueDate).replace("<town>", out.townName));

    const steps = el("fieldset", { class: "steps-rail", role: "group", "aria-label": c.steps });
    steps.append(el("legend", { class: "sr-only" }, c.steps));
    const stepIds: string[] = [];
    if (out.questions.includes("energy")) stepIds.push("energy");
    if (out.questions.includes("water")) stepIds.push("water");
    if (out.questions.includes("fibreOrigin")) stepIds.push("fibreOrigin");
    stepIds.push("evidence", "send");
    const labelsOf: Record<string, string> = {
      energy: c.stepEnergy,
      water: c.stepWater,
      fibreOrigin: c.stepFibreOrigin,
      evidence: c.stepEvidence,
      send: c.stepSend,
    };
    let current = stepIds[0];
    for (const id of stepIds) {
      const b = el("button", { type: "button" }, labelsOf[id]);
      b.dataset.step = id;
      if (id === current) b.setAttribute("aria-current", "step");
      b.addEventListener("click", () => {
        current = id;
        showStep(id);
      });
      steps.append(b);
    }

    const fields = el("div", {});
    const energyField = el("label", { class: "field" }, el("span", {}, c.energyField));
    const energyInput = el("input", { type: "text", "dir": "ltr", "aria-label": c.energyField });
    const unitBtn = el("button", { type: "button", class: "btn" }, c.unit);
    unitBtn.addEventListener("click", () => void openUnit(unitBtn));
    energyField.append(energyInput, unitBtn);
    const waterField = el("label", { class: "field" }, el("span", {}, c.waterField));
    const waterInput = el("input", { type: "text", dir: "ltr", "aria-label": c.waterField });
    waterField.append(waterInput);
    const originField = el("label", { class: "field" }, el("span", {}, c.originField));
    const originSel = el("select", { "aria-label": c.originField });
    for (const [code, name] of countryNames()) originSel.append(el("option", { value: code }, name));
    originField.append(originSel);
    const evidenceField = el("label", { class: "field" }, el("span", {}, c.evidenceField));
    const evidenceInput = el("input", { type: "file", "aria-label": c.evidenceField });
    evidenceField.append(evidenceInput);
    fields.append(energyField, waterField, originField, evidenceField);

    const problems = el("div", { class: "problems", role: "region", "aria-label": c.problems, hidden: "true" });
    const sentLine = el("p", { class: "hint", hidden: "true" }, c.sent);

    const sendBtn = el("button", { class: "btn btn-primary", type: "button" }, c.sendAnswers);
    const nextBtn = el("button", { class: "btn", type: "button" }, c.next);
    const backBtn = el("button", { class: "btn", type: "button" }, c.back);
    const bar = el("div", { class: "bottom-bar" });
    bar.append(backBtn, nextBtn);
    main.append(h1, problems, intro, due, steps, fields, sentLine, bar);

    function showStep(id: string): void {
      for (const b of steps.querySelectorAll<HTMLButtonElement>("button")) {
        if (b.dataset.step === id) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      }
      energyField.hidden = id !== "energy";
      waterField.hidden = id !== "water";
      originField.hidden = id !== "fibreOrigin";
      evidenceField.hidden = id !== "evidence";
      const isSend = id === "send";
      sendBtn.hidden = !isSend;
      nextBtn.hidden = isSend;
      backBtn.hidden = stepIds.indexOf(id) === 0;
      bar.textContent = "";
      bar.append(backBtn, isSend ? sendBtn : nextBtn);
    }

    nextBtn.addEventListener("click", () => {
      const idx = stepIds.indexOf(current);
      current = stepIds[Math.min(idx + 1, stepIds.length - 1)];
      showStep(current);
    });
    backBtn.addEventListener("click", () => {
      const idx = stepIds.indexOf(current);
      current = stepIds[Math.max(idx - 1, 0)];
      showStep(current);
    });

    steps.addEventListener("keydown", (e) => {
      const idx = stepIds.indexOf(current);
      const forward = lang === "ar" ? "ArrowLeft" : "ArrowRight";
      const back = lang === "ar" ? "ArrowRight" : "ArrowLeft";
      if (e.key === forward) {
        current = stepIds[Math.min(idx + 1, stepIds.length - 1)];
        showStep(current);
      }
      if (e.key === back) {
        current = stepIds[Math.max(idx - 1, 0)];
        showStep(current);
      }
      if (e.key === "Home") {
        current = stepIds[0];
        showStep(current);
      }
      if (e.key === "End") {
        current = stepIds[stepIds.length - 1];
        showStep(current);
      }
    });

    let unit = "kWh";
    async function openUnit(opener: HTMLElement): Promise<void> {
      const { overlayOpen, overlayClose } = await import("./overlay.js");
      const body = overlayOpen({ label: c.unit, opener, sheet: true });
      const dialog = body.closest("dialog") as HTMLDialogElement;
      const options: [string, string][] = [["kWh", c.unitKwh], ["MJ", c.unitMj], ["m3", c.unitGas]];
      for (const [id, name] of options) {
        const label = el("label", { class: "radio" });
        const input = el("input", { type: "radio", name: "unit", value: id });
        input.checked = id === unit;
        input.addEventListener("change", () => {
          unit = id;
          unitBtn.textContent = name;
          overlayClose(dialog, opener);
        });
        label.append(input, name);
        body.append(label);
      }
    }

    sendBtn.addEventListener("click", async () => {
      await withWorking(sendBtn, c.working, async () => {
        // Files first, so Sent shows only once MinIO has confirmed.
        const evidenceIds: string[] = [];
        const files = evidenceInput.files ?? [];
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          try {
            const out = await api<{ evidenceId: string }>(`/api/a/${token}/evidence`, { method: "POST", body: form });
            evidenceIds.push(out.evidenceId);
          } catch (err) {
            const failure = err as { status?: number; body?: { error?: { message?: string } } };
            showProblem(failure.body?.error?.message ?? c.refreshFailed);
            return;
          }
        }
        const body: Record<string, unknown> = { evidenceIds };
        if (out.questions.includes("energy")) {
          body.energy = { value: energyInput.value, unit };
        }
        if (out.questions.includes("water")) {
          body.water = { value: waterInput.value };
        }
        if (out.questions.includes("fibreOrigin")) {
          body.fibreOrigin = originSel.value;
        }
        try {
          await api(`/api/a/${token}/answers`, { method: "POST", body: JSON.stringify(body) });
          sentLine.hidden = false;
          announce(c.sent);
          problems.hidden = true;
        } catch (err) {
          const failure = err as { status?: number; body?: { error?: { message?: string } } };
          showProblem(failure.body?.error?.message ?? c.refreshFailed);
        }
      });
    });

    function showProblem(message: string): void {
      problems.hidden = false;
      problems.textContent = "";
      problems.append(el("p", {}, message));
      announce(message);
      problems.focus?.();
    }

    showStep(current);
  }

  function refresh(out: PageData): void {
    if (out.state === "answered") {
      const c = copy();
      const sent = main.querySelector<HTMLElement>(".hint[hidden], p.hint");
      for (const p of main.querySelectorAll<HTMLElement>("p.hint")) {
        if (p.textContent === c.sent) p.hidden = false;
      }
      void sent;
    }
  }

  void load(true);
  const timer = window.setInterval(() => void load(false), 5000);
  return () => window.clearInterval(timer);

  function countryNames(): [string, string][] {
    const names: Record<string, [string, string][]> = {
      en: [["PT", "Portugal"], ["TR", "Turkey"], ["VN", "Vietnam"], ["EG", "Egypt"], ["IN", "India"], ["BD", "Bangladesh"]],
      fr: [["PT", "Portugal"], ["TR", "Turquie"], ["VN", "Vi\u00EAt Nam"], ["EG", "\u00C9gypte"], ["IN", "Inde"], ["BD", "Bangladesh"]],
      tr: [["PT", "Portekiz"], ["TR", "T\u00FCrkiye"], ["VN", "Vietnam"], ["EG", "M\u0131s\u0131r"], ["IN", "Hindistan"], ["BD", "Banglade\u015F"]],
      ar: [["PT", "\u0627\u0644\u0628\u0631\u062A\u063A\u0627\u0644"], ["TR", "\u062A\u0631\u0643\u064A\u0627"], ["VN", "\u0641\u064A\u062A\u0646\u0627\u0645"], ["EG", "\u0645\u0635\u0631"], ["IN", "\u0627\u0644\u0647\u0646\u062F"], ["BD", "\u0628\u0646\u063A\u0644\u0627\u062F\u064A\u0634"]],
    };
    return names[lang] ?? names.en;
  }
}

const ANSWER_COPY: Record<Lang, Record<string, string>> = {
  en: {
    heading: "Your answers",
    intro: "<labelName> asks about <styleName>.",
    dueLine: "Please answer by <dueDate> 23:59:59 <town> time.",
    steps: "Steps",
    stepEnergy: "Energy",
    stepWater: "Water",
    stepFibreOrigin: "Fibre origin",
    stepEvidence: "Evidence",
    stepSend: "Send",
    energyField: "Energy per kg of finished goods",
    waterField: "Water in litres per kg of finished goods",
    originField: "Country of fibre origin",
    unit: "Unit",
    unitKwh: "kWh",
    unitMj: "MJ",
    unitGas: "m\u00B3 of natural gas",
    close: "Close",
    next: "Next",
    back: "Back",
    evidenceField: "Evidence file (PDF, JPEG or PNG)",
    sendAnswers: "Send answers",
    working: "Working\u2026",
    sent: "Sent",
    ended: "This page has ended.",
    numberRefused: "That number isn't in the form this page uses, for example 1,250.5.",
    fileTypeRefused: "That file isn't a PDF, JPEG or PNG.",
    fileTooBig: "That file is over 5,000,000 bytes.",
    fileStoreDown: "The file store is unavailable right now. Nothing was saved.",
    problems: "Problems",
    refreshFailed: "Couldn't refresh. Trying again.",
    emptyAnswer: "Give an answer here.",
  },
  fr: {
    heading: "Vos r\u00E9ponses",
    intro: "<labelName> pose des questions sur <styleName>.",
    dueLine: "Merci de r\u00E9pondre avant le <dueDate> 23:59:59, heure de <town>.",
    steps: "\u00C9tapes",
    stepEnergy: "\u00C9nergie",
    stepWater: "Eau",
    stepFibreOrigin: "Origine de la fibre",
    stepEvidence: "Justificatif",
    stepSend: "Envoi",
    energyField: "\u00C9nergie par kg de produit fini",
    waterField: "Eau en litres par kg de produit fini",
    originField: "Pays d'origine de la fibre",
    unit: "Unit\u00E9",
    unitKwh: "kWh",
    unitMj: "MJ",
    unitGas: "m\u00B3 de gaz naturel",
    close: "Fermer",
    next: "Suivant",
    back: "Retour",
    evidenceField: "Justificatif (PDF, JPEG ou PNG)",
    sendAnswers: "Envoyer les r\u00E9ponses",
    working: "En cours\u2026",
    sent: "Envoy\u00E9",
    ended: "Cette page est termin\u00E9e.",
    numberRefused: "Ce nombre n'est pas \u00E9crit comme il faut, par exemple 1 250,5.",
    fileTypeRefused: "Ce fichier n'est ni un PDF, ni un JPEG, ni un PNG.",
    fileTooBig: "Ce fichier d\u00E9passe 5 000 000 octets.",
    fileStoreDown: "Le stockage des fichiers est indisponible pour le moment. Rien n'a \u00E9t\u00E9 enregistr\u00E9.",
    problems: "Probl\u00E8mes",
    refreshFailed: "Actualisation impossible. Nouvel essai en cours.",
    emptyAnswer: "R\u00E9pondez ici.",
  },
  tr: {
    heading: "Yan\u0131tlar\u0131n\u0131z",
    intro: "<labelName>, <styleName> hakk\u0131nda soruyor.",
    dueLine: "L\u00FCtfen <dueDate> 23:59:59 (<town> saati) tarihine kadar yan\u0131tlay\u0131n.",
    steps: "Ad\u0131mlar",
    stepEnergy: "Enerji",
    stepWater: "Su",
    stepFibreOrigin: "Elyaf k\u00F6keni",
    stepEvidence: "Kan\u0131t belgesi",
    stepSend: "G\u00F6nderim",
    energyField: "Bitmi\u015F \u00FCr\u00FCn\u00FCn kg'si ba\u015F\u0131na enerji",
    waterField: "Bitmi\u015F \u00FCr\u00FCn\u00FCn kg'si ba\u015F\u0131na litre su",
    originField: "Elyaf\u0131n men\u015Fe \u00FClkesi",
    unit: "Birim",
    unitKwh: "kWh",
    unitMj: "MJ",
    unitGas: "m\u00B3 do\u011Fal gaz",
    close: "Kapat",
    next: "\u0130leri",
    back: "Geri",
    evidenceField: "Kan\u0131t dosyas\u0131 (PDF, JPEG veya PNG)",
    sendAnswers: "Yan\u0131tlar\u0131 g\u00F6nder",
    working: "\u0130\u015Fleniyor\u2026",
    sent: "G\u00F6nderildi",
    ended: "Bu sayfan\u0131n s\u00FCresi doldu.",
    numberRefused: "Bu say\u0131 do\u011Fru bi\u00E7imde de\u011Fil, \u00F6rne\u011Fin 1.250,5.",
    fileTypeRefused: "Bu dosya PDF, JPEG veya PNG de\u011Fil.",
    fileTooBig: "Bu dosya 5.000.000 bayt\u0131 a\u015F\u0131yor.",
    fileStoreDown: "Dosya deposu \u015Fu anda kullan\u0131lam\u0131yor. Hi\u00E7bir \u015Fey kaydedilmedi.",
    problems: "Sorunlar",
    refreshFailed: "Yenilenemedi. Yeniden deneniyor.",
    emptyAnswer: "Buraya bir yan\u0131t girin.",
  },
  ar: {
    heading: "\u0625\u062C\u0627\u0628\u0627\u062A\u0643",
    intro: "\u062A\u0633\u0623\u0644 <labelName> \u0639\u0646 <styleName>.",
    dueLine: "\u064A\u0631\u062C\u0649 \u0627\u0644\u0625\u062C\u0627\u0628\u0629 \u0642\u0628\u0644 <dueDate> 23:59:59 \u0628\u062A\u0648\u0642\u064A\u062A <town>.",
    steps: "\u0627\u0644\u062E\u0637\u0648\u0627\u062A",
    stepEnergy: "\u0627\u0644\u0637\u0627\u0642\u0629",
    stepWater: "\u0627\u0644\u0645\u0627\u0621",
    stepFibreOrigin: "\u0645\u0646\u0634\u0623 \u0627\u0644\u0623\u0644\u064A\u0627\u0641",
    stepEvidence: "\u0645\u0633\u062A\u0646\u062F \u062F\u0627\u0639\u0645",
    stepSend: "\u0627\u0644\u0625\u0631\u0633\u0627\u0644",
    energyField: "\u0627\u0644\u0637\u0627\u0642\u0629 \u0644\u0643\u0644 \u0643\u064A\u0644\u0648\u063A\u0631\u0627\u0645 \u0645\u0646 \u0627\u0644\u0645\u0646\u062A\u062C \u0627\u0644\u0646\u0647\u0627\u0626\u064A",
    waterField: "\u0627\u0644\u0645\u0627\u0621 \u0628\u0627\u0644\u0644\u062A\u0631 \u0644\u0643\u0644 \u0643\u064A\u0644\u0648\u063A\u0631\u0627\u0645 \u0645\u0646 \u0627\u0644\u0645\u0646\u062A\u062C \u0627\u0644\u0646\u0647\u0627\u0626\u064A",
    originField: "\u0628\u0644\u062F \u0645\u0646\u0634\u0623 \u0627\u0644\u0623\u0644\u064A\u0627\u0641",
    unit: "\u0627\u0644\u0648\u062D\u062F\u0629",
    unitKwh: "kWh",
    unitMj: "MJ",
    unitGas: "\u0645\u00B3 \u0645\u0646 \u0627\u0644\u063A\u0627\u0632 \u0627\u0644\u0637\u0628\u064A\u0639\u064A",
    close: "\u0625\u063A\u0644\u0627\u0642",
    next: "\u0627\u0644\u062A\u0627\u0644\u064A",
    back: "\u0627\u0644\u0633\u0627\u0628\u0642",
    evidenceField: "\u0645\u0644\u0641 \u0627\u0644\u0645\u0633\u062A\u0646\u062F (PDF \u0623\u0648 JPEG \u0623\u0648 PNG)",
    sendAnswers: "\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0625\u062C\u0627\u0628\u0627\u062A",
    working: "\u062C\u0627\u0631\u064D \u0627\u0644\u0639\u0645\u0644\u2026",
    sent: "\u062A\u0645 \u0627\u0644\u0625\u0631\u0633\u0627\u0644",
    ended: "\u0627\u0646\u062A\u0647\u062A \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629.",
    numberRefused: "\u0647\u0630\u0627 \u0627\u0644\u0631\u0642\u0645 \u0644\u064A\u0633 \u0628\u0627\u0644\u0635\u064A\u063A\u0629 \u0627\u0644\u0635\u062D\u064A\u062D\u0629\u060C \u0645\u062B\u0644 \u0661\u066C\u0662\u0665\u0660\u066B\u0665.",
    fileTypeRefused: "\u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0644\u064A\u0633 PDF \u0623\u0648 JPEG \u0623\u0648 PNG.",
    fileTooBig: "\u064A\u062A\u062C\u0627\u0648\u0632 \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0665\u066C\u0660\u0660\u0660\u066C\u0660\u0660\u0660 \u0628\u0627\u064A\u062A.",
    fileStoreDown: "\u0645\u062E\u0632\u0646 \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u062D\u0627\u0644\u064A\u064B\u0627. \u0644\u0645 \u064A\u064F\u062D\u0641\u0638 \u0623\u064A \u0634\u064A\u0621.",
    problems: "\u0627\u0644\u0645\u0634\u0643\u0644\u0627\u062A",
    refreshFailed: "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u062F\u064A\u062B. \u062C\u0627\u0631\u064D \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u062C\u062F\u062F\u064B\u0627.",
    emptyAnswer: "\u0623\u062F\u062E\u0644 \u0625\u062C\u0627\u0628\u0629 \u0647\u0646\u0627.",
  },
};
