import { buildScene, modelInput, sheetSvg } from '../../shared/geometry/index.ts';
import type { VersionDocument } from '../../shared/types.ts';

/** A published version's sheet as the shared renderer draws it, scaled down by the frame's width. */
export function SheetThumbnail({ version }: { version: VersionDocument }) {
  const { sheet, model } = version.snapshot;
  const svg = sheetSvg(sheet, buildScene(modelInput(model)));
  return <img className="thumb" alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />;
}
