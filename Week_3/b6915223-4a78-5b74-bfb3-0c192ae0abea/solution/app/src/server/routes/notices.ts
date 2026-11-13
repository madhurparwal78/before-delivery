import type { NoticesView } from "../../shared/api.ts";
import { pool, publish } from "../db.ts";
import { ApiError } from "../errors.ts";
import { json, route } from "../http.ts";
import { listNotices, markAllRead, PocketBaseUnreachable } from "../pocketbase.ts";

// The notice inbox reads back from PocketBase (brief: Notices). Any signed-in role.

async function viaInbox<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PocketBaseUnreachable) {
      throw new ApiError(503, "inbox_unavailable", "Notices are delayed. They will appear here when the inbox is back.");
    }
    throw error;
  }
}

export const noticeRoutes = [
  route("GET", "/api/notices", "signed-in", async ({ session }) => {
    const notices = await viaInbox(() => listNotices(session.managerId));
    const view: NoticesView = { unread: notices.filter((notice) => !notice.read).length, notices };
    return json(200, view);
  }),

  route("POST", "/api/notices/read-all", "signed-in", async ({ session }) => {
    await viaInbox(() => markAllRead(session.managerId));
    await publish(pool, { t: "notice", manager: session.managerId });
    return json(204);
  }),
];
