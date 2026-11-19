/**
 * Service panels, skill tabs and cards, the review carousel and the enquiry
 * form. Closed panels, hidden tab panels and hidden slides are inert.
 */
import {
  ANNOUNCEMENTS,
  REVIEWS,
  formStatusText,
  normaliseName,
  validateEnquiry,
  type EnquiryField,
  type EnquiryValues,
} from "../shared/domain.js";
import { announce, prefersReducedMotion, qs, qsa } from "./core.js";

export function initServices(): void {
  if (!document.body.classList.contains("page-home")) return;
  const items = qsa<HTMLElement>("[data-service]");
  for (const item of items) {
    const value = item.dataset.service ?? "";
    const toggle = qs<HTMLButtonElement>(`.service-toggle[aria-controls="service-panel-${value}"]`, item);
    const panel = qs<HTMLElement>(`#service-panel-${value}`, item);
    if (!toggle || !panel) continue;
    let closing = false;
    let closeTimer = 0;
    const open = (): void => {
      for (const other of items) {
        if (other === item) continue;
        const otherValue = other.dataset.service ?? "";
        const otherToggle = qs<HTMLButtonElement>(
          `.service-toggle[aria-controls="service-panel-${otherValue}"]`,
          other
        );
        const otherPanel = qs<HTMLElement>(`#service-panel-${otherValue}`, other);
        if (otherToggle && otherPanel && !otherPanel.hidden) {
          otherToggle.setAttribute("aria-expanded", "false");
          otherPanel.hidden = true;
          other.removeAttribute("data-open");
        }
      }
      window.clearTimeout(closeTimer);
      closing = false;
      toggle.setAttribute("aria-expanded", "true");
      item.dataset.open = "true";
      panel.hidden = false;
      if (!prefersReducedMotion()) panel.dataset.opening = "true";
    };
    const close = (): void => {
      window.clearTimeout(closeTimer);
      toggle.setAttribute("aria-expanded", "false");
      delete item.dataset.open;
      if (prefersReducedMotion()) {
        panel.hidden = true;
        return;
      }
      closing = true;
      panel.dataset.closing = "true";
      closeTimer = window.setTimeout(() => {
        panel.hidden = true;
        panel.removeAttribute("data-closing");
        panel.removeAttribute("data-opening");
        closing = false;
      }, 300);
    };
    toggle.addEventListener("click", () => {
      if (!panel.hidden && !closing) close();
      else open();
    });
    void closing;
  }
}

export function initSkills(): void {
  if (!document.body.classList.contains("page-home")) return;
  const tabs = qsa<HTMLButtonElement>("[data-skill-tab]");
  const panels = qsa<HTMLElement>("[data-skill-panel]");
  if (tabs.length === 0 || panels.length === 0) return;

  const select = (index: number): void => {
    for (const tab of tabs) {
      const selected = Number(tab.dataset.tabIndex) === index;
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = Number((panel.getAttribute("index") ?? "0")) !== index;
    }
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => select(Number(tab.dataset.tabIndex)));
  }

  const tablist = qs<HTMLElement>("[data-skill-tabs]");
  tablist?.addEventListener("keydown", (event) => {
    const current = tabs.findIndex(
      (tab) => tab.getAttribute("aria-selected") === "true"
    );
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    select(next);
    tabs[next].focus({ preventScroll: true });
  });

  for (const panel of panels) {
    const toggles = qsa<HTMLButtonElement>(".skill-toggle", panel);
    for (const toggle of toggles) {
      toggle.addEventListener("click", () => {
        const detail = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
        if (!detail) return;
        const open = !detail.hidden;
        for (const other of qsa<HTMLElement>(".skill-detail", panel)) {
          if (other !== detail) other.hidden = true;
        }
        for (const other of toggles) {
          if (other !== toggle) other.setAttribute("aria-expanded", "false");
        }
        detail.hidden = open;
        toggle.setAttribute("aria-expanded", open ? "false" : "true");
      });
    }
  }
}

type ReviewState = {
  index: number;
};

let reviewState: ReviewState = { index: 1 };

