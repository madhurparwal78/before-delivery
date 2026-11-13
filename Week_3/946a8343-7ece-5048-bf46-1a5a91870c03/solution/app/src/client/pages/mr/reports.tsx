// Report regions of the panel, with the texts exactly as GET .../reports publishes them: `region "Test summary"` (and the new
// failures by name), `region "Coverage"`, `region "Code quality"`, `region "Security"` with its findings, and `region "Owners problems"`.
// Findings move through detected / confirmed / dismissed / resolved with PATCH /api/projects/:id/findings/:fid; refusals show in the
// strip (a missing dismissal reason sits under its textbox) and are announced.
import { useState } from "preact/hooks";
import { api, useAction, type Resource } from "../../api.ts";
import { useLiveResource } from "../../live.ts";
import { Button, Chip, Skeleton, StatusBadge, TextField } from "../../ui/index.ts";
import { concernsRequest, type MrCaps, mrBase } from "./data.ts";
import { ActionNotice, PanelSection, useFocusRequest } from "./parts.tsx";

type FindingState = "detected" | "confirmed" | "dismissed" | "resolved";

interface Finding {
  id: number;
  report_id: string;
  severity: string;
  title: string;
  path: string;
  line: number;
  state: FindingState;
  reason: string | null;
}

interface Reports {
  base_pipeline_id: number | null;
  head_pipeline_id: number | null;
  tests: { text: string; new_failures: string[]; failed: number; passed: number; skipped: number };
  coverage: { text: string; head: number | null; base: number | null };
  quality: { text: string; new: string[]; resolved: string[] };
  security: { text: string; findings: Finding[] };
}

const REPORT_TYPES = ["merge_request", "pipeline", "job", "approvals", "checks", "version"] as const;

export function useReports(project: string, iid: number): Resource<Reports> {
  return useLiveResource<Reports>({
    project,
    types: REPORT_TYPES,
    deps: [project, iid],
    match: (message) => concernsRequest(iid, message.data),
    load: (signal) => api.get<Reports>(`${mrBase(project, iid)}/reports`, { signal }),
  });
}

function FindingRow({ project, finding, allowed, onChanged }: { project: string; finding: Finding; allowed: boolean; onChanged: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const focus = useFocusRequest();
  const move = useAction(async (state: FindingState, why: string | null) => {
    await api.patch(`/api/projects/${encodeURIComponent(project)}/findings/${finding.id}`, why === null ? { state } : { state, reason: why });
    setReason("");
    focus.request("row");
    await onChanged();
  });
  const open = finding.state === "detected" || finding.state === "confirmed";
  const reasonError = move.error?.fieldErrors().reason ?? null;
  return (
    <li ref={focus.ref("row")} tabIndex={-1} class="sp-finding" data-state={finding.state}>
      <p class="sp-finding__head">
        <Chip tone={finding.severity === "critical" || finding.severity === "high" ? "fail" : "idle"}>{finding.severity}</Chip>
        <StatusBadge status={finding.state} />
      </p>
      <p class="sp-finding__title">{finding.title}</p>
      <p class="sp-finding__where sp-mono">{`${finding.path}:${finding.line}`}</p>
      {finding.state === "dismissed" && finding.reason ? <p class="sp-small sp-muted">{finding.reason}</p> : null}
      {move.error && reasonError === null ? <ActionNotice errors={[move.error]} /> : null}
      {allowed && open ? (
        <TextField
          label="Dismissal reason"
          name={`dismissal-${finding.id}`}
          value={reason}
          error={reasonError}
          onInput={(event) => setReason(event.currentTarget.value)}
        />
      ) : null}
      {allowed ? (
        <div class="sp-finding__actions">
          {finding.state === "detected" ? (
            <Button variant="secondary" pending={move.pending} onClick={() => void move.run("confirmed", null)}>
              Confirm finding
            </Button>
          ) : null}
          {open ? (
            <Button variant="secondary" pending={move.pending} onClick={() => void move.run("dismissed", reason)}>
              Dismiss finding
            </Button>
          ) : null}
          {open ? (
            <Button variant="secondary" pending={move.pending} onClick={() => void move.run("resolved", null)}>
              Resolve finding
            </Button>
          ) : null}
          {finding.state === "dismissed" ? (
            <Button variant="secondary" pending={move.pending} onClick={() => void move.run("detected", null)}>
              Reopen finding
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ReportRegions({ project, reports, caps, onChanged }: { project: string; reports: Resource<Reports>; caps: MrCaps; onChanged: () => Promise<void> }) {
  const data = reports.data;
  if (!data) {
    return (
      <>
        {["Test summary", "Coverage", "Code quality", "Security"].map((title) => (
          <PanelSection key={title} title={title}>
            {reports.error ? <ActionNotice errors={[reports.error]} /> : <Skeleton rows={1} height={24} />}
          </PanelSection>
        ))}
      </>
    );
  }
  const changed = async () => {
    await Promise.all([reports.reload(), onChanged()]);
  };
  return (
    <>
      <PanelSection title="Test summary">
        <p>{data.tests.text}</p>
        {data.tests.new_failures.length > 0 ? (
          <ul class="sp-failure-list">
            {data.tests.new_failures.map((name) => (
              <li key={name} class="sp-mono">
                {name}
              </li>
            ))}
          </ul>
        ) : null}
      </PanelSection>
      <PanelSection title="Coverage">
        <p>{data.coverage.text}</p>
      </PanelSection>
      <PanelSection title="Code quality">
        <p>{data.quality.text}</p>
      </PanelSection>
      <PanelSection title="Security">
        <p>{data.security.text}</p>
        {data.security.findings.length > 0 ? (
          <ul class="sp-finding-list">
            {data.security.findings.map((finding) => (
              <FindingRow key={finding.id} project={project} finding={finding} allowed={caps.findings} onChanged={changed} />
            ))}
          </ul>
        ) : null}
      </PanelSection>
    </>
  );
}

export function OwnersProblems({ problems }: { problems: readonly string[] }) {
  if (problems.length === 0) return null;
  return (
    <PanelSection title="Owners problems">
      <ul class="sp-problem-list">
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </PanelSection>
  );
}
