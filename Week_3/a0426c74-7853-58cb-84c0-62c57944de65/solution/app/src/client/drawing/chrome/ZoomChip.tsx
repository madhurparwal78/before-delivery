import { useSceneSlice } from '../../store/index.ts';
import { Chip } from '../../ui/index.ts';
import { fmt3 } from '../../../shared/geometry/index.ts';

/** Bottom right: the zoom of the pane. */
export function ZoomChip() {
  const zoom = useSceneSlice((snapshot) => snapshot.view.zoom);
  return <Chip><span className="chip-text">{`Zoom ${fmt3(zoom)}`}</span></Chip>;
}
