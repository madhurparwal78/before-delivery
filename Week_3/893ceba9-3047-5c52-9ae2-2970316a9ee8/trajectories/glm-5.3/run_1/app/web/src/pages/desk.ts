import { PageCtx } from "../main";
import { h, clearEl, Dialog } from "../ui";
import { api, WorkspaceStats, Project } from "../api";
import { icon, analyticsBlocks, logoMark } from "../illustrations";
import { fetchServiceStatus, renderServiceBanners, ServiceStatus } from "../shell";

export async function renderDeskPage(ctx: PageCtx): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";
  window.__deskCurrentSlug = null;

  const container = h("div", { class: "container", style: "padding-bottom:70px" });
  container.appendChild(h("div", { class: "page-head" }, h("h1", {}, "Your desk")));

  // wordmark strip
  const clients = Array.from(new Set(ctx.projects.map((p) => p.client)));
  const appsRegion = h("section", { role: "region", "aria-label": "Client apps", style: "margin-top:8px" });
  appsRegion.appendChild(h("p", { class: "muted", style: "font-size:15px" }, `Client apps on this desk: ${ctx.projects.map((p) => p.name).join(", ")}`));
  if (clients.length > 0) {
    const strip = h("div", { class: "wordmark-strip", tabindex: "0" });
    const track = h("div", { class: "wordmark-track" });
    const doubled = [...clients, ...clients];
    for (const c of doubled) track.appendChild(h("span", { class: "wordmark" }, c));
    strip.appendChild(track);
    appsRegion.appendChild(strip);
  }
  container.appendChild(appsRegion);

  // analytics band
  const statsRegion = h("section", { role: "region", "aria-label": "Workspace analytics", style: "margin-top:30px" });
  const band = h("div", { class: "analytics-band" });
  band.innerHTML = analyticsBlocks();
  const statsCard = h("div", { class: "card" });
  const statsRow = h("div", { class: "stat-row" });
  const captions: Array<[string, (s: WorkspaceStats) => number]> = [
    ["Exact matches reused", (s) => s.exact_matches_reused],
    ["Conflicts open", (s) => s.conflicts_open],
    ["Below MQM threshold", (s) => s.below_threshold],
    ["Publishes confirmed", (s) => s.publishes_confirmed],
  ];
  const cells = captions.map(() => h("div", { class: "stat-col" }, h("div", { class: "skel big" })));
  for (const c of cells) statsRow.appendChild(c);
  statsCard.appendChild(statsRow);
  statsCard.appendChild(h("div", { style: "display:flex;justify-content:center;margin-top:26px" },
    h("a", { class: "btn btn-outline", href: "/audit" }, "Open audit log", h("span", { class: "arrow", html: icon("arrow", 16) }))));
  band.appendChild(statsCard);
  statsRegion.appendChild(band);
  container.appendChild(statsRegion);

  api<WorkspaceStats>("/api/workspace/stats").then((s) => {
    captions.forEach(([cap, fn], i) => {
      clearEl(cells[i]);
      cells[i].appendChild(h("div", { class: "val num" }, String(fn(s))));
      cells[i].appendChild(h("div", { class: "cap" }, cap));
    });
  }).catch(() => {
    captions.forEach(([cap], i) => {
      clearEl(cells[i]);
      cells[i].appendChild(h("div", { class: "val num" }, "0"));
      cells[i].appendChild(h("div", { class: "cap" }, cap));
    });
  });

  // project cards
  const grid = h("div", { class: "grid-2", style: "margin-top:36px" });
  for (const p of ctx.projects) grid.appendChild(projectCard(p));
  if (ctx.projects.length === 0) {
    grid.appendChild(h("div", { class: "card" }, h("h3", {}, "No projects yet"), h("p", { class: "muted" }, "Create your first client project to begin.")));
  }
  container.appendChild(grid);
  main.appendChild(container);

  // new project dialog wiring
  window.addEventListener("desk:new-project", () => openNewProjectDialog(ctx));
}

