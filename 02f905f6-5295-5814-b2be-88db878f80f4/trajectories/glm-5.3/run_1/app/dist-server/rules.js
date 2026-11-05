export function dec(value, scale) {
    if (typeof value === "bigint")
        return { v: value, s: scale };
    if (typeof value === "number") {
        return { v: BigInt(Math.round(value * 10 ** scale)), s: scale };
    }
    return fromString(value, scale);
}
export function fromString(str, scale) {
    const trimmed = str.trim();
    const neg = trimmed.startsWith("-");
    const abs = neg ? trimmed.slice(1) : trimmed;
    const [intPart, fracPart = ""] = abs.split(".");
    const frac = (fracPart + "0".repeat(scale)).slice(0, scale);
    const digits = BigInt(intPart || "0") * 10n ** BigInt(scale) + BigInt(frac || "0");
    return { v: neg ? -digits : digits, s: scale };
}
export function toString(d, fixed = d.s) {
    const neg = d.v < 0n;
    const abs = neg ? -d.v : d.v;
    const scale = BigInt(d.s);
    const int = abs / 10n ** scale;
    const frac = (abs % 10n ** scale).toString().padStart(d.s, "0").slice(0, fixed);
    const sign = neg ? "-" : "";
    return frac ? `${sign}${int}.${frac}` : `${sign}${int}.${"0".repeat(fixed)}`;
}
export function add(a, b) {
    const s = Math.max(a.s, b.s);
    return { v: rescale(a, s) + rescale(b, s), s };
}
export function sub(a, b) {
    const s = Math.max(a.s, b.s);
    return { v: rescale(a, s) - rescale(b, s), s };
}
export function mul(a, b) {
    return { v: a.v * b.v, s: a.s + b.s };
}
export function div(a, b, scale) {
    // a/b to `scale` decimals, truncating; callers round explicitly where needed.
    const factor = 10n ** BigInt(scale + b.s - a.s);
    return { v: (a.v * factor) / b.v, s: scale };
}
function rescale(d, scale) {
    if (scale === d.s)
        return d.v;
    if (scale > d.s)
        return d.v * 10n ** BigInt(scale - d.s);
    return d.v / 10n ** BigInt(d.s - scale);
}
export function scaleTo(d, scale) {
    return { v: rescale(d, scale), s: scale };
}
// Round half-up at `scale` decimals — the fee's single rounding step lives here.
export function roundHalfUp(d, scale) {
    const factor = 10n ** BigInt(d.s - scale);
    const rem = d.v % factor;
    let base = d.v / factor;
    const half = factor / 2n;
    if (rem >= half)
        base += 1n;
    return { v: base, s: scale };
}
export function cmp(a, b) {
    const s = Math.max(a.s, b.s);
    const av = rescale(a, s);
    const bv = rescale(b, s);
    return av < bv ? -1 : av > bv ? 1 : 0;
}
export function isZero(d) {
    return d.v === 0n;
}
export function isNegative(d) {
    return d.v < 0n;
}
export function isPositive(d) {
    return d.v > 0n;
}
export function fromDec(d) {
    return Number(d.v) / 10 ** d.s;
}
// --- Measuring rules ---
export const CM_PER_INCH = dec(254n, 2); // 2.54
export const MAX_SIDE_IN = dec(230n, 1); // 23.0
export const PLATE_MIN_HEIGHT_IN = dec(15n, 1); // 1.5
// Parses a size: must be a number above 0 with at most two decimals.
// Returns null when invalid (caller reports the right message per rule order).
export function parseSize(value) {
    if (value === undefined || value === null || String(value).trim() === "")
        return { ok: false, d: null };
    const str = String(value).trim();
    if (!/^-?\d+(\.\d{1,2})?$/.test(str))
        return { ok: false, d: null };
    const d = fromString(str, 2);
    if (!isPositive(d))
        return { ok: false, d: null };
    return { ok: true, d };
}
export function inchesFromCm(cm) {
    return div(cm, CM_PER_INCH, 4);
}
// Rule 3: round up to next multiple of 0.5 in; a value already on a multiple stays.
export function roundToHalfInch(inches) {
    const scaled = scaleTo(inches, 1); // tenths
    const rem = scaled.v % 5n;
    const base = scaled.v - rem;
    const rounded = rem === 0n ? scaled.v : base + 5n;
    return { v: rounded, s: 1 };
}
export function roundedSides(shape, unit, raw, errors) {
    const keys = shape === "rectangular" ? ["length", "width", "height"] : ["diameter", "height"];
    const parsed = {};
    let failed = false;
    for (const key of keys) {
        const value = raw[key];
        const res = parseSize(value);
        if (!res.ok || !res.d) {
            errors[key] = String(value ?? "").trim() === "" ? "Enter a size above 0" : "Enter a number with at most two decimals";
            failed = true;
            continue;
        }
        const inches = unit === "cm" ? inchesFromCm(res.d) : res.d;
        parsed[key] = inches;
    }
    if (failed)
        return null;
    const out = {
        length: null,
        width: null,
        diameter: null,
        height: roundToHalfInch(parsed.height)
    };
    if (shape === "rectangular") {
        out.length = roundToHalfInch(parsed.length);
        out.width = roundToHalfInch(parsed.width);
    }
    else {
        out.diameter = roundToHalfInch(parsed.diameter);
    }
    // Rule 4: a plate's rounded height is raised to 1.5 in if lower.
    if (shape === "plate" && cmp(out.height, PLATE_MIN_HEIGHT_IN) < 0) {
        out.height = PLATE_MIN_HEIGHT_IN;
    }
    return out;
}
// Rule 5 limits: side ≤ 23.0 in, height ≤ max post height − 1 in.
export function checkLimits(sides, heightLimitIn, errors) {
    const values = [
        { key: "height", d: sides.height }
    ];
    if (sides.length)
        values.push({ key: "length", d: sides.length });
    if (sides.width)
        values.push({ key: "width", d: sides.width });
    if (sides.diameter)
        values.push({ key: "diameter", d: sides.diameter });
    for (const { key, d } of values) {
        if (cmp(d, MAX_SIDE_IN) > 0) {
            errors[key] = "Too large for the shelf: 23 in at most";
            return false;
        }
    }
    if (cmp(sides.height, heightLimitIn) > 0) {
        const limit = toString(heightLimitIn, 1);
        errors.height = `Too tall for any kiln: ${limit} in at most`;
        return false;
    }
    return true;
}
// Rule 6: cubic inches product of the three rounded sides (diameter twice).
export function cubicInches(sides) {
    const h = sides.height;
    if (sides.diameter) {
        return mul(mul(sides.diameter, sides.diameter), h);
    }
    const l = sides.length;
    const w = sides.width;
    return mul(mul(l, w), h);
}
// --- Fee rules ---
export function rateForPlan(plan, bisqueRate, glazeRate) {
    if (plan === "bisque_only")
        return bisqueRate;
    if (plan === "glaze_only")
        return glazeRate;
    return add(bisqueRate, glazeRate);
}
// The one and only rounding step: half-up to the cent.
export function computeFee(input) {
    const discount = dec(BigInt(100 - input.discountPercent), 0);
    const hundred = dec(100n, 0);
    const amount = mul(mul(input.cubic, input.rate), div(discount, hundred, 10));
    const cents = roundHalfUp(mul(amount, hundred), 0);
    const centsNum = Number(cents.v);
    return {
        amountCents: centsNum,
        minimumApplied: centsNum < input.orderMinimumCents
    };
}
export function feeWithMinimum(input) {
    const r = computeFee(input);
    if (r.minimumApplied) {
        return { amountCents: input.orderMinimumCents, minimumApplied: true };
    }
    return r;
}
// --- Cone ordering ---
export const CONE_ORDER = ["06", "04", "02", "6", "10"];
export function coneAtOrBelow(firingCone, clayMaxCone) {
    return CONE_ORDER.indexOf(firingCone) <= CONE_ORDER.indexOf(clayMaxCone);
}
export function planStage(plan, stage) {
    // The next or current stage: bisque first for bisque_and_glaze; glaze for glaze_only.
    if (plan === "glaze_only")
        return "glaze";
    return stage ?? "bisque";
}
export function coneForGlaze(cone) {
    if (cone === "06" || cone === "6")
        return cone;
    return null;
}
// --- Fill percent ---
export function fillPercent(cubicSumMilli, usableCubicInches) {
    // cubicSumMilli: sum of cubic inches × 1000 (three decimals)
    const numerator = cubicSumMilli * 100n;
    const denom = BigInt(usableCubicInches) * 1000n;
    const q = numerator / denom;
    const r = numerator % denom;
    return Number(q) + (r * 2n >= denom ? 1 : 0);
}
// Firing hours = Σ (|target − previous| ÷ rate) + hold ÷ 60, starting at 70 °F.
export function firingHours(segments) {
    let total = dec(0n, 6);
    let prev = 70;
    for (const seg of segments) {
        const rise = Math.abs(seg.target_f - prev);
        const rate = seg.rate_f_per_hour;
        const hours = div(dec(BigInt(Math.round(rise * 100)), 2), dec(BigInt(rate * 100), 2), 6);
        total = add(total, hours);
        const hold = div(dec(BigInt(seg.hold_minutes), 0), dec(60n, 0), 6);
        total = add(total, hold);
        prev = seg.target_f;
    }
    return total;
}
