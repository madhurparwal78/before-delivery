import { useState, type ReactNode } from "react";

interface ProductArtProps {
  /** The server's `image_url`: the product's own art, or its category's. */
  src: string;
  alt: string;
  category?: string;
  className?: string;
}

/** Procedural product art. If a drawing is missing the category drawing stands in for it. */
export function ProductArt({ src, alt, category, className }: ProductArtProps): ReactNode {
  const [failed, setFailed] = useState(false);
  const url = failed && category ? `/art/category-${category}.svg` : src;
  return <img className={className} src={url} alt={alt} width={400} height={400} onError={() => setFailed(true)} />;
}
