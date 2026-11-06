// Share: the public compliance view an inspector opens without an account.

import { ApiFailure, apiJson } from "../lib/api.js";
import { clear, el } from "../lib/dom.js";

type ShareDocument = { id: string; kind: string; label: string; expires_on: string | null; file_url: string };
type ShareRenter = { business_name: string; documents: ShareDocument[] };
type ShareData = { kitchen: { name: string; address: string }; renters: ShareRenter[] };

export const renderShare = (mount: HTMLElement, path: string): void => {
  const token = path.split("/").filter(Boolean).pop() ?? "";
  const load = async (): Promise<void> => {
    try {
      const data = await apiJson<ShareData>(`/api/share/${token}`);
      clear(mount);
      const column = el("div", { class: "share-column" });
      column.append(
        el("h1", {}, "Current compliance documents"),
        el("p", { class: "kitchen-line" }, `${data.kitchen.name}, ${data.kitchen.address}`),
      );
      if (data.renters.length === 0) {
        column.append(el("p", { class: "empty-copy" }, "No current documents to show."));
      }
      for (const renter of data.renters) {
        const block = el("section", { class: "share-renter" }, el("h2", {}, renter.business_name));
        for (const document of renter.documents) {
          block.append(
            el(
              "div",
              { class: "share-document" },
              el("span", {}, `${document.label} · ${document.expires_on ? `Expires ${document.expires_on}` : "No expiry date"}`),
              el("a", { href: document.file_url }, `Open ${document.label} for ${renter.business_name}`),
            ),
          );
        }
        column.append(block);
      }
      mount.append(column);
    } catch (err) {
      clear(mount);
      const dead = el("div", { class: "share-dead" });
      dead.append(
        el("h1", {}, "This link is no longer active"),
        el("p", {}, "Ask the kitchen operator for a new link."),
      );
      mount.append(dead);
      void err;
    }
  };
  void load();
  void ApiFailure;
};
