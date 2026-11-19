import { useEffect } from "react";
import {
  IconCheck, IconCollapse, IconDown, IconIndent, IconMirror, IconOutdent, IconTrash, IconUp, IconZoomIn, IconZoomOut,
} from "../lib/icons";
import { zoomInto, zoomOut } from "./actions";
import type { ControllerState, OutlineController } from "./controller";

interface ButtonSpec {
  name: string;
  icon: React.ReactNode;
  pressed?: boolean;
  run: (key: string, id: string) => void;
}

export function BulletToolbar({ controller, state }: { controller: OutlineController; state: ControllerState }) {
  const focused = state.focusKey === null ? undefined : controller.rowAt(state.focusKey);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === null) return;
    const place = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      document.documentElement.style.setProperty("--keyboard", `${Math.max(0, covered)}px`);
    };
    place();
    viewport.addEventListener("resize", place);
    viewport.addEventListener("scroll", place);
    return () => {
      viewport.removeEventListener("resize", place);
      viewport.removeEventListener("scroll", place);
    };
  }, []);

  const buttons: ButtonSpec[] = [
    { name: "Indent", icon: <IconIndent />, run: (key) => controller.structural(key, "indent") },
    { name: "Outdent", icon: <IconOutdent />, run: (key) => controller.structural(key, "outdent") },
    { name: "Move up", icon: <IconUp />, run: (key) => controller.structural(key, "up") },
    { name: "Move down", icon: <IconDown />, run: (key) => controller.structural(key, "down") },
    { name: "Collapse", icon: <IconCollapse />, pressed: focused?.bullet.collapsed === true, run: (key) => controller.toggleCollapse(key) },
    { name: "Complete", icon: <IconCheck />, pressed: focused?.bullet.completed === true, run: (key) => controller.toggleComplete(key) },
    { name: "Zoom in", icon: <IconZoomIn />, run: (key, id) => zoomInto(controller, key, id) },
    { name: "Zoom out", icon: <IconZoomOut />, run: () => zoomOut(controller) },
    { name: "Mirror", icon: <IconMirror />, run: (key) => controller.mirror(key) },
    { name: "Delete bullet", icon: <IconTrash />, run: (key) => controller.requestDelete(key) },
  ];

  return (
    <div className="bullet-bar" role="toolbar" aria-label="Bullet actions">
      {buttons.map((button) => (
        <button
          key={button.name} type="button" className="tool-button" aria-label={button.name} title={button.name}
          aria-pressed={button.pressed}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const key = controller.state.focusKey;
            const target = key === null ? undefined : controller.rowAt(key);
            if (button.name === "Zoom out") button.run("", "");
            else if (key !== null && target !== undefined) button.run(key, target.bullet.id);
          }}
        >
          {button.icon}
        </button>
      ))}
    </div>
  );
}
