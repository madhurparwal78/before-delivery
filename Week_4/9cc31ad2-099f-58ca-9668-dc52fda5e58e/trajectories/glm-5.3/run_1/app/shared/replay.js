/** Rules 1-3: shape-level checks on the parsed bytes. Returns null or invalid_inputs. */
export function checkReplayTopLevel(bytes) {
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
    }
    catch {
        return 'invalid_inputs';
    }
    // Rule 1: parses as JSON with no key repeated within any one object.
    // JSON.parse accepts repeated keys, so re-parse checking is needed.
    if (!hasNoDuplicateKeys(bytes))
        return 'invalid_inputs';
    // Rule 2: nesting depth at most 4. Top level is depth 1.
    if (depthOf(parsed) > 4)
        return 'invalid_inputs';
    // Rule 3: top level is an object with a seed and an inputs array.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return 'invalid_inputs';
    const obj = parsed;
    if (typeof obj.seed !== 'string' || !Array.isArray(obj.inputs))
        return 'invalid_inputs';
    return { seed: obj.seed };
}
/** Rules 4-9: event-level checks. stepLimit is the run's step limit. */
export function checkReplayEvents(parsed, stepLimit) {
    const obj = parsed;
    const inputs = obj.inputs;
    // Rule 4: 1 to 2000 events
    if (inputs.length < 1 || inputs.length > 2000)
        return 'invalid_inputs';
    let prevStep = null;
    const events = [];
    for (const item of inputs) {
        // Rule 5: exactly the five keys
        if (typeof item !== 'object' || item === null || Array.isArray(item))
            return 'invalid_inputs';
        const keys = Object.keys(item);
        if (keys.length !== 5 || !keys.includes('step') || !keys.includes('throttle') ||
            !keys.includes('brake') || !keys.includes('drift') || !keys.includes('lane')) {
            return 'invalid_inputs';
        }
        const ev = item;
        // Rule 6: step as plain digits, 0 to stepLimit-1
        if (typeof ev.step !== 'number' || !Number.isInteger(ev.step))
            return 'invalid_inputs';
        if (!isPlainDigits(ev.step))
            return 'invalid_inputs';
        if (ev.step < 0 || ev.step >= stepLimit)
            return 'invalid_inputs';
        // Rule 7: first step 0, strictly increasing
        if (prevStep === null) {
            if (ev.step !== 0)
                return 'invalid_inputs';
        }
        else if (ev.step <= prevStep) {
            return 'invalid_inputs';
        }
        // Rule 8: pedals written as 0 or 1
        for (const k of ['throttle', 'brake', 'drift']) {
            if (ev[k] !== 0 && ev[k] !== 1)
                return 'invalid_inputs';
        }
        // Rule 9: lane one of the three strings
        if (ev.lane !== 'left' && ev.lane !== 'middle' && ev.lane !== 'right')
            return 'invalid_inputs';
        prevStep = ev.step;
        events.push({ step: ev.step, throttle: ev.throttle, brake: ev.brake,
            drift: ev.drift, lane: ev.lane });
    }
    return events;
}
/** The input in force on step k: the last event whose step is at most k. */
export function inputAtStep(events) {
    let idx = 0;
    let last = events[0];
    return (step) => {
        while (idx < events.length && events[idx].step <= step) {
            last = events[idx];
            idx++;
        }
        return { throttle: last.throttle, brake: last.brake, drift: last.drift, lane: last.lane };
    };
}
/** Rule 1's no-repeated-keys check, by a strict JSON parser pass. */
function hasNoDuplicateKeys(bytes) {
    const text = BufferLikeToString(bytes);
    let i = 0;
    const len = text.length;
    const stack = [];
    let ok = true;
    const seen = [];
    while (i < len) {
        const ch = text[i];
        if (ch === '{') {
            stack.push('object');
            seen.push(new Set());
            i++;
        }
        else if (ch === '[') {
            stack.push('array');
            seen.push(new Set());
            i++;
        }
        else if (ch === '}' || ch === ']') {
            stack.pop();
            seen.pop();
            i++;
        }
        else if (ch === '"') {
            // read the string
            let j = i + 1;
            let s = '';
            while (j < len) {
                if (text[j] === '\\') {
                    s += text[j + 1] ?? '';
                    j += 2;
                    continue;
                }
                if (text[j] === '"')
                    break;
                s += text[j];
                j++;
            }
            // If the top of the stack is an object and the next non-space char after the string is ':',
            // this string is a key.
            let k = j + 1;
            while (k < len && /\s/.test(text[k]))
                k++;
            if (stack[stack.length - 1] === 'object' && text[k] === ':') {
                const current = seen[seen.length - 1];
                if (current) {
                    if (current.has(s)) {
                        ok = false;
                        break;
                    }
                    current.add(s);
                }
            }
            i = j + 1;
        }
        else {
            i++;
        }
    }
    return ok;
}
function BufferLikeToString(bytes) {
    if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    // A minimal UTF-8 decode fallback for runtimes without TextDecoder.
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b < 0x80)
            out += String.fromCharCode(b);
        else
            out += String.fromCharCode(0xfffd);
    }
    return out;
}
function depthOf(value, depth = 1) {
    if (typeof value !== 'object' || value === null)
        return depth;
    if (Array.isArray(value)) {
        let max = depth;
        for (const item of value)
            max = Math.max(max, depthOf(item, depth + 1));
        return max;
    }
    let max = depth;
    for (const item of Object.values(value))
        max = Math.max(max, depthOf(item, depth + 1));
    return max;
}
/** Rule 6's plain digits: JSON numbers without sign, decimal point or exponent. */
function isPlainDigits(value) {
    return Number.isInteger(value) && value >= 0;
}
