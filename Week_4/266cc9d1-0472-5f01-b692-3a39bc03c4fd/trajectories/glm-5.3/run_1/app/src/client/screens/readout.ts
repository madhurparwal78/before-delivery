import type { Tower, Finding, FlightAnswer } from '../api.js';
import { cameraLine, chainageReadout, droneLine, flightTimeLine } from '../format.js';

/**
 * The position readout: five mono lines, in order. The drone line and flight
 * time follow the latest-scrub-input-wins rule through the pending flag.
 */
export class Readout {
  el: HTMLElement;
  private chainageEl: HTMLElement;
  private spanEl: HTMLElement;
  private droneEl: HTMLElement;
  private timeEl: HTMLElement;
  private cameraEl: HTMLElement;
  private streamEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('section');
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Position readout');
    this.el.className = 'readout';
    this.chainageEl = document.createElement('p');
    this.spanEl = document.createElement('p');
    this.droneEl = document.createElement('p');
    this.timeEl = document.createElement('p');
    this.cameraEl = document.createElement('p');
    this.streamEl = document.createElement('p');
    this.streamEl.className = 'stream-line';
    this.el.append(this.chainageEl, this.spanEl, this.droneEl, this.timeEl, this.cameraEl, this.streamEl);
    parent.append(this.el);
  }

  setChainage(chainage: number, towers: Tower[]): void {
    this.chainageEl.textContent = chainageReadout(chainage);
    this.spanEl.textContent = spanText(towers, chainage);
  }

  setFlightPending(): void {
    this.droneEl.textContent = 'Drone locating...';
    this.timeEl.textContent = '';
  }

  setFlight(answer: FlightAnswer): void {
    if (answer.covered && answer.position) {
      this.droneEl.textContent = droneLine(answer.position.lon_deg, answer.position.lat_deg, answer.position.height_m);
      this.timeEl.textContent = answer.time ? flightTimeLine(answer.time) : '';
    } else {
      this.droneEl.textContent = `Drone ${answer.label ?? 'No flight coverage'}`;
      this.timeEl.textContent = '';
    }
  }

  setCamera(heightAboveGround: number, heading: number, pitch: number): void {
    this.cameraEl.textContent = cameraLine(heightAboveGround, heading, pitch);
  }

  setStreaming(n: number): void {
    this.streamEl.textContent = n > 0 ? `Streaming ${n} ${n === 1 ? 'tile' : 'tiles'}` : '';
  }
}

export function spanText(towers: Tower[], chainage: number): string {
  for (let i = 0; i < towers.length - 1; i++) {
    if (chainage >= towers[i].chainage_m && chainage < towers[i + 1].chainage_m) {
      return `Span ${towers[i].number}–${towers[i + 1].number}`;
    }
  }
  const last = towers[towers.length - 1];
  return `Span ${towers[towers.length - 2].number}–${last.number}`;
}

export function findingOptionText(f: Finding): string {
  const status = f.status === 'violation' ? 'Violation' : 'Clear';
  return `${f.label} ${status} clearance ${f.clearance_m.toFixed(2)} m ${f.span.label} chainage ${f.chainage_m.toFixed(1)} m`;
}
