/** The inbox page. */

import { api, esc } from "./api.js";

export async function inboxPage(): Promise<void> {
  const page = document.getElementById("page")!;
  page.innerHTML = `
    <div style="max-width:720px;margin:0 auto;padding:24px;">
      <section aria-label="Inbox">
        <h1 class="headline">Inbox</h1>
        <ul id="inbox-list" role="list" aria-label="Inbox items" style="list-style:none;padding:0"></ul>
      </section>
      <p id="announcements" role="status" aria-live="polite" class="status"></p>
    </div>`;
  const res = await api<{ unread: number; items: { id: string; text: string; read: boolean }[] }>("GET", "/api/inbox");
  if (res.status === 401) {
    location.href = "/signin?next=/inbox";
    return;
  }
  const list = res.json?.items ?? [];
  const ul = document.getElementById("inbox-list")!;
  if (list.length === 0) {
    ul.innerHTML = `<li><div class="card"><h2 class="headline">Your inbox is empty.</h2></div></li>`;
  } else {
    ul.innerHTML = list.map((i) => `<li class="inbox-item">${esc(i.text)}</li>`).join("");
  }
  await api("POST", "/api/inbox/read");
}
