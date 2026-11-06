// Structured JSON log lines on stdout (brief: Deployment, Logs). Messages carry ids and outcomes only: no cookie,
// password, Bearer token, card token or vet token ever reaches a line.
import { config } from "./config.js";
import { currentContext } from "./context.js";
export function log(level, msg, fields = {}) {
    const line = {
        ts: new Date().toISOString(),
        level,
        msg,
        request_id: currentContext().requestId,
        instance: config.instanceLabel,
        ...fields,
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
}
/** The request path as logged (never its query, which holds signatures): vet tokens become `[token]`. */
export function loggedPath(pathname) {
    return pathname.replace(/^\/api\/vet\/[^/]+/, "/api/vet/[token]").replace(/^\/vet\/[^/]+/, "/vet/[token]");
}
export const errorText = (error) => (error instanceof Error ? error.message : "unknown error");
