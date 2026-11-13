import { type ReactNode, useEffect, useRef, useState } from "react";
import type { PageSize } from "../../shared/types";
import { type PdfState, renderWidth } from "../lib/pdf";

interface PageSheetProps {
  number: number;
  count: number;
  size: PageSize;
  pdf: PdfState;
  children?: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onImage?: (url: string) => void;
}

export function PageSheet({ number, count, size, pdf, children, onClick, onImage }: PageSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [width, setWidth] = useState(0);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "1500px 0px" },
    );
    observer.observe(el);
    // The drawing only ever grows: a sheet that narrows keeps the sharper one it already has.
    const sizer = new ResizeObserver(() => {
      const wanted = renderWidth(el.clientWidth);
      setWidth((current) => Math.max(current, wanted));
    });
    sizer.observe(el);
    return () => {
      observer.disconnect();
      sizer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!near || !width || pdf.status !== "ready") return;
    let cancelled = false;
    pdf.source.image(number, width).then(
      (made) => {
        if (cancelled) return;
        setUrl(made);
        onImage?.(made);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [near, width, pdf, number]);

  return (
    <div
      ref={ref}
      id={`page-${number}`}
      role="group"
      aria-label={`Page ${number} of ${count}`}
      tabIndex={-1}
      className="sheet"
      style={{ aspectRatio: `${size.w} / ${size.h}` }}
      onClick={onClick}
    >
      {url ? <img src={url} alt="" draggable={false} className="sheet-image" /> : null}
      {children}
    </div>
  );
}
