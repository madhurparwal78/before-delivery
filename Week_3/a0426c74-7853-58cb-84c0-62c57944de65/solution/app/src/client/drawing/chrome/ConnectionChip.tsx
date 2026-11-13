import { useDrawingSlice, useDrawingStore } from '../../store/index.ts';
import { Chip } from '../../ui/index.ts';
import { Switch } from '../controls/Switch.tsx';

/** Bottom left: `switch "Work offline"` and `status "Connection"`. */
export function ConnectionChip() {
  const store = useDrawingStore();
  const connection = useDrawingSlice((snapshot) => snapshot.connection);
  return (
    <Chip>
      <Switch checked={connection.offline} onChange={(offline) => void store.setOffline(offline)}>Work offline</Switch>
      <span className="chip-text" role="status" aria-label="Connection">{connection.text}</span>
    </Chip>
  );
}
