import type { LayerBox } from "../../shared/layers";
import type { Clip } from "../../shared/types";
import { checksumColour } from "../lib/format";

/** The fill of a layer box: a text layer's own box colour, else the colour of its media checksum. */
export function layerFill(clip: Clip, sha256: string | undefined): string {
  return clip.kind === "text" ? `#${clip.box_colour ?? "000000"}` : checksumColour(sha256 ?? "000000");
}

export function layerStyle(layer: LayerBox, size: { width: number; height: number }, fill: string): Record<string, string | number> {
  return {
    left: `${((layer.x - layer.width / 2) / size.width) * 100}%`,
    top: `${((layer.y - layer.height / 2) / size.height) * 100}%`,
    width: `${(layer.width / size.width) * 100}%`,
    height: `${(layer.height / size.height) * 100}%`,
    opacity: layer.opacity / 100,
    transform: `rotate(${layer.rotation}deg)`,
    background: fill,
  };
}