export function initReviews(): void {
  if (!document.body.classList.contains("page-home")) return;
  const track = qs<HTMLElement>("[data-review-track]");
  const slides = qsa<HTMLElement>("[data-review-slide]");
  const prev = qs<HTMLButtonElement>("[data-review-prev]");
  const next = qs<HTMLButtonElement>("[data-review-next]");
  const position = qs<HTMLElement>("[data-review-position]");
  const carousel = qs<HTMLElement>("[data-reviews-carousel]");
  if (!track || slides.length === 0 || !prev || !next || !position || !carousel) return;

  const show = (index: number, announceIt: boolean): void => {
    reviewState.index = index;
    for (const slide of slides) {
      const visible = Number(slide.dataset.reviewIndex) === index;
      slide.hidden = !visible;
    }
    track.style.transform = `translateX(-${(index - 1) * 100}%)`;
    prev.disabled = index === 1;
    next.disabled = index === slides.length;
    if (document.activeElement === prev && prev.disabled) next.focus({ preventScroll: true });
    if (document.activeElement === next && next.disabled) prev.focus({ preventScroll: true });
    position.textContent = `${index} / 5`;
    if (announceIt) {
      const review = REVIEWS[index - 1];
      announce(ANNOUNCEMENTS.review(index, review));
    }
  };

  prev.addEventListener("click", () => {
    if (reviewState.index > 1) show(reviewState.index - 1, true);
  });
  next.addEventListener("click", () => {
    if (reviewState.index < slides.length) show(reviewState.index + 1, true);
  });

  carousel.addEventListener("keydown", (event) => {
    let index = 0;
    if (event.key === "ArrowRight") index = Math.min(reviewState.index + 1, slides.length);
    else if (event.key === "ArrowLeft") index = Math.max(reviewState.index - 1, 1);
    else if (event.key === "Home") index = 1;
    else if (event.key === "End") index = slides.length;
    else return;
    event.preventDefault();
    if (index !== reviewState.index && index > 0) show(index, true);
  });

  let dragStart: { x: number; y: number } | null = null;
  const endDrag = (event: PointerEvent): void => {
    if (!dragStart) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    dragStart = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0 && reviewState.index < slides.length) show(reviewState.index + 1, true);
    else if (dx > 0 && reviewState.index > 1) show(reviewState.index - 1, true);
  };
  track.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragStart = { x: event.clientX, y: event.clientY };
    // a pointer capture keeps the drag tied to the track wherever it ends
    try {
      track.setPointerCapture(event.pointerId);
    } catch {
      /* the drag still works without capture */
    }
  });
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", () => {
    dragStart = null;
  });

  show(1, false);
}

type EnquiryState = "editing" | "invalid" | "sending" | "sent" | "failed";

