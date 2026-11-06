export function money(cents) {
    const v = cents ?? 0;
    const sign = v < 0 ? '−' : '';
    const a = Math.abs(v);
    return `${sign}$${(a / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function moneySigned(cents) {
    const sign = cents < 0 ? '−' : '+';
    const a = Math.abs(cents);
    return `${sign}$${(a / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
