/** The empty-state drawing: a sheet folded at a seam-coloured crease. Drawn for this app. */
export function FoldMotif() {
  return (
    <svg className="fold-motif" viewBox="0 0 96 64" width="96" height="64" aria-hidden="true">
      <polygon points="48,6 8,12 10,56 48,52" fill="#FAF6EE" stroke="#8C7F6E" strokeWidth="1.5" />
      <polygon points="48,6 88,12 86,56 48,52" fill="#F1EADC" stroke="#8C7F6E" strokeWidth="1.5" />
      <line x1="48" y1="6" x2="48" y2="52" stroke="#E0522B" strokeWidth="2" />
    </svg>
  );
}
