// Every time on screen reads `YYYY-MM-DD HH:MM:SS +HH:MM` in the viewer's zone.
import { formatDisplay } from "../../shared/zone";
import { parseIsoInstant } from "../../shared/time";
import { useAppState } from "./store";

export function useShown(): (iso: string | number) => string {
  const zone = useAppState((s) => s.me?.time_zone ?? "UTC");
  return (value) => formatDisplay(typeof value === "number" ? value : (parseIsoInstant(value) ?? Date.parse(value)), zone);
}
