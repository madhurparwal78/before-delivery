import { useLitRun } from "../litrun.ts";
import { AirfieldMap } from "./map.tsx";
import { useRoom } from "./room.tsx";

/** The session's map: the aircraft, the typed route lighting up, and this seat's accepted routes going dark. */
export function MapPanel() {
  const room = useRoom();
  const { payload, preview } = room;
  const run = useLitRun(preview.route, preview.stop, room.reduced);
  const mine = payload.runs.filter((r) => r.position === room.position);
  const accepted = mine.flatMap((r) => payload.aircraft.find((a) => a.callsign === r.callsign)?.route ?? []);
  const emphasised = preview.callsign ?? room.selected;
  const chooseAircraft = (callsign: string): void => {
    room.select(callsign);
    document.querySelector<HTMLElement>(`[data-board="${room.position ?? ""}"] [data-strip="${callsign}"]`)?.focus();
  };
  return (
    <AirfieldMap
      name="Airfield map"
      layout={room.sessionInfo.layout}
      aircraft={payload.aircraft}
      closed={payload.runwayClosed}
      litPreview={run.lit}
      litAccepted={accepted}
      conflicts={preview.conflicts}
      stopBars={[...(run.stopBar ? [run.stopBar] : []), ...mine.map((r) => r.stop)]}
      selected={emphasised}
      emergency={payload.emergency}
      glideMs={room.glideMs}
      onSelect={chooseAircraft}
    />
  );
}
