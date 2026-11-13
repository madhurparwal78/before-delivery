// `/projects/<id>/-/files?ref=&path=`: the file tree and the file view on the ground. Not a live page.
import "../styles/repo.css";
import { useRoute, A, navigate, setQuery } from "../router.ts";
import { useResource } from "../api.ts";
import { useProject, useRole } from "../role.ts";
import { Main } from "../shell/main.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { useTitle } from "../ui/page.tsx";
import { RefSelect, RepoTitle } from "./repo/chrome.tsx";
import { ancestors, basename, formatSize, loadFile, loadRefs, repoPath } from "./repo/data.ts";
import { FileTree } from "./repo/tree.tsx";
import { splitLines } from "../../shared/diff.ts";

function Breadcrumb({ id, at, path }: { id: string; at: string; path: string }) {
  const parts = path.split("/").filter((part) => part !== "");
  return (
    <nav aria-label="Path" class="sp-crumbs">
      <ol>
        <li>{parts.length === 0 ? <span aria-current="page">root</span> : <A href={repoPath(id, "files", at, "")}>root</A>}</li>
        {parts.map((part, index) => {
          const upTo = parts.slice(0, index + 1).join("/");
          return (
            <li key={upTo}>
              {index === parts.length - 1 ? <span aria-current="page">{part}</span> : <A href={repoPath(id, "files", at, upTo)}>{part}</A>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Source({ content }: { content: string }) {
  const lines = splitLines(content);
  if (lines.length === 0) return <p class="sp-source__empty">This file is empty.</p>;
  return (
    <pre class="sp-source">
      <code>
        {lines.map((text, index) => (
          <span key={index} class="sp-source__line">{`${text}\n`}</span>
        ))}
      </code>
    </pre>
  );
}

function FilesBody({ id }: { id: string }) {
  const route = useRoute();
  const project = useProject();
  const role = useRole();
  const refs = useResource((signal) => loadRefs(id, signal), [id]);
  const requested = route.query.get("ref");
  const path = route.query.get("path") ?? "";
  const at = requested ?? project.defaultBranch ?? "";
  const file = useResource(async (signal) => (path === "" || at === "" ? null : loadFile(id, at, path, signal)), [id, at, path]);
  const mayEdit = !role.loaded || role.atLeast("developer");

  if (refs.error) return <Notice>{refs.error.message}</Notice>;
  if (!refs.data || at === "") return <Skeleton rows={6} height={40} />;

  const isEmpty = refs.data.branches.length === 0 && refs.data.tags.length === 0;
  if (isEmpty) {
    return (
      <EmptyState
        tone="dark"
        eyebrow="FILES"
        headline="This project is empty"
        action={mayEdit ? { label: "Add a file", href: repoPath(id, "edit", project.defaultBranch ?? "main", "") } : undefined}
      />
    );
  }

  const isFolder = path !== "" && file.error?.status === 404;
  const reveal = isFolder ? [...ancestors(path), path] : ancestors(path);
  const open = (target: string): void => {
    navigate(repoPath(id, "files", at, target));
  };

  return (
    <>
      <div class="sp-repo-bar">
        <RefSelect label="Ref" name="ref" refs={refs.data} value={at} onChange={(value) => setQuery({ ref: value, path: null })} />
        <Breadcrumb id={id} at={at} path={path} />
        <nav aria-label="Repository" class="sp-repo-bar__links">
          <A href={repoPath(id, "commits", at, "")} class="sp-linkbtn">
            Commits
          </A>
        </nav>
      </div>
      <div class="sp-repo-split">
        <div data-landmark="files" class="sp-repo-side">
          <FileTree project={id} at={at} selected={path} reveal={reveal} onOpenFile={open} />
        </div>
        <div class="sp-repo-view">
          {path === "" || isFolder ? (
            <p class="sp-repo-hint">{isFolder ? `${basename(path)} is a folder. Pick a file to read it.` : "Pick a file to read it."}</p>
          ) : file.error ? (
            <Notice>{file.error.message}</Notice>
          ) : !file.data ? (
            <Skeleton rows={8} height={24} />
          ) : (
            <section class="sp-file" aria-label={`File ${file.data.path}`}>
              <header class="sp-filebar">
                <span class="sp-filebar__path">{file.data.path}</span>
                <span class="sp-filebar__meta">{formatSize(file.data.size)}</span>
                <span class="sp-filebar__links">
                  <A href={repoPath(id, "blame", at, path)} class="sp-linkbtn">
                    blame
                  </A>
                  <A href={repoPath(id, "commits", at, path)} class="sp-linkbtn">
                    history
                  </A>
                  {mayEdit ? (
                    <A href={repoPath(id, "edit", at, path)} class="sp-linkbtn">
                      edit
                    </A>
                  ) : null}
                </span>
              </header>
              <div class="sp-source__scroll" tabIndex={0} role="region" aria-label={`Source of ${file.data.path}`}>
                <Source content={file.data.content} />
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export default function FilesPage() {
  const { id } = useRoute().params;
  useTitle("Files");
  return (
    <Main project={id} class="sp-repo-page">
      <div class="sp-container">
        <RepoTitle title="Files" />
        <FilesBody id={id} />
      </div>
    </Main>
  );
}
