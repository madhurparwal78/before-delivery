import { BG_COLORS, BOX_FACE, BOX_FACE_DARK, GLASS, INK, INSIDE_TONE, PAPER, TOP_COLORS } from "./crate.js";
/** Flat 2D picture of the crate at the home view, used without WebGL or while
 * the context is lost. Same name, units, lid and stamp as the 3D picture. */
export function drawStill(ctx, line, columns, blockBg) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = BG_COLORS[blockBg];
    ctx.fillRect(0, 0, w, h);
    const rows = line.pack / columns;
    // Trapezoid box seen from about 55 degrees: back edge shorter than front.
    const cx = w / 2;
    const frontY = h * 0.86;
    const backY = h * 0.18;
    const frontHalf = w * 0.42;
    const backHalf = w * 0.22;
    // Outer walls
    ctx.fillStyle = BOX_FACE;
    ctx.beginPath();
    ctx.moveTo(cx - frontHalf, frontY);
    ctx.lineTo(cx - backHalf, backY);
    ctx.lineTo(cx + backHalf, backY);
    ctx.lineTo(cx + frontHalf, frontY);
    ctx.closePath();
    ctx.fill();
    // Inside
    ctx.fillStyle = INSIDE_TONE;
    ctx.beginPath();
    ctx.moveTo(cx - frontHalf * 0.9, frontY - h * 0.03);
    ctx.lineTo(cx - backHalf * 0.92, backY + h * 0.02);
    ctx.lineTo(cx + backHalf * 0.92, backY + h * 0.02);
    ctx.lineTo(cx + frontHalf * 0.9, frontY - h * 0.03);
    ctx.closePath();
    ctx.fill();
    // Slot marks and units, back row first, left to right
    const cellW = (frontHalf * 0.84) / columns;
    for (let i = 0; i < line.pack; i++) {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const rowT = (row + 0.5) / rows;
        const half = frontHalf * 0.9 * (1 - rowT) + backHalf * 0.92 * rowT;
        const y = (backY + h * 0.02) * (1 - rowT) + (frontY - h * 0.03) * rowT;
        const x = cx - half + ((col + 0.5) / columns) * half * 2;
        ctx.strokeStyle = BOX_FACE_DARK;
        ctx.lineWidth = Math.max(1, w / 300);
        ctx.strokeRect(x - cellW / 2, y - cellW * 0.42, cellW, cellW * 0.84);
        const cell = line.cells[i];
        if (cell === "empty" || line.status === "sealed" || line.status === "taken_up")
            continue;
        // Body
        ctx.fillStyle = line.unit === "bottle" ? GLASS : PAPER;
        const bodyW = cellW * 0.62;
        if (line.unit === "bottle") {
            ctx.fillRect(x - bodyW * 0.22, y - cellW * 1.1, bodyW * 0.44, cellW * 0.8);
        }
        else {
            ctx.fillRect(x - bodyW / 2, y - cellW * 0.62, bodyW, cellW * 0.5);
        }
        // Top patch
        ctx.fillStyle = topColorFor(cell, line.status);
        const topW = cellW * 0.56;
        ctx.beginPath();
        ctx.moveTo(x - topW / 2, y - cellW * 0.62);
        ctx.lineTo(x, y - cellW * 0.72);
        ctx.lineTo(x + topW / 2, y - cellW * 0.62);
        ctx.lineTo(x, y - cellW * 0.52);
        ctx.closePath();
        ctx.fill();
    }
    // Ink edges
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, w / 400);
    ctx.beginPath();
    ctx.moveTo(cx - frontHalf, frontY);
    ctx.lineTo(cx - backHalf, backY);
    ctx.lineTo(cx + backHalf, backY);
    ctx.lineTo(cx + frontHalf, frontY);
    ctx.closePath();
    ctx.stroke();
    if (line.status === "sealed" || line.status === "taken_up") {
        // Lid shut
        ctx.fillStyle = BOX_FACE;
        ctx.beginPath();
        ctx.moveTo(cx - frontHalf, frontY - h * 0.01);
        ctx.lineTo(cx - backHalf, backY - h * 0.08);
        ctx.lineTo(cx + backHalf, backY - h * 0.08);
        ctx.lineTo(cx + frontHalf, frontY - h * 0.01);
        ctx.closePath();
        ctx.fill();
        ctx.strokeRect(cx - backHalf, backY - h * 0.08, backHalf * 2, h * 0.06);
        drawStampText(ctx, line.status === "sealed" ? "SEALED" : "TAKEN UP", cx, backY - h * 0.02, w * 0.1, "#3E6B47", blockBg);
    }
    else if (line.status === "dropped") {
        drawStampText(ctx, "DROPPED", cx, h * 0.78, w * 0.11, INK, blockBg);
    }
}
function drawStampText(ctx, text, x, y, size, color, _bg) {
    ctx.save();
    ctx.translate(x, y);
    ctx.font = `800 ${size}px Archivo`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    let offset = -((text.length - 1) * size * 0.32) / 2;
    for (const ch of text) {
        ctx.save();
        ctx.translate(offset, 0);
        ctx.rotate((ch.charCodeAt(0) % 7 - 3) * 0.012);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        offset += size * 0.64;
    }
    ctx.restore();
}
function topColorFor(cell, status) {
    if (status === "dropped")
        return TOP_COLORS.dropped;
    return cell === "mine" ? TOP_COLORS.mine : TOP_COLORS.taken;
}
