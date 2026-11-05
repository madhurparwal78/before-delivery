import { BG_COLORS, BOX_FACE, BOX_FACE_DARK, GLASS, INK, INSIDE_TONE, PAPER } from "./crate.js";
const THREE = await import("three");
const BOX_W = 1.5;
const BOX_D = 1.15;
const BOX_H = 0.42;
const WALL = 0.05;
const INNER_W = BOX_W - 2 * WALL;
const INNER_D = BOX_D - 2 * WALL;
const TOP_COLORS = {
    mine: 0xb5541a,
    taken: 0x26211a,
    dropped: 0x6b5c48,
};
const materials = new Map();
const stamps = new Map();
const floors = new Map();
let edgeMaterial = null;
let fluteTexture = null;
function mat(color, basic = false) {
    const key = `${color}:${basic}`;
    let m = materials.get(key);
    if (!m) {
        m = basic
            ? new THREE.MeshBasicMaterial({ color })
            : new THREE.MeshLambertMaterial({ color });
        materials.set(key, m);
    }
    return m;
}
function makeFluteTexture() {
    if (fluteTexture)
        return fluteTexture;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d");
    ctx.fillStyle = BOX_FACE;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = BOX_FACE_DARK;
    ctx.lineWidth = 2;
    for (let x = 0; x < 64; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 64);
        ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    fluteTexture = tex;
    return tex;
}
function boxMaterial() {
    const key = "box-face";
    let m = materials.get(key);
    if (!m) {
        const map = makeFluteTexture();
        m = new THREE.MeshLambertMaterial({ map });
        materials.set(key, m);
    }
    return m;
}
function floorTexture(columns, rows) {
    const key = `${columns}x${rows}`;
    let tex = floors.get(key);
    if (tex)
        return tex;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = INSIDE_TONE;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "#C4B291";
    ctx.lineWidth = 3;
    const cw = 256 / columns;
    const ch = 256 / rows;
    for (let r = 0; r < rows; r++) {
        for (let col = 0; col < columns; col++) {
            ctx.strokeRect(col * cw + cw * 0.12, r * ch + ch * 0.12, cw * 0.76, ch * 0.76);
        }
    }
    tex = new THREE.CanvasTexture(c);
    floors.set(key, tex);
    return tex;
}
function stampTexture(text, color) {
    const key = `${text}:${color}`;
    let tex = stamps.get(key);
    if (tex)
        return tex;
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 160;
    const ctx = c.getContext("2d");
    ctx.font = "800 86px Archivo";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    const spacing = 62;
    const total = (text.length - 1) * spacing;
    for (let i = 0; i < text.length; i++) {
        ctx.save();
        ctx.translate(256 - total / 2 + i * spacing, 80);
        ctx.rotate(((text.charCodeAt(i) % 5) - 2) * 0.02);
        ctx.fillText(text[i], 0, 0);
        ctx.restore();
    }
    tex = new THREE.CanvasTexture(c);
    stamps.set(key, tex);
    return tex;
}
/** Builds the whole crate picture for one line: the single place a crate's
 * picture (units, tops, slots, lid, stamp) is derived from a line. */