export function initEnquiry(): void {
  if (!document.body.classList.contains("page-home")) return;
  const form = qs<HTMLFormElement>("[data-enquiry]");
  const send = qs<HTMLButtonElement>("[data-send]");
  const status = qs<HTMLElement>("[data-form-status]");
  const sentPanel = qs<HTMLElement>("[data-sent-panel]");
  const sentHeading = qs<HTMLElement>("[data-sent-panel] .sent-heading");
  const sentCopy = qs<HTMLElement>("[data-sent-copy]");
  const another = qs<HTMLButtonElement>("[data-send-another]");
  if (!form || !send || !status || !sentPanel || !sentHeading || !sentCopy || !another) return;

  const field = (id: string): HTMLElement => {
    const element = qs<HTMLElement>(id);
    if (!element) return document.createElement("span");
    return element;
  };
  const fields: Record<EnquiryField, HTMLElement> = {
    name: field("#enquiry-name"),
    email: field("#enquiry-email"),
    projectType: field("#enquiry-project-type"),
    budget: field("[data-budget-group]"),
    message: field("#enquiry-message"),
  };
  const messages: Record<EnquiryField, HTMLElement> = {
    name: field("#enquiry-name-message"),
    email: field("#enquiry-email-message"),
    projectType: field("#enquiry-project-type-message"),
    budget: field("#budget-message"),
    message: field("#enquiry-message-message"),
  };

  let state: EnquiryState = "editing";
  let checked = false;

  const values = (): EnquiryValues => ({
    name: (fields.name as HTMLInputElement).value,
    email: (fields.email as HTMLInputElement).value,
    projectType: (fields.projectType as HTMLSelectElement).value,
    budget:
      qs<HTMLInputElement>("input[name='budget']:checked", fields.budget)?.value ?? "",
    message: (fields.message as HTMLTextAreaElement).value,
  });

  const setError = (field: EnquiryField, message: string | undefined): void => {
    const element = fields[field];
    const messageElement = messages[field];
    if (message) {
      element.setAttribute("aria-invalid", "true");
      element.setAttribute("aria-describedby", messageElement.id);
      messageElement.textContent = message;
      messageElement.hidden = false;
    } else {
      element.removeAttribute("aria-invalid");
      element.removeAttribute("aria-describedby");
      messageElement.textContent = "";
      messageElement.hidden = true;
    }
  };

  const validate = (): number => {
    const errors = validateEnquiry(values());
    let count = 0;
    for (const field of Object.keys(fields) as EnquiryField[]) {
      const message = errors[field];
      setError(field, message);
      if (message) count += 1;
    }
    return count;
  };

  const setFieldState = (disabled: boolean): void => {
    for (const element of Object.values(fields)) {
      const control =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? element
          : element.querySelector("input");
      if (control) (control as HTMLInputElement).disabled = disabled;
    }
    send.disabled = disabled;
  };

  const updateStatus = (count: number): void => {
    status.textContent = formStatusText(count);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state === "sending") return;
    checked = true;
    const count = validate();
    if (count > 0) {
      state = "invalid";
      updateStatus(count);
      const first = Object.keys(fields).find(
        (field) => fields[field as EnquiryField].getAttribute("aria-invalid") === "true"
      );
      if (first) fields[first as EnquiryField].focus({ preventScroll: true });
      return;
    }
    state = "sending";
    setFieldState(true);
    form.setAttribute("aria-busy", "true");
    status.textContent = "Sending your message…";
    send.textContent = "Sending…";
    const controller = new AbortController();
    const abortTimer = window.setTimeout(() => controller.abort(), 30000);
    void (async () => {
      try {
        const response = await fetch("/api/enquiries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(values()),
          signal: controller.signal,
        });
        window.clearTimeout(abortTimer);
        if (response.status === 201) {
          state = "sent";
          form.hidden = true;
          status.textContent = "";
          const name = normaliseName(values().name);
          const firstWord = name.split(" ")[0] ?? "";
          sentCopy.textContent = `Thanks, ${firstWord}. Your message is in my inbox, and I usually reply within two working days.`;
          sentPanel.hidden = false;
          sentHeading.focus({ preventScroll: true });
          return;
        }
        if (response.status === 422) {
          const body = (await response.json()) as { fields: Partial<Record<EnquiryField, string>> };
          state = "invalid";
          setFieldState(false);
          form.removeAttribute("aria-busy");
          send.textContent = "Send message";
          let count = 0;
          for (const field of Object.keys(fields) as EnquiryField[]) {
            const message = body.fields[field];
            setError(field, message);
            if (message) count += 1;
          }
          updateStatus(count);
          const first = Object.keys(fields).find(
            (key) => fields[key as EnquiryField].getAttribute("aria-invalid") === "true"
          );
          if (first) fields[first as EnquiryField].focus({ preventScroll: true });
          return;
        }
        throw new Error("send failed");
      } catch {
        window.clearTimeout(abortTimer);
        state = "failed";
        setFieldState(false);
        form.removeAttribute("aria-busy");
        send.textContent = "Send message";
        status.textContent =
          "Your message was not sent because the mail server is unavailable. Your details are still here, so you can try again.";
        send.focus({ preventScroll: true });
      }
    })();
  });

  const recount = (field: EnquiryField): void => {
    if (!checked) return;
    const errors = validateEnquiry(values());
    setError(field, errors[field]);
    const count = Object.keys(fields).filter(
      (key) => fields[key as EnquiryField].getAttribute("aria-invalid") === "true"
    ).length;
    updateStatus(count);
    if (count === 0 && state === "invalid") state = "editing";
  };

  for (const field of Object.keys(fields) as EnquiryField[]) {
    const element = fields[field];
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      element.addEventListener("input", () => recount(field));
      element.addEventListener("change", () => recount(field));
    } else {
      // the budget band: a radiogroup, so every radio inside carries the change
      for (const input of qsa<HTMLInputElement>("input", element)) {
        input.addEventListener("change", () => recount(field));
      }
      element.addEventListener("input", () => recount(field));
    }
  }

  another.addEventListener("click", () => {
    state = "editing";
    checked = false;
    form.reset();
    for (const field of Object.keys(fields) as EnquiryField[]) setError(field, undefined);
    updateStatus(0);
    status.textContent = "";
    sentPanel.hidden = true;
    form.hidden = false;
    (fields.name as HTMLInputElement).focus({ preventScroll: true });
  });
}
