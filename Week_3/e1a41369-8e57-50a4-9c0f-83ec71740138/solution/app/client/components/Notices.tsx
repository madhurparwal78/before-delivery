import type { Notice } from "../../shared/api";
import { api } from "../api";
import { noticeReturn } from "../actions";
import { firstRowSelector, focusWhenPresent, rowSelector } from "../focus";
import { hundredths, tenths } from "../format";
import { setState, useStore } from "../store";
import { LevelBadge } from "./LevelBadge";
import { Sheet, useSheetClose } from "./Sheet";

/** After a level-up or faint: back to the row whose action caused it, else the first Habits row. */
function returnFocus(): void {
  const target = noticeReturn.taskId;
  noticeReturn.taskId = null;
  if (target) {
    focusWhenPresent(rowSelector(target));
    return;
  }
  setState({ tab: "habits" });
  focusWhenPresent(firstRowSelector("habits"));
}

function Acknowledge({ label }: { label: string }) {
  const close = useSheetClose();
  return (
    <button type="button" className="btn btn-solid" onClick={close}>
      {label}
    </button>
  );
}

/** Notices closed on this page: a live player event sent before the server took the ack still lists them. */
const acknowledged = new Set<string>();

function NoticeDialog({ notice }: { notice: Notice }) {
  const maxHealth = useStore((state) => state.me!.maxHealth);
  const dismiss = (): void => {
    acknowledged.add(notice.id);
    setState((current) => (current.me ? { me: { ...current.me, notices: current.me.notices.filter((open) => open.id !== notice.id) } } : {}));
    void api("POST", `/api/notices/${notice.id}/ack`, {});
    returnFocus();
  };
  return notice.kind === "level_up" ? (
    <Sheet title="Level up" centered onClose={dismiss}>
      <LevelBadge level={notice.level} />
      <p>{`You reached level ${notice.level}. Your health is full again.`}</p>
      <Acknowledge label="Keep going" />
    </Sheet>
  ) : (
    <Sheet title="You fainted" centered onClose={dismiss}>
      <p>{`You dropped to level ${notice.level} and lost ${hundredths(notice.goldLost)} gold. Your health is back to ${tenths(maxHealth)}.`}</p>
      <Acknowledge label="Get back up" />
    </Sheet>
  );
}

/** The oldest unacknowledged notice, live or waiting from a close, opens its dialog. */
export function Notices() {
  const notice = useStore((state) => state.me?.notices.find((open) => !acknowledged.has(open.id)));
  return notice ? <NoticeDialog key={notice.id} notice={notice} /> : null;
}
