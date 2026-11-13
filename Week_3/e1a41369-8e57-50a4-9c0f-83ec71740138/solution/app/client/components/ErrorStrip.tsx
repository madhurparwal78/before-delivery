import { AlertTriangle, X } from "lucide-react";
import { setState, useStore } from "../store";

export function ErrorStrip() {
  const message = useStore((state) => state.alert);
  if (!message) return null;
  return (
    <div className="strip" role="alert">
      <AlertTriangle aria-hidden="true" size={20} />
      <span>{message}</span>
      <button type="button" className="strip-dismiss" aria-label="Dismiss message" onClick={() => setState({ alert: null })}>
        <X aria-hidden="true" size={20} />
      </button>
    </div>
  );
}
