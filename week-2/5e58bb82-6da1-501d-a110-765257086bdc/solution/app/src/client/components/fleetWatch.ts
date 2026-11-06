// The live fleet feed shared by the fleet board and the mission console: vessels and alerts every two
// seconds, with each observed change (raised, cleared, link state) announced exactly once.
import { useRef, useState } from "react";
import { api, type Alert, type Vessel } from "../api";
import { usePoll } from "../hooks";

const ENDED = new Set(["Aborted", "Complete"]);

interface Options {
  announce: (text: string) => void;
  /** Only this mission's alerts and vessels (the console); all of them on the fleet board. */
  missionId?: string;
  vesselIds?: Set<string>;
  missionStatus: (missionId: string) => string | undefined;
}

export function useFleetWatch({ announce, missionId, vesselIds, missionStatus }: Options) {
  const [vessels, setVessels] = useState<Vessel[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const seenAlerts = useRef<Map<string, Alert["state"]> | null>(null);
  const seenLinks = useRef<Map<string, string> | null>(null);
  const latest = useRef({ announce, missionId, vesselIds, missionStatus });
  latest.current = { announce, missionId, vesselIds, missionStatus };

  const refresh = usePoll(async () => {
    const [v, a] = await Promise.all([api<Vessel[]>("/api/vessels"), api<Alert[]>("/api/alerts?status=all")]);
    if (!v.ok || !a.ok) return;
    const { announce: say, missionId: only, vesselIds: scope, missionStatus: statusOf } = latest.current;
    const mine = a.data.filter((x) => !only || x.mission_id === only);
    const links = new Map(v.data.map((x) => [x.id, x.link_state]));
    if (seenLinks.current) {
      for (const vessel of v.data) {
        if (scope && !scope.has(vessel.id)) continue;
        const before = seenLinks.current.get(vessel.id);
        if (before && before !== vessel.link_state) say(`${vessel.name} link ${vessel.link_state.toLowerCase()}`);
      }
    }
    if (seenAlerts.current) {
      for (const alert of [...mine].reverse()) {
        const before = seenAlerts.current.get(alert.id);
        if (!before) {
          if (alert.state === "Active") say(alert.heading);
          continue;
        }
        const cleared = (before === "Active" && alert.state === "Rectified") || (before === "Acknowledged" && alert.state === "Closed");
        if (cleared && !ENDED.has(statusOf(alert.mission_id) ?? "")) {
          say(alert.kind === "geofence_breach" ? `${alert.vessel_name} back inside the geofence` : `${alert.heading} — rectified`);
        }
      }
    }
    seenLinks.current = links;
    seenAlerts.current = new Map(mine.map((x) => [x.id, x.state]));
    setVessels(v.data);
    setAlerts(mine.filter((x) => x.state !== "Closed"));
  }, 2000, [missionId]);

  /** An acknowledgement's response replaces the card at once; Closed leaves the board. */
  const applyAlert = (updated: Alert) => {
    seenAlerts.current?.set(updated.id, updated.state);
    setAlerts((list) => list.flatMap((x) => (x.id !== updated.id ? [x] : updated.state === "Closed" ? [] : [updated])));
  };

  return { vessels, alerts, refresh, applyAlert };
}
