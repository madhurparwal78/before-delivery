// `/groups/<path>`: group heading, subgroups, projects, members with their effective role, epics, and (owners) the spurpack import.
import type { ComponentChildren } from "preact";
import "../styles/project.css";
import { api, useResource } from "../api.ts";
import { A, useRoute } from "../router.ts";
import { Main } from "../shell/main.tsx";
import { Chip } from "../ui/chip.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { Heading } from "../ui/heading.tsx";
import { useTitle } from "../ui/page.tsx";
import { PackChooser } from "./project/import-flow.tsx";
import type { EpicRow, GroupView } from "./project/types.ts";

interface Loaded {
  group: GroupView;
  epics: EpicRow[];
}

async function loadGroup(path: string, signal: AbortSignal): Promise<Loaded> {
  const mine = await api.get<{ groups: Array<{ id: number; path: string }> }>("/api/me/groups", { signal });
  const found = mine.groups.find((group) => group.path === path);
  if (!found) throw new Error("Not found.");
  const group = await api.get<GroupView>(`/api/groups/${found.id}`, { signal });
  let epics: EpicRow[] = [];
  try {
    epics = (await api.get<{ epics: EpicRow[] }>(`/api/groups/${found.id}/epics`, { signal })).epics;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
  }
  return { group, epics };
}

function Section({ title, empty, count, children }: { title: string; empty: string; count: number; children: ComponentChildren }) {
  return (
    <section class="sp-group-section">
      <Heading level={2} class="sp-group-section__title">
        {title}
      </Heading>
      {count === 0 ? <p class="sp-muted">{empty}</p> : children}
    </section>
  );
}

export default function GroupPage() {
  const { path = "" } = useRoute().params;
  useTitle(path);
  const loaded = useResource((signal) => loadGroup(path, signal), [path]);
  return (
    <Main>
      <div class="sp-container sp-group">
        {loaded.error ? (
          <>
            <h1 class="sp-page-title">{path}</h1>
            <Notice>{loaded.error.message}</Notice>
          </>
        ) : null}
        {loaded.loading && !loaded.data && !loaded.error ? <Skeleton rows={5} height={56} /> : null}
        {loaded.data ? <GroupBody group={loaded.data.group} epics={loaded.data.epics} /> : null}
      </div>
    </Main>
  );
}

function GroupBody({ group, epics }: { group: GroupView; epics: EpicRow[] }) {
  return (
    <>
      <p class="sp-kicker sp-group__path">[ {group.path} ]</p>
      <h1 class="sp-page-title">{group.name}</h1>
      <p>
        <Chip>{group.visibility}</Chip>
      </p>
      {group.my_role === "owner" ? (
        <section class="sp-group-section">
          <Heading level={2} class="sp-group-section__title">
            Import a project
          </Heading>
          <p class="sp-muted">Upload a spurpack file to add its project to this group.</p>
          <PackChooser groupId={group.id} />
        </section>
      ) : null}
      <Section title="Subgroups" empty="No subgroups." count={group.subgroups.length}>
        <ul class="sp-group-list">
          {group.subgroups.map((sub) => (
            <li key={sub.id}>
              <A href={`/groups/${sub.path}`} class="sp-group-list__link">
                <span class="sp-group-list__name">{sub.name}</span>
                <span class="sp-group-list__meta sp-mono">{sub.path}</span>
              </A>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Projects" empty="No projects." count={group.projects.length}>
        <ul class="sp-group-list">
          {group.projects.map((project) => (
            <li key={project.id}>
              <A href={`/projects/${project.id}`} class="sp-group-list__link">
                <span class="sp-group-list__name">{project.name}</span>
                <span class="sp-group-list__meta sp-mono">{project.path}</span>
                <Chip>{project.visibility}</Chip>
              </A>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Members" empty="No members." count={group.members.length}>
        <ul class="sp-group-list">
          {group.members.map((member) => (
            <li key={member.username} class="sp-group-list__row">
              <span class="sp-group-list__name">{member.username}</span>
              <span class="sp-group-list__meta">
                {member.custom_role ?? member.role}. Effective role: {member.effective_role ?? "none"}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Epics" empty="No epics." count={epics.length}>
        <ul class="sp-group-list">
          {epics.map((epic) => (
            <li key={epic.iid}>
              <A href={`/groups/${group.path}/-/epics/${epic.iid}`} class="sp-group-list__link">
                <span class="sp-group-list__meta sp-mono">&amp;{epic.iid}</span>
                <span class="sp-group-list__name">{epic.title}</span>
                <Chip tone={epic.state === "opened" ? "live" : "idle"}>{epic.state}</Chip>
              </A>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
