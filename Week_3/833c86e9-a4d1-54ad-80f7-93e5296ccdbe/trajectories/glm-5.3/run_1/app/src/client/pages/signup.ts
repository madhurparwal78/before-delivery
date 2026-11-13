import { t, fmt } from "../i18n.js";
import { ui, syncStateFromMe, refreshNav } from "../boot.js";
import { api } from "../api.js";
import type { Page } from "../router.js";

const page: Page = {
  async render(main: HTMLElement): Promise<void> {
    main.replaceChildren();
    const form = document.createElement("form");
    form.setAttribute("aria-label", ui("signup.title"));
    const mk = (label: string, key: string) => {
      const lab = document.createElement("label");
      const input = document.createElement("input");
      input.type = "password";
      input.dataset.field = key;
      lab.append(document.createTextNode(label), input);
      form.appendChild(lab);
      return input;
    };
    const username = mk(ui("signin.username"), "username");
    username.type = "text";
    const password = mk(ui("signin.password"), "password");
    const submit = document.createElement("button");
    submit.textContent = ui("signup.submit");
    form.appendChild(submit);
    const msg = document.createElement("p");
    form.appendChild(msg);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.textContent = "";
      submit.setAttribute("aria-busy", "true");
      const res = await api("/api/signup", {
        method: "POST",
        body: JSON.stringify({ username: username.value, password: password.value })
      });
      submit.removeAttribute("aria-busy");
      if (!res.ok) {
        const fields = res.data.fields as Record<string, string> | undefined;
        if (fields?.username) msg.textContent = t("signup.username", { fmt: fmt() });
        else if (fields?.password) msg.textContent = t("signup.password", { fmt: fmt() });
        else if (res.data.error === "username_taken") msg.textContent = t("signup.taken", { fmt: fmt() });
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
