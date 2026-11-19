import type { CSSProperties, PointerEvent, Ref } from "react";
import { Film, Plus } from "lucide-react";
import type { Reference } from "../../shared/api.js";
import { StillSource, Thumb } from "../components/bits.js";

interface Props {
  reference: Reference;
  style?: CSSProperties;
  itemRef?: Ref<HTMLElement>;
  onAdd: (reference: Reference, opener: HTMLButtonElement) => void;
  onOpen: (reference: Reference, opener: HTMLButtonElement) => void;
}

/** The full-title overlay shows on hover only when the card's own title line is cut short. */
function markClamped(event: PointerEvent<HTMLLIElement>): void {
  const title = event.currentTarget.querySelector<HTMLElement>(".card__title");
  event.currentTarget.dataset.clamped = String(!!title && title.scrollWidth > title.clientWidth);
}

/** One reference on the wall: its picture, its title and the Add / Open clip buttons. */
export function ReferenceCard({ reference: r, style, itemRef, onAdd, onOpen }: Props) {
  const meta = r.kind === "clip" ? `Clip · ${r.frameRate} fps` : r.createdBy.displayName;
  return (
    <li className="card" style={style} ref={itemRef as Ref<HTMLLIElement>} onPointerEnter={markClamped}>
      <div className="card__media">
        <Thumb src={r.mediaUrl} kind={r.kind} alt={r.title} />
        <span className="card__full" aria-hidden="true">
          {r.title}
        </span>
      </div>
      <div className="card__body">
        <p className="card__title">{r.title}</p>
        {r.kind === "still" ? (
          <p className="card__meta">
            <StillSource clipTitle={r.sourceClipTitle ?? ""} timecode={r.timecode ?? ""} className="still-source--line" />
          </p>
        ) : (
          <p className="card__meta">{meta}</p>
        )}
        <div className="card__actions">
          {r.kind === "clip" && (
            <button type="button" className="btn btn--icon" aria-label={`Open clip ${r.title}`} onClick={(e) => onOpen(r, e.currentTarget)}>
              <Film size={16} aria-hidden="true" />
              <span className="btn__text">Open</span>
            </button>
          )}
          <button type="button" className="btn btn--icon" aria-label={`Add ${r.title} to cluster`} onClick={(e) => onAdd(r, e.currentTarget)}>
            <Plus size={16} aria-hidden="true" />
            <span className="btn__text">Add</span>
          </button>
        </div>
      </div>
    </li>
  );
}
