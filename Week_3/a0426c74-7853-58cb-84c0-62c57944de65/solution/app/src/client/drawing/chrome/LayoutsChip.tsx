import { useDrawingSlice, useDrawingStore, useMay, useSceneSlice } from '../../store/index.ts';
import { Button, Chip, Tabs, useMediaLayout } from '../../ui/index.ts';

const MODEL = 'model';

/** Top left: the drawing's name, `tablist "Layouts"` (Model and one tab per sheet) and `button "New sheet"`. */
export function LayoutsChip({ onNewSheet }: { onNewSheet: () => void }) {
  const store = useDrawingStore();
  const name = useDrawingSlice((snapshot) => snapshot.info?.name ?? '');
  const sheets = useDrawingSlice((snapshot) => snapshot.sheets);
  const mayAddSheet = useMay('addSheet');
  const active = useSceneSlice((snapshot) => snapshot.sheet);
  const phone = useMediaLayout() === 'phone';
  const items = [{ id: MODEL, label: 'Model' }, ...sheets.map((sheet) => ({ id: sheet.id, label: sheet.name }))];
  return (
    <Chip>
      <span className="chip-title">{name}</span>
      <Tabs label="Layouts" items={items} selected={active?.id ?? MODEL} onSelect={(id) => store.showLayout(id === MODEL ? null : id)} />
      {mayAddSheet && !phone ? <Button onClick={onNewSheet}>New sheet</Button> : null}
    </Chip>
  );
}
