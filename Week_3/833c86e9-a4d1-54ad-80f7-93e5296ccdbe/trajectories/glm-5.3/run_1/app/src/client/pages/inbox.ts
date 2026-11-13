import { t, fmt } from "../i18n.js";
import { ui } from "../boot.js";
import { api } from "../api.js";
import type { Page } from "../router.js";

const page: Page = {
  async render(main: HTMLElement): Promise<void> {
    main.replaceChildren();
    const region = document.createElement("section");
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", ui("inbox.title"));
    main.appendChild(region);
    const res = await api<{ id: number; at: string; kind: string; property: string; link: string }[]>("/api/inbox");
    if (!res.ok || res.data.length === 0) {
      const p = document.createElement("p");
      p.textContent = t("inbox.empty", { fmt: fmt() });
      region.appendChild(p);
      return;
    }
    const ul = document.createElement("ul");
    for (const m of res.data) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = m.link;
      a.setAttribute("aria-label", `${ui("inbox.review")} ${m.property}`);
      a.textContent = `${ui("inbox.review")} ${m.property}`;
      li.appendChild(a);
      ul.appendChild(li);
    }
    region.appendChild(ul);
  }
};

export default page;
