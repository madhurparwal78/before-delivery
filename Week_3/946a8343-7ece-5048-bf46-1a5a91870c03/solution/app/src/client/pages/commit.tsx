// `/projects/<id>/-/commit/<full id>`: one commit. The level 1 heading `Commit <short>` takes focus after an editor commit.
import "../styles/repo.css";
import { useRef } from "preact/hooks";
import { useResource } from "../api.ts";
import { A, useFocusOnArrival, useRoute } from "../router.ts";
import { Main } from "../shell/main.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { useTitle } from "../ui/page.tsx";
import { Time } from "../ui/time.tsx";
import { DiffFiles } from "./repo/diff-view.tsx";
import { commitPath, loadCommit, short } from "./repo/data.ts";
import { RepoTitle } from "./repo/chrome.tsx";

function CommitBody({ id, sha }: { id: string; sha: string }) {
  const commit = useResource((signal) => loadCommit(id, sha, signal), [id, sha]);
  if (commit.error) return <Notice>{commit.error.message}</Notice>;
  if (!commit.data) return <Skeleton rows={6} height={48} />;
  const detail = commit.data;
  const [subject = "", ...rest] = detail.message.split("\n");
  return (
    <>
      <section class="sp-commit" aria-label="Commit details">
        <p class="sp-commit__subject">{subject || "(no message)"}</p>
        {rest.join("\n").trim() !== "" ? <pre class="sp-commit__body">{rest.join("\n").trim()}</pre> : null}
        <dl class="sp-commit__facts">
          <div>
            <dt>Author</dt>
            <dd>{detail.author}</dd>
          </div>
          <div>
            <dt>Authored</dt>
            <dd>
              <Time iso={detail.authoredAt} />
            </dd>
          </div>
          <div>
            <dt>Parents</dt>
            <dd>
              {detail.parents.length === 0
                ? "None"
                : detail.parents.map((parent) => (
                    <A key={parent} href={commitPath(id, parent)} class="sp-mono sp-commit__parent">
                      {short(parent)}
                    </A>
                  ))}
            </dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd class="sp-mono sp-commit__full">{detail.id}</dd>
          </div>
        </dl>
      </section>
      <h2 class="sp-section-title">{detail.diffs.length === 1 ? "1 file changed" : `${detail.diffs.length} files changed`}</h2>
      <DiffFiles diffs={detail.diffs} />
    </>
  );
}

export default function CommitPage() {
  const { id, sha } = useRoute().params;
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  useTitle(`Commit ${short(sha)}`);
  return (
    <Main project={id} class="sp-repo-page">
      <div class="sp-container">
        <RepoTitle title={`Commit ${short(sha)}`} headingRef={heading} />
        <CommitBody id={id} sha={sha} />
      </div>
    </Main>
  );
}
