import { t, fmt } from "../i18n.js";
import { ui } from "../boot.js";
import { api } from "../api.js";
import { toast } from "../ui.js";
import type { Page } from "../router.js";

const page: Page = {
  async render(main: HTMLElement): Promise<void> {
    main.replaceChildren();
    const h1 = document.createElement("h1");
    h1.textContent = ui("moderation.title");
    main.appendChild(h1);
    const res = await api<{ id: number; cleanliness: number; comfort: number; location: number; staff: number; value: number; comment: string; property: string }[]>("/api/moderation/reviews");
    if (!res.ok) {
      const p = document.createElement("p");
      p.textContent = res.status === 403 ? t("page.forbidden", { fmt: fmt() }) : t("page.missing", { fmt: fmt() });
      main.appendChild(p);
      return;
    }
    if (res.data.length === 0) {
      const p = document.createElement("p");
      p.textContent = t("moderation.empty", { fmt: fmt() });
      main.appendChild(p);
      return;
    }
    for (const review of res.data) {
      const article = document.createElement("article");
      const scores = document.createElement("p");
      scores.textContent = `${review.cleanliness} ${review.comfort} ${review.location} ${review.staff} ${review.value}`;
      const comment = document.createElement("blockquote");
      comment.textContent = review.comment;
      const prop = document.createElement("p");
      prop.textContent = review.property;
      const publish = document.createElement("button");
      publish.textContent = `${ui("moderation.publish")} ${review.id}`;
      publish.addEventListener("click", async () => {
        publish.setAttribute("aria-busy", "true");
        const r = await api(`/api/moderation/reviews/${review.id}/publish`, { method: "POST" });
        publish.removeAttribute("aria-busy");
        if (r.ok) {
          toast(t("toast.published", { fmt: fmt() }));
          article.remove();
        }
      });
      const reject = document.createElement("button");
      reject.textContent = `${ui("moderation.reject")} ${review.id}`;
      reject.addEventListener("click", async () => {
        reject.setAttribute("aria-busy", "true");
        const r = await api(`/api/moderation/reviews/${review.id}/reject`, { method: "POST" });
        reject.removeAttribute("aria-busy");
        if (r.ok) {
          toast(t("toast.rejected", { fmt: fmt() }));
          article.remove();
        }
      });
      article.append(scores, comment, prop, publish, reject);
      main.appendChild(article);
    }
  }
};

export default page;
