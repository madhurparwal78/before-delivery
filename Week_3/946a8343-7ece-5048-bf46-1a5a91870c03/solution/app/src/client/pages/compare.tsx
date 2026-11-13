// `/projects/<id>/-/compare?from=&to=`: the commits between two refs and the files they change.
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
import { DiffFiles } from "./repo/diff-view.tsx";
import { commitPath, loadCompare, loadRefs, short } from "./repo/data.ts";

function CompareBody({ id }: { id: string }) {
  const route = useRoute();
  const project = useProject();
  const from = route.query.get("from") ?? project.defaultBranch ?? "";
  const to = route.query.get("to") ?? project.defaultBranch ?? "";
  const refs = useResource((signal) => loadRefs(id, signal), [id]);
  const compared = useResource(async (signal) => (from === "" || to === "" ? null : loadCompare(id, from, to, signal)), [id, from, to]);
  if (refs.error) return <Notice>{refs.error.message}</Notice>;
  if (!refs.data) return <Skeleton rows={6} height={48} />;
  return (
    <>
      <div class="sp-repo-bar sp-repo-bar--pair">
        <RefSelect
          label="Compare from"
          name="compare-from"
          refs={refs.data}
          value={from}
          onChange={(value) => setQuery({ from: value, to })}
        />
        <RefSelect label="Compare to" name="compare-to" refs={refs.data} value={to} onChange={(value) => setQuery({ from, to: value })} />
      </div>
      {compared.error ? <Notice>{compared.error.message}</Notice> : null}
      {!compared.data && !compared.error ? <Skeleton rows={6} height={48} /> : null}
      {compared.data && compared.data.commits.length === 0 && compared.data.diffs.length === 0 ? (
        <EmptyState tone="dark" eyebrow="COMPARE" headline="No differences" />
      ) : null}
      {compared.data && compared.data.commits.length > 0 ? (
        <>
          <h2 class="sp-section-title">{compared.data.commits.length === 1 ? "1 commit" : `${compared.data.commits.length} commits`}</h2>
          <ul class="sp-history" aria-label="Commits">
            {compared.data.commits.map((commit) => (
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
        </>
      ) : null}
      {compared.data && compared.data.diffs.length > 0 ? (
        <>
          <h2 class="sp-section-title">
            {compared.data.diffs.length === 1 ? "1 file changed" : `${compared.data.diffs.length} files changed`}
          </h2>
          <DiffFiles diffs={compared.data.diffs} />
        </>
      ) : null}
    </>
  );
}

export default function ComparePage() {
  const { id } = useRoute().params;
  useTitle("Compare");
  return (
    <Main project={id} class="sp-repo-page">
      <div class="sp-container">
        <RepoTitle title="Compare" />
        <CompareBody id={id} />
      </div>
    </Main>
  );
}