function projectCard(p: Project): HTMLElement {
  const card = h("article", { class: "card" });
  card.appendChild(h("div", { class: "spread" },
    h("div", null, h("h3", {}, p.name), h("p", { class: "muted small", style: "margin-top:4px" }, `${p.client} · ${p.repository}`)),
    h("span", { class: "pill" }, h("i", { class: "sq on", style: "width:9px;height:9px;border-radius:2px;display:inline-block" }), p.target_languages.join(", ")),
  ));
  card.appendChild(h("p", { class: "muted", style: "margin-top:14px" }, `Source ${p.source_language} into ${p.target_languages.join(", ")}.`));
  card.appendChild(h("div", { style: "margin-top:18px" },
    h("a", { class: "btn btn-primary", href: `/projects/${p.slug}` }, `Open ${p.name}`)));
  return card;
}

function openNewProjectDialog(ctx: PageCtx): void {
  const fields: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  const errBox = h("div", { class: "inline-err", hidden: true, role: "alert" });

  const mk = (label: string, key: string, attrs: Record<string, string> = {}) => {
    const input = h("input", { class: "control", id: `np-${key}`, ...attrs }) as HTMLInputElement;
    fields[key] = input;
    return h("label", { class: "field" }, h("span", { class: "label" }, label), input);
  };
  const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "New project" });
  dlg.appendChild(h("h2", {}, "New project"));
  dlg.appendChild(h("p", { class: "sub" }, "Set up a client app with its source language and target languages."));
  const grid = h("div", { class: "form-grid" });
  grid.appendChild(mk("Slug", "slug", { placeholder: "larkspur-rider" }));
  grid.appendChild(mk("Project name", "name", { placeholder: "Larkspur Rider" }));
  grid.appendChild(mk("Client", "client", { placeholder: "Larkspur Cycles" }));
  grid.appendChild(mk("Source language", "source_language", { placeholder: "en" }));
  grid.appendChild(mk("Target languages", "target_languages", { placeholder: "de, fr, ja" }));
  grid.appendChild(mk("Repository", "repository", { placeholder: "larkspur-cycles/rider-app" }));
  const threshold = h("input", { class: "control", type: "number", min: "0", max: "100", value: "90", id: "np-threshold", "aria-label": "MQM threshold" }) as HTMLInputElement;
  fields["mqm_threshold"] = threshold;
  grid.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "MQM threshold"), threshold));
  dlg.appendChild(grid);
  dlg.appendChild(errBox);

  const cancel = h("button", { class: "btn btn-outline", onclick: () => dialog.close(false) }, "Cancel");
  const create = h("button", { class: "btn btn-primary" }, "Create project");
  const actions = h("div", { class: "actions-row" }, cancel, create);
  dlg.appendChild(actions);

  const dialog = new Dialog(dlg, document.activeElement as HTMLElement);
  dialog.open();

  create.addEventListener("click", async () => {
    create.disabled = true;
    ctx.fb.setStatus("Creating project.");
    errBox.hidden = true;
    try {
      const langs = (fields["target_languages"] as HTMLInputElement).value.split(",").map((s) => s.trim()).filter(Boolean);
      const project = await api<Project>("/api/projects", { method: "POST", json: {
        slug: (fields["slug"] as HTMLInputElement).value.trim(),
        name: (fields["name"] as HTMLInputElement).value.trim(),
        client: (fields["client"] as HTMLInputElement).value.trim(),
        source_language: (fields["source_language"] as HTMLInputElement).value.trim(),
        target_languages: langs,
        repository: (fields["repository"] as HTMLInputElement).value.trim(),
        mqm_threshold: parseInt(threshold.value, 10),
      } });
      ctx.fb.setStatus(`Created ${project.name}.`);
      dialog.close(true);
      await ctx.shell.refreshProjects();
      history.pushState(null, "", `/projects/${project.slug}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e: any) {
      create.disabled = false;
      ctx.fb.clearStatus();
      const msg = e.fields && Object.keys(e.fields).length ? Object.values(e.fields)[0] : e.message;
      errBox.textContent = msg;
      errBox.hidden = false;
      ctx.fb.setProblem(msg);
      const firstKey = e.fields ? Object.keys(e.fields)[0] : null;
      const target = firstKey ? fields[firstKey] : fields["slug"];
      (target as HTMLInputElement).focus();
    }
  });
}
