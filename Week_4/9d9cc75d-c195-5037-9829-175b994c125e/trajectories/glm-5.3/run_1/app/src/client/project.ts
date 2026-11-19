/** The project page: members, sources, workbooks. */

import { api, esc, el } from "./api.js";

export async function projectPage(id: string): Promise<void> {
  const res = await api<{
    id: string;
    name: string;
    role: string;
    explorers_schedule: boolean;
    members: { username: string; role: string }[];
    sources: { id: string; name: string }[];
    workbooks: { id: string; name: string; state: string; certified_by: string | null }[];
  }>("GET", `/api/projects/${id}`);
  if (res.status === 404) {
    document.getElementById("page")!.innerHTML = `<div class="card" style="max-width:520px;margin:48px auto;"><h1 class="headline">Not found.</h1></div>`;
    return;
  }
  const project = res.json!;
  document.getElementById("page")!.className = "depth-raw";
  document.getElementById("page")!.innerHTML = `
    <div class="stack" style="max-width:1000px;margin:0 auto;padding:24px;">
      <h1 class="headline">${esc(project.name)}</h1>
      <div class="project-cols">
        <section class="card">
          <h3>Members</h3>
          <table class="data" aria-label="Members">
            <thead><tr><th>Username</th><th>Role</th><th></th></tr></thead>
            <tbody id="members-body">
              ${project.members.map((m) => `<tr><td>${esc(m.username)}</td><td>${esc(m.role)}</td><td><button data-remove="${esc(m.username)}" aria-label="Remove ${esc(m.username)}">Remove</button></td></tr>`).join("")}
            </tbody>
          </table>
          <form id="add-member" class="row">
            <input name="username" aria-label="Member username" placeholder="username">
            <select name="role" aria-label="Role"><option>Viewer</option><option>Explorer</option><option>Creator</option></select>
            <button class="primary">Add member</button>
          </form>
          <label class="row"><input type="checkbox" id="explorers-schedule" ${project.explorers_schedule ? "checked" : ""}> <span>Explorers may schedule refreshes</span></label>
        </section>
        <section class="card">
          <h3>Sources</h3>
          <ul>${project.sources.map((s) => `<li><a href="/sources/${esc(s.id)}">${esc(s.name)}</a></li>`).join("") || '<li class="muted">No sources yet.</li>'}</ul>
          <a href="/sources/new">Upload a source</a>
        </section>
      </div>
      <section class="card">
        <h3>Workbooks</h3>
        <ul>${project.workbooks.map((w) => `<li><a href="/workbooks/${esc(w.id)}">${esc(w.name)}</a> <span class="muted">${w.state === "published" ? "Published" : "Draft"}</span></li>`).join("") || '<li class="muted">No workbooks yet.</li>'}</ul>
      </section>
      <p id="announcements" role="status" aria-live="polite" class="status"></p>
    </div>`;

  const announce = (t: string): void => {
    document.getElementById("announcements")!.textContent = t;
  };

  const form = document.getElementById("add-member") as HTMLFormElement;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const username = String(data.get("username") ?? "").toLowerCase();
    const role = String(data.get("role")).toLowerCase();
    const res2 = await api("PUT", `/api/projects/${id}/members/${username}`, { role });
    if (res2.status === 200) {
      announce(`Member added: ${username} as ${role}.`);
      location.reload();
    } else {
      const errors = (res2.json as { errors?: Record<string, string> } | null)?.errors;
      announce(errors?.username ?? "You do not have access to this.");
    }
  });
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-remove]")) {
    btn.addEventListener("click", async () => {
      const username = btn.dataset.remove!;
      const res2 = await api("DELETE", `/api/projects/${id}/members/${username}`);
      if (res2.status === 204) {
        btn.closest("tr")?.remove();
      }
    });
  }
  const sched = document.getElementById("explorers-schedule") as HTMLInputElement;
  sched.addEventListener("change", async () => {
    const res2 = await api("PATCH", `/api/projects/${id}`, { explorers_schedule: sched.checked });
    if (res2.status === 200) announce("Schedule saved.");
    else announce("You do not have access to this.");
  });
  void el;
}
