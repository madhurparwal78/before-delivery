// Live updates for a page that shows things from several projects (the group board and the epic): one channel per project, the
// page's announcements, and a reload when a message names what the page shows.
import { useLayoutEffect, useRef } from "preact/hooks";
import { announce } from "../../announce.tsx";
import { api } from "../../api.ts";
import { startChannel, subscribeProject, type LiveMessage } from "../../live.ts";
import { useUser } from "../../session.ts";
import { asNumber, isRecord } from "../../util.ts";

function useProjectsLive(projectIds: readonly number[], pageKey: string | null, wants: (message: LiveMessage) => boolean, reload: () => void): void {
  const me = useUser();
  const latest = useRef({ reload, wants, username: me?.username ?? null });
  latest.current = { reload, wants, username: me?.username ?? null };
  useLayoutEffect(() => {
    let alive = true;
    const stops: Array<() => void> = [];
    const onMessage = (message: LiveMessage) => {
      for (const say of message.data.say ?? []) {
        if (say.to !== undefined && say.to !== latest.current.username) continue;
        if (say.pages !== undefined && say.pages.length > 0 && (pageKey === null || !say.pages.includes(pageKey))) continue;
        announce(say.text);
      }
      if (latest.current.wants(message)) latest.current.reload();
    };
    for (const id of projectIds) {
      stops.push(subscribeProject(id, { onMessage, onResync: () => latest.current.reload() }));
      void api.get<unknown>(`/api/projects/${id}`).then(
        (raw) => {
          if (!alive) return;
          const body = isRecord(raw) && isRecord(raw.project) ? raw.project : raw;
          stops.push(startChannel(id, isRecord(body) ? asNumber(body.seq) : null));
        },
        () => undefined,
      );
    }
    return () => {
      alive = false;
      for (const stop of stops) stop();
    };
  }, [projectIds.join(",")]);
}

export function useGroupBoardLive(projectIds: readonly number[], boardId: number, reload: () => void): void {
  useProjectsLive(
    projectIds,
    `board:${boardId}`,
    (message) => {
      if (message.type !== "board") return false;
      const ids = message.data.board_ids;
      return !Array.isArray(ids) || ids.includes(boardId);
    },
    reload,
  );
}

export function useEpicLive(projectIds: readonly number[], iid: number, reload: () => void): void {
  useProjectsLive(projectIds, null, (message) => message.type === "epic" && asNumber(message.data.iid) === iid, reload);
}