export function buildScene(spec) {
    const { line, columns } = spec;
    const rows = line.pack / columns;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLORS[spec.blockBg]);
    const boxGroup = new THREE.Group();
    scene.add(boxGroup);
    const boxMat = boxMaterial();
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(INNER_W, INNER_D), new THREE.MeshLambertMaterial({ map: floorTexture(columns, rows) }));
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0.001;
    boxGroup.add(floorMesh);
    const wallGeo = new THREE.BoxGeometry(BOX_W, BOX_H, WALL);
    const backWall = new THREE.Mesh(wallGeo, boxMat);
    backWall.position.set(0, BOX_H / 2, -INNER_D / 2 - WALL / 2);
    boxGroup.add(backWall);
    const frontWall = new THREE.Mesh(wallGeo, boxMat);
    frontWall.position.set(0, BOX_H / 2, INNER_D / 2 + WALL / 2);
    boxGroup.add(frontWall);
    const sideGeo = new THREE.BoxGeometry(WALL, BOX_H, BOX_D);
    const leftWall = new THREE.Mesh(sideGeo, boxMat);
    leftWall.position.set(-INNER_W / 2 - WALL / 2, BOX_H / 2, 0);
    boxGroup.add(leftWall);
    const rightWall = new THREE.Mesh(sideGeo, boxMat);
    rightWall.position.set(INNER_W / 2 + WALL / 2, BOX_H / 2, 0);
    boxGroup.add(rightWall);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(BOX_W, WALL, BOX_D), boxMat);
    bottom.position.y = -WALL / 2;
    boxGroup.add(bottom);
    edgeMaterial = edgeMaterial ?? new THREE.LineBasicMaterial({ color: INK });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D)), edgeMaterial);
    edges.position.y = BOX_H / 2;
    boxGroup.add(edges);
    const cellW = INNER_W / columns;
    const cellD = INNER_D / rows;
    const hasLid = line.status === "sealed" || line.status === "taken_up";
    for (let i = 0; i < line.pack; i++) {
        const raisedUnit = spec.raised.get(i);
        const cell = line.cells[i] !== "empty" ? line.cells[i] : raisedUnit?.cell ?? "empty";
        if (cell === "empty" || hasLid)
            continue;
        const col = i % columns;
        const row = Math.floor(i / columns);
        const x = -INNER_W / 2 + (col + 0.5) * cellW;
        const z = -INNER_D / 2 + (row + 0.5) * cellD;
        const raise = raisedUnit?.frac ?? 0;
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        const body = unitBody(line.unit, cellW);
        group.add(body);
        const top = unitTop(cell, line.status, cellW);
        const bodyTop = bodyHeight(line.unit, cellW);
        top.position.y = bodyTop + 0.004 + raise * (bodyTop + 0.35);
        group.add(top);
        boxGroup.add(group);
    }
    const lidGroup = new THREE.Group();
    lidGroup.position.set(0, BOX_H, -INNER_D / 2 - WALL);
    const lidGeo = new THREE.BoxGeometry(BOX_W + 0.08, 0.07, BOX_D + 0.08);
    const lid = new THREE.Mesh(lidGeo, boxMat);
    lid.position.set(0, 0.035, (BOX_D + 0.08) / 2);
    lidGroup.add(lid);
    const lidEdges = new THREE.LineSegments(new THREE.EdgesGeometry(lidGeo), edgeMaterial);
    lidEdges.position.copy(lid.position);
    lidGroup.add(lidEdges);
    lidGroup.rotation.x = (-spec.lidAngle * Math.PI) / 180;
    boxGroup.add(lidGroup);
    if (spec.stampScale > 0 && (line.status === "sealed" || line.status === "taken_up")) {
        const text = line.status === "sealed" ? "SEALED" : "TAKEN UP";
        const stamp = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.34), new THREE.MeshBasicMaterial({ map: stampTexture(text, "#3E6B47"), transparent: true }));
        stamp.rotation.x = -Math.PI / 2;
        stamp.position.set(0, BOX_H + 0.11, 0.05);
        stamp.scale.setScalar(spec.stampScale);
        boxGroup.add(stamp);
    }
    if (spec.stampScale > 0 && line.status === "dropped") {
        const stamp = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.34), new THREE.MeshBasicMaterial({ map: stampTexture("DROPPED", "#26211A"), transparent: true }));
        stamp.position.set(0, BOX_H * 0.6, INNER_D / 2 + WALL + 0.002);
        stamp.scale.setScalar(spec.stampScale);
        boxGroup.add(stamp);
    }
    const hemi = new THREE.HemisphereLight(0xffffff, 0x888877, 1.15);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(1.5, 3, 2);
    scene.add(dir);
    const camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 20);
    const elevation = (35 * Math.PI) / 180;
    const azimuth = (spec.turn * Math.PI) / 180;
    const distance = 4.1;
    const cy = BOX_H + 0.25;
    camera.position.set(distance * Math.cos(elevation) * Math.sin(azimuth), cy + distance * Math.sin(elevation), distance * Math.cos(elevation) * Math.cos(azimuth));
    camera.lookAt(0, cy - 0.1, 0);
    return { scene, camera };
}
function bodyHeight(unit, cellW) {
    switch (unit) {
        case "jar":
            return cellW * 0.58;
        case "bottle":
            return cellW * 1.16;
        case "jug":
            return cellW * 0.6;
        case "lb":
            return cellW * 0.63;
    }
}
function unitBody(unit, cellW) {
    const group = new THREE.Group();
    switch (unit) {
        case "jar": {
            const body = new THREE.Mesh(new THREE.CylinderGeometry(cellW * 0.34, cellW * 0.34, cellW * 0.5, 14), mat(GLASS));
            body.position.y = cellW * 0.25;
            group.add(body);
            const lid = new THREE.Mesh(new THREE.CylinderGeometry(cellW * 0.35, cellW * 0.35, cellW * 0.1, 14), mat(BOX_FACE_DARK));
            lid.position.y = cellW * 0.53;
            group.add(lid);
            break;
        }
        case "bottle": {
            const body = new THREE.Mesh(new THREE.CylinderGeometry(cellW * 0.2, cellW * 0.22, cellW * 0.85, 12), mat(GLASS));
            body.position.y = cellW * 0.43;
            group.add(body);
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(cellW * 0.08, cellW * 0.12, cellW * 0.25, 12), mat(GLASS));
            neck.position.y = cellW * 0.97;
            group.add(neck);
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(cellW * 0.09, cellW * 0.09, cellW * 0.08, 12), mat(BOX_FACE_DARK));
            cap.position.y = cellW * 1.12;
            group.add(cap);
            break;
        }
        case "jug": {
            const body = new THREE.Mesh(new THREE.CylinderGeometry(cellW * 0.3, cellW * 0.32, cellW * 0.6, 14), mat(GLASS));
            body.position.y = cellW * 0.3;
            group.add(body);
            const handle = new THREE.Mesh(new THREE.TorusGeometry(cellW * 0.2, cellW * 0.05, 8, 14, Math.PI), mat(BOX_FACE_DARK));
            handle.position.set(cellW * 0.3, cellW * 0.42, 0);
            handle.rotation.z = Math.PI / 2;
            group.add(handle);
            break;
        }
        case "lb": {
            const body = new THREE.Mesh(new THREE.BoxGeometry(cellW * 0.72, cellW * 0.55, cellW * 0.62), mat(PAPER));
            body.position.y = cellW * 0.28;
            group.add(body);
            const fold = new THREE.Mesh(new THREE.BoxGeometry(cellW * 0.74, cellW * 0.1, cellW * 0.2), mat(BOX_FACE_DARK));
            fold.position.y = cellW * 0.58;
            group.add(fold);
            break;
        }
    }
    return group;
}
function unitTop(cell, status, cellW) {
    const color = status === "dropped" ? TOP_COLORS.dropped : cell === "mine" ? TOP_COLORS.mine : TOP_COLORS.taken;
    const size = cellW * 0.56;
    const top = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat(color, true));
    top.rotation.x = -Math.PI / 2;
    return top;
}
