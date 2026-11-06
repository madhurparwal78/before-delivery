import * as THREE from 'three';
import { BOX, VIEW, slotCentre, slotSize, topExtent, unitBodyHeight } from './layout.ts';
import { crateTones, palette, topColours } from './palette.ts';
import { topColourOf, type CrateModel } from './model.ts';
import { fluteTexture, stampTexture } from './textures.ts';

export interface CratePicture {
  model: CrateModel;
  turnDegrees: number;
  /** 0 while a unit is still falling, 1 once it has settled. */
  unitProgress: number[];
  lidProgress: number;
  stampProgress: number;
}

interface UnitParts {
  group: THREE.Group;
  top: THREE.Mesh;
}

export interface GlCrate {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  update: (picture: CratePicture) => void;
  dispose: () => void;
}

function inkEdges(geometry: THREE.BufferGeometry, parent: THREE.Object3D): void {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 25),
    new THREE.LineBasicMaterial({ color: palette.ink }),
  );
  parent.add(edges);
}

function buildUnit(model: CrateModel, bodyMaterial: THREE.Material, topMaterials: Record<string, THREE.Material>): UnitParts {
  const group = new THREE.Group();
  const size = slotSize(model);
  const minSlot = Math.min(size.width, size.depth);
  const height = unitBodyHeight(model.unit);
  const extent = topExtent(model);

  if (model.unit === 'lb') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(size.width * 0.66, height, size.depth * 0.66), bodyMaterial);
    body.position.y = height / 2;
    group.add(body);
    inkEdges(body.geometry, body);
  } else {
    const radius = model.unit === 'bottle' ? minSlot * 0.22 : minSlot * 0.33;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.04, height, 14), bodyMaterial);
    body.position.y = height / 2;
    group.add(body);
    if (model.unit === 'bottle') {
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.45, radius * 0.5, height * 0.22, 10), bodyMaterial);
      neck.position.y = height + height * 0.1;
      group.add(neck);
    }
    if (model.unit === 'jug') {
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.52, radius * 0.14, 6, 12, Math.PI * 1.2),
        bodyMaterial,
      );
      handle.position.set(radius * 0.95, height * 0.62, 0);
      handle.rotation.y = Math.PI / 2;
      group.add(handle);
    }
  }

  const topY = model.unit === 'bottle' ? height * 1.24 : height + 0.004;
  let top: THREE.Mesh;
  if (model.unit === 'lb') {
    top = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent * (size.depth / size.width)), topMaterials.taken!);
  } else {
    const topRadius = model.unit === 'bottle' ? minSlot * 0.26 : extent / 2;
    top = new THREE.Mesh(new THREE.CircleGeometry(topRadius, 18), topMaterials.taken!);
  }
  top.rotation.x = -Math.PI / 2;
  top.position.y = topY;
  group.add(top);
  return { group, top };
}

