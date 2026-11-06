// Report sickness, the worker's own records, fit notes and the return.

import { OFFLINE, api, openDownload } from "../api.js";
import { clear, el, errorSlot, say, showFieldErrors, statusRegion } from "../dom.js";
import { SICKNESS_LABELS, formatDate } from "../format.js";

const MAX_FIT_NOTE_BYTES = 5000000;

function failureText(error) {
  return error.status === 0 ? OFFLINE : error.message;
}

export const list = {
  async render() {
    const status = statusRegion("Sickness status");
    const records = el("ul", { class: "plain", "aria-label": "My sickness records" });
    const first = el("input", {
      type: "text",
      "aria-label": "First day off sick",
      placeholder: "YYYY-MM-DD",
    });
    const reason = el("input", { type: "text", "aria-label": "Reason" });
    const submit = el("button", { type: "submit", text: "Report sickness" });
    const form = el(
      "form",
      { "aria-label": "Report sickness" },
      el("label", {}, "First day off sick", first),
      errorSlot("start_date"),
      el("label", {}, "Reason", reason),
      errorSlot("reason"),
      submit
    );

    async function load() {
      const payload = await api.get("/api/me/sickness");
      clear(records);
      for (const record of payload.items) {
        records.append(
          el(
            "li",
            {},
            el("a", {
              href: `/sickness/${record.id}`,
              text: `${formatDate(record.start_date)}, ${SICKNESS_LABELS[record.status]}`,
            }),
            el("span", { text: `${record.days} days` })
          )
        );
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      showFieldErrors(form, {});
      submit.disabled = true;
      say(status, "Reporting…");
      try {
        const created = await api.post("/api/sickness", {
          start_date: first.value,
          reason: reason.value,
        });
        say(
          status,
          created.status === "fit_note_required"
            ? "Sickness reported. Please upload a fit note — you've been off more than 7 days."
            : "Sickness reported. Get well soon."
        );
        await load();
      } catch (error) {
        showFieldErrors(form, error.errors || {});
        say(status, failureText(error));
      }
      submit.disabled = false;
    });

    await load();
    return el(
      "div",
      {},
      el("h1", { text: "Report sickness" }),
      el("section", { class: "panel" }, form, status),
      el("section", { class: "panel" }, el("h2", { text: "My sickness records" }), records)
    );
  },
};

export const detail = {
  async render({ params }) {
    const status = statusRegion("Sickness status");
    const panel = el("section", { class: "panel" });

    async function load() {
      const record = await api.get(`/api/sickness/${params.id}`);
      clear(panel);
      panel.append(
        el("p", { text: SICKNESS_LABELS[record.status] }),
        el("p", {
          text: `${formatDate(record.start_date)}${
            record.last_sick_date ? ` to ${formatDate(record.last_sick_date)}` : ""
          } · ${record.days} days`,
        })
      );
      const file = el("input", { type: "file", "aria-label": "Fit note file" });
      const upload = el("button", { type: "button", text: "Upload fit note" });
      upload.addEventListener("click", async () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        if (chosen.size > MAX_FIT_NOTE_BYTES) {
          say(status, "Fit notes can be up to 5,000,000 bytes.");
          return;
        }
        upload.disabled = true;
        say(status, "Uploading fit note…");
        try {
          await api.upload(`/api/sickness/${record.id}/fit-note`, chosen);
          say(status, "Fit note received. It is being stored securely.");
          await load();
          return;
        } catch (error) {
          say(
            status,
            error.status === 413 ? "Fit notes can be up to 5,000,000 bytes." : failureText(error)
          );
        }
        upload.disabled = false;
      });
      panel.append(el("label", {}, "Fit note file", file), upload);
      if (record.fit_note) {
        panel.append(
          el("a", {
            href: "#",
            text: "Open fit note",
            onclick: async (event) => {
              event.preventDefault();
              say(status, "Opening…");
              try {
                await openDownload(`/api/sickness/${record.id}/fit-note`);
              } catch (error) {
                say(status, failureText(error));
              }
            },
          })
        );
      }
      const lastDay = el("input", {
        type: "text",
        "aria-label": "Last day off sick",
        placeholder: "YYYY-MM-DD",
      });
      const back = el("button", { type: "button", text: "I'm back at work" });
      const lastError = errorSlot("last_sick_date");
      back.addEventListener("click", async () => {
        back.disabled = true;
        lastError.textContent = "";
        say(status, "Saving…");
        try {
          await api.post(`/api/sickness/${record.id}/return`, { last_sick_date: lastDay.value });
          say(status, "Welcome back. Sickness record closed.");
          await load();
          return;
        } catch (error) {
          lastError.textContent = error.errors?.last_sick_date || "";
          say(status, failureText(error));
        }
        back.disabled = false;
      });
      panel.append(el("label", {}, "Last day off sick", lastDay), lastError, back);
    }

    await load();
    return el("div", {}, el("h1", { text: "Sickness record" }), panel, status);
  },
};
