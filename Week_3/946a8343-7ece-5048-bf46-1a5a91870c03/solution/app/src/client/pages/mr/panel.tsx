// The merge request panel. On desk and tablet it is `complementary "Merge request panel"` (MrFrame draws the element); on a phone
// the same sections fill the bottom sheet's tabs (sheet.tsx).
//   <PanelSections page part checksRef? onMerged />   part "all": merge checks, approvals, merge buttons, threads, viewing now, train,
//                                                      reports, owners problems; part "checks": the same without the threads
import type { Ref } from "preact";
import { Skeleton } from "../../ui/index.ts";
import { TrainList } from "../train/train-list.tsx";
import { Approvals } from "./approvals.tsx";
import { MergeActions } from "./actions.tsx";
import { MergeChecks } from "./checks.tsx";
import { type MrPage, useMrCaps } from "./data.ts";
import { PanelSection } from "./parts.tsx";
import { OwnersProblems, ReportRegions, useReports } from "./reports.tsx";
import { ThreadsRegion } from "./threads.tsx";

interface PanelSectionsProps {
  page: MrPage;
  part: "all" | "checks";
  checksRef?: Ref<HTMLElement>;
  onMerged: () => void;
}

export function PanelSections({ page, part, checksRef, onMerged }: PanelSectionsProps) {
  const { mr, settings, project, iid } = page;
  const caps = useMrCaps(mr, settings);
  const reports = useReports(project, iid);
  const threads = part === "all" ? <ThreadsRegion project={project} page={page} variant="panel" /> : null;
  if (page.status === "loading") {
    return (
      <>
        <MergeChecks checks={null} innerRef={checksRef} />
        <Skeleton rows={4} height={32} />
      </>
    );
  }
  if (!mr) return <MergeChecks checks={null} innerRef={checksRef} />;
  return (
    <>
      <MergeChecks checks={mr.checks} innerRef={checksRef} />
      <Approvals page={page} caps={caps} />
      <MergeActions page={page} caps={caps} onMerged={onMerged} />
      {threads}
      <PanelSection title="Viewing now">
        {mr.viewing.length === 0 ? (
          <p class="sp-muted">Nobody else</p>
        ) : (
          <ul class="sp-viewer-list">
            {mr.viewing.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}
      </PanelSection>
      {settings?.merge_trains === true || mr.train !== null ? (
        <div class="sp-mrp">
          <h2 class="sp-mrp__title">Merge train</h2>
          <TrainList project={Number(project)} target={mr.target} variant="panel" currentIid={mr.iid} />
        </div>
      ) : null}
      <ReportRegions project={project} reports={reports} caps={caps} onChanged={page.reload} />
      <OwnersProblems problems={mr.owners_problems} />
    </>
  );
}
