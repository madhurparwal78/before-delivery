// `dialog "Panel"` on a phone: the bottom sheet with tabs Checks (merge checks, approvals, Approve, the merge buttons and the
// reports), Threads and Files. It rises with `sheet-rise` (220 ms, translateY(96px) -> 0, starting below the screen edge) unless the reader prefers reduced motion;
// Escape closes it and focus returns to `button "Open panel"`; Tab stays inside (a11y/dialog.tsx).
import type { ComponentChildren, RefObject } from "preact";
import { Sheet } from "../../a11y/dialog.tsx";
import { prefersReducedMotion } from "../../hooks.ts";
import { Button, Tabs } from "../../ui/index.ts";
import type { MrPage } from "./data.ts";
import { PanelSections } from "./panel.tsx";
import { ThreadsRegion } from "./threads.tsx";

const RISE_MS = 220;

function rise(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  element.animate({ transform: ["translateY(96px)", "translateY(0)"] }, { duration: RISE_MS, easing: "cubic-bezier(0, 1, 0.05, 1)", id: "sheet-rise" });
}

export function PanelSheet({
  page,
  filesNav,
  open,
  onClose,
  opener,
  onMerged,
}: {
  page: MrPage;
  filesNav: ComponentChildren | null;
  open: boolean;
  onClose: () => void;
  opener: RefObject<HTMLElement>;
  onMerged: () => void;
}) {
  return (
    <Sheet name="Panel" open={open} onClose={onClose} opener={opener} motion={rise} class="sp-mr-sheet">
      <div class="sp-dialog__bar">
        <h2 class="sp-dialog__title">Panel</h2>
        <Button variant="ghost" class="sp-dialog__close" aria-label="Close panel" onClick={onClose}>
          Close
        </Button>
      </div>
      <Tabs
        label="Panel sections"
        tabs={[
          { id: "checks", label: "Checks", panel: <PanelSections page={page} part="checks" onMerged={onMerged} /> },
          { id: "threads", label: "Threads", panel: <ThreadsRegion project={page.project} page={page} variant="sheet" /> },
          {
            id: "files",
            label: "Files",
            panel: (
              <nav aria-label="Files" data-landmark="files">
                {filesNav ?? <p class="sp-muted">No files</p>}
              </nav>
            ),
          },
        ]}
      />
    </Sheet>
  );
}
