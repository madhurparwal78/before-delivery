// Frame of the merge request pages (overview and changes): live main, header (ref kicker, !iid, title, navigation "Merge request",
// the state buttons) and the panes.
//   desk (1280 px and wider)  navigation "Files" | centre | complementary "Merge request panel"
//   tablet (768 to 1279 px)   centre | panel; the file list sits in a drawer opened by button "Show files"
//   phone (narrower)          one column; button "Open panel" opens dialog "Panel" (sheet.tsx)
// `page` is the result of useMergeRequestPage; `filesNav` is the content of navigation "Files" (null: this page has no file list).
// After a navigation that asked for it (requestMrFocus) the level 1 heading or region "Merge checks" takes focus.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Dialog } from "../../a11y/dialog.tsx";
import { api, useAction } from "../../api.ts";
import { useBreakpoint } from "../../hooks.ts";
import "../../styles/mr.css";
import { useLivePage } from "../../live.ts";
import { A, currentLocation } from "../../router.ts";
import { LiveMain } from "../../shell/main.tsx";
import { Button, Chip, Notice, Skeleton, useTitle } from "../../ui/index.ts";
import { type MrCaps, type MrPage, mrBase, mrPath, useMrCaps } from "./data.ts";
import { ActionNotice, takeMrFocus, useFocusRequest } from "./parts.tsx";
import { PanelSections } from "./panel.tsx";
import { PanelSheet } from "./sheet.tsx";

interface MrFrameProps {
  project: string;
  iid: number;
  tab: "overview" | "changes";
  page: MrPage;
  filesNav: ComponentChildren | null;
  children?: ComponentChildren;
}

function stateWord(page: MrPage): { label: string; tone: "ok" | "wait" | "fail" | "idle" } {
  const mr = page.mr;
  if (!mr) return { label: "", tone: "idle" };
  if (mr.state === "merged") return { label: "Merged", tone: "ok" };
  if (mr.state === "closed") return { label: "Closed", tone: "fail" };
  return mr.draft ? { label: "Draft", tone: "wait" } : { label: "Open", tone: "ok" };
}

function BindLivePage({ page }: { page: MrPage }) {
  page.livePage.current = useLivePage();
  return null;
}

function StateButtons({ page, caps, onReady }: { page: MrPage; caps: MrCaps; onReady: () => void }) {
  const { mr } = page;
  const focus = useFocusRequest();
  const base = mr ? mrBase(page.project, mr.iid) : "";
  const ready = useAction(async () => {
    await api.patch(base, { state_event: "ready" });
    await page.reload();
    onReady();
  });
  const close = useAction(async () => {
    await api.patch(base, { state_event: "close" });
    focus.request("reopen");
    await page.reload();
  });
  const reopen = useAction(async () => {
    await api.patch(base, { state_event: "reopen" });
    focus.request("close");
    await page.reload();
  });
  const rebase = useAction(async () => {
    await api.post(`${base}/rebase`);
    await page.reload();
  });
  if (!mr || !caps.write) return null;
  const behind = mr.checks.some((check) => check.name === "rebase" && check.state === "failed");
  const open = mr.state === "opened";
  return (
    <>
      <div class="sp-mr__actions">
        {open && mr.draft ? (
          <Button variant="secondary" pending={ready.pending} onClick={() => void ready.run()}>
            Mark as ready
          </Button>
        ) : null}
        {open && behind ? (
          <Button variant="secondary" pending={rebase.pending} onClick={() => void rebase.run()}>
            Rebase
          </Button>
        ) : null}
        {open ? (
          <Button innerRef={focus.ref("close")} variant="secondary" pending={close.pending} onClick={() => void close.run()}>
            Close merge request
          </Button>
        ) : null}
        {mr.state === "closed" ? (
          <Button innerRef={focus.ref("reopen")} variant="secondary" pending={reopen.pending} onClick={() => void reopen.run()}>
            Reopen merge request
          </Button>
        ) : null}
      </div>
      <ActionNotice errors={[ready.error, close.error, reopen.error, rebase.error]} />
    </>
  );
}

function MergedHeading({ target, wanted }: { target: string; wanted: { current: boolean } }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (!wanted.current) return;
    wanted.current = false;
    heading.current?.focus();
  }, []);
  return (
    <h2 ref={heading} tabIndex={-1} class="sp-mr__merged">
      {`Merged into ${target}`}
    </h2>
  );
}

