// Client entry point: routes by path between the landing, forms and the project page.
import { api } from "./api.js";
import { renderLanding } from "./landing.js";
async function main() {
    const root = document.getElementById('app');
    const path = window.location.pathname;
    if (path === '/' || path === '') {
        // The landing page for a signed-out visitor; the Projects list for a member.
        try {
            const me = await api.me();
            const { renderProjects } = await import("./auth-pages.js");
            await renderProjects(root, me);
            return;
        }
        catch {
            renderLanding(root);
            return;
        }
    }
    await import("./project-page.js");
}
void main();
