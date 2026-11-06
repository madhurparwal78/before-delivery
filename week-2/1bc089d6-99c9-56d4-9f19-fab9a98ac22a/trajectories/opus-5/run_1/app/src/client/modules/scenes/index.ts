import { cityScene, type CityScene } from './city.js';
import { FlatStage } from './flat.js';
import { flowersScene, type FlowersScene } from './flowers.js';
import { heroScene } from './hero.js';
import { lanternScene } from './lantern.js';
import { moonScene } from './moon.js';
import { Stage } from './stage.js';
import { waterScene } from './water.js';

export interface Evening {
  resize(): void;
  render(name: string, progress: number, elapsed: number): void;
  setLitWindows(count: number): void;
  closeFlower(index: number): void;
  flowerHits(): { x: number; y: number }[];
}

/** Builds the whole evening on one canvas, in WebGL where the browser allows it. */
export function buildEvening(canvas: HTMLCanvasElement): Evening {
  const stage = new Stage(canvas);
  if (stage.usable) {
    const city: CityScene = cityScene();
    const flowers: FlowersScene = flowersScene();
    stage.add(heroScene());
    stage.add(city);
    stage.add(waterScene());
    stage.add(flowers);
    stage.add(moonScene());
    stage.add(lanternScene());
    return {
      resize: () => stage.resize(),
      render: (name, progress, elapsed) => stage.render(name, progress, elapsed),
      setLitWindows: (count) => city.setLitWindows(count),
      closeFlower: (index) => flowers.closeEarly(index),
      flowerHits: () => flowers.hitPoints(),
    };
  }
  const flat = new FlatStage(canvas);
  return {
    resize: () => flat.resize(),
    render: (name, progress) => flat.render(name, progress),
    setLitWindows: (count) => flat.setLitWindows(count),
    closeFlower: () => undefined,
    flowerHits: () => [],
  };
}
