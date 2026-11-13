import { useEffect } from "react";
import { usePlace } from "../router.js";
import { cellStates, shelf, startMarket } from "../state/market.js";
import { holds, restoreHold } from "../state/hold.js";
import { setSceneDim, SHEET_DIM, story, useChapter } from "../state/story.js";
import { useStore } from "../state/store.js";
import { BoxSheet } from "./BoxSheet.js";
import { Checkout } from "./Checkout.js";
import { HoldBar } from "./HoldBar.js";
import { Lookup } from "./Lookup.js";
import { MissingSheet } from "./MissingSheet.js";
import { OrderPage } from "./OrderPage.js";
import { Header } from "./Header.js";
import { SoundGate } from "./SoundGate.js";
import { StoryView } from "./StoryView.js";
import { viewOf, type View } from "./routes.js";
import "../styles/shell.css";

/** Keeps the 3D boxes in step with the shelf and the reader's own hold. */
const SceneSync = () => {
  const shelfState = useStore(shelf);
  const holdState = useStore(holds);
  const own = holdState.live ? holdState.number : null;
  useEffect(() => {
    if (shelfState.loaded) story().setBoxes(cellStates(shelfState.states, own));
  }, [shelfState.loaded, shelfState.states, own]);
  return null;
};

const SheetView = ({ view }: { view: Exclude<View, { kind: "story" }> }) => {
  switch (view.kind) {
    case "box":
      return <BoxSheet number={view.number} />;
    case "checkout":
      return <Checkout />;
    case "order":
      return <OrderPage reference={view.reference} />;
    case "lookup":
      return <Lookup />;
    case "missing":
      return <MissingSheet />;
  }
};

/** Holds the bar docked where the brief says: the shelf, the box and checkout sheets, and the story while a hold is live. */
const HoldDock = ({ view }: { view: View }) => {
  const chapter = useChapter();
  const holdState = useStore(holds);
  const docked =
    view.kind === "box" || view.kind === "checkout" || (view.kind === "story" && (view.shelf || chapter === "shelf" || holdState.number !== null));
  return docked ? <HoldBar /> : null;
};

export const PublicApp = () => {
  const { pathname } = usePlace();
  const view = viewOf(pathname);
  const story$ = view.kind === "story";

  useEffect(() => {
    startMarket();
    restoreHold();
  }, []);

  useEffect(() => {
    setSceneDim(story$ ? 0 : SHEET_DIM);
  }, [story$]);

  return (
    <>
      <SceneSync />
      <Header view={view} />
      {view.kind === "story" ? <StoryView shelfRoute={view.shelf} /> : <SheetView view={view} />}
      <HoldDock view={view} />
      <SoundGate view={view} />
    </>
  );
};
