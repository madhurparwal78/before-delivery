import { errors } from './errors.js';
export const DRAWN_KINDS = ['cube', 'sphere', 'plane', 'torus', 'tube', 'model', 'shader'];
export const OUTPUT_BUSES = ['main', 'side', 'led'];
export const OUTPUT_BUS_LABELS = { main: 'Main', side: 'Side screens', led: 'LED strip' };
export const TICKS_PER_BEAT = 96;
export const TICKS_PER_BAR = 384;
export const MAX_TICK = 24_576;
const whiteMaterial = () => ({ tint: [1, 1, 1], tint_alpha: 1, albedo_texture_id: null, emissive_texture_id: null });
export function defaultLayer(id, kind, name) {
    return {
        id,
        parent_id: null,
        index: 0,
        name,
        kind,
        version: 1,
        visible: true,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        props: defaultProps(kind),
        material: kind === 'cube' || kind === 'sphere' || kind === 'plane' || kind === 'torus' || kind === 'tube' || kind === 'model' ? whiteMaterial() : null,
        model_asset_id: null,
        output_buses: DRAWN_KINDS.includes(kind) ? ['main'] : [],
        shader_version: kind === 'shader' ? 1 : null,
    };
}
function defaultProps(kind) {
    switch (kind) {
        case 'camera': return { fov: 50, near: 0.1, far: 200 };
        case 'light': return { intensity: 1 };
        case 'tube': return { twist: 0, radius: 1 };
        default: return {};
    }
}
export const STARTER_SHADER = `#version 300 es
precision highp float;
uniform float u_beat;
uniform vec2 u_resolution;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float pulse = 0.5 + 0.5 * sin(u_beat * 6.2831853);
  fragColor = vec4(uv * pulse, 0.5, 1.0);
}
`;
export const RANGES = {
    'position': { min: -10_000, max: 10_000, label: 'Position must be between -10000 and 10000' },
    'rotation': { min: -10_000, max: 10_000, label: 'Rotation must be between -10000 and 10000' },
    'scale': { min: 0.001, max: 1_000, label: 'Scale must be between 0.001 and 1000' },
    'props.fov': { min: 10, max: 120, label: 'Field of view must be between 10 and 120' },
    'props.near': { min: 0.01, max: 10, label: 'Near plane must be between 0.01 and 10' },
    'props.far': { min: 0, max: 10_000, label: 'Far plane must be greater than the near plane and at most 10000' },
    'props.twist': { min: -10, max: 10, label: 'Twist must be between -10 and 10' },
    'props.radius': { min: 0.1, max: 100, label: 'Radius must be between 0.1 and 100' },
    'props.intensity': { min: 0, max: 10, label: 'Intensity must be between 0 and 10' },
    'material.tint': { min: 0, max: 1, label: 'Tint components must be between 0 and 1' },
    'material.tint_alpha': { min: 0, max: 1, label: 'Tint alpha must be between 0 and 1' },
};
export const KEYABLE_PROPERTIES = [
    'position.x', 'position.y', 'position.z',
    'rotation.x', 'rotation.y', 'rotation.z',
    'scale.x', 'scale.y', 'scale.z',
    'props.fov', 'props.near', 'props.far',
    'props.twist', 'props.radius', 'props.intensity',
    'material.tint_alpha',
];
export function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
export function inRange(rule, value) {
    return value >= rule.min && value <= rule.max;
}
export function barBeatString(tick) {
    const bar = Math.floor(tick / TICKS_PER_BAR) + 1;
    const withinBar = tick % TICKS_PER_BAR;
    const beat = withinBar / TICKS_PER_BEAT + 1;
    const whole = Math.floor(beat);
    const fraction = beat - whole;
    const text = fraction === 0
        ? String(whole)
        : `${whole}${fraction.toFixed(2).replace(/0+$/, '').slice(1)}`;
    return `${bar}:${text}`;
}
export const snapToQuarterBeat = (tick) => {
    const remainder = tick % 24;
    if (remainder < 12)
        return tick - remainder;
    return tick - remainder + 24;
};
export function validateName(field, value, max) {
    if (typeof value !== 'string' || value.length < 1 || value.length > max) {
        return errors.validation({ [field]: `Name must be 1 to ${max} characters` });
    }
    return value;
}
export function validateEmail(value) {
    if (typeof value !== 'string')
        return errors.validation({ email: 'Enter a valid email address' });
    const trimmed = value.trim();
    if (trimmed.length > 254 || /\s/.test(trimmed))
        return errors.validation({ email: 'Enter a valid email address' });
    const at = trimmed.indexOf('@');
    if (at <= 0 || trimmed.indexOf('@', at + 1) !== -1)
        return errors.validation({ email: 'Enter a valid email address' });
    const domain = trimmed.slice(at + 1);
    const dot = domain.indexOf('.');
    if (dot <= 0 || dot === domain.length - 1)
        return errors.validation({ email: 'Enter a valid email address' });
    return trimmed.toLowerCase();
}
export function validateDisplayName(value) {
    if (typeof value !== 'string')
        return errors.validation({ display_name: 'Display name must be 1 to 40 characters' });
    const trimmed = value.trim();
    if (trimmed.length < 1 || trimmed.length > 40)
        return errors.validation({ display_name: 'Display name must be 1 to 40 characters' });
    return trimmed;
}
export function validatePassword(value) {
    if (typeof value !== 'string' || value.length < 10)
        return errors.validation({ password: 'Password must be at least 10 characters' });
    return value;
}
export const STORAGE_BANNER = 'Asset storage is unreachable. Uploads and publishing are paused.';
export const COLLAB_BANNER = 'Live collaboration is offline. Locks can’t be taken right now.';