export function buildGlCrate(model: CrateModel): GlCrate {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(
    (-VIEW.frustumHeight * VIEW.aspect) / 2,
    (VIEW.frustumHeight * VIEW.aspect) / 2,
    VIEW.frustumHeight / 2,
    -VIEW.frustumHeight / 2,
    0.1,
    20,
  );
  camera.position.set(0, Math.sin(VIEW.elevation) * VIEW.distance, Math.cos(VIEW.elevation) * VIEW.distance);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xfff4e0, 0.75);
  key.position.set(-1.2, 2.4, 1.6);
  scene.add(key);

  const turnGroup = new THREE.Group();
  scene.add(turnGroup);

  const sideTexture = fluteTexture(false);
  const frontTexture = fluteTexture(true);
  const sideMaterial = new THREE.MeshLambertMaterial({ map: sideTexture, color: 0xffffff });
  const frontMaterial = new THREE.MeshLambertMaterial({ map: frontTexture, color: 0xffffff });
  const insideMaterial = new THREE.MeshLambertMaterial({ color: crateTones.inside, side: THREE.DoubleSide });

  const inner = BOX.width - 2 * BOX.wall;
  const innerDepth = BOX.depth - 2 * BOX.wall;

  const floor = new THREE.Mesh(new THREE.BoxGeometry(BOX.width, BOX.wall, BOX.depth), insideMaterial);
  floor.position.y = BOX.wall / 2;
  turnGroup.add(floor);
  inkEdges(floor.geometry, floor);

  const makeWall = (width: number, depth: number, x: number, z: number, material: THREE.Material): void => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, BOX.height, depth), material);
    wall.position.set(x, BOX.height / 2, z);
    turnGroup.add(wall);
    inkEdges(wall.geometry, wall);
    const lining = new THREE.Mesh(new THREE.PlaneGeometry(width === BOX.wall ? depth : width, BOX.height), insideMaterial);
    if (width === BOX.wall) {
      lining.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      lining.position.set(x + (x < 0 ? BOX.wall / 2 : -BOX.wall / 2) + (x < 0 ? 0.001 : -0.001), BOX.height / 2, z);
    } else {
      lining.rotation.y = z < 0 ? 0 : Math.PI;
      lining.position.set(x, BOX.height / 2, z + (z < 0 ? BOX.wall / 2 + 0.001 : -BOX.wall / 2 - 0.001));
    }
    turnGroup.add(lining);
  };
  makeWall(BOX.width, BOX.wall, 0, -BOX.depth / 2 + BOX.wall / 2, sideMaterial);
  makeWall(BOX.width, BOX.wall, 0, BOX.depth / 2 - BOX.wall / 2, frontMaterial);
  makeWall(BOX.wall, BOX.depth, -BOX.width / 2 + BOX.wall / 2, 0, sideMaterial);
  makeWall(BOX.wall, BOX.depth, BOX.width / 2 - BOX.wall / 2, 0, sideMaterial);

  const slotMaterial = new THREE.LineBasicMaterial({ color: crateTones.slot });
  const size = slotSize(model);
  const slotLines = new THREE.Group();
  for (let column = 1; column < model.columns; column += 1) {
    const x = -inner / 2 + column * size.width;
    slotLines.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x, BOX.wall + 0.002, -innerDepth / 2),
          new THREE.Vector3(x, BOX.wall + 0.002, innerDepth / 2),
        ]),
        slotMaterial,
      ),
    );
  }
  for (let row = 1; row < model.rows; row += 1) {
    const z = -innerDepth / 2 + row * size.depth;
    slotLines.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-inner / 2, BOX.wall + 0.002, z),
          new THREE.Vector3(inner / 2, BOX.wall + 0.002, z),
        ]),
        slotMaterial,
      ),
    );
  }
  turnGroup.add(slotLines);

  const bodyTone =
    model.unit === 'lb' ? crateTones.sack : model.unit === 'jug' ? crateTones.paper : crateTones.glass;
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: bodyTone });
  const topMaterials: Record<string, THREE.Material> = {
    mine: new THREE.MeshBasicMaterial({ color: topColours.mine }),
    taken: new THREE.MeshBasicMaterial({ color: topColours.taken }),
    dropped: new THREE.MeshBasicMaterial({ color: topColours.dropped }),
  };

  const units: UnitParts[] = [];
  for (let index = 0; index < model.pack; index += 1) {
    const unit = buildUnit(model, bodyMaterial, topMaterials);
    const centre = slotCentre(model, index);
    unit.group.position.set(centre.x, BOX.wall, centre.z);
    turnGroup.add(unit.group);
    units.push(unit);
  }

  const lidHinge = new THREE.Group();
  lidHinge.position.set(0, BOX.height, -BOX.depth / 2);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(BOX.width, BOX.wall, BOX.depth), frontMaterial);
  lid.position.set(0, BOX.wall / 2, BOX.depth / 2);
  lidHinge.add(lid);
  inkEdges(lid.geometry, lid);
  turnGroup.add(lidHinge);

  const lidStampMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  const lidStamp = new THREE.Mesh(new THREE.PlaneGeometry(BOX.width * 0.72, BOX.width * 0.36), lidStampMaterial);
  lidStamp.rotation.x = -Math.PI / 2;
  lidStamp.position.set(0, BOX.wall + 0.004, BOX.depth / 2);
  lidHinge.add(lidStamp);

  const frontStampMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    map: stampTexture('DROPPED', 'ink'),
  });
  const frontStamp = new THREE.Mesh(new THREE.PlaneGeometry(BOX.width * 0.7, BOX.height * 0.7), frontStampMaterial);
  frontStamp.position.set(0, BOX.height * 0.5, BOX.depth / 2 + 0.004);
  turnGroup.add(frontStamp);

  let stampText: string | null = null;

  const update = (picture: CratePicture): void => {
    const current = picture.model;
    turnGroup.rotation.y = (picture.turnDegrees * Math.PI) / 180;
    const dropHeight = 0.55;
    units.forEach((unit, index) => {
      const cell = current.cells[index] ?? 'empty';
      const colour = topColourOf(cell, current.dropped);
      const progress = picture.unitProgress[index] ?? (colour === null ? 0 : 1);
      unit.group.visible = colour !== null && progress > 0;
      if (colour !== null) {
        unit.top.material = topMaterials[colour]!;
        unit.group.position.y = BOX.wall + (1 - Math.min(1, Math.max(0, progress))) * dropHeight;
      }
    });

    lidHinge.visible = picture.lidProgress > 0;
    const openAngle = -1.85;
    lidHinge.rotation.x = openAngle * (1 - picture.lidProgress);

    const wantedStamp = current.stamp === 'DROPPED' ? null : current.stamp;
    if (wantedStamp !== stampText) {
      stampText = wantedStamp;
      const existing = lidStampMaterial.map;
      lidStampMaterial.map = wantedStamp === null ? null : stampTexture(wantedStamp, 'green');
      lidStampMaterial.needsUpdate = true;
      existing?.dispose();
    }
    const press = Math.min(1, Math.max(0, picture.stampProgress));
    lidStamp.visible = wantedStamp !== null && press > 0;
    lidStampMaterial.opacity = press;
    const scale = 1 + (1 - press) * 0.45;
    lidStamp.scale.set(scale, scale, 1);
    frontStamp.visible = current.stamp === 'DROPPED';
  };

  const dispose = (): void => {
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
    });
    [sideMaterial, frontMaterial, insideMaterial, bodyMaterial, lidStampMaterial, frontStampMaterial].forEach(
      (material) => material.dispose(),
    );
    Object.values(topMaterials).forEach((material) => material.dispose());
    sideTexture.dispose();
    frontTexture.dispose();
  };

  return { scene, camera, update, dispose };
}
