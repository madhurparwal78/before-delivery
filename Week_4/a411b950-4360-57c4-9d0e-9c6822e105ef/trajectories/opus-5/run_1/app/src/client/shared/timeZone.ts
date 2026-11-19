/** The operator's time zone, written into the page shell by the server. */
export function operatorTimeZone(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="earshot-time-zone"]');
  return meta?.content ?? 'UTC';
}
