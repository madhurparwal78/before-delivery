// `/projects/<id>/-/blame?ref=&path=`: `table "Blame"` with one row per line (line, short commit, author, text).
import "../styles/repo.css";
import { useResource } from "../api.ts";
import { A, useRoute } from "../router.ts";
import { useProject } from "../role.ts";
import { Main } from "../shell/main.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { useTitle } from "../ui/page.tsx";
import { RepoTitle } from "./repo/chrome.tsx";
import { commitPath, loadBlame, repoPath, short } from "./repo/data.ts";

function BlameBody({ id }: { id: string }) {
  const route = useRoute();
  const project = useProject();
  const path = route.query.get("path") ?? "";
  const at = route.query.get("ref") ?? project.defaultBranch ?? "";
  const blame = useResource(async (signal) => (at === "" || path === "" ? [] : loadBlame(id, at, path, signal)), [id, at, path]);
  if (blame.error) return <Notice>{blame.error.message}</Notice>;
  if (!blame.data) return <Skeleton rows={8} height={24} />;
  return (
    <section class="sp-file" aria-label={`Blame of ${path}`}>
      <header class="sp-filebar">
        <span class="sp-filebar__path">{path}</span>
        <span class="sp-filebar__meta">{at}</span>
        <span class="sp-filebar__links">
          <A href={repoPath(id, "files", at, path)} class="sp-linkbtn">
            file
          </A>
          <A href={repoPath(id, "commits", at, path)} class="sp-linkbtn">
            history
          </A>
        </span>
      </header>
      <div class="sp-source__scroll" tabIndex={0} role="region" aria-label={`Blame lines of ${path}`}>
        <table class="sp-blame" aria-label="Blame">
          <thead class="sp-visually-hidden">
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Commit</th>
              <th scope="col">Author</th>
              <th scope="col">Text</th>
            </tr>
          </thead>
          <tbody>
            {blame.data.map((line) => (
              <tr key={line.line} class="sp-blame__row">
                <td class="sp-blame__line">{line.line}</td>
                <td class="sp-blame__commit">
                  <A href={commitPath(id, line.commit)}>{short(line.commit)}</A>
                </td>
                <td class="sp-blame__author">{line.author}</td>
                <td class="sp-blame__text">{line.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function BlamePage() {
  const { id } = useRoute().params;
  useTitle("Blame");
  return (
    <Main project={id} class="sp-repo-page">
      <div class="sp-container">
        <RepoTitle title="Blame" />
        <BlameBody id={id} />
      </div>
    </Main>
  );
}
