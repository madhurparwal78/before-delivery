import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Status, Device, GuestScene, Scene, Clip, Notice } from './types.js';

export interface LiveState {
  status: Status | null;
  devices: Map<string, Device>;
  scenes: Map<string, Scene>;
  guestScenes: Map<string, GuestScene>;
  clips: Map<string, Clip>;
  notices: Map<string, Notice>;
  scheduleRevs: Map<string, number>;
  connected: boolean;
  deviceMsg: string;
  sceneMsg: string;
  connMsg: string;
}

export const LiveCtx = createContext<LiveState | null>(null);

export function useLive(): LiveState {
  const v = useContext(LiveCtx);
  if (!v) throw new Error('LiveCtx missing');
  return v;
}

/** One socket to /api/socket, feeding every page's live state. */
export function useLiveProvider(): LiveState {
  const [status, setStatus] = useState<Status | null>(null);
  const [devices, setDevices] = useState(new Map<string, Device>());
  const [scenes, setScenes] = useState(new Map<string, Scene>());
  const [guestScenes, setGuestScenes] = useState(new Map<string, GuestScene>());
  const [clips, setClips] = useState(new Map<string, Clip>());
  const [notices, setNotices] = useState(new Map<string, Notice>());
  const [scheduleRevs, setScheduleRevs] = useState(new Map<string, number>());
  const [connected, setConnected] = useState(false);
  const [deviceMsg, setDeviceMsg] = useState('');
  const [sceneMsg, setSceneMsg] = useState('');
  const [connMsg, setConnMsg] = useState('');
  const everConnected = useRef(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closedByUser = false;

    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/api/socket`);
      ws.onopen = () => {
        setConnected(true);
        if (everConnected.current) setConnMsg('Live updates resumed.');
        everConnected.current = true;
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as { type: string } & Record<string, unknown>;
        switch (msg.type) {
          case 'status':
            setStatus(msg as unknown as Status);
            break;
          case 'device': {
            const d = msg.device as Device;
            setDevices((m) => new Map(m).set(d.id, d));
            setDeviceMsg(deviceSummary(d));
            break;
          }
          case 'guest_scene': {
            const g = msg.guest_scene as GuestScene;
            setGuestScenes((m) => new Map(m).set(g.id, g));
            break;
          }
          case 'schedule':
            setScheduleRevs((m) => new Map(m).set(msg.schedule_id as string, msg.revision as number));
            break;
          case 'scene': {
            const s = msg.scene as Scene;
            setScenes((m) => new Map(m).set(s.id, s));
            break;
          }
          case 'clip': {
            const c = msg.clip as Clip;
            setClips((m) => new Map(m).set(c.id, c));
            break;
          }
          case 'notice': {
            const n = msg.notice as Notice;
            setNotices((m) => new Map(m).set(n.id, n));
            break;
          }
        }
        if (msg.type === 'status') {
          const st = msg as unknown as Status;
          // Detect live scene changes to feed the "Scene changes" region.
          setStatus((prev) => {
            if (prev) {
              for (let i = 0; i < prev.rooms.length && i < st.rooms.length; i++) {
                if (prev.rooms[i]!.scene_id !== st.rooms[i]!.scene_id && st.rooms[i]!.scene_id !== null) {
                  setSceneMsg(`${st.rooms[i]!.name} is now in ${st.rooms[i]!.scene_name}`);
                }
              }
            }
            return st;
          });
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closedByUser) {
          setConnMsg('Live updates paused. Reconnecting…');
          retry = setTimeout(connect, 2000);
        }
      };
      ws.onerror = () => { ws?.close(); };
    };
    connect();
    return () => {
      closedByUser = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return useMemo(() => ({ status, devices, scenes, guestScenes, clips, notices, scheduleRevs, connected, deviceMsg, sceneMsg, connMsg }), [status, devices, scenes, guestScenes, clips, notices, scheduleRevs, connected, deviceMsg, sceneMsg, connMsg]);
}

function deviceSummary(d: Device): string {
  if (!d.online) return `${d.name}: offline`;
  if (d.kind === 'light') {
    const st = d.state as { on: boolean; brightness: number };
    return st.on ? `${d.name}: on at ${st.brightness}%` : `${d.name}: off`;
  }
  if (d.kind === 'plug') {
    const st = d.state as { on: boolean };
    return st.on ? `${d.name}: on` : `${d.name}: off`;
  }
  if (d.kind === 'thermostat') {
    const st = d.state as { setpoint_f: number; current_f: number };
    return `${d.name}: set to ${st.setpoint_f}°F, reading ${st.current_f}°F`;
  }
  return `${d.name}: back online`;
}

export function LiveProvider(props: { children: ReactNode }): JSX.Element {
  const live = useLiveProvider();
  return <LiveCtx.Provider value={live}>{props.children}</LiveCtx.Provider>;
}
