import { api } from "../api.js";
import { el } from "../util.js";
import { onPaymentsChange, refreshPaymentsStatus } from "../session.js";
import { clear } from "../util.js";
/** Member home: open cycles, then this household's cycles in sealing through breakdown. */
export async function renderMemberHome(page, me) {
    void me;
    const notices = el("div", { class: "notices", role: "region", "aria-label": "Notices" });
    const openList = el("ul", { class: "links-list", "aria-label": "Open cycles" });
    const otherList = el("ul", { class: "links-list", "aria-label": "Your cycles" });
    page.append(el("h1", { text: "Cycles" }), notices, el("h2", { text: "Open cycles" }), openList, el("h2", { text: "Your cycles" }), otherList);
    const draw = (cycles) => {
        const open = cycles.filter((c) => c.status === "open");
        const mine = cycles.filter((c) => ["sealing", "ordered", "received", "breakdown", "closing"].includes(c.status));
        clear(openList);
        clear(otherList);
        if (open.length === 0) {
            openList.append(el("li", {}, el("div", { class: "empty-message", text: "There's no open cycle right now. The next case list appears here when the coordinator opens it." })));
        }
        for (const c of open) {
            openList.append(el("li", {}, el("a", { href: `/cycles/${c.id}`, "data-nav": true, text: `${c.name} — cutoff ${c.cutoff_display ?? ""}` })));
        }
        for (const c of mine) {
            otherList.append(el("li", {}, el("a", { href: `/cycles/${c.id}`, "data-nav": true, text: `${c.name} — ${c.status}` })));
        }
    };
    const drawNotices = (paused) => {
        clear(notices);
        if (paused) {
            notices.append(el("div", { class: "banner", text: "Payments are paused. We can't take top-ups right now; your credit and pledges are safe." }));
        }
    };
    onPaymentsChange(drawNotices);
    void refreshPaymentsStatus();
    const load = async () => {
        const { data } = await api("/api/cycles");
        draw(data.cycles);
    };
    await load();
    const timer = setInterval(() => {
        if (!document.body.contains(openList)) {
            clearInterval(timer);
            return;
        }
        void load();
        void refreshPaymentsStatus();
    }, 10000);
}
