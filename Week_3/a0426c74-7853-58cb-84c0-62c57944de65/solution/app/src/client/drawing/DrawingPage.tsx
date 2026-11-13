import { useEffect, useState } from 'react';
import { ACCESS_REVOKED, NOT_FOUND_PAGE, NOT_FOUND } from '../../shared/copy.ts';
import { DrawingStore, DrawingStoreProvider, useDrawingSlice, useSceneSlice } from '../store/index.ts';
import { browserDrawingDeps } from '../store/browserDeps.ts';
import { NotAvailable } from '../ui/index.ts';
import { DrawingScreen } from './DrawingScreen.tsx';
import { useMe } from './me.ts';
import { WorkspaceSkeleton } from './workspace/WorkspaceSkeleton.tsx';

function Screen() {
  const status = useSceneSlice((snapshot) => snapshot.status);
  const info = useDrawingSlice((snapshot) => snapshot.info);
  if (status === 'revoked') return <NotAvailable sentences={[ACCESS_REVOKED]} />;
  if (status === 'not-found') return <NotAvailable sentences={[NOT_FOUND_PAGE]} />;
  if (status === 'failed') return <NotAvailable sentences={[NOT_FOUND]} />;
  if (status !== 'ready' || info === null) return <WorkspaceSkeleton />;
  return <DrawingScreen info={info} />;
}

/** `/drawings/<id>`: opens the live store of the drawing for the signed-in person (a lost session sends them to sign in) and shows its screen. */
export function DrawingPage({ id }: { id: string }) {
  const username = useMe();
  const [store, setStore] = useState<DrawingStore | null>(null);
  useEffect(() => {
    if (username === null) return undefined;
    const opened = new DrawingStore(id, browserDrawingDeps(username));
    void opened.open();
    setStore(opened);
    return () => {
      opened.close();
      setStore(null);
    };
  }, [id, username]);
  if (store === null) return <WorkspaceSkeleton />;
  return (
    <DrawingStoreProvider store={store}>
      <Screen />
    </DrawingStoreProvider>
  );
}
