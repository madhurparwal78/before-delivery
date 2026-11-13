import { t, fmt } from "../i18n.js";
import { ui, syncStateFromMe, refreshNav } from "../boot.js";
import { api } from "../api.js";
import type { Page } from "../router.js";

const page: Page = {
  async render(main: HTMLElement): Promise<void> {
    main.replaceChildren();
    const form = document.createElement("form");
    form.setAttribute("aria-label", ui("signin.title"));
    const mk = (label: string, key: string, type = "text") => {
      const lab = document.createElement("label");
      const input = document.createElement("input");
      input.type = type;
      input.dataset.field = key;
      lab.append(document.createTextNode(label), input);
      form.appendChild(lab);
      return input;
    };
    const username = mk(ui("signin.username"), "username");
    const password = mk(ui("signin.password"), "password", "password");
    const submit = document.createElement("button");
    submit.textContent = ui("signin.submit");
    form.appendChild(submit);
    const msg = document.createElement("p");
    form.appendChild(msg);
    const create = document.createElement("a");
    create.href = "/signup";
    create.textContent = ui("signin.create");
    form.appendChild(create);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.textContent = "";
      submit.setAttribute("aria-busy", "true");
      const res = await api("/api/signin", {
        method: "POST",
        body: JSON.stringify({ username: username.value, password: password.value })
      });
      submit.removeAttribute("aria-busy");
      if (!res.ok) {
        msg.textContent = res.status === 401 ? t("signin.failed", { fmt: fmt() }) : res.status === 429 ? t("rate.limited", { fmt: fmt() }) : "";
        return;
      }
      await syncStateFromMe();
      refreshNav();
      location.href = "/account";
    });
    main.appendChild(form);
  }
};

export default page;
