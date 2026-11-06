import { clear, el } from "./util.js";
import { clubInfo, forgetClub, hooks, loadMe, renderTopBar, roleHome, showSignIn } from "./session.js";
import { renderMemberHome } from "./screens/memberhome.js";
import { renderMemberCycle } from "./screens/membercycle.js";
import { renderCreditHistory } from "./screens/credithistory.js";
import { renderCoordinatorList } from "./screens/coordlist.js";
import { renderCoordinatorCycle } from "./screens/coordcycle.js";
import { renderBreakdown } from "./screens/breakdown.js";
import { renderNotFound } from "./screens/notfound.js";
import { resetLiveRegions } from "./live.js";
let routeToken = 0;
function navigate(path) {
    history.pushState(null, "", path);
    void renderRoute();
}
export { navigate };
export async function renderRoute() {
    const token = ++routeToken;
    const me = await loadMe();
    if (token !== routeToken)
        return;
    const path = location.pathname;
    resetLiveRegions();
    if (!me) {
        forgetClub();
        showSignIn(path);
        return;
    }
    const club = await clubInfo();
    if (token !== routeToken)
        return;
    renderTopBar(club.name, me);
    const main = document.getElementById("main");
    clear(main);
    const page = el("div", { class: "page" });
    main.append(page);
    const cycleMatch = /^\/cycles\/([^/]+)$/.exec(path);
    const coordMatch = /^\/coordinator\/cycles\/([^/]+)$/.exec(path);
    if (path === "/") {
        if (me.role === "member")
            await renderMemberHome(page, me);
        else
            history.replaceState(null, "", roleHome(me)), void renderRoute();
        return;
    }
    if (cycleMatch) {
        if (me.role === "member") {
            await renderMemberCycle(page, me, decodeURIComponent(cycleMatch[1]));
        }
        else {
            history.replaceState(null, "", roleHome(me));
            void renderRoute();
        }
        return;
    }
    if (path === "/credit") {
        if (me.role === "member")
            await renderCreditHistory(page, me);
        else {
            history.replaceState(null, "", roleHome(me));
            void renderRoute();
        }
        return;
    }
    if (path === "/coordinator") {
        if (me.role === "coordinator")
            await renderCoordinatorList(page, me);
        else {
            history.replaceState(null, "", roleHome(me));
            void renderRoute();
        }
        return;
    }
    if (path === "/coordinator/cycles/new") {
        if (me.role === "coordinator")
            await renderCoordinatorCycle(page, me, null);
        else {
            history.replaceState(null, "", roleHome(me));
            void renderRoute();
        }
        return;
    }
    if (coordMatch) {
        if (me.role === "coordinator")
            await renderCoordinatorCycle(page, me, decodeURIComponent(coordMatch[1]));
        else {
            history.replaceState(null, "", roleHome(me));
            void renderRoute();
        }
        return;
    }
    if (path === "/breakdown") {
        if (me.role === "volunteer" || me.role === "coordinator")
            await renderBreakdown(page, me);
        else {
            history.replaceState(null, "", roleHome(me));
            void renderRoute();
        }
        return;
    }
    renderNotFound(page, me);
}
/** The screen a role may see at this address, or its home after sign-in. */
export function screenAllowed(path, me) {
    if (path === "/")
        return true;
    if (/^\/cycles\/[^/]+$/.test(path))
        return me.role === "member";
    if (path === "/credit")
        return me.role === "member";
    if (path === "/coordinator" || path === "/coordinator/cycles/new" || /^\/coordinator\/cycles\/[^/]+$/.test(path)) {
        return me.role === "coordinator";
    }
    if (path === "/breakdown")
        return me.role === "volunteer" || me.role === "coordinator";
    return true;
}
export function boot() {
    hooks.signOutReset = () => {
        forgetClub();
        resetLiveRegions();
    };
    hooks.renderRoute = renderRoute;
    hooks.afterSignIn = (path, me) => {
        if (screenAllowed(path, me)) {
            void renderRoute();
        }
        else {
            history.replaceState(null, "", roleHome(me));
            void renderRoute();
        }
    };
    document.addEventListener("click", (e) => {
        const target = e.target;
        const link = target.closest("a[data-nav]");
        if (link) {
            e.preventDefault();
            navigate(link.getAttribute("href"));
        }
    });
    window.addEventListener("popstate", () => void renderRoute());
    window.addEventListener("resize", () => window.dispatchEvent(new CustomEvent("tally-resize")));
    void renderRoute();
}
boot();
