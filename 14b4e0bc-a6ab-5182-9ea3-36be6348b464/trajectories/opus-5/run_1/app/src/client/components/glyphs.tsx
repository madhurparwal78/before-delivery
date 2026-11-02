import type { ReactNode } from 'react';
import type { Tag } from '../../shared/domain.ts';

/** PII is hatched with a P glyph; Confidential is a dotted outline with a C glyph. */
export function TagGlyph({ tag }: { tag: Tag }): ReactNode {
  return (
    <span className={`glyph glyph-${tag}`} data-tag-glyph={tag}>
      {tag === 'PII' ? 'P' : 'C'}
    </span>
  );
}

export function DeprecationFlag(): ReactNode {
  return (
    <span className="mono flag" data-deprecation-flag>
      D
    </span>
  );
}
