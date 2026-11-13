import { t, fmt } from "../i18n.js";
import { ui } from "../boot.js";
import { api } from "../api.js";
import { status } from "../ui.js";
import type { Page } from "../router.js";

const page: Page = {
  async render(main: HTMLElement): Promise<void> {
    main.replaceChildren();
    const form = document.createElement("form");
    form.setAttribute("aria-label", ui("find.title"));
    const mk = (label: string, key: string) => {
      const lab = document.createElement("label");
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.field = key;
      lab.append(document.createTextNode(label), input);
      form.appendChild(lab);
      return input;
    };
    const code = mk(ui("find.code"), "code");
    const surname = mk(ui("find.surname"), "surname");
    const submit = document.createElement("button");
    submit.textContent = ui("find.submit");
    form.appendChild(submit);
    const msg = document.createElement("p");
    form.appendChild(msg);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submit.setAttribute("aria-busy", "true");
      const res = await api<{ code: string }>("/api/bookings/find", {
        method: "POST",
        body: JSON.stringify({ code: code.value, surname: surname.value })
      });
      submit.removeAttribute("aria-busy");
      if (!res.ok) {
        if (res.status === 404) msg.textContent = t("find.none", { fmt: fmt() });
        else if (res.status === 429) msg.textContent = t("rate.limited", { fmt: fmt() });
        return;
      }
      location.href = `/bookings/${res.data.code}`;
    });
    main.append(form);
  }
};

export default page;
