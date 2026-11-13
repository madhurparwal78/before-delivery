import { NO_SELECTION, VARIES } from '../../../shared/copy.ts';
import { dimensionStyle, propertyText } from '../../../shared/geometry/index.ts';
import type { DimStyle, DimensionEntity, Entity, InsertEntity, Sheet } from '../../../shared/types.ts';
import { useDrawingSlice, useDrawingStore, useMay, useScene, useSceneSlice } from '../../store/index.ts';
import { CommitField } from '../controls/CommitField.tsx';
import { SheetProperties } from './SheetProperties.tsx';
import '../../styles/drawing/properties.css';

const isInsert = (entity: Entity): entity is InsertEntity => entity.type === 'insert';
const isDimension = (entity: Entity): entity is DimensionEntity => entity.type === 'dimension';

function Attributes({ inserts }: { inserts: readonly InsertEntity[] }) {
  const store = useDrawingStore();
  const blocks = useDrawingSlice((snapshot) => snapshot.state.blocks);
  const tags = [...new Set(inserts.flatMap((insert) => blocks[insert.block].attributes.map((attribute) => attribute.tag)))];
  return (
    <>
      {tags.map((tag) => {
        const values = new Set(inserts.map((insert) => insert.attributes[tag] ?? ''));
        const common = values.size === 1 ? [...values][0] : '';
        return (
          <CommitField
            key={tag}
            label={tag}
            value={common}
            placeholder={values.size > 1 ? VARIES : undefined}
            onCommit={(value) =>
              store.edit('PROPERTIES', inserts.map((insert) => ({ type: 'modify', handle: insert.handle, set: { attributes: { ...insert.attributes, [tag]: value } } })))
            }
          />
        );
      })}
    </>
  );
}

function DimensionStyleFields({ dimension }: { dimension: DimensionEntity }) {
  const store = useDrawingStore();
  const styles = useDrawingSlice((snapshot) => snapshot.state.dim_styles);
  const style = dimensionStyle(styles, dimension.style);
  const change = (patch: Partial<DimStyle>): void => store.edit('PROPERTIES', [{ type: 'dim_style_set', ...style, ...patch }]);
  const number = (text: string, fallback: number): number => (Number.isFinite(Number(text)) && text.trim() !== '' ? Number(text) : fallback);
  return (
    <>
      <p className="strong">{`Dimension style ${style.name}`}</p>
      <CommitField label="Precision" value={String(style.precision)} onCommit={(text) => change({ precision: number(text, style.precision) })} />
      <CommitField label="Prefix" value={style.prefix} onCommit={(text) => change({ prefix: text })} />
      <CommitField label="Suffix" value={style.suffix} onCommit={(text) => change({ suffix: text })} />
      <CommitField label="Scale" value={String(style.scale)} onCommit={(text) => change({ scale: number(text, style.scale) })} />
      <CommitField label="Text height" value={String(style.text_height_mm)} onCommit={(text) => change({ text_height_mm: number(text, style.text_height_mm) })} />
    </>
  );
}

function SelectionProperties() {
  const scene = useScene();
  const selected = useSceneSlice((snapshot) => snapshot.selection);
  const entities = [...selected].flatMap((id) => {
    const entity = scene.byId.get(id)?.entity;
    return entity ? [entity] : [];
  });
  if (entities.length === 0) return <p className="empty">{NO_SELECTION}</p>;
  const length = propertyText(entities, 'length');
  const area = propertyText(entities, 'area');
  const inserts = entities.filter(isInsert);
  const dimension = entities.find(isDimension);
  return (
    <>
      {length === null ? null : <p className="prop"><span className="label">Length</span> <span>{length}</span></p>}
      {area === null ? null : <p className="prop"><span className="label">Area</span> <span>{area}</span></p>}
      {inserts.length > 0 ? <Attributes key={inserts.map((insert) => insert.handle).join()} inserts={inserts} /> : null}
      {dimension ? <DimensionStyleFields key={dimension.handle} dimension={dimension} /> : null}
    </>
  );
}

/** `region "Properties"`: the selection's Length, Area, insert attributes and dimension style, or the shown sheet's title block. */
export function PropertiesPanel() {
  const sheet: Sheet | null = useSceneSlice((snapshot) => snapshot.sheet);
  const mayEditSheet = useMay('editSheet');
  return sheet ? <SheetProperties sheet={sheet} canEdit={mayEditSheet} /> : <SelectionProperties />;
}
