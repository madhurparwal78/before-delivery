import { useId } from "react";
import { PinContent } from "../components/PinContent";
import { usePin } from "../lib/hooks";
import { navigate } from "../lib/router";
import { NotFound } from "./NotFound";

/** A pin opened directly: the same content as the exhibit, as the page's main content. */
export function PinPage({ id }: { id: number }) {
  const titleId = useId();
  const { pin, setPin, missing } = usePin(id);
  if (missing) return <div className="page"><NotFound heading="Pin not found" /></div>;
  if (!pin) return <div className="page" aria-busy="true" />;
  return (
    <div className="page pin-page">
      <PinContent pin={pin} titleId={titleId} variant="page" onChange={setPin} onGone={() => navigate(`/b/${pin.board.id}`, { replace: true })} />
    </div>
  );
}
