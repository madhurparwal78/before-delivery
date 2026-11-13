// `/projects/<id>/-/wiki/<slug>/history`: the numbered versions of a page, a diff of any two, and restoring one as a new version.
import "../styles/repo.css";
import { useState } from "preact/hooks";
import { announce } from "../announce.tsx";
import { api, ApiError, asApiError, useAction } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { A, useRoute } from "../router.ts";
import { useRole } from "../role.ts";
import { LiveMain } from "../shell/main.tsx";
import { Button } from "../ui/button.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { Select } from "../ui/fields.tsx";
import { useTitle } from "../ui/page.tsx";
import { Time } from "../ui/time.tsx";
import { diffHunks, splitLines } from "../../shared/diff.ts";
import { DiffBlock } from "./repo/diff-view.tsx";
import { RepoTitle } from "./repo/chrome.tsx";
import { wikiPath } from "./repo/data.ts";
import { parseWikiPage, parseWikiVersions, type WikiVersion } from "./repo/types.ts";

async function loadVersions(project: string, slug: string, signal: AbortSignal): Promise<WikiVersion[]> {
  try {
    return parseWikiVersions(await api.get(`/api/projects/${project}/wiki/${slug}/versions`, { signal }));
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return [];
    throw cause;
  }
}

function HistoryBody({ id, slug }: { id: string; slug: string }) {
  const role = useRole();
  const versions = useLiveResource({
    project: id,
    types: ["wiki"],
    load: (signal) => loadVersions(id, slug, signal),
    deps: [id, slug],
    match: (message) => message.data.slug === undefined || message.data.slug === slug,
  });
  const [picked, setPicked] = useState<{ from: number; to: number } | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const mayWrite = !role.loaded || role.atLeast("developer");

  const restore = useAction(
    async (version: number) => {
      setNotice(null);
      try {
        const saved = parseWikiPage(await api.post(`/api/projects/${id}/wiki/${slug}/restore`, { version }));
        const text = saved ? `Restored version ${version} as version ${saved.version}.` : `Restored version ${version}.`;
        setNotice({ tone: "success", text });
        announce(text);
        await versions.reload();
      } catch (cause) {
        const failure = asApiError(cause);
        setNotice({ tone: "error", text: failure.message });
        announce(failure.message, "error");
      }
    },
    { announce: false },
  );

  if (versions.error) return <Notice>{versions.error.message}</Notice>;
  if (!versions.data) return <Skeleton rows={5} height={56} />;
  const all = versions.data;
  if (all.length === 0) {
    return (
      <EmptyState
        tone="dark"
        eyebrow="WIKI"
        headline="No wiki pages yet"
        action={{ label: "Create the first page", href: wikiPath(id, slug) }}
      />
    );
  }

  const newest = all[all.length - 1]?.version ?? 1;
  const choice = picked ?? { from: all[all.length - 2]?.version ?? newest, to: newest };
  const older = all.find((entry) => entry.version === choice.from);
  const newer = all.find((entry) => entry.version === choice.to);
  const hunks = older && newer ? diffHunks(splitLines(older.content), splitLines(newer.content)) : [];
  const options = all.map((entry) => <option key={entry.version} value={String(entry.version)}>{`Version ${entry.version}`}</option>);
  const restoring = Math.min(choice.from, choice.to);

  return (
    <div class="sp-wiki-history">
      <div class="sp-repo-bar sp-repo-bar--pair">
        <Select
          label="Compare from"
          name="wiki-from"
          value={String(choice.from)}
          onChange={(event) => setPicked({ ...choice, from: Number(event.currentTarget.value) })}
        >
          {options}
        </Select>
        <Select
          label="Compare to"
          name="wiki-to"
          value={String(choice.to)}
          onChange={(event) => setPicked({ ...choice, to: Number(event.currentTarget.value) })}
        >
          {options}
        </Select>
      </div>
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {older && newer ? (
        <DiffBlock path={`Version ${older.version} to Version ${newer.version}`} status={null} oldPath={null} hunks={hunks} />
      ) : null}
      {mayWrite ? (
        <div class="sp-wiki-history__restore">
          <Button pending={restore.pending} onClick={() => void restore.run(restoring)}>
            Restore this version
          </Button>
          <span class="sp-muted">{`Saves Version ${restoring} as a new version.`}</span>
        </div>
      ) : null}
      <ul class="sp-history" aria-label="Versions">
        {[...all].reverse().map((entry) => (
          <li key={entry.version} class="sp-history__row">
            <span class="sp-history__message">{`Version ${entry.version}: ${entry.title}`}</span>
            <span class="sp-history__meta">
              <span>{entry.author}</span>
              <Time iso={entry.createdAt} />
            </span>
          </li>
        ))}
      </ul>
      <A href={wikiPath(id, slug)} class="sp-linkbtn">
        Back to the page
      </A>
    </div>
  );
}

export default function WikiHistoryPage() {
  const { id, slug } = useRoute().params;
  useTitle("Wiki history");
  return (
    <LiveMain project={id} pageKeys={["project", `wiki:${slug}`]} class="sp-repo-page">
      <div class="sp-container">
        <RepoTitle title="Wiki history" />
        <HistoryBody id={id} slug={slug} />
      </div>
    </LiveMain>
  );
}
