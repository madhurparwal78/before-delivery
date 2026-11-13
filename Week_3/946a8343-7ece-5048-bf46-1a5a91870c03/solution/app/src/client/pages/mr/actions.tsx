// The merge buttons of the panel. Which ones show comes from the request's state, the project's settings and the live role:
//   Merge / Set to auto-merge / Cancel auto-merge     merge trains off
//   Add to merge train                                 merge trains on, not on the train
//   Remove from train / Merge now (maintainer)         on the train
// A refusal (a failed merge check comes back as 409 merge_blocked with its text) shows in the strip and is announced.
import { api, idempotencyKey, useAction } from "../../api.ts";
import { Button } from "../../ui/index.ts";
import { focusCar } from "../train/train-list.tsx";
import { type MrCaps, type MrPage, mrBase } from "./data.ts";
import { ActionNotice } from "./parts.tsx";

export function MergeActions({ page, caps, onMerged }: { page: MrPage; caps: MrCaps; onMerged: () => void }) {
  const { mr, settings } = page;
  const base = mr ? mrBase(page.project, mr.iid) : "";
  const sha = mr?.source_head ?? null;

  const merge = useAction(async () => {
    if (sha === null) return;
    await api.post(`${base}/merge`, { sha }, { idempotencyKey: idempotencyKey() });
    onMerged();
    page.patch((current) => ({ ...current, state: "merged", auto_merge: false, train: null }));
    await page.reload();
  });
  const autoOn = useAction(async () => {
    if (sha === null) return;
    await api.post(`${base}/auto_merge`, { sha });
    page.patch((current) => ({ ...current, auto_merge: true }));
    await page.reload();
  });
  const autoOff = useAction(async () => {
    await api.del(`${base}/auto_merge`);
    page.patch((current) => ({ ...current, auto_merge: false }));
    await page.reload();
  });
  const join = useAction(async () => {
    await api.post(`${base}/train`);
    if (mr) focusCar(mr.iid);
    await page.reload();
  });
  const leave = useAction(async () => {
    await api.del(`${base}/train`);
    await page.reload();
  });
  const now = useAction(async () => {
    await api.post(`${base}/train/merge_now`);
    onMerged();
    await page.reload();
  });

  if (!mr || mr.state !== "opened" || !caps.write || (settings === null && mr.train === null)) return null;
  const trains = settings?.merge_trains === true || mr.train !== null;
  return (
    <div class="sp-mrp sp-mrp--actions">
      <ActionNotice errors={[merge.error, autoOn.error, autoOff.error, join.error, leave.error, now.error]} />
      <div class="sp-mrp__buttons">
        {mr.train !== null ? (
          <>
            <Button variant="secondary" pending={leave.pending} onClick={() => void leave.run()}>
              Remove from train
            </Button>
            {caps.manageTrain ? (
              <Button pending={now.pending} onClick={() => void now.run()}>
                Merge now
              </Button>
            ) : null}
          </>
        ) : trains ? (
          <Button pending={join.pending} onClick={() => void join.run()}>
            Add to merge train
          </Button>
        ) : (
          <>
            <Button pending={merge.pending} onClick={() => void merge.run()}>
              Merge
            </Button>
            {mr.auto_merge ? (
              <Button variant="secondary" pending={autoOff.pending} onClick={() => void autoOff.run()}>
                Cancel auto-merge
              </Button>
            ) : (
              <Button variant="secondary" pending={autoOn.pending} onClick={() => void autoOn.run()}>
                Set to auto-merge
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
