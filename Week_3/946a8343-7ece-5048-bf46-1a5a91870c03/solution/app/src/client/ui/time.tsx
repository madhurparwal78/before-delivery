// <Time iso="2026-01-01T00:00:00.000Z" /> renders <time datetime> as `YYYY-MM-DD HH:mm:ss <zone>` in the viewer's profile
// time zone (24-hour clock). Use it for every time the server returned.
import { useUser } from "../session.ts";
import { formatServerTime } from "../time.ts";

export function Time({ iso, class: className }: { iso: string; class?: string }) {
  const zone = useUser()?.time_zone ?? "UTC";
  return (
    <time dateTime={iso} class={className}>
      {formatServerTime(iso, zone)}
    </time>
  );
}
