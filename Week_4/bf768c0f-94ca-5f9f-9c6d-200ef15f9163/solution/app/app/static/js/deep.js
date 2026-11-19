// The deep board: the same position in perspective, drawn by the browser's hardware graphics.
import * as THREE from '/static/vendor/three.module.js';
import { reducedMotion } from './app.js';
import { FILES, isLight } from './board.js';

const SQUARE = 1;
const PIECE_SETS = {
  Marble: {
    light: { color: 0xf2ece0, roughness: 0.22, metalness: 0.04 },
    dark: { color: 0x2f2a26, roughness: 0.24, metalness: 0.05 },
  },
  Wood: {
    light: { color: 0xd9a05a, roughness: 0.62, metalness: 0.02 },
    dark: { color: 0x8a5a2b, roughness: 0.66, metalness: 0.02 },
  },
  Glass: {
    light: { color: 0xdfeef2, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.55 },
    dark: { color: 0x2b4450, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.62 },
  },
};

function cssColour(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(value || fallback);
}

function lathe(profile, segments = 28) {
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

function knightShape() {
  const shape = new THREE.Shape();
  // A horse head in profile, muzzle to +x: chest, jaw, muzzle, brow, two ears, then the mane.
  const pts = [
    [-0.28, 0.00], [0.28, 0.00], [0.26, 0.20], [0.16, 0.36], [0.30, 0.44], [0.44, 0.50],
    [0.47, 0.58], [0.42, 0.65], [0.26, 0.71], [0.15, 0.80], [0.13, 0.98], [0.05, 0.86],
    [-0.01, 0.99], [-0.07, 0.84], [-0.17, 0.78], [-0.25, 0.62], [-0.30, 0.40], [-0.30, 0.18],
  ];
  shape.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(([x, y]) => shape.lineTo(x, y));
  shape.closePath();
  return shape;
}

function buildPiece(kind, material, darkMaterial) {
  const group = new THREE.Group();
  const add = (geometry, mat = material, y = 0) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.y += y;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  };

  if (kind === 'P') {
    add(lathe([[0, 0], [0.30, 0], [0.30, 0.06], [0.20, 0.10], [0.14, 0.30], [0.19, 0.36], [0.10, 0.40], [0, 0.40]]));
    add(new THREE.SphereGeometry(0.17, 20, 16), material, 0.52);
  } else if (kind === 'R') {
    add(lathe([[0, 0], [0.33, 0], [0.33, 0.07], [0.24, 0.12], [0.22, 0.46], [0.29, 0.52], [0.29, 0.62], [0, 0.62]]));
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const battlement = add(new THREE.BoxGeometry(0.13, 0.17, 0.13), material, 0.70);
      battlement.position.x = Math.cos(angle) * 0.22;
      battlement.position.z = Math.sin(angle) * 0.22;
      battlement.rotation.y = -angle;
    }
  } else if (kind === 'N') {
    // The profile lies across the board, so both players see the head side-on.
    const geometry = new THREE.ExtrudeGeometry(knightShape(), {
      depth: 0.28, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2,
    });
    geometry.translate(0, 0, -0.14);
    const head = add(geometry);
    head.position.y = 0.10;
    add(lathe([[0, 0], [0.32, 0], [0.32, 0.06], [0.24, 0.1], [0.22, 0.14], [0, 0.14]]));
    for (const side of [-1, 1]) {
      const eye = add(new THREE.SphereGeometry(0.045, 12, 10), darkMaterial, 0.80);
      eye.position.set(0.17, 0.80, side * 0.17);
    }
    const nostril = add(new THREE.SphereGeometry(0.03, 10, 8), darkMaterial, 0.66);
    nostril.position.set(0.44, 0.66, 0);
  } else if (kind === 'B') {
    add(lathe([[0, 0], [0.32, 0], [0.32, 0.07], [0.22, 0.12], [0.16, 0.34], [0.23, 0.40], [0.16, 0.46],
      [0.19, 0.58], [0.12, 0.74], [0.05, 0.82], [0, 0.84]]));
    const slit = add(new THREE.BoxGeometry(0.05, 0.22, 0.30), material, 0.62);
    slit.rotation.z = 0.25;
    add(new THREE.SphereGeometry(0.075, 14, 12), material, 0.90);
  } else if (kind === 'Q') {
    add(lathe([[0, 0], [0.36, 0], [0.36, 0.07], [0.25, 0.13], [0.17, 0.45], [0.24, 0.56], [0.30, 0.66], [0, 0.66]]));
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const point = add(new THREE.ConeGeometry(0.06, 0.20, 10), material, 0.78);
      point.position.x = Math.cos(angle) * 0.24;
      point.position.z = Math.sin(angle) * 0.24;
    }
    add(new THREE.SphereGeometry(0.09, 16, 14), material, 0.86);
  } else if (kind === 'K') {
    add(lathe([[0, 0], [0.37, 0], [0.37, 0.08], [0.26, 0.14], [0.18, 0.5], [0.26, 0.62], [0.30, 0.74], [0, 0.74]]));
    add(new THREE.BoxGeometry(0.10, 0.34, 0.10), material, 1.00);
    add(new THREE.BoxGeometry(0.26, 0.10, 0.10), material, 0.98);
  }
  group.traverse((child) => { child.castShadow = true; });
  return group;
}

