// `/projects/<id>`: the project home. The hero (dot field, column rules, the project name, the open merge request bar and the two
// staggered tiles), the project health stat cards, the release notes carousel and the recent activity row. Not a live page.
import "../styles/project.css";
import { api, useResource } from "../api.ts";
import { useProject } from "../role.ts";
import { A, useRoute } from "../router.ts";
import { Main } from "../shell/main.tsx";
import { StatusBadge } from "../ui/chip.tsx";
import { Notice } from "../ui/feedback.tsx";
import { useTitle } from "../ui/page.tsx";
import { Time } from "../ui/time.tsx";
import { ReleaseNotes } from "./project/carousel.tsx";
import type { ActivityEvent, ActivityKind, ActivityList, Overview } from "./project/types.ts";

const KIND_LABEL: Readonly<Record<ActivityKind, string>> = {
  push: "PUSH",
  merge_request: "MERGE REQUEST",
  issue: "ISSUE",
  pipeline: "PIPELINE",
};

function groupOf(path: string | null): string | null {
  if (path === null) return null;
  const slash = path.lastIndexOf("/");
  return slash === -1 ? null : path.slice(0, slash);
}

function TagTile({ id, overview }: { id: string; overview: Overview | undefined }) {
  const tag = overview?.latest_tag ?? null;
  if (overview !== undefined && tag === null) {
    return (
      <div class="sp-tile sp-tile--empty">
        <span class="sp-tile__eyebrow">Latest tag</span>
        <span class="sp-tile__line">No tags yet</span>
      </div>
    );
  }
  if (tag === null) return <div class="sp-tile sp-tile--empty" aria-hidden="true" />;
  // Only the eyebrow and the version sit inside the link, so its name (`Latest tag <name>`) holds all the link's visible text; the
  // link still covers the whole tile.
  return (
    <div class="sp-tile sp-tile--tag sp-tile--linked">
      <A href={`/projects/${id}/-/files?${new URLSearchParams({ ref: tag.name }).toString()}`} class="sp-tile__cover" aria-label={`Latest tag ${tag.name}`}>
        <span class="sp-tile__eyebrow">Latest tag</span>{" "}
        <span class="sp-tile__kicker sp-tile__kicker--version sp-mono">{tag.name}</span>
      </A>
      <span class="sp-tile__line">{tag.message}</span>
    </div>
  );
}

function PipelineTile({ id, branch, overview }: { id: string; branch: string | null; overview: Overview | undefined }) {
  const pipeline = overview?.latest_pipeline ?? null;
  if (overview !== undefined && pipeline === null) {
    return (
      <div class="sp-tile sp-tile--empty">
        <span class="sp-tile__eyebrow">Latest pipeline</span>
        <span class="sp-tile__line">No pipelines yet</span>
      </div>
    );
  }
  if (pipeline === null) return <div class="sp-tile sp-tile--empty" aria-hidden="true" />;
  // The link is named `Latest pipeline on <branch>: <status>` (the brief's name), which starts with its visible eyebrow; the short
  // commit id stays in its text and the badge below shows the status.
  return (
    <div class="sp-tile sp-tile--pipeline sp-tile--linked">
      <A href={`/projects/${id}/-/pipelines/${pipeline.id}`} class="sp-tile__cover" aria-label={`Latest pipeline on ${branch ?? pipeline.ref}: ${pipeline.status}`}>
        <span class="sp-tile__eyebrow">Latest pipeline</span>{" "}
        <span class="sp-tile__kicker sp-mono">{pipeline.sha.slice(0, 7)}</span>
      </A>
      <span class="sp-tile__line">
        <StatusBadge status={pipeline.status} />
      </span>
    </div>
  );
}

function Stat({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div role="group" aria-label={label} class="sp-stat">
      <p class="sp-stat__label sp-mono">[ {label} ]</p>{" "}
      <p class="sp-stat__value sp-mono">{value}</p>{" "}
      <p class="sp-stat__caption">{caption}</p>
    </div>
  );
}

function Health({ overview }: { overview: Overview }) {
  return (
    <section aria-label="Project health" class="sp-health sp-dark">
      <div class="sp-container">
        <div class="sp-health__row" tabIndex={0}>
          <Stat label="Open merge requests" value={String(overview.open_merge_requests)} caption="waiting for review or merge" />
          <Stat label="Pipelines passed" value={overview.pipelines_passed === null ? "—" : `${overview.pipelines_passed}%`} caption="of the pipelines that finished" />
          <Stat label="Open issues" value={String(overview.open_issues)} caption="still to be done" />
        </div>
      </div>
    </section>
  );
}

function Activity({ events }: { events: readonly ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <div class="sp-container">
        <p class="sp-muted sp-activity-empty">No activity yet.</p>
      </div>
    );
  }
  return (
    <ul aria-label="Recent activity" class="sp-activity sp-dark">
      {events.map((event, index) => (
        <li key={index} class="sp-activity__cell">
          <A href={event.href} class="sp-activity__link">
            <span class="sp-activity__kicker sp-mono">
              <span class="sp-activity__square" aria-hidden="true" />
              {KIND_LABEL[event.kind]}
            </span>
            <span class="sp-activity__title">{event.title}</span>
            <span class="sp-activity__detail">{event.detail}</span>
            <Time iso={event.at} class="sp-activity__time sp-mono" />
          </A>
        </li>
      ))}
    </ul>
  );
}

export default function ProjectHomePage() {
  const { id = "" } = useRoute().params;
  const project = useProject();
  useTitle(project.name ?? "Project");
  const overview = useResource((signal) => api.get<Overview>(`/api/projects/${id}/overview`, { signal }), [id]);
  const activity = useResource(async (signal) => (await api.get<ActivityList>(`/api/projects/${id}/activity?limit=3`, { signal })).events, [id]);
  const group = groupOf(project.path);
  return (
    <Main project={id} pageKeys={["project"]} class="sp-home">
      <section data-hero class="sp-hero sp-hero-pull">
        <div class="sp-hero__dots" aria-hidden="true" />
        <div class="sp-hero__rules" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div class="sp-container sp-hero__inner">
          <p class="sp-kicker sp-hero__path">{group !== null ? `[ ${group} ]` : "\u00a0"}</p>
          <h1 class="sp-hero__title">{project.name ?? "\u00a0"}</h1>
          {project.error ? <Notice>{project.error.message}</Notice> : null}
          <div class="sp-hero__cols">
            <div class="sp-hero__col sp-hero__col--intro">
              <p class="sp-hero__description">{group !== null ? `A project of ${group}.` : "\u00a0"}</p>
              <A href={`/projects/${id}/-/merge_requests/new`} class="sp-bar">
                <span class="sp-bar__label">Open a merge request</span> <span class="sp-bar__arrow" aria-hidden="true">→</span>
              </A>
            </div>
            <div class="sp-hero__col sp-hero__col--tag">
              <TagTile id={id} overview={overview.data} />
            </div>
            <div class="sp-hero__col sp-hero__col--pipeline">
              <PipelineTile id={id} branch={project.defaultBranch} overview={overview.data} />
            </div>
          </div>
        </div>
      </section>
      {overview.error ? (
        <div class="sp-container">
          <Notice>{overview.error.message}</Notice>
        </div>
      ) : null}
      {overview.data ? <Health overview={overview.data} /> : null}
      {overview.data && overview.data.tags.length > 0 ? <ReleaseNotes tags={overview.data.tags} /> : null}
      {activity.data ? <Activity events={activity.data} /> : null}
    </Main>
  );
}
