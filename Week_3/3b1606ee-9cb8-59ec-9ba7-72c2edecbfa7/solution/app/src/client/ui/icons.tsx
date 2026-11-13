import type { ReactNode } from 'react';

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg className="glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const PaperclipGlyph = () => (
  <Glyph>
    <path d="M8 12.5 15.5 5a3.5 3.5 0 0 1 5 5l-9 9a5.5 5.5 0 0 1-8-8l8-8" />
  </Glyph>
);

export const PhotoGlyph = () => (
  <Glyph>
    <path d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01" />
  </Glyph>
);

export const SendGlyph = () => (
  <Glyph>
    <path d="M3 12 21 4l-5 16-4-6zM12 14l9-10" />
  </Glyph>
);

export const BackGlyph = () => (
  <Glyph>
    <path d="M15 5 8 12l7 7" />
  </Glyph>
);

export const FileGlyph = () => (
  <Glyph>
    <path d="M6 3h8l4 4v14H6zM14 3v4h4" />
  </Glyph>
);
