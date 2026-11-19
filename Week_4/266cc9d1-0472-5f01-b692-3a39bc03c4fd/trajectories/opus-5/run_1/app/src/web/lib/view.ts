/** View state: chainage, scrub time, selection and camera pose in the URL. */

import { chainage as fmtChainage, angle, degrees7 } from "../../shared/format.js";

export interface CameraPose {
  lonDeg: number;
  latDeg: number;
  heightM: number;
  headingDeg: number;
  pitchDeg: number;
}

export interface ViewState {
  chainageM: number;
  time: string | null;
  findingId: string | null;
  camera: CameraPose | null;
}

export function formatCamera(pose: CameraPose): string {
  return [
    degrees7(pose.lonDeg),
    degrees7(pose.latDeg),
    fmtChainage(pose.heightM),
    angle(pose.headingDeg),
    angle(pose.pitchDeg),
  ].join(",");
}

function parseCamera(value: string | null): CameraPose | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 5 || parts.some((part) => !Number.isFinite(part))) return null;
  return {
    lonDeg: parts[0],
    latDeg: parts[1],
    heightM: parts[2],
    headingDeg: parts[3],
    pitchDeg: parts[4],
  };
}

export function readViewState(search: string): ViewState {
  const params = new URLSearchParams(search);
  const rawChainage = Number(params.get("ch"));
  return {
    chainageM: Number.isFinite(rawChainage) && params.has("ch") ? rawChainage : 0,
    time: params.get("t"),
    findingId: params.get("f"),
    camera: parseCamera(params.get("cam")),
  };
}

export function viewSearch(state: ViewState): string {
  const params = new URLSearchParams();
  params.set("ch", fmtChainage(state.chainageM));
  if (state.time) params.set("t", state.time);
  if (state.findingId) params.set("f", state.findingId);
  if (state.camera) params.set("cam", formatCamera(state.camera));
  return `?${params.toString()}`;
}

export function writeViewState(state: ViewState, mode: "replace" | "push"): void {
  const url = `${window.location.pathname}${viewSearch(state)}`;
  if (mode === "push") {
    window.history.pushState(null, "", url);
  } else {
    window.history.replaceState(null, "", url);
  }
}
