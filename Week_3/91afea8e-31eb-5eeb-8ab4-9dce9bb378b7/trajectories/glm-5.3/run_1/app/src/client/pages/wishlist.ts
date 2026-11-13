import { el, busy, openDialog } from "../ui.ts";
import { get, post, del } from "../api.ts";
import { amount } from "../format.ts";
import { state, signinLink, navigate, refreshCartCount, guestCart, setGuestCart } from "../app.ts";

interface WishItem {
  item_id: string; product_id: string; listing_id: string; title: string;
  brand: string; image_url: string; price_paise: number; in_stock: boolean;
}

export async function renderWishlist(): Promise<HTMLElement> {
  const main = el("main", {});
  if (!state.account || state.account.role !== "shopper") {
    void navigate(signinLink());
    main.append(el("div", { class: "panel-deep" }, el("p", { text: "taking you to sign in so your wishlist can come with you." })));
    return main;
  }
  const res = await get<{ items: WishItem[] }>("/api/wishlist");
  main.append(el("h1", { text: "wishlist" }));

  const shareBtn = el("button", { class: "btn btn-yellow", text: "Share wishlist" });
  shareBtn.addEventListener("click", () => {
    const nameField = el("label", { class: "field" });
    nameField.append(el("span", { class: "label-text", text: "Name to show" }));
    const nameInput = el("input", { type: "text", maxlength: "40", value: state.account?.first_name ?? "" });
    nameField.append(nameInput);
    const linkField = el("label", { class: "field" });
    linkField.append(el("span", { class: "label-text", text: "Share link" }));
    const linkInput = el("input", { type: "text", readonly: "readonly" });
    linkField.append(linkInput);
    const createBtn = el("button", { class: "btn btn-primary", text: "Create link" });
    const copyBtn = el("button", { class: "btn btn-yellow", text: "Copy link", hidden: "true" });
    const regenBtn = el("button", { class: "btn btn-ghost", text: "Make a new link" });
    const offBtn = el("button", { class: "btn btn-ghost", text: "Turn off link" });
    const dlg = el("dialog", { "aria-label": "Share wishlist" });
    dlg.append(el("h2", { text: "Share wishlist" }), nameField, linkField, createBtn, copyBtn, regenBtn, offBtn);
    const load = async () => {
      try {
        const link = await post<{ url: string }>("/api/wishlist/share", { display_name: nameInput.value || "a shopper" });
        linkInput.value = link.url;
        createBtn.hidden = true;
        copyBtn.hidden = false;
      } catch { /* nothing yet */ }
    };
    createBtn.addEventListener("click", () => void busy(createBtn, load));
    copyBtn.addEventListener("click", () => { void navigator.clipboard?.writeText(`${window.location.origin}${linkInput.value}`); });
    regenBtn.addEventListener("click", () => {
      void busy(regenBtn, async () => {
        const link = await post<{ url: string }>("/api/wishlist/share/regenerate", { display_name: nameInput.value || "a shopper" });
        linkInput.value = link.url;
      });
    });
    offBtn.addEventListener("click", () => {
      void busy(offBtn, async () => {
        await del("/api/wishlist/share");
        linkInput.value = "";
        copyBtn.hidden = true;
        createBtn.hidden = false;
      });
    });
    openDialog(dlg, shareBtn);
    void load();
  });
  main.append(shareBtn);

  if (res.items.length === 0) {
    const empty = el("div", { class: "panel-pink" });
    empty.append(el("p", { text: "no saved items yet." }));
    main.append(empty);
    return main;
  }

  const grid = el("div", { class: "card-grid" });
  for (const item of res.items) {
    const card = el("article", { class: "product-card" });
    const link = el("a", { href: `/p/${item.product_id}` });
    link.append(el("img", { src: item.image_url, alt: item.title }));
    card.append(link);
    card.append(el("h3", { text: item.title }));
    card.append(el("p", { class: "price", style: "font-family:var(--font-head);font-weight:900;font-size:1.6rem", text: amount(item.price_paise) }));
    const addBtn = el("button", { class: "btn btn-primary", text: "Add to cart" });
    addBtn.addEventListener("click", () => {
      void busy(addBtn, async () => {
        await post("/api/cart/lines", { listing_id: item.listing_id, quantity: 1 });
        await refreshCartCount();
        addBtn.textContent = "added";
      });
    });
    const removeBtn = el("button", { class: "btn btn-ghost", text: `Remove ${item.title}` });
    removeBtn.addEventListener("click", () => {
      void busy(removeBtn, async () => {
        await del(`/api/wishlist/${item.item_id}`);
        void navigate("/wishlist", true);
      });
    });
    card.append(addBtn, removeBtn);
    grid.append(card);
  }
  main.append(grid);
  return main;
}

export async function renderShared(token: string): Promise<HTMLElement> {
  const main = el("main", {});
  let data: { kind: string; display_name: string; items: WishItem[] };
  try {
    data = await get(`/api/shared/${token}`);
  } catch {
    const panel = el("div", { class: "panel-black" });
    panel.append(el("p", { text: "This link has expired or been replaced." }));
    main.append(panel);
    return main;
  }
  main.append(el("h1", { text: `${data.display_name}'s ${data.kind}` }));
  if (data.items.length === 0) {
    const empty = el("div", { class: "panel-pink" });
    empty.append(el("p", { text: "nothing shared yet." }));
    main.append(empty);
    return main;
  }
  const grid = el("div", { class: "card-grid" });
  for (const item of data.items) {
    const card = el("article", { class: "product-card" });
    card.append(el("img", { src: item.image_url, alt: item.title }));
    card.append(el("h3", { text: item.title }));
    card.append(el("p", { class: "price", style: "font-family:var(--font-head);font-weight:900;font-size:1.6rem", text: amount(item.price_paise) }));
    const addBtn = el("button", { class: "btn btn-primary", text: `Add ${item.title} to my cart` });
    addBtn.addEventListener("click", () => {
      void busy(addBtn, async () => {
        if (!state.account || state.account.role !== "shopper") {
          const guest = guestCart();
          const existing = guest.find((l) => l.listing_id === item.listing_id);
          if (existing) existing.quantity = Math.min(10, existing.quantity + 1);
          else if (guest.length < 10) guest.push({ listing_id: item.listing_id, quantity: 1 });
          setGuestCart(guest);
          await refreshCartCount();
          void navigate(signinLink());
          return;
        }
        await post("/api/cart/lines", { listing_id: item.listing_id, quantity: 1 });
        await refreshCartCount();
        addBtn.textContent = "added";
      });
    });
    card.append(addBtn);
    grid.append(card);
  }
  main.append(grid);
  return main;
}
