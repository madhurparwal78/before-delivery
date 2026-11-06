/** The Friends dialog and the boot entry. */

import { api, ApiError } from "./lib/api.js";
import { h, clear, statusRegion, setStatus } from "./lib/dom.js";
import { boot, registerRoute, renderNotFound, currentMe } from "./app.js";
import { Copy } from "../shared/copy.js";
import "./screens/auth.js";
import "./screens/servers.js";
import "./screens/world.js";
import "./screens/manage.js";
import "./styles.css";

registerRoute(".*", (_params, render) => renderNotFound(render.main), true);

let friendsOpen = false;

window.addEventListener("open-friends", () => {
  if (friendsOpen) return;
  void openFriends();
});

async function openFriends(): Promise<void> {
  const slug = /^\/s\/([^/]+)/.exec(location.pathname)?.[1];
  if (slug === undefined) return;
  friendsOpen = true;
  const dialog = h("dialog", { class: "sheet modal-centre", "aria-label": "Friends" }) as unknown as HTMLDialogElement;
  const list = h("ul", { "aria-label": "Friends" });
  const emailInput = h("input", { type: "email", "aria-label": "Friend's email" }) as unknown as HTMLInputElement;
  const status = statusRegion("Invite status", "invite-status");
  const invites = h("ul", { "aria-label": "Invites" });
  const load = async (): Promise<void> => {
    const friends = await api<{ friends: { display_name: string; handle: string; online: boolean }[] }>(`/api/servers/${slug}/friends`);
    clear(list);
    for (const friend of friends.data.friends) {
      list.append(h("li", {}, `${friend.display_name} (${friend.handle}): ${friend.online ? "ONLINE" : "OFFLINE"}`));
    }
    const mine = await api<{ invites: { email: string; state: string; mail: string }[] }>(`/api/servers/${slug}/invites`);
    clear(invites);
    for (const invite of mine.data.invites) {
      invites.append(h("li", {}, `${invite.email}: ${invite.state.toUpperCase()} (${invite.mail.toUpperCase()})`));
    }
  };
  const send = h("button", { class: "primary", onclick: async () => {
    try {
      const res = await api<{ invite: { mail: string } }>(`/api/servers/${slug}/invites`, {
        method: "POST",
        idempotencyKey: `invite-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        body: { email: emailInput.value },
      });
      setStatus(status, res.data.invite.mail === "held" ? Copy.invites.held : `Invite sent to ${emailInput.value}`);
      emailInput.value = "";
      await load();
    } catch (err) {
      if (err instanceof ApiError) setStatus(status, err.failure.message);
    }
  } }, "Send invite");
  dialog.append(
    h("div", { class: "dialog-body" },
      h("h2", { class: "dialog-title" }, "Friends"),
      list,
      h("label", {}, "Friend's email"),
      emailInput,
      send,
      invites,
      status,
      h("button", { onclick: () => dialog.close() }, "Close")
    )
  );
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    dialog.remove();
    friendsOpen = false;
  });
  dialog.showModal();
  await load();
}

void currentMe;

const root = document.getElementById("root");
if (root !== null) {
  void boot(root);
}
