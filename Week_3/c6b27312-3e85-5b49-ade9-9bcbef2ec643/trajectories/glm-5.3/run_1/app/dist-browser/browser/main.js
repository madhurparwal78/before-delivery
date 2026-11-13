import { el } from "./dom.js";
import { api } from "./api.js";
import { renderPartPage } from "./part.js";
import { renderHome, renderDashboard } from "./pages.js";
import { renderSignin, renderSignup, renderPublish, renderRoom, renderCompare, renderTape } from "./rooms.js";
/** Drawn chrome: frame, vertex dots, crosshair, dimension leader. */
function setupChrome() {
    const frame = document.querySelector('[data-ui="frame"]');
    const dots = document.querySelector('[data-ui="vertex-dots"]');
    const crosshair = document.querySelector('[data-ui="crosshair"]');
    const leader = document.querySelector('[data-ui="dimension-leader"]');
    const leaderFigure = document.querySelector('[data-ui="leader-figure"]');
    const leaderUnit = document.querySelector('[data-ui="leader-unit"]');
    const h1 = () => document.querySelector("h1");
    const place = () => {
        const target = h1();
        if (!target || !frame || !dots || !crosshair || !leader || !leaderFigure || !leaderUnit)
            return;
        const r = target.getBoundingClientRect();
        if (r.width === 0)
            return;
        // Frame just outside the heading.
        const pad = 6;
        frame.setAttribute("x", String(r.left - pad));
        frame.setAttribute("y", String(r.top - pad));
        frame.setAttribute("width", String(r.width + pad * 2));
        frame.setAttribute("height", String(r.height + pad * 2));
        // Vertex dots on each corner.
        const dot = window.innerWidth >= 1024 ? 14 : 10;
        const corners = [
            [r.left - pad, r.top - pad],
            [r.left + r.width + pad, r.top - pad],
            [r.left - pad, r.top + r.height + pad],
            [r.left + r.width + pad, r.top + r.height + pad],
        ];
        dots.replaceChildren();
        for (const [cx, cy] of corners) {
            const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            c.setAttribute("cx", String(cx));
            c.setAttribute("cy", String(cy));
            c.setAttribute("r", String(dot / 2));
            dots.append(c);
        }
        // Crosshair at the viewport centre.
        const vp = document.querySelector('[data-ui="viewport"]');
        crosshair.replaceChildren();
        if (vp) {
            const vr = vp.getBoundingClientRect();
            const cx = vr.left + vr.width / 2;
            const cy = vr.top + vr.height / 2;
            const size = 10;
            const h = document.createElementNS("http://www.w3.org/2000/svg", "line");
            h.setAttribute("x1", String(cx - size));
            h.setAttribute("x2", String(cx + size));
            h.setAttribute("y1", String(cy));
            h.setAttribute("y2", String(cy));
            h.setAttribute("stroke", "currentColor");
            h.setAttribute("stroke-width", "1");
            const v = document.createElementNS("http://www.w3.org/2000/svg", "line");
            v.setAttribute("x1", String(cx));
            v.setAttribute("x2", String(cx));
            v.setAttribute("y1", String(cy - size));
            v.setAttribute("y2", String(cy + size));
            v.setAttribute("stroke", "currentColor");
            v.setAttribute("stroke-width", "1");
            crosshair.append(h, v);
        }
        // Dimension leader beside the heading: rendered width in inches, 2 sig figs.
        const inches = r.width / 96;
        const figure = significant2(inches);
        const y = r.bottom + 14;
        const x0 = r.left;
        const x1 = r.right;
        const lines = leader.querySelectorAll("line");
        if (lines.length >= 3) {
            lines[0].setAttribute("x1", String(x0));
            lines[0].setAttribute("y1", String(r.bottom + 6));
            lines[0].setAttribute("x2", String(x0));
            lines[0].setAttribute("y2", String(y + 2));
            lines[1].setAttribute("x1", String(x1));
            lines[1].setAttribute("y1", String(r.bottom + 6));
            lines[1].setAttribute("x2", String(x1));
            lines[1].setAttribute("y2", String(y + 2));
            lines[2].setAttribute("x1", String(x0));
            lines[2].setAttribute("y1", String(y));
            lines[2].setAttribute("x2", String(x1));
            lines[2].setAttribute("y2", String(y));
        }
        const arrows = leader.querySelectorAll("polygon");
        if (arrows.length >= 2) {
            arrows[0].setAttribute("points", `${x0},${y} ${x0 + 6},${y - 3} ${x0 + 6},${y + 3}`);
            arrows[1].setAttribute("points", `${x1},${y} ${x1 - 6},${y - 3} ${x1 - 6},${y + 3}`);
        }
        leaderFigure.setAttribute("x", String((x0 + x1) / 2 - 20));
        leaderFigure.setAttribute("y", String(y + 4));
        leaderFigure.textContent = figure;
        leaderUnit.setAttribute("x", String((x0 + x1) / 2 + 14));
        leaderUnit.setAttribute("y", String(y + 4));
    };
    window.addEventListener("resize", () => place());
    window.setInterval(place, 800);
    place();
}
function significant2(n) {
    if (n === 0)
        return "0";
    const exp = Math.floor(Math.log10(Math.abs(n)));
    const digits = Math.max(0, 1 - exp);
    const rounded = Math.round(Math.abs(n) / 10 ** (exp - 1)) * 10 ** (exp - 1);
    return rounded.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
/** The storage banner, driven by the health answer (H4). */
async function setupStorageBanner() {
    try {
        const res = await fetch("/api/health", { credentials: "same-origin" });
        const json = (await res.json());
        if (json.storage === "down")
            showStorageBanner();
    }
    catch { /* unreachable server: nothing to show */ }
    window.addEventListener("tinework:storage-unavailable", () => showStorageBanner());
}
function showStorageBanner() {
    const root = document.getElementById("status-banners");
    if (document.getElementById("storage-banner"))
        return;
    const banner = el("div", { class: "status-banner", role: "status", id: "storage-banner" });
    banner.textContent = "Part storage is unreachable. Viewing and discussion still work.";
    root.append(banner);
}
/** Top navigation sign-in state. */
async function setupNav() {
    try {
        await api.me();
        const signin = document.getElementById("nav-signin");
        const dashboard = document.getElementById("nav-dashboard");
        const signout = document.getElementById("nav-signout");
        if (signin)
            signin.hidden = true;
        if (dashboard)
            dashboard.hidden = false;
        if (signout) {
            signout.hidden = false;
            signout.addEventListener("click", async () => {
                await api.signout();
                location.href = "/";
            });
        }
    }
    catch {
        const signin = document.getElementById("nav-signin");
        if (signin)
            signin.hidden = false;
    }
}
async function boot() {
    const app = document.getElementById("app");
    const config = await api.config();
    const me = await api.me().catch(() => null);
    const ctx = { config, me, app };
    const path = location.pathname;
    const params = new URLSearchParams(location.search);
    if (path === "/" || path === "") {
        await renderHome(ctx);
    }
    else if (path.startsWith("/parts/")) {
        const rest = path.slice("/parts/".length);
        if (rest === "new") {
            if (!me) {
                location.href = `/signin?next=${encodeURIComponent(path)}`;
                return;
            }
            await renderPublish(ctx);
        }
        else if (rest.endsWith("/compare")) {
            const slug = rest.slice(0, -"/compare".length);
            await renderCompare(ctx, slug, params);
        }
        else {
            await renderPartPage(ctx, rest, params);
        }
    }
    else if (path.startsWith("/tapes/")) {
        await renderTape(ctx, path.slice("/tapes/".length));
    }
    else if (path.startsWith("/rooms/")) {
        if (!me) {
            location.href = `/signin?next=${encodeURIComponent(path)}`;
            return;
        }
        await renderRoom(ctx, path.slice("/rooms/".length));
    }
    else if (path === "/dashboard") {
        if (!me) {
            location.href = `/signin?next=${encodeURIComponent(path)}`;
            return;
        }
        await renderDashboard(ctx);
    }
    else if (path === "/signin") {
        await renderSignin(ctx, params);
    }
    else if (path === "/signup") {
        await renderSignup(ctx);
    }
    void setupChrome();
    void setupNav();
    void setupStorageBanner();
}
void boot();
