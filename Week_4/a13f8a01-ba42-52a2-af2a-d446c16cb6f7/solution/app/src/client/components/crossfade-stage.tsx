import { useEffect, useState } from "react";
import { useReducedMotion } from "../use-media.js";
import { RenderFrame } from "./render-frame.js";

interface Layer {
  id: number;
  penId: string;
  version?: number;
}

let sequence = 0;

interface Props {
  penId: string | null;
  version?: number;
  label: string;
  className?: string;
}

function StageLayer({ layer, covering, onShown }: { layer: Layer; covering: boolean; onShown: (id: number) => void }): React.JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (loaded && reduced) onShown(layer.id);
  }, [loaded, reduced, layer.id, onShown]);
  return (
    <div
      className="layer"
      data-shown={loaded && covering}
      onTransitionEnd={(event) => {
        if (event.propertyName === "opacity" && loaded) onShown(layer.id);
      }}
    >
      <RenderFrame
        className="layer-frame"
        title="Pen render"
        tabbable={false}
        initial={{ kind: "pen", penId: layer.penId, ...(layer.version === undefined ? {} : { version: layer.version }) }}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

export function CrossfadeStage({ penId, version, label, className }: Props): React.JSX.Element {
  const [layers, setLayers] = useState<Layer[]>([]);

  useEffect(() => {
    if (penId === null) return;
    setLayers((current) => {
      const top = current[current.length - 1];
      if (top?.penId === penId && top.version === version) return current;
      return [...current, { id: ++sequence, penId, ...(version === undefined ? {} : { version }) }];
    });
  }, [penId, version]);

  const settle = (id: number): void => setLayers((current) => current.filter((layer, index) => layer.id >= id || index === current.length - 1));

  return (
    <div className={`crossfade ${className ?? ""}`} role="group" aria-label={label}>
      {layers.map((layer, index) => (
        <StageLayer key={layer.id} layer={layer} covering={index === layers.length - 1} onShown={settle} />
      ))}
    </div>
  );
}
