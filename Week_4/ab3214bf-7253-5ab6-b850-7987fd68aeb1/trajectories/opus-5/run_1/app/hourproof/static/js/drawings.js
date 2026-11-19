// Procedural flat drawings: a disc electricity meter and a pylon.

const SVG = 'http://www.w3.org/2000/svg';

function shape(name, attributes) {
  const node = document.createElementNS(SVG, name);
  Object.entries(attributes).forEach(([key, value]) =>
    node.setAttribute(key, String(value))
  );
  return node;
}

function dial(centreX, centreY, radius, hand) {
  const group = shape('g', {});
  group.append(shape('circle', { cx: centreX, cy: centreY, r: radius, fill: '#fff' }));
  group.append(
    shape('circle', {
      cx: centreX,
      cy: centreY,
      r: radius,
      fill: 'none',
      stroke: '#000',
      'stroke-width': radius * 0.12,
    })
  );
  for (let tick = 0; tick < 10; tick += 1) {
    const angle = (tick / 10) * Math.PI * 2 - Math.PI / 2;
    const inner = radius * 0.62;
    const outer = radius * 0.86;
    group.append(
      shape('line', {
        x1: centreX + Math.cos(angle) * inner,
        y1: centreY + Math.sin(angle) * inner,
        x2: centreX + Math.cos(angle) * outer,
        y2: centreY + Math.sin(angle) * outer,
        stroke: '#000',
        'stroke-width': radius * 0.08,
      })
    );
  }
  const handAngle = (hand / 10) * Math.PI * 2 - Math.PI / 2;
  group.append(
    shape('line', {
      x1: centreX,
      y1: centreY,
      x2: centreX + Math.cos(handAngle) * radius * 0.7,
      y2: centreY + Math.sin(handAngle) * radius * 0.7,
      stroke: '#000',
      'stroke-width': radius * 0.14,
    })
  );
  return group;
}

export function discMeter(className) {
  const svg = shape('svg', {
    viewBox: '0 0 420 760',
    class: className,
    'aria-hidden': 'true',
    focusable: 'false',
    preserveAspectRatio: 'xMidYMid meet',
  });
  svg.append(shape('rect', { x: 20, y: 20, width: 380, height: 720, fill: '#fff' }));
  svg.append(
    shape('rect', {
      x: 20,
      y: 20,
      width: 380,
      height: 720,
      fill: 'none',
      stroke: '#000',
      'stroke-width': 16,
    })
  );
  svg.append(shape('circle', { cx: 210, cy: 250, r: 150, fill: '#fff' }));
  svg.append(
    shape('circle', {
      cx: 210,
      cy: 250,
      r: 150,
      fill: 'none',
      stroke: '#000',
      'stroke-width': 18,
    })
  );
  svg.append(shape('rect', { x: 90, y: 190, width: 240, height: 70, fill: '#000' }));
  for (let box = 0; box < 5; box += 1) {
    svg.append(
      shape('rect', { x: 100 + box * 46, y: 200, width: 36, height: 50, fill: '#fff' })
    );
  }
  [2, 7, 4, 9].forEach((hand, index) => {
    svg.append(dial(126 + index * 56, 330, 24, hand));
  });
  svg.append(shape('rect', { x: 120, y: 430, width: 180, height: 14, fill: '#000' }));
  svg.append(shape('ellipse', { cx: 210, cy: 530, rx: 130, ry: 34, fill: '#fff' }));
  svg.append(
    shape('ellipse', {
      cx: 210,
      cy: 530,
      rx: 130,
      ry: 34,
      fill: 'none',
      stroke: '#000',
      'stroke-width': 16,
    })
  );
  svg.append(shape('rect', { x: 196, y: 496, width: 28, height: 68, fill: '#000' }));
  svg.append(shape('rect', { x: 60, y: 620, width: 300, height: 10, fill: '#000' }));
  svg.append(shape('rect', { x: 60, y: 650, width: 220, height: 10, fill: '#000' }));
  svg.append(shape('rect', { x: 60, y: 680, width: 260, height: 10, fill: '#000' }));
  return svg;
}

export function pylon(className) {
  const svg = shape('svg', {
    viewBox: '0 0 300 420',
    class: className,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const line = (x1, y1, x2, y2, width = 10) =>
    svg.append(shape('line', { x1, y1, x2, y2, stroke: '#000', 'stroke-width': width }));
  line(60, 420, 140, 0);
  line(240, 420, 160, 0);
  line(40, 300, 260, 300, 12);
  line(70, 180, 230, 180, 12);
  line(100, 90, 200, 90, 12);
  for (let rung = 0; rung < 6; rung += 1) {
    const y = 380 - rung * 60;
    const inset = 18 + rung * 14;
    line(inset + 40, y, 260 - inset, y, 6);
  }
  [40, 260].forEach((x) => svg.append(shape('rect', { x: x - 10, y: 290, width: 20, height: 26, fill: '#000' })));
  return svg;
}
