import type { JSX } from "preact";
import type { Boot } from "../shared/types.js";
import { Header, NotFound, StatusRegion } from "./chrome.js";
import { LockDialog, SignInDialog } from "./dialogs.js";
import { Garage } from "./garage.js";
import { Hub } from "./hub.js";
import { useRoute } from "./router.js";
import { Showroom } from "./showroom.js";
import { TestRide } from "./testride.js";

export function App({ boot }: { boot: Boot }): JSX.Element {
  const { path, search } = useRoute();
  return (
    <div id="app">
      <div id="page">
        <Header />
        {path === "/" || path === "/showroom" ? (
          <Showroom initial={boot.reading} />
        ) : path === "/test-ride" ? (
          <TestRide search={search} />
        ) : path === "/garage" ? (
          <Garage />
        ) : path === "/hub" ? (
          <Hub search={search} />
        ) : (
          <NotFound />
        )}
      </div>
      <div id="layers">
        <SignInDialog />
        <LockDialog />
      </div>
      <StatusRegion />
    </div>
  );
}