export function MrFrame({ project, iid, tab, page, filesNav, children }: MrFrameProps) {
  const { mr } = page;
  const breakpoint = useBreakpoint();
  const caps = useMrCaps(mr, page.settings);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const checksRef = useRef<HTMLElement>(null);
  const filesOpener = useRef<HTMLButtonElement>(null);
  const panelOpener = useRef<HTMLButtonElement>(null);
  const mergedFocus = useRef(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useTitle(mr ? `${mr.title} (!${iid})` : `Merge request !${iid}`);

  // The head and the layout draw once the first answer is in, so nothing above or beside them moves when the data arrives.
  const loading = page.status === "loading";

  useLayoutEffect(() => {
    if (loading) return;
    const target = takeMrFocus(currentLocation().path);
    if (target === "checks") (checksRef.current ?? headingRef.current)?.focus();
    else if (target === "heading") headingRef.current?.focus();
  }, [loading]);

  const pageKeys = useMemo(() => (mr ? [`mr:${iid}`, `train:${mr.target}`] : [`mr:${iid}`]), [iid, mr?.target]);
  const onMerged = () => {
    mergedFocus.current = true;
    setSheetOpen(false);
  };
  const word = stateWord(page);
  const ref = mr ? `[ ${mr.source} -> ${mr.target} ]` : "";
  const refQuery = mr ? `?ref=${encodeURIComponent(mr.source)}` : "";
  const projectBase = `/projects/${encodeURIComponent(project)}/-`;
  const link = (href: string, label: string, current: boolean) => (
    <A href={href} class="sp-mr__link" aria-current={current ? "page" : undefined}>
      {label}
    </A>
  );
  const phone = breakpoint === "phone";
  const desk = breakpoint === "desk";
  const files = (
    <nav aria-label="Files" data-landmark="files" class="sp-mr__files" onClick={(event) => {
      if (!desk && event.target instanceof Element && event.target.closest("a, button")) setDrawerOpen(false);
    }}>
      {filesNav}
    </nav>
  );

  return (
    <LiveMain project={project} pageKeys={pageKeys} class="sp-mr">
      <BindLivePage page={page} />
      <div class="sp-mr__wrap">
        {loading ? <Skeleton rows={3} height={32} /> : null}
        <div class="sp-mr__head" hidden={loading}>
          <p class="sp-mr__ref">
            {mr ? <span class="sp-mr__kicker sp-kicker">{ref}</span> : null}
            <span class="sp-mr__iid sp-mono">{`!${iid}`}</span>
            {word.label ? <Chip tone={word.tone}>{word.label}</Chip> : null}
          </p>
          <h1 ref={headingRef} tabIndex={-1} class="sp-mr__title">
            {mr ? mr.title : `Merge request !${iid}`}
          </h1>
          <div class="sp-mr__bar">
            <nav aria-label="Merge request" class="sp-mr__nav">
              {link(`${projectBase}/merge_requests/${iid}`, "Overview", tab === "overview")}
              {link(`${projectBase}/commits${refQuery}`, "Commits", false)}
              {link(`${projectBase}/pipelines${refQuery}`, "Pipelines", false)}
              {link(mrPath(project, iid, "changes"), "Changes", tab === "changes")}
            </nav>
            {phone ? (
              <Button innerRef={panelOpener} onClick={() => setSheetOpen(true)}>
                Open panel
              </Button>
            ) : null}
            {breakpoint === "tablet" && filesNav !== null ? (
              <Button innerRef={filesOpener} variant="secondary" onClick={() => setDrawerOpen(true)}>
                Show files
              </Button>
            ) : null}
          </div>
          <StateButtons page={page} caps={caps} onReady={() => headingRef.current?.focus()} />
          {mr && mr.state === "merged" ? <MergedHeading target={mr.target} wanted={mergedFocus} /> : null}
        </div>
        {page.status === "error" && page.error ? <Notice>{page.error.message}</Notice> : null}
        <div class={`sp-mr__layout sp-mr__layout--${breakpoint}`} hidden={loading}>
          {desk && filesNav !== null ? files : null}
          <div class="sp-mr__center">{children}</div>
          {!phone ? (
            <aside aria-label="Merge request panel" data-landmark="panel" tabIndex={-1} class="sp-mr__panel">
              <PanelSections page={page} part="all" checksRef={checksRef} onMerged={onMerged} />
            </aside>
          ) : null}
        </div>
      </div>
      {phone ? <PanelSheet page={page} filesNav={filesNav} open={sheetOpen} onClose={() => setSheetOpen(false)} opener={panelOpener} onMerged={onMerged} /> : null}
      {breakpoint === "tablet" && filesNav !== null ? (
        <Dialog name="Files" open={drawerOpen} onClose={() => setDrawerOpen(false)} opener={filesOpener} class="sp-mr-drawer">
          <div class="sp-dialog__bar">
            <h2 class="sp-dialog__title">Files</h2>
            <Button variant="ghost" class="sp-dialog__close" aria-label="Close files" onClick={() => setDrawerOpen(false)}>
              Close
            </Button>
          </div>
          {files}
        </Dialog>
      ) : null}
    </LiveMain>
  );
}
