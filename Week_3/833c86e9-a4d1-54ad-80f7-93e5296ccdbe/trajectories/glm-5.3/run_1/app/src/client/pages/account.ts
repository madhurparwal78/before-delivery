import { state, t, fmt } from "../i18n.js";
import { ui, syncStateFromMe, refreshNav } from "../boot.js";
import { api } from "../api.js";
import { toast } from "../ui.js";
import type { Page } from "../router.js";

const page: Page = {
  async render(main: HTMLElement): Promise<void> {
    main.replaceChildren();
    const region = document.createElement("section");
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", ui("account.loyalty"));
    main.appendChild(region);
    const tierLine = document.createElement("p");
    tierLine.textContent = `${state.tier}: ${t("loyalty.line", { tier: state.tier, count_noun: "stay", n: state.completedStays, fmt: fmt() })}`;
    region.appendChild(tierLine);
    const perks = document.createElement("ul");
    for (const perk of state.perks) {
      const li = document.createElement("li");
      li.textContent = t(perk === "perk.late" ? "perk.late" : "perk.drink", { fmt: fmt() });
      perks.appendChild(li);
    }
    region.appendChild(perks);

    const signOut = document.createElement("button");
    signOut.textContent = ui("account.sign_out");
    signOut.addEventListener("click", async () => {
      signOut.setAttribute("aria-busy", "true");
      await api("/api/signout-everywhere", { method: "POST" });
      signOut.removeAttribute("aria-busy");
      await syncStateFromMe();
      refreshNav();
      toast(t("signed.out", { fmt: fmt() }));
      location.href = "/signin";
    });
    main.appendChild(signOut);
  }
};

export default page;
