const CARRY_KEY = "__sollis_carry";
export function readCarry() {
    const raw = window[CARRY_KEY];
    return typeof raw === "object" && raw !== null ? raw : null;
}
export function writeCarry(data) {
    window[CARRY_KEY] = data;
}
