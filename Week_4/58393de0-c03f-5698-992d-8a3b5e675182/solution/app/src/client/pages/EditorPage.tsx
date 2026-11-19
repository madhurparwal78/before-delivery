import { useRef } from "react";
import { EditorShell } from "../editors/EditorShell";
import { isProjectKind } from "../editors/blank";
import { matchPath, useRouter } from "../lib/router";

/**
 * `/editor/new?kind=…[&starter=…]` or `/editor/<projectId>`. The first save of a new design replaces the URL with the
 * new project's, and the editor stays mounted: its key keeps the value it had before the URL changed.
 */
export default function EditorPage() {
  const { location, navigate } = useRouter();
  const routeId = matchPath("/editor/:id", location.path)?.id ?? "";
  const kindParam = location.search.get("kind");
  const kind = isProjectKind(kindParam) ? kindParam : "3d";
  const starter = location.search.get("starter");
  const adopted = useRef<{ id: string; key: string } | null>(null);
  const epoch = useRef(0);

  const routeKey = routeId === "new" ? `new:${kind}:${starter ?? ""}` : routeId;
  const key = adopted.current && adopted.current.id === routeId ? adopted.current.key : `${routeKey}@${epoch.current}`;

  const onCreated = (id: string) => {
    adopted.current = { id, key };
    epoch.current += 1;
    navigate(`/editor/${encodeURIComponent(id)}`, { replace: true });
  };

  return <EditorShell key={key} target={{ id: routeId === "new" ? null : routeId, kind, starter }} onCreated={onCreated} />;
}
