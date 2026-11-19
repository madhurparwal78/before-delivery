/**
 * The scrub engine shared by the workspace and the review page.
 *
 * Every scrub input updates the readout, span and near marks at once, then asks
 * the flight endpoint for the playhead's position. Only the answer to the
 * latest input is ever applied; late answers to earlier inputs are discarded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { centrelineAt, spanAt } from "./centreline.js";
import { chainage as fmtChainage } from "../../shared/format.js";
import { readViewState, writeViewState, type CameraPose, type ViewState } from "./view.js";
import type { Finding, FlightAnswer, Tower } from "./types.js";

export const NEAR_REACH_M = 25;

export interface ChasePoseInput {
  chainageM: number;
  answer: FlightAnswer | null;
  groundHeightM: number;
}

export interface CorridorView {
  chainageM: number;
  span: { from: number; to: number; label: string };
  flight: { pending: boolean; answer: FlightAnswer | null };
  selectedId: string | null;
  nearIds: Set<string>;
  camera: CameraPose | null;
  scrub: (chainageM: number, mode: ScrubMode) => void;
  releasePlayhead: (chainageM: number) => void;
  select: (findingId: string | null) => void;
  setCamera: (pose: CameraPose) => void;
  chasePose: (chainageM: number, answer: FlightAnswer | null) => CameraPose;
  initialCamera: CameraPose | null;
}

export type ScrubMode = "step" | "drag" | "commit";

interface Options {
  towers: Tower[];
  lengthM: number;
  findings: Finding[];
  flightPath: string;
  groundHeightAt: (lonDeg: number, latDeg: number) => number | null;
  baseHeightAt: (chainageM: number) => number;
  onSelectionAnnounce?: (finding: Finding) => void;
}

export function useCorridorView(options: Options): CorridorView {
  const initial = useMemo(() => readViewState(window.location.search), []);
  const [chainageM, setChainageM] = useState(initial.chainageM);
  const [selectedId, setSelectedId] = useState<string | null>(initial.findingId);
  const [answer, setAnswer] = useState<FlightAnswer | null>(null);
  const [pending, setPending] = useState(true);
  const [camera, setCameraState] = useState<CameraPose | null>(initial.camera);

  const requestId = useRef(0);
  const stateRef = useRef<ViewState>({
    chainageM: initial.chainageM,
    time: initial.time,
    findingId: initial.findingId,
    camera: initial.camera,
  });
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const commitUrl = useCallback((mode: "replace" | "push") => {
    writeViewState(stateRef.current, mode);
  }, []);

  /** Asks the flight endpoint for one chainage and applies only the latest answer. */
  const requestFlight = useCallback(
    (targetChainageM: number, writeUrl: boolean) => {
      const id = requestId.current + 1;
      requestId.current = id;
      setPending(true);
      const path = `${optionsRef.current.flightPath}?chainage_m=${fmtChainage(targetChainageM)}`;
      api<FlightAnswer>("GET", path)
        .then((result) => {
          if (requestId.current !== id) return;
          setAnswer(result);
          setPending(false);
          stateRef.current.time = result.covered ? result.time : null;
          if (writeUrl) commitUrl("replace");
        })
        .catch(() => {
          if (requestId.current !== id) return;
          setAnswer(null);
          setPending(false);
        });
    },
    [commitUrl],
  );

  const requestFlightByTime = useCallback(
    (time: string) => {
      const id = requestId.current + 1;
      requestId.current = id;
      setPending(true);
      api<FlightAnswer>("GET", `${optionsRef.current.flightPath}?time=${encodeURIComponent(time)}`)
        .then((result) => {
          if (requestId.current !== id) return;
          setAnswer(result);
          setPending(false);
        })
        .catch(() => {
          if (requestId.current !== id) return;
          setAnswer(null);
          setPending(false);
        });
    },
    [],
  );

  // Opening a URL places the drone at `t` when it is there, otherwise at the
  // time mapped from `ch`.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || options.lengthM <= 0) return;
    started.current = true;
    const target = clamp(initial.chainageM, 0, options.lengthM);
    stateRef.current.chainageM = target;
    setChainageM(target);
    if (initial.time) {
      requestFlightByTime(initial.time);
    } else {
      requestFlight(target, true);
    }
  }, [options.lengthM, initial.chainageM, initial.time, requestFlight, requestFlightByTime]);

  const scrub = useCallback(
    (next: number, mode: ScrubMode) => {
      const target = clamp(next, 0, optionsRef.current.lengthM);
      stateRef.current.chainageM = target;
      stateRef.current.time = null;
      setChainageM(target);
      requestFlight(target, true);
      if (mode !== "drag") commitUrl("replace");
    },
    [commitUrl, requestFlight],
  );

  const releasePlayhead = useCallback(
    (next: number) => {
      const target = clamp(next, 0, optionsRef.current.lengthM);
      stateRef.current.chainageM = target;
      setChainageM(target);
      commitUrl("replace");
      requestFlight(target, true);
    },
    [commitUrl, requestFlight],
  );

  const select = useCallback(
    (findingId: string | null) => {
      setSelectedId(findingId);
      stateRef.current.findingId = findingId;
      const finding = optionsRef.current.findings.find((item) => item.id === findingId);
      if (finding) {
        stateRef.current.chainageM = finding.chainage_m;
        stateRef.current.time = null;
        setChainageM(finding.chainage_m);
        requestFlight(finding.chainage_m, true);
        optionsRef.current.onSelectionAnnounce?.(finding);
      }
      commitUrl("push");
    },
    [commitUrl, requestFlight],
  );

  const setCamera = useCallback((pose: CameraPose) => {
    setCameraState(pose);
    stateRef.current.camera = pose;
  }, []);

  // `cam` is rewritten once the camera has been still, always replacing.
  const cameraSettle = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!camera) return undefined;
    window.clearTimeout(cameraSettle.current);
    cameraSettle.current = window.setTimeout(() => commitUrl("replace"), 700);
    return () => window.clearTimeout(cameraSettle.current);
  }, [camera, commitUrl]);

  // Back and forward restore the playhead, selection and camera of that entry.
  useEffect(() => {
    const onPopState = (): void => {
      const restored = readViewState(window.location.search);
      stateRef.current = restored;
      setChainageM(clamp(restored.chainageM, 0, optionsRef.current.lengthM));
      setSelectedId(restored.findingId);
      setCameraState(restored.camera);
      if (restored.time) {
        requestFlightByTime(restored.time);
      } else {
        requestFlight(restored.chainageM, false);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [requestFlight, requestFlightByTime]);

  const chasePose = useCallback(
    (targetChainageM: number, flightAnswer: FlightAnswer | null): CameraPose => {
      const towers = optionsRef.current.towers;
      const covered = flightAnswer?.covered === true && flightAnswer.position !== undefined;
      const target = covered
        ? {
            lonDeg: flightAnswer!.position!.lon_deg,
            latDeg: flightAnswer!.position!.lat_deg,
            heightM: flightAnswer!.position!.height_m,
          }
        : centreGround(targetChainageM, optionsRef.current);
      const behind = centrelineAt(towers, targetChainageM - 150);
      const above = covered ? 80 : 60;
      const cameraHeight = target.heightM + above;
      const horizontal = haversine(behind.lonDeg, behind.latDeg, target.lonDeg, target.latDeg);
      const pitchDeg = (Math.atan2(target.heightM - cameraHeight, horizontal) * 180) / Math.PI;
      const headingDeg = bearing(behind.lonDeg, behind.latDeg, target.lonDeg, target.latDeg);
      const groundAtCamera = optionsRef.current.groundHeightAt(behind.lonDeg, behind.latDeg);
      const floor = (groundAtCamera ?? optionsRef.current.baseHeightAt(targetChainageM)) + 10;
      return {
        lonDeg: behind.lonDeg,
        latDeg: behind.latDeg,
        heightM: Math.max(cameraHeight, floor),
        headingDeg: (headingDeg + 360) % 360,
        pitchDeg,
      };
    },
    [],
  );

  const nearIds = useMemo(() => {
    const ids = new Set<string>();
    for (const finding of options.findings) {
      if (Math.abs(finding.chainage_m - chainageM) <= NEAR_REACH_M + 1e-9) ids.add(finding.id);
    }
    return ids;
  }, [options.findings, chainageM]);

  const span = useMemo(() => spanAt(options.towers, chainageM), [options.towers, chainageM]);

  return {
    chainageM,
    span,
    flight: { pending, answer },
    selectedId,
    nearIds,
    camera,
    scrub,
    releasePlayhead,
    select,
    setCamera,
    chasePose,
    initialCamera: initial.camera,
  };
}

function centreGround(
  chainageM: number,
  options: Options,
): { lonDeg: number; latDeg: number; heightM: number } {
  const point = centrelineAt(options.towers, chainageM);
  const sampled = options.groundHeightAt(point.lonDeg, point.latDeg);
  return {
    lonDeg: point.lonDeg,
    latDeg: point.latDeg,
    heightM: sampled ?? options.baseHeightAt(chainageM),
  };
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6378137 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  return (Math.atan2(y, x) * 180) / Math.PI;
}
