// The share reader client: a read-only surface that follows the server.

import { h, clearChildren, dateHeading } from "./dom.js";
import { sanitizeBody } from "../shared/richtext.js";
import { SHARE_REFRESH } from "./constants.js";

interface ShareStatus {
  status: "active" | "expired" | "revoked" | "unknown";
  expires_at_display?: string;
}

interface ShareCollection {
  status: string;
  collection: { name: string };
  expires_at_display: string;
  objects: Array<{ id: string; title: string; type_name: string }>;
}

interface ShareObject {
  id: string;
  title: string;
  type_name: string;
  properties: Record<string, unknown>;
  blocks: Array<{ id: string; kind: string; position: number; body: string | null; hidden?: boolean; attachment: { id: string; filename: string; content_type: string } | null }>;
  backlinks: Array<{ from_object_id: string; from_title: string; kind: string }>;
}

async function get<T>(path: string): Promise<{ status: number; body: T | null }> {
  try {
    const res = await fetch(path, { credentials: "omit" });
    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return { status: res.status, body: parsed as T };
  } catch {
    return { status: 0, body: null };
  }
}

export async function bootShare(token: string, objectId: string | null): Promise<void> {
  const main = h("main", { class: "share-main" });
  document.body.append(main);
  const linkStatus = h("div", { role: "status", "aria-live": "polite", "aria-label": "Link status", class: "share-link-status" });

  const renderInactive = (heading: string, sub: string, statusText: string): void => {
    clearChildren(main);
    main.append(h("h1", {}, heading), linkStatus);
    linkStatus.textContent = statusText;
    if (sub.length > 0) main.append(h("p", { class: "share-sub" }, sub));
  };

  const poll = async (): Promise<boolean> => {
    const res = await get<ShareStatus>(`/s/${token}/api/status`);
    if (res.status === 404) {
      renderInactive("This link is not recognised", "", "This link is not recognised.");
      return false;
    }
    const body = res.body;
    if (body === null || body.status !== "active") {
      renderInactive("This link is no longer active", "Ask the person who shared it for a new link.", "This link is no longer active.");
      return false;
    }
    return true;
  };

  const active = await poll();
  if (!active) {
    setInterval(() => void poll(), SHARE_REFRESH);
    return;
  }

  if (objectId === null) {
    await renderCollection();
    setInterval(async () => {
      if (await poll()) await renderCollection();
    }, SHARE_REFRESH);
  } else {
    await renderObject(objectId);
    setInterval(async () => {
      if (await poll()) await renderObject(objectId);
    }, SHARE_REFRESH);
  }

  async function renderCollection(): Promise<void> {
    const res = await get<ShareCollection>(`/s/${token}/api/collection`);
    if (res.status === 410 || res.status === 404 || res.body === null || res.body.status !== "active") {
      renderInactive("This link is no longer active", "Ask the person who shared it for a new link.", "This link is no longer active.");
      return;
    }
    clearChildren(main);
    main.append(h("h1", {}, res.body.collection.name), linkStatus);
    linkStatus.textContent = "";
    const list = h("ul", { class: "share-notes", "aria-label": "Shared notes" });
    for (const obj of res.body.objects) {
      list.append(h("li", {}, h("a", { href: `/s/${token}/o/${obj.id}` }, obj.title)));
    }
    main.append(list);
    main.append(h("p", { class: "share-expiry" }, `Expires ${res.body.expires_at_display}`));
  }

  async function renderObject(objectId: string): Promise<void> {
    const res = await get<ShareObject>(`/s/${token}/api/objects/${objectId}`);
    if (res.status === 404) {
      renderInactive("This note is not part of this share.", "", "This note is not part of this share.");
      return;
    }
    if (res.status === 410 || res.body === null) {
      renderInactive("This link is no longer active", "Ask the person who shared it for a new link.", "This link is no longer active.");
      return;
    }
    const obj = res.body;
    clearChildren(main);
    const col = h("div", { class: "share-column" }, h("h1", {}, obj.title), linkStatus);
    linkStatus.textContent = "";
    // shareable properties
    const propList = h("dl", { class: "share-properties" });
    for (const [name, value] of Object.entries(obj.properties)) {
      propList.append(h("dt", {}, name), h("dd", {}, value === null ? "—" : String(value)));
    }
    if (Object.keys(obj.properties).length > 0) col.append(propList);
    for (const block of obj.blocks) {
      if (block.kind === "quote") {
        if (block.hidden === true) {
          col.append(h("figure", { class: "share-block quote" }, "Quoted from a note outside this share."));
        } else {
          col.append(h("figure", { class: "share-block quote", html: sanitizeBody(block.body ?? "") }));
        }
      } else if (block.kind === "attachment" && block.attachment !== null) {
        const att = block.attachment;
        if (att.content_type.startsWith("image/")) {
          col.append(h("figure", { class: "share-block attachment" }, h("img", { src: `/s/${token}/api/attachments/${att.id}`, alt: att.filename })));
        } else {
          col.append(h("figure", { class: "share-block attachment" }, h("a", { href: `/s/${token}/api/attachments/${att.id}` }, att.filename)));
        }
      } else if (block.kind === "text") {
        col.append(h("div", { class: "share-block", html: sanitizeBody(block.body ?? "") }));
      }
    }
    const backlinks = h("section", { "aria-label": "Backlinks", class: "share-backlinks" }, h("h2", {}, "Backlinks"));
    const list = h("ul", {});
    for (const b of obj.backlinks) {
      list.append(h("li", {}, h("a", { href: `/s/${token}/o/${b.from_object_id}` }, b.from_title)));
    }
    backlinks.append(list);
    main.append(col, backlinks);
  }
}
