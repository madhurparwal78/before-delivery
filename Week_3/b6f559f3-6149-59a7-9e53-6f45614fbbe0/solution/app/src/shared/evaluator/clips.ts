import { FRAMES_PER_SECOND } from '../format';
import { isObject } from '../paths';
import { slerp, type Quat, type Triple } from '../quaternion';
import type { Json, ModelChannel, ModelClip, ModelSummary } from '../types';

export interface ClipConfig {
  name: string;
  play: boolean;
  loop: boolean;
  speed: number;
  offsetMs: number;
}

interface NodePose {
  translation: Triple;
  rotation: Quat;
  scale: Triple;
}

/** The layer's clip settings for every clip of the model, defaults filling the ones it does not mention. */
export function clipConfigs(stored: Json | undefined, model: ModelSummary): ClipConfig[] {
  const given = Array.isArray(stored) ? stored.filter(isObject) : [];
  return model.clips.map((clip) => {
    const own = given.find((entry) => entry['name'] === clip.name);
    return {
      name: clip.name,
      play: own?.['play'] === true,
      loop: own?.['loop'] === true,
      speed: typeof own?.['speed'] === 'number' ? own['speed'] : 1,
      offsetMs: typeof own?.['offsetMs'] === 'number' ? own['offsetMs'] : 0,
    };
  });
}

/** Clip time in seconds at a timeline frame. A clip that is not playing stays at 0. */
function clipTime(config: ClipConfig, durationS: number, frame: number, reducedMotion: boolean): number {
  if (!config.play || reducedMotion) return 0;
  const elapsed = Math.max(0, frame / FRAMES_PER_SECOND - config.offsetMs / 1000) * config.speed;
  if (!config.loop) return Math.min(elapsed, durationS);
  return durationS === 0 ? 0 : elapsed - Math.floor(elapsed / durationS) * durationS;
}

function sample(channel: ModelChannel, time: number, width: number): number[] {
  const { times, values } = channel;
  const at = (i: number): number[] => values.slice(i * width, i * width + width);
  const first = times[0];
  const last = times[times.length - 1];
  if (first === undefined || last === undefined || time <= first) return at(0);
  if (time >= last) return at(times.length - 1);
  let index = 0;
  while ((times[index + 1] as number) <= time + (channel.interpolation === 'STEP' ? 1e-9 : 0)) index++;
  if (channel.interpolation === 'STEP') return at(index);
  const span = (times[index + 1] as number) - (times[index] as number);
  const t = (time - (times[index] as number)) / span;
  const from = at(index);
  const to = at(index + 1);
  if (channel.path === 'rotation') return slerp(from as Quat, to as Quat, t);
  return from.map((v, i) => v + ((to[i] as number) - v) * t);
}

function restPose(model: ModelSummary, nodeName: string): NodePose {
  const node = model.nodes.find((n) => n.name === nodeName);
  return {
    translation: node?.translation ?? [0, 0, 0],
    rotation: node?.rotation ?? [0, 0, 0, 1],
    scale: node?.scale ?? [1, 1, 1],
  };
}

export function clipTimes(model: ModelSummary, configs: ClipConfig[], frame: number, reducedMotion: boolean): { clip: ModelClip; time: number }[] {
  return model.clips.map((clip, index) => ({
    clip,
    time: clipTime(configs[index] as ClipConfig, clip.durationS, frame, reducedMotion),
  }));
}

/** A node's transform at a frame: the stored one with every clip applied in list order, later clips winning. */
export function nodePose(model: ModelSummary, configs: ClipConfig[], nodeName: string, frame: number, reducedMotion: boolean): NodePose {
  const pose = restPose(model, nodeName);
  for (const { clip, time } of clipTimes(model, configs, frame, reducedMotion)) {
    for (const channel of clip.channels) {
      if (channel.node !== nodeName) continue;
      if (channel.path === 'translation') pose.translation = sample(channel, time, 3) as Triple;
      else if (channel.path === 'rotation') pose.rotation = sample(channel, time, 4) as Quat;
      else pose.scale = sample(channel, time, 3) as Triple;
    }
  }
  return pose;
}
