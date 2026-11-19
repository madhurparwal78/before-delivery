import type { Regions } from '../regions.js';
import type { Model, StrokeOutcome } from './model.js';

export interface FloodRequest {
  index: number;
  oldColour: string;
  newColour: string;
  cursor: { x: number; y: number };
  usedBy: number;
  frames: number;
  seq: number;
  by: string;
}

export interface Workspace {
  model: Model;
  regions: Regions;
  repaint(): void;
  refreshPanels(): void;
  reload(): Promise<void>;
  announceStage(text: string): void;
  announceList(text: string): void;
  teamStroke(name: string, pixels: number): void;
  afterStroke(outcome: StrokeOutcome): void;
  startFlood(request: FloodRequest): void;
  openComment(x: number, y: number): void;
  pinMode: boolean;
  focusStage(): void;
}
