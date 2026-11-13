// `/projects/<id>/-/wiki/<slug>`: the rendered page (HTML from the server's Markdown subset) and its editor. A live page.
import "../styles/repo.css";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { announce } from "../announce.tsx";
import { api, ApiError, asApiError, useAction } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { A, useRoute } from "../router.ts";
import { useRole } from "../role.ts";
import { LiveMain } from "../shell/main.tsx";
import { Button } from "../ui/button.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { TextArea, TextField } from "../ui/fields.tsx";
import { useTitle } from "../ui/page.tsx";
import { wikiPath } from "./repo/data.ts";
import { RepoTitle } from "./repo/chrome.tsx";
import { parseWikiList, parseWikiPage, type WikiListEntry, type WikiPageBody } from "./repo/types.ts";

interface Draft {
  title: string;
  content: string;
  /** The version this edit starts from; it only moves when this editor saves. */
  base: number;
}

interface WikiState {
  pages: WikiListEntry[];
  page: WikiPageBody | null;
}

async function loadWiki(project: string, slug: string, signal: AbortSignal): Promise<WikiState> {
  const pages = parseWikiList(await api.get(`/api/projects/${project}/wiki`, { signal }));
  if (!pages.some((entry) => entry.slug === slug)) return { pages, page: null };
  try {
    return { pages, page: parseWikiPage(await api.get(`/api/projects/${project}/wiki/${slug}`, { signal })) };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return { pages, page: null };
    throw cause;
  }
}

function WikiBody({ id, slug }: { id: string; slug: string }) {
  const role = useRole();
  const wiki = useLiveResource({ project: id, types: ["wiki"], load: (signal) => loadWiki(id, slug, signal), deps: [id, slug] });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const title = useRef<HTMLInputElement>(null);
  const mayWrite = !role.loaded || role.atLeast("developer");

  useLayoutEffect(() => {
    if (draft === null && wiki.data) {
      const page = wiki.data.page;
      setDraft(page ? { title: page.title, content: page.content, base: page.version } : { title: "", content: "", base: 0 });
    }
  }, [wiki.data, draft]);

  const save = useAction(
    async () => {
      if (draft === null) return;
      setNotice(null);
      setFieldErrors({});
      try {
        const saved = parseWikiPage(
          await api.put(`/api/projects/${id}/wiki/${slug}`, { title: draft.title, content: draft.content, base_version: draft.base }),
        );
        if (saved === null) return;
        setDraft({ ...draft, base: saved.version });
        wiki.setData((state) => ({
          pages: state?.pages.some((entry) => entry.slug === slug) ? state.pages : [...(state?.pages ?? []), { slug, title: saved.title }],
          page: saved,
        }));
        const text = `Saved version ${saved.version}.`;
        setNotice({ tone: "success", text });
        announce(text);
      } catch (cause) {
        const failure = asApiError(cause);
        announce(failure.message, "error");
        const fields = failure.status === 422 ? failure.fieldErrors() : {};
        if (fields["title"] !== undefined || fields["content"] !== undefined) setFieldErrors(fields);
        else setNotice({ tone: "error", text: failure.message });
      }
    },
    { announce: false },
  );

  useLayoutEffect(() => {
    if (creating) title.current?.focus();
  }, [creating]);

  if (wiki.error) return <Notice>{wiki.error.message}</Notice>;
  if (!draft || !wiki.data) return <Skeleton rows={6} height={48} />;

  const current = wiki.data.page;
  const pages = wiki.data.pages;
  const exists = current !== null;
  const noPages = pages.length === 0 && !exists;
  const showEditor = mayWrite && (exists || !noPages || creating);

  return (
    <div class="sp-wiki">
      <nav aria-label="Wiki pages" class="sp-wiki__pages">
        {pages.length === 0 ? (
          <p class="sp-muted">No pages.</p>
        ) : (
          <ul>
            {pages.map((entry) => (
              <li key={entry.slug}>
                <A href={wikiPath(id, entry.slug)} class="sp-wiki__link" aria-current={entry.slug === slug ? "page" : undefined}>
                  {entry.title}
                </A>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div class="sp-wiki__body">
        {noPages && !creating ? (
          <EmptyState
            tone="dark"
            eyebrow="WIKI"
            headline="No wiki pages yet"
            action={mayWrite ? { label: "Create the first page", onClick: () => setCreating(true) } : undefined}
          />
        ) : null}
        {current ? (
          <article class="sp-wiki__article">
            <div class="sp-wiki__bar">
              <span class="sp-kicker">[ Version {current.version} ]</span>
              <A href={wikiPath(id, slug, "history")} class="sp-linkbtn">
                History
              </A>
            </div>
            <div class="sp-wiki__render" dangerouslySetInnerHTML={{ __html: current.html }} />
          </article>
        ) : null}
        {showEditor ? (
          <form
            class="sp-wiki__form"
            aria-label={exists ? "Edit page" : "New page"}
            onSubmit={(event) => {
              event.preventDefault();
              void save.run();
            }}
          >
            {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
            <TextField
              label="Page title"
              name="wiki-title"
              value={draft.title}
              innerRef={title}
              error={fieldErrors["title"] ?? null}
              onInput={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
            />
            <TextArea
              label="Page content"
              name="wiki-content"
              rows={14}
              spellcheck={false}
              class="sp-wiki__content"
              value={draft.content}
              error={fieldErrors["content"] ?? null}
              onInput={(event) => setDraft({ ...draft, content: event.currentTarget.value })}
            />
            <Button type="submit" pending={save.pending}>
              Save page
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export default function WikiPage() {
  const { id, slug } = useRoute().params;
  useTitle("Wiki");
  return (
    <LiveMain project={id} pageKeys={["project", `wiki:${slug}`]} class="sp-repo-page">
      <div class="sp-container">
        <RepoTitle title="Wiki" />
        <WikiBody id={id} slug={slug} />
      </div>
    </LiveMain>
  );
}
