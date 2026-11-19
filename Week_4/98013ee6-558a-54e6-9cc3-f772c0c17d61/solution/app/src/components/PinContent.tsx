import { ExternalLink, Bookmark, Pencil } from "lucide-react";
import { useState } from "react";
import { counted } from "../../shared/relativeTime";
import { creditLine, imageSource } from "../lib/pins";
import { SaveDialog } from "../dialogs/SaveDialog";
import { EditPinDialog } from "../dialogs/EditPinDialog";
import { useSession } from "../session";
import { Link } from "../ui/Link";
import { Comments } from "./Comments";
import { ReactMenu } from "./ReactMenu";
import type { Pin } from "../../shared/types";

interface Props {
  pin: Pin;
  titleId: string;
  variant: "page" | "exhibit";
  imageRef?: React.Ref<HTMLImageElement>;
  textRef?: React.Ref<HTMLDivElement>;
  onChange: (pin: Pin) => void;
  onGone: () => void;
}

/** A pin's image, text, credit, counts, actions and comments: the exhibit and the pin page share it. */
export function PinContent({ pin, titleId, variant, imageRef, textRef, onChange, onGone }: Props) {
  const { me } = useSession();
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const Heading = variant === "page" ? "h1" : "h2";
  const credit = pin.saved_from;

  return (
    <div className="pin-layout">
      <div className="pin-image">
        <img
          ref={imageRef}
          src={imageSource(pin, 900)}
          alt={pin.alt}
          width={pin.image.width}
          height={pin.image.height}
          style={{ aspectRatio: `${pin.image.width} / ${pin.image.height}` }}
          draggable={false}
        />
      </div>
      <div className="pin-text" ref={textRef}>
        <Heading id={titleId} className="pin-title">{pin.title}</Heading>
        {pin.description ? <p className="pin-description">{pin.description}</p> : null}
        {pin.tags.length > 0 ? (
          <ul className="tags">
            {pin.tags.map((tag) => (
              <li key={tag}>
                <Link to={`/search?tag=${encodeURIComponent(tag)}`}>{`#${tag}`}</Link>
              </li>
            ))}
          </ul>
        ) : null}
        {pin.source && pin.source_host ? (
          <p className="pin-source">
            <a href={pin.source} target="_blank" rel="noopener noreferrer">{pin.source_host}</a>
            <ExternalLink size={16} aria-hidden="true" />
          </p>
        ) : null}
        <p className="pin-credit">
          {credit === null ? (
            <Link to={`/u/${pin.owner.handle}`}>{pin.owner.name}</Link>
          ) : credit.pin_id !== null ? (
            <Link to={`/pin/${credit.pin_id}`}>{creditLine(pin)}</Link>
          ) : (
            creditLine(pin)
          )}
        </p>
        <p className="pin-alt"><span className="meta-label">Alt text</span> {pin.alt}</p>
        <p className="pin-counts">
          <span>{counted(pin.saves, "save", "saves")}</span>
          <span>{counted(pin.comments, "comment", "comments")}</span>
          <span>{counted(pin.reactions, "reaction", "reactions")}</span>
        </p>
        <div className="pin-actions">
          <ReactMenu pin={pin} onChange={(mine, reactions) => onChange({ ...pin, my_reaction: mine, reactions })} />
          <button type="button" className="button button--primary" onClick={() => setSaving(true)}>
            <Bookmark size={20} aria-hidden="true" />
            Save
          </button>
          {me?.id === pin.owner.id ? (
            <button type="button" className="button button--quiet" onClick={() => setEditing(true)}>
              <Pencil size={20} aria-hidden="true" />
              Edit pin
            </button>
          ) : null}
        </div>
        <Comments pin={pin} />
      </div>
      {saving ? <SaveDialog pin={pin} onClose={() => setSaving(false)} /> : null}
      {editing ? <EditPinDialog pin={pin} onClose={() => setEditing(false)} onSaved={onChange} onGone={onGone} /> : null}
    </div>
  );
}
