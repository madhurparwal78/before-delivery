import type { Bootstrap } from "../../shared/api.ts";

/** Values the server embeds in every page (brief: Configuration and secrets). */
export const bootstrap: Bootstrap = JSON.parse(document.getElementById("bootstrap")?.textContent ?? "{}") as Bootstrap;
