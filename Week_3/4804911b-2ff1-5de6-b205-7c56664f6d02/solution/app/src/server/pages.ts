import type { IncomingMessage, ServerResponse } from "node:http";
import { accountOf } from "./auth.js";
import { db, isReady } from "./db.js";
import { sendAsset, sendShell } from "./static.js";

const SCREEN = { editor: "/editor", stockist: "/stockist" } as const;

function redirect(res: ServerResponse, to: string): void {
  res.writeHead(302, { location: to, "cache-control": "no-store", "content-length": 0 });
  res.end();
}

/** Page routes: the app shell for known screens, built files for assets, the shell with a 404 for everything else. */
export async function dispatchPage(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const head = req.method === "HEAD";
  if (req.method !== "GET" && !head) {
    res.writeHead(405, { allow: "GET, HEAD", "content-length": 0 });
    res.end();
    return;
  }
  if (pathname !== "/" && (await sendAsset(res, pathname, head))) return;
  if (pathname === "/" ) return sendShell(res, 200, false);
  if (pathname === "/sign-in" || pathname === "/stockist" || pathname === "/editor") {
    const account = isReady() ? await accountOf(req).catch(() => null) : null;
    if (pathname === "/sign-in") return account ? redirect(res, SCREEN[account.role]) : sendShell(res, 200, false);
    if (!account) return redirect(res, "/sign-in");
    if (SCREEN[account.role] !== pathname) return redirect(res, SCREEN[account.role]);
    return sendShell(res, 200, true);
  }
  const notice = /^\/notices\/(VT-\d{4}-\d{2,})$/.exec(pathname);
  if (notice) {
    const exists = !isReady() || (await db.query("SELECT 1 FROM notices WHERE number = $1", [notice[1]]).then((r) => r.rows.length > 0, () => true));
    return sendShell(res, exists ? 200 : 404, false);
  }
  return sendShell(res, 404, false);
}
