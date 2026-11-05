// A stored photo, uncropped on a darker bisque mat with a mono caption.
import { useState } from "react";

export function Photo({ photoId, alt, caption }: { photoId: string; alt: string; caption: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="photo-frame">
      <div className="photo-mat">
        {failed ? (
          <p className="photo-missing">Photo unavailable while storage is down.</p>
        ) : (
          <img src={`/api/photos/${photoId}`} alt={alt} onError={() => setFailed(true)} />
        )}
      </div>
      <figcaption className="photo-caption">{caption}</figcaption>
    </figure>
  );
}
