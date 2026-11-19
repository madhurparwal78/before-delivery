/**
 * `<D> days <HH>:<MM>:<SS>` when one day or more remains (`1 day` when D is 1),
 * otherwise `<HH>:<MM>:<SS>`.
 */
export function formatCountdown(secondsLeft: number): string {
  const total = Math.max(0, Math.floor(secondsLeft));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
  if (days >= 1) return `${days} ${days === 1 ? 'day' : 'days'} ${clock}`;
  return clock;
}
