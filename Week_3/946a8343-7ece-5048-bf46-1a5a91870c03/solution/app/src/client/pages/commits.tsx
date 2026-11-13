// `/projects/<id>/-/commits?ref=&path=`: first-parent history as flat rows with 1 px dividers.
import "../styles/repo.css";
import { useResource } from "../api.ts";
import { A, setQuery, useRoute } from "../router.ts";
import { useProject } from "../role.ts";
import { Main } from "../shell/main.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { useTitle } from "../ui/page.tsx";
import { Time } from "../ui/time.tsx";
import { RefSelect, RepoTitle } from "./repo/chrome.tsx";
import { commitPath, loadHistory, loadRefs, repoPath, short } from "./repo/data.ts";

function CommitsBody({ id }: { id: string }) {
  const route = useRoute();
  const project = useProject();
  const path = route.query.get("path") ?? "";
  const at = route.query.get("ref") ?? project.defaultBranch ?? "";
  const refs = useResource((signal) => loadRefs(id, signal), [id]);
  const history = useResource(async (signal) => (at === "" ? [] : loadHistory(id, at, path, signal)), [id, at, path]);
  if (refs.error || history.error) return <Notice>{(refs.error ?? history.error)?.message ?? ""}</Notice>;
  if (!refs.data || !history.data) return <Skeleton rows={6} height={64} />;
  return (
    <>
      <div class="sp-repo-bar">
        <RefSelect label="Ref" name="ref" refs={refs.data} value={at} onChange={(value) => setQuery({ ref: value })} />
        {path !== "" ? (
          <p class="sp-repo-bar__filter">
            Only commits that changed <span class="sp-mono">{path}</span>. <A href={repoPath(id, "commits", at, "")}>Show all</A>
          </p>
        ) : null}
      </div>
      {history.data.length === 0 ? (
        <EmptyState tone="dark" eyebrow="COMMITS" headline="No commits yet" />
      ) : (
        <ul class="sp-history" aria-label="Commits">
          {history.data.map((commit) => (
            <li key={commit.id} class="sp-history__row">
              <A href={commitPath(id, commit.id)} class="sp-history__message">
                {commit.message.split("\n")[0] || "(no message)"}
              </A>
              <span class="sp-history__meta">
                <span class="sp-mono sp-history__id">{short(commit.id)}</span>
                <span>{commit.author}</span>
                <Time iso={commit.authoredAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function CommitsPage() {
  const { id } = useRoute().params;
  useTitle("Commits");
  return (
    <Main project={id} class="sp-repo-page">
      <div class="sp-container">
        <RepoTitle title="Commits" />
        <CommitsBody id={id} />
      </div>
    </Main>
  );
}
