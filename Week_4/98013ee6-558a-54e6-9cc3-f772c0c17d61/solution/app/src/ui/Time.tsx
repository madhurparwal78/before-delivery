import { relativeTime } from "../../shared/relativeTime";
import { businessNow, useBusinessTick } from "../lib/clock";
import { useSession } from "../session";

/** A shown time: a `time` element on the business clock, re-rendered when the clock ticks or moves. */
export function Time({ iso }: { iso: string }) {
  useBusinessTick();
  const { config } = useSession();
  return <time dateTime={iso}>{relativeTime(businessNow(), Date.parse(iso), config.time_zone)}</time>;
}
