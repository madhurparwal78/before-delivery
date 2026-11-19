import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ChapterPage, VersionView } from "../../shared/api.ts";
import { VERSION_STATE_WORDS, type Role, type VersionState } from "../../shared/domain.ts";
import { ApiFailure, api, get } from "../lib/api.ts";
import { dateOf } from "../lib/format.ts";
import { useHeadingFocus, useTitle } from "../lib/focus.ts";
import { useLive } from "../lib/live.ts";
import { useSession } from "../lib/session.tsx";
import { Alert, Button, Loading, usePageStatus } from "../ui/index.ts";
import { VersionForm } from "../editor/VersionForm.tsx";
import { useAction } from "../admin/useAction.ts";
import { NotFound } from "./NotFound.tsx";
import "../editor/editor.css";

interface VersionSummary {
  id: string;
  number: number;
  state: VersionState;
  revision: number;
  publishedAt: string | null;
}

const OPEN_STATES: readonly VersionState[] = ["draft", "in_review", "approved"];

/** `/editor/<slug>`: the version list of a chapter and the open version's form. */
export function Editor({ params }: { params: string[] }): ReactNode {
  const [slug] = params;
  const role = useSession().me!.principal.role;
  const say = usePageStatus();
  const action = useAction();
  const [chapter, setChapter] = useState<ChapterPage | "missing" | null>(null);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<VersionView | null>(null);
  const [assetNames, setAssetNames] = useState<Map<string, string>>(new Map());

  const loadVersions = useCallback(async (): Promise<VersionSummary[]> => {
    const list = (await get<{ versions: VersionSummary[] }>(`/api/chapters/${slug}/versions`)).versions.sort((a, b) => b.number - a.number);
    setVersions(list);
    return list;
  }, [slug]);

  const loadDetail = useCallback(async (id: string): Promise<void> => {
    const view = await get<VersionView>(`/api/versions/${id}`);
    setAssetNames(new Map((view.assetOptions ?? []).map((a) => [a.id, a.name])));
    setDetail(view);
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    const list = await loadVersions();
    const open = list.find((v) => OPEN_STATES.includes(v.state));
    setSelected((current) => (current && list.some((v) => v.id === current) ? current : (open?.id ?? null)));
  }, [loadVersions]);

  useEffect(() => {
    get<ChapterPage>(`/api/chapters/${slug}`).then(setChapter, (failure: unknown) => {
      if (failure instanceof ApiFailure && failure.status === 404) setChapter("missing");
    });
    void reload();
  }, [slug, reload]);
  useEffect(() => {
    if (selected) void loadDetail(selected);
    else setDetail(null);
  }, [selected, loadDetail, versions]);
  useLive(["chapter.updated"], () => void reload());

  const title = chapter && chapter !== "missing" ? chapter.title : slug;
  useTitle(`${title} editor`);
  useHeadingFocus(versions !== null && chapter !== null);

  if (chapter === "missing") return <NotFound />;
  if (!versions || !chapter) return <Loading />;

  const latest = Math.max(0, ...versions.map((v) => v.number));
  const hasOpen = versions.some((v) => OPEN_STATES.includes(v.state));
  const refresh = async (): Promise<void> => {
    await reload();
    if (selected) await loadDetail(selected);
  };
  const perform = (key: string, work: () => Promise<void>): Promise<boolean> => action.run(key, work);

  return (
    <div className="stack">
      <div className="screen-head" data-frame>
        <h1>{`${title} editor`}</h1>
        <p className="muted">Draft, review and publish versions of this chapter. Every statement keeps a stable rule identifier.</p>
      </div>
      <div className="editor-layout">
        <section className="cell cell-pad stack" data-frame aria-label="Version list">
          <h2>Versions</h2>
          <ul className="versions" aria-label="Versions">
            {versions.map((v) => (
              <li key={v.id} aria-current={v.id === selected}>
                <span className="version-title">{`Version ${v.number} — ${VERSION_STATE_WORDS[v.state]}`}</span>
                {v.publishedAt ? <span className="muted">Published {dateOf(v.publishedAt)}</span> : null}
                <div className="cell-actions">
                  {v.id !== selected ? <Button onClick={() => setSelected(v.id)}>{`Open version ${v.number}`}</Button> : null}
                  {role === "owner" && v.state === "approved" ? (
                    <Button
                      primary
                      pending={action.busy === `publish:${v.id}` && "save"}
                      onClick={() =>
                        void perform(`publish:${v.id}`, async () => {
                          await api("POST", `/api/versions/${v.id}/publish`);
                          await refresh();
                          say(`Version ${v.number} published.`);
                        })
                      }
                    >
                      {`Publish version ${v.number}`}
                    </Button>
                  ) : null}
                  {role === "owner" && (v.state === "published" || v.state === "superseded") ? (
                    <Button
                      pending={action.busy === `republish:${v.id}` && "save"}
                      onClick={() =>
                        void perform(`republish:${v.id}`, async () => {
                          const created = await api<VersionView>("POST", `/api/chapters/${slug}/republish`, { version: v.number });
                          await reload();
                          setSelected(created.id);
                          say(`Version ${created.number} published from version ${v.number}.`);
                        })
                      }
                    >
                      {`Republish version ${v.number}`}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {role === "author" && !hasOpen ? (
            <Button
              primary
              pending={action.busy === "start" && "save"}
              onClick={() =>
                void perform("start", async () => {
                  const created = await api<VersionView>("POST", `/api/chapters/${slug}/versions`);
                  await reload();
                  setSelected(created.id);
                })
              }
            >
              {`Start version ${latest + 1}`}
            </Button>
          ) : null}
          <Alert message={action.error && !action.error.key.startsWith("form:") ? action.error.message : null} />
        </section>
        {detail ? (
          <VersionForm
            key={detail.id}
            version={detail}
            slug={slug}
            role={role as Role}
            publishedStatements={chapter.statements.map((s) => s.identifier)}
            assetNames={assetNames}
            onChanged={refresh}
            run={perform}
            busy={action.busy}
            error={action.error?.key.startsWith("form:") ? action.error.message : null}
            say={say}
          />
        ) : (
          <section className="cell cell-pad" data-frame>
            <p className="muted">{hasOpen ? "Open a version to read it." : "No version is open. Open one from the list to read it."}</p>
          </section>
        )}
      </div>
    </div>
  );
}
