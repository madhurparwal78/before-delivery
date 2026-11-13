import type { ClientConfig } from "../shared/protocol";

/** The limits this server instance runs with, written into the page by the server. */
export const clientConfig: ClientConfig = JSON.parse(document.getElementById("seam-config")?.textContent ?? "{}") as ClientConfig;
