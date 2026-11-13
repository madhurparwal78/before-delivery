// The client state of a drawing page. Framework-agnostic classes with `subscribe` / `getSnapshot` (for `useSyncExternalStore`), React hooks on top.
//
//   const store = new DrawingStore(id, browserDrawingDeps(username));   // Drawing screen; then store.open(), and store.close() on unmount
//   <DrawingStoreProvider store={store}> ... </DrawingStoreProvider>
//   const connection = useDrawingSlice((s) => s.connection);     // re-renders only when that slice changes
//   const selection = useSceneSlice((s) => s.selection);          // works on Drawing and Review (SceneStoreProvider)
//   const scene = useScene();                                     // the Scene, re-rendering on every scene update
//
// Slices (see types.ts): status, scene, dom, revision, view, pane, sheet, selection, grips, hover, window, aids, prompt, measuring, find, focus,
// and for the live drawing: info (name, folder, role, username), state (confirmed + unconfirmed groups), parameters (with values), sheets, canEdit,
// currentLayer, connection (exact `status "Connection"` text + the switch state), pendingOps, members (People here), cursors, followed,
// command (expects), preview, xrefNotices, storageNotice, exportJob, folderDrawings.
//
// Focus: the store never touches the DOM. `snapshot.focus` is a request ({target, seq}); the element's owner focuses it once per `seq`:
//   command (after a command ends, a refusal, a rollback, Delete, Find closed), drawing (after a role change), layer-list, parameter-list, find.
// Announcements and toasts go through the injected deps (`announce`, `pushToast` in the page). A lost session calls `deps.signIn()`;
// `status` then reads `unauthenticated`, a missing or foreign drawing `not-found`, a revoked role `revoked` (the scene is cleared).
//
// Actions of the live drawing:
//   edit(command, ops)                 a group from a panel or dialog (LAYER, PROPERTIES, PARAM, XCLIP, LAYERSTATE, RESTORE, IMPORT...)
//   undo() / redo() / eraseSelection() / nudge(dx, dy) / setCurrentLayer(name)
//   commandEnter(text) / commandSpace(text): boolean (true = acted as Enter, clear the box) / commandEscape() / setPhone(bool)
//   atReady / spaceIsCharacter (getters: `U` in an empty box at Ready is undo; a Space that is a character stays in the box)
//   (the pane ends a transient prompt message on every key press itself: commandKeyPress())
//   toggleAid('snap'|'ortho'|'grid'|'polar')  (F3, F8, F9, F10 and the toggle buttons)
//   setOffline(bool) / follow(user)
//   selectOnly(id) / toggleSelected(id) / clearSelection() / panToEntity(id) / zoomAll()
//   openFind() / closeFind() / setFindQuery(q) / nextMatch()      (Find count text: copy.findCount(find.index + 1, find.matches.length))
//   showLayout(sheetId | null) (Drawing) or showSheet(sheet | null) (any scene store)
//   startMeasure(world) (phone: Measure from here; the next tap on the pane ends it and the result lands in `prompt`)
//   reloadXref(name) / setStorageNotice(text | null) / trackExport(job) / requestFocus(target) / setPrompt(text)
//   onLive(listener)                   every applied live message (version, review, markup, issue, rfi, link...) for panels with their own lists
export { DrawingStore } from './drawingStore.ts';
export { ReviewStore } from './reviewStore.ts';
export { SceneStore } from './sceneStore.ts';
export { AID_LABEL } from './sceneStore.ts';
export type { DraftingAid } from './sceneStore.ts';
export { browserSceneEnv, newId, openSocket } from './browserDeps.ts';
export { LiveChannel } from './liveChannel.ts';
export {
  DrawingStoreProvider, SceneStoreProvider, useDrawingSlice, useDrawingStore, useMay, useScene, useSceneSlice, useSceneStore,
} from './hooks.tsx';
export type { DocumentInfo, FocusTarget, OpInput } from './types.ts';
