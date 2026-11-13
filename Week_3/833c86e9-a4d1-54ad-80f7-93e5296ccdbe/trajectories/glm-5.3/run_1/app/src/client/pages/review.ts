import { t, fmt } from "../i18n.js";
import { ui } from "../boot.js";
import { api } from "../api.js";
import { toast } from "../ui.js";
import { onEvent } from "../events.js";
import { onCleanup } from "../router.js";
import type { Page } from "../router.js";

const page: Page = {
  async render(main: HTMLElement, params: URLSearchParams, path: string): Promise<void> {
    main.replaceChildren();
    const token = params.get("seg0") ?? path.split("/")[2];
    const host = document.createElement("div");
    main.appendChild(host);

    const load = async (): Promise<void> => {
      const res = await api<{ property: string; in: string; out: string; open_until: string }>(`/api/reviews/${token}`);
      host.replaceChildren();
      if (!res.ok) {
        const p = document.createElement("p");
        if (res.status === 403) p.textContent = t("review.early", { fmt: fmt() });
        else if (res.status === 410) p.textContent = t("review.closed", { fmt: fmt() });
        else if (res.status === 409) p.textContent = t("review.used", { fmt: fmt() });
        else p.textContent = t("find.none", { fmt: fmt() });
        host.appendChild(p);
        return;
      }
      const info = document.createElement("p");
      info.textContent = `${res.data.property} · ${res.data.in} → ${res.data.out}`;
      host.appendChild(info);
      const form = document.createElement("form");
      const fields: Record<string, HTMLInputElement> = {};
      for (const key of ["cleanliness", "comfort", "location", "staff", "value"] as const) {
        const lab = document.createElement("label");
        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.max = "10";
        input.setAttribute("role", "spinbutton");
        input.setAttribute("aria-label", ui("review." + key));
        fields[key] = input;
        lab.append(document.createTextNode(ui("review." + key)), input);
        form.appendChild(lab);
      }
      const commentLab = document.createElement("label");
      const comment = document.createElement("textarea");
      comment.setAttribute("aria-label", ui("review.comment"));
      commentLab.append(document.createTextNode(ui("review.comment")), comment);
      form.appendChild(commentLab);
      const submit = document.createElement("button");
      submit.textContent = ui("review.send");
      form.appendChild(submit);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = document.createElement("p");
        submit.setAttribute("aria-busy", "true");
        const res2 = await api<{ id: number; state: string }>(`/api/reviews/${token}`, {
          method: "POST",
          body: JSON.stringify({
            cleanliness: Number(fields.cleanliness.value),
            comfort: Number(fields.comfort.value),
            location: Number(fields.location.value),
            staff: Number(fields.staff.value),
            value: Number(fields.value.value),
            comment: comment.value
          })
        });
        submit.removeAttribute("aria-busy");
        if (!res2.ok) {
          if (res2.status === 422) {
            const fieldsErr = res2.data.fields as Record<string, string>;
            const bad = Object.entries(fieldsErr)[0];
            msg.textContent = bad?.[1] === "review.score_range" ? t("review.score_range", { fmt: fmt() }) : String(bad?.[1]);
            host.appendChild(msg);
          }
          return;
        }
        toast(t("toast.review_sent", { fmt: fmt() }));
        load();
      });
      host.appendChild(form);
    };
    await load();

    // the page re-reads the link status on every clock event
    const off = onEvent(() => { void load(); }, "clock");
    onCleanup(() => { off(); });
  }
};

export default page;
