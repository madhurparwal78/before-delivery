import {
  Box, Camera, Circle, CircleDot, Code2, Cuboid, Folder, Layers, Lightbulb, Network, PackageOpen, Radio, ScrollText,
  Square, Terminal, Torus,
} from "lucide-react";
import type { LayerKind } from "../../shared/types.ts";

export function KindIcon({ kind, size = 14 }: { kind: LayerKind; size?: number }) {
  const props = { size, "aria-hidden": true, className: "kind-icon" } as const;
  switch (kind) {
    case "group": return <Folder {...props} />;
    case "cube": return <Cuboid {...props} />;
    case "sphere": return <Circle {...props} />;
    case "plane": return <Square {...props} />;
    case "torus": return <Torus {...props} />;
    case "tube": return <CircleDot {...props} />;
    case "camera": return <Camera {...props} />;
    case "light": return <Lightbulb {...props} />;
    case "model": return <Box {...props} />;
    case "shader": return <Code2 {...props} />;
  }
}

export const DOCK_ICONS = { Layers, Assets: PackageOpen, Shaders: Code2, Graph: Network, Scripts: Terminal, Shows: Radio, Activity: ScrollText } as const;
