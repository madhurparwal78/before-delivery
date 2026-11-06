// How each lighting state sets the 3D scenes (DESIGN.md → 3D ambience). Only ambient light changes; pool sizes,
// tints and figures never do.
import type { LightState } from "../../shared/dial";

interface Ambience {
  background: string;
  ambient: string;
  intensity: number;
  floor: string;
}

export const AMBIENCE: Record<LightState, Ambience> = {
  night: { background: "#0A0E16", ambient: "#8FA3C8", intensity: 0.18, floor: "#141922" },
  evening: { background: "#1D1915", ambient: "#C9A57E", intensity: 0.28, floor: "#211C18" },
  morning: { background: "#ECEEF0", ambient: "#DDE6F0", intensity: 0.55, floor: "#2A2F37" },
  day: { background: "#F4EEE3", ambient: "#FFF6E8", intensity: 0.7, floor: "#2F2C28" },
  gallery: { background: "#EFEDE9", ambient: "#FFFFFF", intensity: 0.6, floor: "#2C2C2C" },
};
