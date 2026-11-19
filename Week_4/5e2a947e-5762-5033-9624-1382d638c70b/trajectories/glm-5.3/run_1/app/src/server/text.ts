/**
 * HTML escaping for text rendered into exported SVG, and the notes
 * markdown subset shared by the server (validation) and browser.
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
