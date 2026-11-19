// A thin single line in the action blue. It steps flat across days with no
// money movement and carries no axis or labels.

export function sparkline(values) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('viewBox', '0 0 120 34');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const series = Array.isArray(values) && values.length > 0 ? values.map(Number) : [0];
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min || 1;
  const step = series.length > 1 ? 120 / (series.length - 1) : 0;
  const points = series
    .map((value, index) => {
      const x = index * step;
      const y = 31 - ((value - min) / span) * 28;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'var(--accent)');
  line.setAttribute('stroke-width', '1.6');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line);
  return svg;
}
