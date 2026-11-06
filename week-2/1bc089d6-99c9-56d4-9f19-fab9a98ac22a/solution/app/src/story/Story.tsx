import { useEffect } from "react";

import { startStory } from "./runtime/startStory";
import { Breathe, CityWindow, FlowerWindow, Hero, NobodyPlans, Numbers, Screen, Settle, WaterWindow } from "./sections/Chapters";
import { Backdrop, Gate, TopBar } from "./sections/Chrome";
import { Film, LightsOut, PlannerChapter } from "./sections/Closing";
import { Track } from "./sections/Track";

/**
 * The whole story renders as one document in reading order: 3D windows (`[data-scene]`, transparent)
 * alternate with text chapters (opaque) over a single fixed canvas. The imperative runtime binds
 * scroll, sound and the scenes once the markup is in the DOM.
 */
export function Story() {
  useEffect(() => startStory(), []);
  return (
    <>
      <Backdrop />
      <Gate />
      <Hero />
      <TopBar />
      <main className="sh-story" id="story">
        <NobodyPlans />
        <Numbers />
        <CityWindow />
        <Screen />
        <WaterWindow />
        <Breathe />
        <FlowerWindow />
        <Settle />
        <Track />
        <Film />
        <PlannerChapter />
      </main>
      <LightsOut />
    </>
  );
}
