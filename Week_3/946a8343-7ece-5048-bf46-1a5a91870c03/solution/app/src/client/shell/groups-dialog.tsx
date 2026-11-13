// `dialog "Groups"`: the signed-in user's groups from GET /api/me/groups ({groups:[{id,path,name}]}), each a link to
// /groups/<path>.
import type { RefObject } from "preact";
import { api, useResource } from "../api.ts";
import { Dialog } from "../a11y/dialog.tsx";
import { A } from "../router.ts";
import { Button } from "../ui/button.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { Icon } from "../ui/icons.tsx";
import { isRecord, asNumber, asString } from "../util.ts";

interface GroupRow {
  id: number;
  path: string;
  name: string;
}

async function loadGroups(signal: AbortSignal): Promise<GroupRow[]> {
  const body: unknown = await api.get("/api/me/groups", { signal });
  const list = isRecord(body) && Array.isArray(body.groups) ? body.groups : [];
  const rows: GroupRow[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const id = asNumber(item.id);
    const path = asString(item.path);
    if (id === null || path === null) continue;
    rows.push({ id, path, name: asString(item.name) ?? path });
  }
  return rows;
}

function GroupsBody({ onClose }: { onClose: () => void }) {
  const groups = useResource(loadGroups, []);
  return (
    <>
      <div class="sp-dialog__bar">
        <h2 class="sp-dialog__title">Groups</h2>
        <Button variant="ghost" class="sp-dialog__close" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </Button>
      </div>
      {groups.error ? <Notice>{groups.error.message}</Notice> : null}
      {groups.loading && !groups.data ? <Skeleton rows={3} height={44} /> : null}
      {groups.data && groups.data.length === 0 ? <p class="sp-dialog__empty">You are not a member of any group yet.</p> : null}
      {groups.data && groups.data.length > 0 ? (
        <ul class="sp-group-list" aria-label="Your groups">
          {groups.data.map((group) => (
            <li key={group.id}>
              <A href={`/groups/${group.path.split("/").map(encodeURIComponent).join("/")}`} class="sp-group-list__link" onClick={onClose}>
                <span class="sp-group-list__name">{group.name}</span>
                <span class="sp-group-list__path">{group.path}</span>
              </A>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function GroupsDialog({ open, onClose, opener }: { open: boolean; onClose: () => void; opener: RefObject<HTMLElement> }) {
  return (
    <Dialog name="Groups" open={open} onClose={onClose} opener={opener}>
      <GroupsBody onClose={onClose} />
    </Dialog>
  );
}
