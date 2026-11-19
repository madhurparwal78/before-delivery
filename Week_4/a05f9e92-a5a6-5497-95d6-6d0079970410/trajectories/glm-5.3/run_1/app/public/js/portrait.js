// Procedural portraits: a 2:3 mosaic of glyph shapes generated from a name,
// on a flat ground in the tier colour.
const GLYPH_COLOURS = ['#14161c', '#ff8f4d', '#6b2f14', '#ffffff'];
/** Deterministic pseudo-random from a string seed. */
function seeded(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return () => {
        h ^= h << 13;
        h ^= h >>> 17;
        h ^= h << 5;
        return ((h >>> 0) % 10000) / 10000;
    };
}
/** Draw a portrait tile as an SVG element (2:3 upright). */
export function portraitSvg(spec) {
    const random = seeded(spec.name.toLowerCase());
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 150');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('aria-hidden', 'true');
    const ground = document.createElementNS(ns, 'rect');
    ground.setAttribute('width', '100');
    ground.setAttribute('height', '150');
    ground.setAttribute('fill', spec.tier === 1 ? '#14161c' : spec.tier === 2 ? '#6b2f14' : '#ff7d33');
    svg.appendChild(ground);
    const cols = 4;
    const rows = 6;
    const cell = 20;
    const margin = 5;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const pick = random();
            if (pick < 0.3)
                continue;
            const x = margin + c * cell;
            const y = margin + r * cell;
            const colour = GLYPH_COLOURS[Math.floor(random() * GLYPH_COLOURS.length)];
            const shape = Math.floor(random() * 4);
            const node = document.createElementNS(ns, 'g');
            node.setAttribute('fill', colour);
            node.setAttribute('stroke', colour);
            node.setAttribute('stroke-width', '2');
            if (shape === 0) {
                const rect = document.createElementNS(ns, 'rect');
                rect.setAttribute('x', String(x + 2));
                rect.setAttribute('y', String(y + 2));
                rect.setAttribute('width', '12');
                rect.setAttribute('height', '12');
                node.appendChild(rect);
            }
            else if (shape === 1) {
                const circle = document.createElementNS(ns, 'circle');
                circle.setAttribute('cx', String(x + 8));
                circle.setAttribute('cy', String(y + 8));
                circle.setAttribute('r', '6');
                node.appendChild(circle);
            }
            else if (shape === 2) {
                const line = document.createElementNS(ns, 'line');
                line.setAttribute('x1', String(x + 2));
                line.setAttribute('y1', String(y + 2));
                line.setAttribute('x2', String(x + 14));
                line.setAttribute('y2', String(y + 14));
                node.appendChild(line);
            }
            else {
                const path = document.createElementNS(ns, 'path');
                path.setAttribute('d', `M ${x + 2} ${y + 14} L ${x + 8} ${y + 2} L ${x + 14} ${y + 14} Z`);
                node.appendChild(path);
            }
            svg.appendChild(node);
        }
    }
    return svg;
}
/** Render a portrait with its accessible name. */
export function renderPortrait(container, spec, alt) {
    container.textContent = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'portrait';
    wrapper.style.aspectRatio = '2 / 3';
    wrapper.setAttribute('role', 'img');
    wrapper.setAttribute('aria-label', alt);
    wrapper.appendChild(portraitSvg(spec));
    container.appendChild(wrapper);
}
