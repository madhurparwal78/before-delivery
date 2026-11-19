export function formatMoney(cents) {
    const negative = cents < 0;
    const abs = Math.abs(cents);
    const dollars = Math.floor(abs / 100).toString();
    const centsPart = (abs % 100).toString().padStart(2, '0');
    const withCommas = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${negative ? '-' : ''}$${withCommas}.${centsPart}`;
}
export function formatPrice(kind, cents) {
    return kind === 'event' ? `${cents}\u00A2` : formatMoney(cents);
}
export function formatThousands(n) {
    return n.toLocaleString('en-US');
}
export function feeForFill(notionalCents, bps) {
    return Math.floor((notionalCents * bps + 5000) / 10000);
}
export function monthName(month) {
    const [year, mon] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year ?? 2026, (mon ?? 1) - 1, 1));
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
}
export function shortId(id) {
    return id.slice(0, 8);
}
export function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
