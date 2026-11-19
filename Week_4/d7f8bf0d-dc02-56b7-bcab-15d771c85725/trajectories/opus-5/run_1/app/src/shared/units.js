export const MM_PER_INCH = 25.4;
function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
}
/** Inches rounded to the nearest eighth, printed as a reduced mixed fraction. */
export function formatInches(mm) {
    const sign = mm < 0 ? '-' : '';
    const eighths = Math.round((Math.abs(mm) / MM_PER_INCH) * 8);
    const whole = Math.floor(eighths / 8);
    const rest = eighths % 8;
    if (rest === 0)
        return `${sign}${whole} in`;
    const divisor = gcd(rest, 8);
    const fraction = `${rest / divisor}/${8 / divisor}`;
    return whole === 0 ? `${sign}${fraction} in` : `${sign}${whole} ${fraction} in`;
}
export function formatMillimetres(mm) {
    return `${mm} mm`;
}
export function formatLength(mm, units) {
    return units === 'in' ? formatInches(mm) : formatMillimetres(mm);
}
/** Tenths of a percent printed with exactly one decimal. */
export function formatGradeTenths(tenths) {
    return (tenths / 10).toFixed(1);
}
function trimDecimals(value, decimals) {
    return String(Number(value.toFixed(decimals)));
}
/** The editable value for a length spinbutton in the workspace's display units. */
export function lengthToInput(mm, units) {
    return units === 'in' ? trimDecimals(mm / MM_PER_INCH, 3) : String(Math.round(mm));
}
/** The stored integer millimetres for a length spinbutton value. */
export function lengthFromInput(value, units) {
    return units === 'in' ? Math.round(value * MM_PER_INCH) : Math.round(value);
}
/** The editable value for the elevation step, stored in hundredths of a millimetre. */
export function elevationStepToInput(hundredths, units) {
    return units === 'in'
        ? trimDecimals(hundredths / 100 / MM_PER_INCH, 3)
        : trimDecimals(hundredths / 100, 2);
}
export function elevationStepFromInput(value, units) {
    return units === 'in' ? Math.round(value * MM_PER_INCH * 100) : Math.round(value * 100);
}
export function fastClockLabel(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}
//# sourceMappingURL=units.js.map