export function createDeepView(container, { orientation, onSquare }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120f0d);

  let dirty = true;
  const touch = () => { dirty = true; };
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const spherical = { radius: 15.2, theta: orientation === 'white' ? 0 : Math.PI, phi: 0.82 };

  function placeCamera() {
    const { radius, theta, phi } = spherical;
    camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta) * (orientation === 'white' ? 1 : 1),
    );
    camera.lookAt(0, 0, 0);
    dirty = true;
  }
  placeCamera();

  scene.add(new THREE.HemisphereLight(0xfff0dd, 0x241a12, 0.75));
  const key = new THREE.DirectionalLight(0xfff2e0, 1.5);
  key.position.set(5, 11, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  key.shadow.camera.far = 30;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffd9a8, 0.35);
  fill.position.set(-6, 5, -5);
  scene.add(fill);

  const boardGroup = new THREE.Group();
  scene.add(boardGroup);
  const squareMeshes = {};
  const markerMeshes = [];

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x2a211a, roughness: 0.7 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.32, 9.2), frameMaterial);
  frame.position.y = -0.28;
  frame.receiveShadow = true;
  boardGroup.add(frame);

  function squareCentre(square) {
    const file = FILES.indexOf(square[0]);
    const rank = Number(square[1]);
    return { x: (file - 3.5) * SQUARE, z: (3.5 - (rank - 1)) * SQUARE };
  }

  function buildSquares() {
    const light = cssColour('--sq-light', '#ecf0e5');
    const dark = cssColour('--sq-dark', '#26442a');
    for (let file = 0; file < 8; file += 1) {
      for (let rank = 1; rank <= 8; rank += 1) {
        const name = `${FILES[file]}${rank}`;
        let mesh = squareMeshes[name];
        if (!mesh) {
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(SQUARE, 0.14, SQUARE),
            new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.02 }),
          );
          const { x, z } = squareCentre(name);
          mesh.position.set(x, -0.07, z);
          mesh.receiveShadow = true;
          mesh.userData.square = name;
          boardGroup.add(mesh);
          squareMeshes[name] = mesh;
        }
        mesh.material.color.copy(isLight(name) ? light : dark);
        mesh.material.emissive = new THREE.Color(0x000000);
      }
    }
  }
  buildSquares();

  let setName = document.documentElement.dataset.set3d || 'Marble';
  let materials = null;

  function buildMaterials() {
    const spec = PIECE_SETS[setName] || PIECE_SETS.Marble;
    materials = {
      w: new THREE.MeshStandardMaterial({ ...spec.light }),
      b: new THREE.MeshStandardMaterial({ ...spec.dark }),
      edge: new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.4 }),
    };
  }
  buildMaterials();

  const pieceGroup = new THREE.Group();
  scene.add(pieceGroup);
  let pieceMeshes = {};

  function clearPieces() {
    pieceGroup.clear();
    pieceMeshes = {};
  }

  function drawPieces(pieces) {
    clearPieces();
    Object.entries(pieces).forEach(([square, code]) => {
      const colour = code[0];
      const group = buildPiece(code[1], materials[colour], materials.edge);
      const { x, z } = squareCentre(square);
      group.position.set(x, 0, z);
      group.rotation.y = colour === 'w' ? 0 : Math.PI;
      group.userData.square = square;
      group.traverse((child) => { child.userData.square = square; });
      pieceGroup.add(group);
      pieceMeshes[square] = group;
    });
  }

  function clearMarkers() {
    markerMeshes.splice(0).forEach((mesh) => { mesh.parent?.remove(mesh); mesh.geometry.dispose(); });
  }

  function drawMarkers(state) {
    clearMarkers();
    Object.values(squareMeshes).forEach((mesh) => mesh.material.emissive.setHex(0x000000));
    if (state.lastMove) {
      [state.lastMove.slice(0, 2), state.lastMove.slice(2, 4)].forEach((name) => {
        squareMeshes[name]?.material.emissive.setHex(0x4a3418);
      });
    }
    if (state.check && squareMeshes[state.check]) {
      squareMeshes[state.check].material.emissive.setHex(0x5e1a12);
    }
    if (state.selected && squareMeshes[state.selected]) {
      squareMeshes[state.selected].material.emissive.setHex(0x55501a);
    }
    if (state.legal) {
      state.legal.forEach((name) => {
        const marker = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.16, 0.04, 20),
          new THREE.MeshStandardMaterial({ color: 0x3fb8b8, transparent: true, opacity: 0.8 }),
        );
        const { x, z } = squareCentre(name);
        marker.position.set(x, 0.05, z);
        boardGroup.add(marker);
        markerMeshes.push(marker);
      });
    }
  }

  let last = { pieces: {} };

  function render(state) {
    last = state;
    touch();
    buildSquares();
    drawPieces(state.pieces);
    drawMarkers(state);
    if (state.toppleKing) {
      const king = pieceMeshes[state.toppleKing];
      if (king) { king.rotation.z = 1.25; king.position.y = 0.2; }
    }
  }

  async function animateMove(from, to, { knight = false, capture = false } = {}) {
    const mover = pieceMeshes[from];
    if (!mover) return;
    const start = squareCentre(from);
    const end = squareCentre(to);
    const duration = reducedMotion() ? 1 : 320;
    const taken = capture ? pieceMeshes[to] : null;
    const began = performance.now();
    await new Promise((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - began) / duration);
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        mover.position.x = start.x + (end.x - start.x) * ease;
        mover.position.z = start.z + (end.z - start.z) * ease;
        mover.position.y = knight ? Math.sin(Math.PI * ease) * 0.9 : Math.sin(Math.PI * ease) * 0.12;
        if (taken) {
          taken.scale.setScalar(Math.max(0.01, 1 - ease));
          taken.position.y = ease * 0.6;
        }
        touch();
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      step();
    });
    mover.position.y = 0;
    if (taken) taken.visible = false;
    touch();
  }

  /* ---------------------------------------------------------- interaction */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragging = false;
  let moved = false;
  let lastPointer = { x: 0, y: 0 };

  renderer.domElement.addEventListener('pointerdown', (event) => {
    dragging = true;
    moved = false;
    lastPointer = { x: event.clientX, y: event.clientY };
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    spherical.theta -= dx * 0.008;
    spherical.phi = Math.min(1.45, Math.max(0.18, spherical.phi - dy * 0.006));
    lastPointer = { x: event.clientX, y: event.clientY };
    placeCamera();
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    dragging = false;
    try { renderer.domElement.releasePointerCapture(event.pointerId); } catch { /* fine */ }
    if (moved) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([pieceGroup, boardGroup], true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && !node.userData.square) node = node.parent;
      if (node && node.userData.square) { onSquare(node.userData.square); return; }
    }
  });
  renderer.domElement.addEventListener('wheel', (event) => {
    event.preventDefault();
    spherical.radius = Math.min(24, Math.max(6.5, spherical.radius + event.deltaY * 0.012));
    placeCamera();
  }, { passive: false });

  let pinchStart = null;
  renderer.domElement.addEventListener('touchstart', (event) => {
    if (event.touches.length === 2) {
      pinchStart = { distance: touchDistance(event), radius: spherical.radius };
    }
  }, { passive: true });
  renderer.domElement.addEventListener('touchmove', (event) => {
    if (event.touches.length === 2 && pinchStart) {
      const scale = pinchStart.distance / touchDistance(event);
      spherical.radius = Math.min(24, Math.max(6.5, pinchStart.radius * scale));
      placeCamera();
    }
  }, { passive: true });
  function touchDistance(event) {
    const [a, b] = event.touches;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
  }

  function resize() {
    const width = container.clientWidth || 480;
    const height = container.clientHeight || width;
    renderer.setSize(width, height, false);
    dirty = true;
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  let running = true;
  function loop() {
    if (!running) return;
    if (dirty) { dirty = false; renderer.render(scene, camera); }
    requestAnimationFrame(loop);
  }
  loop();

  return {
    render,
    animateMove,
    resize,
    setPieceSet(name) {
      setName = name;
      buildMaterials();
      render(last);
    },
    refreshTheme() { buildSquares(); drawMarkers(last); },
    setOrientation(side) {
      spherical.theta = side === 'white' ? 0 : Math.PI;
      placeCamera();
    },
    dispose() { running = false; observer.disconnect(); renderer.dispose(); },
  };
}
