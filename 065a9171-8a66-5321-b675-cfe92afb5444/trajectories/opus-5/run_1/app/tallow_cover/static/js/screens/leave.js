// Request leave, My requests and one request's detail.

import { OFFLINE, api } from "../api.js";
import {
  append,
  clear,
  el,
  errorSlot,
  openDialog,
  say,
  select,
  showFieldErrors,
  statusRegion,
} from "../dom.js";
import { STATUS_LABELS, TYPE_LABELS, formatDate } from "../format.js";
import { homeName } from "../homes.js";

function failureText(error) {
  return error.status === 0 ? OFFLINE : error.message;
}

export const newRequest = {
  async render({ me, navigate }) {
    const status = statusRegion("Leave status");
    const type = select(
      "Leave type",
      [
        { value: "annual", label: "Annual leave" },
        { value: "unpaid", label: "Unpaid leave" },
        { value: "compassionate", label: "Compassionate leave" },
      ],
      "annual"
    );
    const first = el("input", { type: "text", "aria-label": "First day", placeholder: "YYYY-MM-DD" });
    const last = el("input", { type: "text", "aria-label": "Last day", placeholder: "YYYY-MM-DD" });
    const note = el("textarea", { "aria-label": "Note", rows: "3" });
    const draftButton = el("button", { class: "quiet", type: "button", text: "Save draft" });
    const submitButton = el("button", { type: "submit", text: "Submit request" });
    const form = el(
      "form",
      { "aria-label": "Request leave" },
      el("label", {}, "Leave type", type),
      el("label", {}, "First day", first),
      errorSlot("start_date"),
      el("label", {}, "Last day", last),
      errorSlot("end_date"),
      el("label", {}, "Note", note),
      errorSlot("note"),
      errorSlot("type"),
      el("div", { class: "row" }, draftButton, submitButton)
    );

    async function send(submit) {
      showFieldErrors(form, {});
      say(status, submit ? "Submitting…" : "Saving draft…");
      draftButton.disabled = true;
      submitButton.disabled = true;
      try {
        const created = await api.post("/api/leave-requests", {
          type: type.value,
          start_date: first.value,
          end_date: last.value,
          note: note.value,
          submit,
        });
        if (!submit) {
          say(status, "Draft saved.");
          navigate(`/leave/${created.id}`);
          return;
        }
        const where = homeName(created.home_id);
        say(
          status,
          created.short_notice
            ? `Request sent to ${where}. It's inside the notice period, so it's marked short notice.`
            : `Request sent to ${where}.`
        );
        navigate(`/leave/${created.id}`);
      } catch (error) {
        showFieldErrors(form, error.errors || {});
        say(status, failureText(error));
      }
      draftButton.disabled = false;
      submitButton.disabled = false;
    }

    draftButton.addEventListener("click", () => send(false));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      send(true);
    });
    return el("div", {}, el("h1", { text: "Request leave" }), el("section", { class: "panel" }, form, status));
  },
};

export const myRequests = {
  async render() {
    const payload = await api.get("/api/me/leave-requests");
    const list = el("ul", { class: "plain", "aria-label": "My requests" });
    for (const item of payload.items) {
      list.append(
        el(
          "li",
          {},
          el("a", {
            href: `/leave/${item.id}`,
            text: `${TYPE_LABELS[item.type]}, ${formatDate(item.start_date)} to ${formatDate(
              item.end_date
            )}, ${STATUS_LABELS[item.status]}`,
          }),
          el("span", { text: `${item.hours} h` }),
          item.short_notice ? el("span", { class: "tag", text: "Short notice" }) : null
        )
      );
    }
    return el("div", {}, el("h1", { text: "My requests" }), el("section", { class: "panel" }, list));
  },
};

export const requestDetail = {
  async render({ me, params, navigate }) {
    const status = statusRegion("Leave status");
    const panel = el("section", { class: "panel" });

    async function load() {
      const item = await api.get(`/api/leave-requests/${params.id}`);
      clear(panel);
      append(
        panel,
        el("p", { text: `${TYPE_LABELS[item.type]} · ${STATUS_LABELS[item.status]}` }),
        el("p", {
          text: `${formatDate(item.start_date)} to ${formatDate(item.end_date)} · ${item.length_days} days`,
        }),
        el("p", { text: `${item.hours} hours booked` }),
        Number(item.sickness_hours) > 0
          ? el("p", { text: `${item.sickness_hours} hours returned for sick days` })
          : null,
        item.short_notice ? el("span", { class: "tag", text: "Short notice" }) : null,
        item.note ? el("p", { text: item.note }) : null
      );
      if (item.requester.id === me.id) {
        panel.append(
          el("button", {
            type: "button",
            text: "Withdraw request",
            onclick: async () => {
              say(status, "Withdrawing…");
              try {
                await api.post(`/api/leave-requests/${item.id}/withdraw`, {});
                say(status, "Request withdrawn.");
                await load();
              } catch (error) {
                say(status, failureText(error));
              }
            },
          })
        );
      }
      if (me.role === "hr_admin") panel.append(cancelButton(item));
    }

    function cancelButton(item) {
      const button = el("button", { class: "quiet", type: "button", text: "Cancel leave" });
      button.addEventListener("click", () => {
        const reason = el("input", { type: "text", "aria-label": "Reason" });
        const errors = errorSlot("reason");
        const dialog = el(
          "dialog",
          { "aria-label": "Cancel approved leave" },
          el("h2", { text: "Cancel approved leave" }),
          el("label", {}, "Reason", reason),
          errors,
          el(
            "div",
            { class: "row" },
            el("button", {
              type: "button",
              text: "Confirm cancellation",
              onclick: async () => {
                say(status, "Cancelling…");
                try {
                  await api.post(`/api/leave-requests/${item.id}/cancel`, { reason: reason.value });
                  dialog.close();
                  say(status, `Leave cancelled. ${item.requester.display_name} will be emailed.`);
                  await load();
                } catch (error) {
                  errors.textContent = error.errors?.reason || failureText(error);
                }
              },
            }),
            el("button", { class: "quiet", type: "button", text: "Close", onclick: () => dialog.close() })
          )
        );
        openDialog(dialog, reason, button);
      });
      return button;
    }

    await load();
    return el("div", {}, el("h1", { text: "Leave request" }), panel, status);
  },
};
