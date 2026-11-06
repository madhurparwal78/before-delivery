import type { SceneId } from "../../stage";
import type { SceneFactory } from "../types";
import { createCityScene } from "./CityScene";
import { createDuskScene } from "./DuskScene";
import { createFlowerScene } from "./FlowerScene";
import { createLanternScene } from "./LanternScene";
import { createMoonScene } from "./MoonScene";
import { createWaterScene } from "./WaterScene";

export const SCENES: Record<SceneId, SceneFactory> = {
  dusk: createDuskScene,
  city: createCityScene,
  water: createWaterScene,
  flowers: createFlowerScene,
  moon: createMoonScene,
  lantern: createLanternScene,
};
