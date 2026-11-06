// The Admin screen: org policy form, versions.
import type { AppCtx } from "../main.js";
import type { Policy, Model } from "../types.js";
import { api, h, clear, notice, alertNotice } from "../lib.js";
import { Ribbon } from "../ribbon.js";
import { openJobDialog } from "../jobdialog.js";

const ZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Europe/Madrid", "Europe/Warsaw", "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Asia/Dubai",
  "Australia/Sydney", "Pacific/Auckland",
];
const RETENTIONS = [7, 30, 90];
const ACCESS = ["Allowed", "Blocked", "Inherit"];
const VISIBILITY = ["Team", "Restricted"];

export function renderAdmin(ctx: AppCtx): void {
  const { main } = ctx;
  clear(main);
  const readOnly = ctx.member.role !== "admin";
  const ribbon = new Ribbon(() => undefined);
  const meterHost = h("div", {}, ribbon.build());
  const teamSel = h("select", { "aria-label": "Team" }) as HTMLSelectElement;
  for (const t of ctx.teams) teamSel.append(h("option", { value: t.id, text: t.name, selected: t.id === ctx.selectedTeam() ? true : undefined }));
  teamSel.addEventListener("change", () => {
    ctx.onTeamChange(teamSel.value);
  });

  const formHost = h("div", {});
  const versionsList = h("ul", { "aria-label": "Policy versions" });

  main.append(
    h("div", { class: "screen-title" }, h("h1", { text: "Admin" })),
    h("div", { class: "toolbar" }, h("div", { class: "field" }, h("label", { text: "Team" }), teamSel)),
    meterHost,
    h("section", { class: "panel" },
      h("header", {}, h("h2", { text: "Org policy" })),
      h("div", { class: "panel-body" }, formHost),
    ),
    h("section", { class: "panel" },
      h("header", {}, h("h2", { text: "Policy versions" })),
      h("div", { class: "panel-body" }, versionsList),
    ),
  );

  interface TeamFormState {
    id: string;
    name: string;
    concurrency: string;
    payload_visibility: string;
    soft_cap: string;
    hard_cap: string;
    api_default: string;
    playground_default: string;
    model_access: Record<string, { api: string; playground: string }>;
  }

  let policy: Policy | null = null;
  let orgAccess: Record<string, { api: string; playground: string }> = {};
  let teamStates: TeamFormState[] = [];
  let teamEls: Record<string, Record<string, HTMLElement>> = {};

  function accessValue(v: string): string {
    if (v === "allowed") return "Allowed";
    if (v === "blocked") return "Blocked";
    return "Inherit";
  }
  function accessFromControl(v: string): string {
    return v.toLowerCase();
  }

  function renderForm(): void {
    clear(formHost);
    teamEls = {};
    if (!policy) return;
    const tzSel = h("select", { "aria-label": "Time zone" }) as HTMLSelectElement;
    for (const z of ZONES) tzSel.append(h("option", { value: z, text: z, selected: z === policy?.timezone ? true : undefined }));
    const retSel = h("select", { "aria-label": "Retention" }) as HTMLSelectElement;
    for (const r of RETENTIONS) retSel.append(h("option", { value: String(r), text: `${r} days`, selected: r === policy?.retention_days ? true : undefined }));

    const form = h("form", { "aria-label": "Org policy" },
      h("fieldset", {}, h("legend", { text: "Organisation" }),
        h("div", { class: "inline-fields" },
          h("div", { class: "field" }, h("label", { text: "Time zone" }), tzSel),
          h("div", { class: "field" }, h("label", { text: "Retention" }), retSel),
        ),
      ),
    );

    for (const teamState of teamStates) {
      const fieldset = h("fieldset", { role: "group", "aria-label": teamState.name }, h("legend", { text: teamState.name }));
      const conc = h("input", { type: "number", "aria-label": "Concurrency", min: "1", max: "20", value: teamState.concurrency }) as HTMLInputElement;
      const vis = h("select", { "aria-label": "Payload visibility" }) as HTMLSelectElement;
      for (const v of VISIBILITY) vis.append(h("option", { value: v, text: v, selected: accessValue(teamState.payload_visibility === "team" ? "allowed" : "inherit") === v || (teamState.payload_visibility === "restricted" && v === "Restricted") ? true : undefined }));
      const soft = h("input", { type: "number", "aria-label": "Soft cap (credits)", min: "0", value: teamState.soft_cap }) as HTMLInputElement;
      const hard = h("input", { type: "number", "aria-label": "Hard cap (credits)", min: "0", value: teamState.hard_cap }) as HTMLInputElement;
      const apiDef = h("select", { "aria-label": "Default for API" }) as HTMLSelectElement;
      const pgDef = h("select", { "aria-label": "Default for playground" }) as HTMLSelectElement;
      for (const sel of [apiDef, pgDef]) {
        for (const a of ACCESS) sel.append(h("option", { value: a, text: a }));
      }
      apiDef.value = accessValue(teamState.api_default);
      pgDef.value = accessValue(teamState.playground_default);
      const inner = h("div", { class: "rate-form-grid" },
        h("div", { class: "field" }, h("label", { text: "Concurrency" }), conc),
        h("div", { class: "field" }, h("label", { text: "Payload visibility" }), vis),
        h("div", { class: "field" }, h("label", { text: "Soft cap (credits)" }), soft),
        h("div", { class: "field" }, h("label", { text: "Hard cap (credits)" }), hard),
        h("div", { class: "field" }, h("label", { text: "Default for API" }), apiDef),
        h("div", { class: "field" }, h("label", { text: "Default for playground" }), pgDef),
      );
      for (const [slug, acc] of Object.entries(teamState.model_access)) {
        const apiSel = h("select", { "aria-label": `${modelLabelFor(slug)} API` }) as HTMLSelectElement;
        const pgSel = h("select", { "aria-label": `${modelLabelFor(slug)} playground` }) as HTMLSelectElement;
        for (const sel of [apiSel, pgSel]) for (const a of ACCESS) sel.append(h("option", { value: a, text: a }));
        apiSel.value = accessValue(acc.api);
        pgSel.value = accessValue(acc.playground);
        inner.append(
          h("div", { class: "field" }, h("label", { text: `${modelLabelFor(slug)} API` }), apiSel),
          h("div", { class: "field" }, h("label", { text: `${modelLabelFor(slug)} playground` }), pgSel),
        );
        teamEls[teamState.id] ??= {};
        teamEls[teamState.id][`${slug}#api`] = apiSel;
        teamEls[teamState.id][`${slug}#playground`] = pgSel;
      }
      teamEls[teamState.id] ??= {};
      Object.assign(teamEls[teamState.id], { concurrency: conc, visibility: vis, soft: soft, hard: hard, api_default: apiDef, playground_default: pgDef });
      fieldset.append(inner);
      form.appendChild(fieldset);
    }

    const orgFieldset = h("fieldset", { role: "group", "aria-label": "Org model access" }, h("legend", { text: "Org model access" }));
    for (const slug of Object.keys(orgAccess)) {
      const apiSel = h("select", { "aria-label": `${modelLabelFor(slug)} API` }) as HTMLSelectElement;
      const pgSel = h("select", { "aria-label": `${modelLabelFor(slug)} playground` }) as HTMLSelectElement;
      for (const sel of [apiSel, pgSel]) {
        sel.append(h("option", { value: "Allowed", text: "Allowed" }));
        sel.append(h("option", { value: "Blocked", text: "Blocked" }));
      }
      apiSel.value = orgAccess[slug].api === "blocked" ? "Blocked" : "Allowed";
      pgSel.value = orgAccess[slug].playground === "blocked" ? "Blocked" : "Allowed";
      orgFieldset.append(
        h("div", { class: "field" }, h("label", { text: `${modelLabelFor(slug)} API` }), apiSel),
        h("div", { class: "field" }, h("label", { text: `${modelLabelFor(slug)} playground` }), pgSel),
      );
      teamEls.org ??= {};
      teamEls.org[`${slug}#api`] = apiSel;
      teamEls.org[`${slug}#playground`] = pgSel;
    }
    form.appendChild(orgFieldset);

    const saveBtn = h("button", { class: "btn", type: "submit", text: "Save policy" });
    form.addEventListener("submit", async (e: Event) => {
      e.preventDefault();
      if (!policy) return;
      saveBtn.textContent = "Saving…";
      saveBtn.disabled = true;
      const body = collectBody();
      const res = await api<{ policy: Policy }>("PUT", "/api/policy", body);
      saveBtn.textContent = "Save policy";
      saveBtn.disabled = false;
      if (res.status === 200) {
        notice(`Policy saved as version ${res.body.policy.version}.`);
        await loadPolicy();
      } else if (res.status === 412) {
        const body12 = res.body as unknown as { current_version?: number };
        alertNotice(`Someone saved a newer policy (version ${body12.current_version ?? "?"}). Reload to see it before saving again.`);
      } else if (res.status === 422) {
        const fields = (res.body as unknown as { error: { fields?: Record<string, string> } }).error.fields ?? {};
        alertNotice(Object.values(fields)[0] ?? "Fix the highlighted fields.");
      } else {
        alertNotice(res.body.error?.message ?? "The save failed.");
      }
    });
    if (readOnly) saveBtn.disabled = true;
    form.appendChild(saveBtn);
    formHost.append(form);
  }

  function modelLabelFor(slug: string): string {
    return modelNames[slug] ?? slug;
  }

  const modelNames: Record<string, string> = {};

  function collectBody(): Record<string, unknown> {
    if (!policy) return {};
    const teams = teamStates.map((t) => {
      const els = teamEls[t.id] ?? {};
      const model_access: Record<string, { api: string; playground: string }> = {};
      for (const slug of Object.keys(t.model_access)) {
        model_access[slug] = {
          api: accessFromControl(((els[`${slug}#api`] as HTMLSelectElement)?.value ?? "Inherit")),
          playground: accessFromControl(((els[`${slug}#playground`] as HTMLSelectElement)?.value ?? "Inherit")),
        };
      }
      return {
        id: t.id,
        name: t.name,
        concurrency: Number((els.concurrency as HTMLInputElement)?.value ?? t.concurrency),
        payload_visibility: (els.visibility as HTMLSelectElement)?.value === "Restricted" ? "restricted" : "team",
        soft_cap_credits: Number((els.soft as HTMLInputElement)?.value ?? t.soft_cap),
        hard_cap_credits: Number((els.hard as HTMLInputElement)?.value ?? t.hard_cap),
        context_defaults: {
          api: accessFromControl((els.api_default as HTMLSelectElement)?.value ?? "Inherit"),
          playground: accessFromControl((els.playground_default as HTMLSelectElement)?.value ?? "Inherit"),
        },
        model_access,
      };
    });
    const org_model_access: Record<string, { api: string; playground: string }> = {};
    for (const slug of Object.keys(orgAccess)) {
      org_model_access[slug] = {
        api: ((teamEls.org?.[`${slug}#api`] as HTMLSelectElement)?.value ?? "Allowed") === "Blocked" ? "blocked" : "allowed",
        playground: ((teamEls.org?.[`${slug}#playground`] as HTMLSelectElement)?.value ?? "Allowed") === "Blocked" ? "blocked" : "allowed",
      };
    }
    const tz = (formHost.querySelector('[aria-label="Time zone"]') as HTMLSelectElement)?.value ?? policy.timezone;
    const ret = Number((formHost.querySelector('[aria-label="Retention"]') as HTMLSelectElement)?.value ?? policy.retention_days);
    return {
      version: policy.version,
      timezone: tz,
      retention_days: ret,
      org_model_access,
      teams,
    };
  }

  async function loadPolicy(): Promise<void> {
    const res = await api<{ policy: Policy }>("GET", "/api/policy");
    if (res.status !== 200) return;
    policy = res.body.policy;
    orgAccess = policy.org_model_access;
    teamStates = policy.teams.map((t) => ({
      id: t.id,
      name: t.name,
      concurrency: String(t.concurrency),
      payload_visibility: t.payload_visibility,
      soft_cap: String(t.soft_cap_credits),
      hard_cap: String(t.hard_cap_credits),
      api_default: t.context_defaults.api,
      playground_default: t.context_defaults.playground,
      model_access: t.model_access,
    }));
    renderForm();
    const versionsRes = await api<{ versions: { version: number; saved_by: { name: string }; saved_at: string }[] }>("GET", "/api/policy/versions");
    if (versionsRes.status === 200) {
      clear(versionsList);
      for (const v of versionsRes.body.versions) {
        versionsList.append(h("li", { class: "num", text: `Version ${v.version} — saved by ${v.saved_by.name} at ${v.saved_at}` }));
      }
    }
  }

  async function refreshMeter(): Promise<void> {
    const team = ctx.selectedTeam();
    if (!team) return;
    const res = await api<import("../types.js").Meter>("GET", `/api/teams/${team}/meter`);
    if (res.status === 200) ribbon.update(res.body, (id) => openJobDialog(id));
  }

  void api<{ models: Model[] }>("GET", "/api/models").then((res) => {
    if (res.status !== 200) return;
    for (const m of res.body.models) modelNames[m.slug] = m.name;
    void loadPolicy();
  });
  void refreshMeter();
  const timer = window.setInterval(() => void refreshMeter(), 5000);
  const obs = new MutationObserver(() => {
    if (!document.body.contains(main)) {
      window.clearInterval(timer);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
