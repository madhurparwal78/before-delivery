// The Library screen: search, asset grid, asset dialog, deletion.
import type { AppCtx } from "../main.js";
import type { Asset } from "../types.js";
import { api, h, clear, notice, alertNotice, openDialog } from "../lib.js";


export function renderLibrary(ctx: AppCtx): void {
  const { main } = ctx;
  clear(main);
  const searchBox = h("input", { type: "search", "aria-label": "Search media", placeholder: "Search media" }) as HTMLInputElement;
  const resultsList = h("ul", { class: "asset-grid", "aria-label": "Results" });
  main.append(
    h("div", { class: "screen-title" }, h("h1", { text: "Library" })),
    h("div", { class: "toolbar" }, h("div", { class: "field" }, h("label", { text: "Search" }), searchBox)),
    h("section", { class: "panel" },
      h("header", {}, h("h2", { text: "Media" })),
      h("div", { class: "panel-body" }, resultsList),
    ),
  );

  let timer: number | null = null;
  searchBox.addEventListener("input", () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 250);
  });

  async function refresh(): Promise<void> {
    const q = searchBox.value.trim();
    const res = await api<{ assets: Asset[] }>("GET", `/api/assets${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    if (res.status !== 200) return;
    clear(resultsList);
    if (res.body.assets.length === 0) {
      resultsList.append(h("li", { class: "empty-note", text: "No media matches." }));
      return;
    }
    for (const asset of res.body.assets) {
      resultsList.append(h("li", {},
        h("button", { class: "asset-card", "aria-label": `Asset ${asset.id}`, onclick: () => void openAsset(asset) },
          mediaMark(asset.media_type, asset.url),
          h("span", { class: "asset-meta", text: `${asset.model ?? asset.kind} · ${asset.created_at.slice(0, 10)} · ${asset.expires_at.slice(0, 10)}` }),
        ),
      ));
    }
  }

  function mediaMark(mediaType: string, url?: string): HTMLElement {
    if (mediaType.startsWith("image/")) return h("img", { src: url ?? "", alt: "" });
    if (mediaType.startsWith("video/")) return h("span", { class: "media-glyph", text: "▶" });
    return h("span", { class: "media-glyph", text: "♪" });
  }

  async function openAsset(asset: Asset): Promise<void> {
    let handle: { close(): void } | null = null;
    handle = openDialog({
      label: `Asset ${asset.id}`,
      build(root) {
        const body = h("div", {},
          mediaViewer(asset),
          h("dl", {},
            h("dt", { text: "Model" }), h("dd", { text: asset.model ?? asset.kind }),
            h("dt", { text: "Created" }), h("dd", { text: asset.created_at }),
            h("dt", { text: "Expires" }), h("dd", { text: asset.expires_at }),
            h("dt", { text: "Kind" }), h("dd", { text: asset.kind }),
          ),
          asset.prompt !== undefined ? h("p", { text: asset.prompt }) : null,
        );
        const actions = h("div", { class: "dialog-actions" });
        if (ctx.member.role === "member") {
          actions.append(h("button", {
            class: "btn", text: "Use as input",
            onclick: () => {
              handle?.close();
              useAsInput(ctx, asset.id);
            },
          }));
        }
        if (ctx.member.role === "compliance" || ctx.member.role === "admin") {
          actions.append(h("button", {
            class: "btn btn-danger", text: "Delete",
            onclick: () => confirmDelete(asset, () => handle?.close()),
          }));
        }
        root.append(
          h("header", {}, h("h2", { text: `Asset ${asset.id}` }),
            h("button", { class: "btn btn-ghost", text: "Close", onclick: () => handle?.close() })),
          h("div", { class: "dialog-body" }, body, actions),
        );
      },
    });
  }

  function mediaViewer(asset: Asset): HTMLElement {
    if (asset.url && asset.media_type.startsWith("image/")) {
      return h("img", { src: asset.url, alt: "", style: "width:100%;max-height:320px;object-fit:contain;border:1px solid var(--hairline)" });
    }
    if (asset.url && asset.media_type.startsWith("video/")) {
      return h("video", { src: asset.url, controls: true, style: "width:100%;max-height:320px" });
    }
    if (asset.url && asset.media_type.startsWith("audio/")) {
      return h("audio", { src: asset.url, controls: true, style: "width:100%" });
    }
    return h("div", { class: "empty-note", text: "The media is not readable from this account." });
  }

  function confirmDelete(asset: Asset, closeAssetDialog: () => void): void {
    let handle: { close(): void } | null = null;
    handle = openDialog({
      label: "Delete asset",
      alertStyle: true,
      build(root) {
        root.append(
          h("header", {}, h("h2", { text: "Delete asset" })),
          h("div", { class: "dialog-body" },
            h("p", { text: `Delete ${asset.id} permanently from storage, search and lineage?` }),
            h("div", { class: "dialog-actions" },
              h("button", { class: "btn", text: "Keep", onclick: () => handle?.close() }),
              h("button", {
                class: "btn btn-danger", text: "Delete permanently",
                onclick: async (e: Event) => {
                  const btn = e.target as HTMLButtonElement;
                  btn.textContent = "Deleting…";
                  btn.disabled = true;
                  const res = await api("DELETE", `/api/assets/${asset.id}`);
                  if (res.status === 204) {
                    notice(`Asset ${asset.id} deleted from storage, search and lineage.`);
                    handle?.close();
                    closeAssetDialog();
                    searchBox.focus();
                    void refresh();
                  } else if (res.status === 410) {
                    alertNotice("That asset is already gone.");
                    handle?.close();
                    closeAssetDialog();
                    void refresh();
                  } else if (res.status === 503) {
                    alertNotice("Storage is unreachable, so nothing was deleted. Try again when it returns.");
                    btn.textContent = "Delete permanently";
                    btn.disabled = false;
                  } else {
                    alertNotice((res.body as unknown as { error: { message: string } }).error?.message ?? "The delete failed.");
                    btn.textContent = "Delete permanently";
                    btn.disabled = false;
                  }
                },
              }),
            ),
          ),
        );
      },
    });
  }

  void refresh();
}

/** "Use as input": open Run with a media field filled with the asset reference. */
export function useAsInput(ctx: AppCtx, assetId: string): void {
  window.sessionStorage.setItem("dispatch-use-as-input", assetId);
  ctx.navigate("/run");
}
