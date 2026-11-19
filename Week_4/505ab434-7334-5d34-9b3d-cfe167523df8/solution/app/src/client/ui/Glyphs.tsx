// Inline vector art written for this product: the Quenby mark, badge glyphs and the large empty-state glyphs.
import type { ReactNode } from "react";

/** The Quenby mark: three stacked trapezoids, each with a chevron cut in its lower edge. */
export function QuenbyMark({ size = 34, label = true, className }: { size?: number; label?: boolean; className?: string }): ReactNode {
  const bands = [
    "M30 0H70L80 24L50 16L20 24Z",
    "M22 30H78L88 54L50 46L12 54Z",
    "M14 60H86L96 84L50 76L4 84Z",
  ];
  return (
    <svg
      viewBox="0 0 100 84"
      width={size}
      height={(size * 84) / 100}
      className={className}
      role={label ? "img" : undefined}
      aria-label={label ? "Quenby & Co. mark" : undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {bands.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

export type GlyphName = "check" | "key" | "bar" | "clock" | "chevron" | "parcel" | "padlock" | "empty" | "lost" | "inbox" | "list";

/** A glyph in `currentColor`, decorative unless the caller labels it. */
export function Glyph({ name, size = 20 }: { name: GlyphName; size?: number }): ReactNode {
  const common = { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": true, focusable: "false" } as const;
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "square", strokeLinejoin: "miter" } as const;
  switch (name) {
    case "check":
      return (
        <svg {...common}>
          <path d="M4 12.5L9.5 18L20 6.5" {...stroke} />
        </svg>
      );
    case "key":
      return (
        <svg {...common}>
          <circle cx="8" cy="12" r="4" {...stroke} />
          <path d="M12 12H21M18 12V16M21 12V15" {...stroke} />
        </svg>
      );
    case "bar":
      return (
        <svg {...common}>
          <path d="M4 12H20" {...stroke} strokeWidth={4} />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" {...stroke} />
          <path d="M12 7V12L15.5 14" {...stroke} />
        </svg>
      );
    case "chevron":
      return (
        <svg {...common}>
          <path d="M5 9L12 16L19 9" {...stroke} />
        </svg>
      );
    case "parcel":
      return (
        <svg {...common}>
          <path d="M3 8L12 4L21 8V17L12 21L3 17Z M3 8L12 12L21 8 M12 12V21" {...stroke} />
        </svg>
      );
    case "padlock":
      return (
        <svg {...common}>
          <rect x="5" y="11" width="14" height="9" {...stroke} />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" {...stroke} />
        </svg>
      );
    case "empty":
      return (
        <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden focusable="false">
          <rect x="14" y="26" width="92" height="68" fill="none" stroke="currentColor" strokeWidth="6" />
          <path d="M14 26L60 62L106 26" fill="none" stroke="currentColor" strokeWidth="6" />
          <rect x="44" y="76" width="32" height="10" fill="currentColor" />
        </svg>
      );
    case "inbox":
      return (
        <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden focusable="false">
          <path d="M16 70L34 26H86L104 70V96H16Z" fill="none" stroke="currentColor" strokeWidth="6" />
          <path d="M16 70H44L50 82H70L76 70H104" fill="none" stroke="currentColor" strokeWidth="6" />
        </svg>
      );
    case "list":
      return (
        <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden focusable="false">
          <rect x="20" y="22" width="80" height="16" fill="currentColor" />
          <rect x="20" y="52" width="56" height="16" fill="currentColor" />
          <rect x="20" y="82" width="68" height="16" fill="currentColor" />
        </svg>
      );
    case "lost":
      return (
        <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden focusable="false">
          <circle cx="52" cy="52" r="30" fill="none" stroke="currentColor" strokeWidth="8" />
          <path d="M76 76L104 104" stroke="currentColor" strokeWidth="10" strokeLinecap="square" />
          <path d="M40 40L64 64M64 40L40 64" stroke="currentColor" strokeWidth="6" />
        </svg>
      );
  }
}
