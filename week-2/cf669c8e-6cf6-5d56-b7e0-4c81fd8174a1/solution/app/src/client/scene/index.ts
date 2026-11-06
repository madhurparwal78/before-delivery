/**
 * Scene module. One `SceneModel` per page drives the WebGL scene, the SVG still drawing, the Clearance readout, the
 * parts list and the story. Import `./scene.css` once (tokens.css must be loaded first).
 *
 *   const model = useMemo(() => new SceneModel({ reducedMotion, units }), []);   // create once per page
 *   model.setParts(fit.parts)           // ScenePart[] from the server fit result (default: K50 table)
 *   model.setRails(fit.rails)           // { pack, hub } RailResult | null; call after every quote
 *   model.setUnits(units); model.setReducedMotion(reduced)   // or useReducedMotion() from here
 *   model.setStoryProgress(p | null)    // story only, p in 0..1; pure function of p
 *   model.on('railStop', part => ...)   // 'traction-pack' | 'hub-motor' newly reached its stop: ask the server for the fit
 *   model.on('select', id => ...)       // selection changed by a click in the scene ('' = background)
 *   model.select(id | null)             // selection from elsewhere; pack/hub starts the Feeler Sweep
 *   useSceneSnapshot(model)             // selectedPart, rail, parts[], camera angles, ... (see SceneSnapshot)
 *
 * Components (all take the same `model`):
 *   <SceneView model mode="config|story" onEscape titleBlock />  role application "Moped scene" (or img "Moped drawing")
 *   <ClearanceRegion ref model verdictWord onEscape />            region "Clearance" with slider "Insertion travel"
 *   <PartsList ref model onPick />                                list "Parts schedule", one Tab stop, roving focus
 *   <StillStack />                                                six stacked stills for reduced-motion story
 *   <TitleBlock donor kit roadClass />                            ruled title block cell group
 * The scene stage sizes itself from CSS (aspect-ratio); give `.scene-frame` a column width. The rail handle lives in the
 * stage next to (not inside) the application element.
 */
export { SceneModel } from './model.js';
export { SceneView } from './SceneView.js';
export { ClearanceRegion } from './Clearance.js';
export type { ClearanceHandle } from './Clearance.js';
export { PartsList } from './PartsList.js';
export type { PartsListHandle } from './PartsList.js';
export { StillStack, STORY_CAPTIONS } from './StillStack.js';
export { TitleBlock } from './TitleBlock.js';
export { useSceneSnapshot, useReducedMotion } from './hooks.js';
