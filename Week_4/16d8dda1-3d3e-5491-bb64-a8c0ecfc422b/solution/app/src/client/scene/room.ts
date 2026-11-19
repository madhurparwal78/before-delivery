import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';
import type { SeatPlace, TablePlace } from '../../shared/wire';
import {
  BOARD_CELLS,
  BOARD_CENTER_HEIGHT,
  SLATE,
  WALL_HEIGHT,
  cellCenter,
  cellX,
  frontWallZ,
  type Room,
} from './geometry';
import { Label } from './labels';
import { createFloorTexture, createGlowTexture } from './textures';
import { Transition } from './tween';

const SLIDE_FRAME = { width: 3.2, height: 1.8 };
const WOOD = '#A98862';
const WOOD_DARK = '#8C6C49';

const flat = (color: string): MeshLambertMaterial => new MeshLambertMaterial({ color, flatShading: true });

class SeatNode {
  readonly position: Vector3;
  readonly pool: Mesh<CircleGeometry, MeshBasicMaterial>;
  readonly glow = new Transition(0);
  readonly parts: Mesh[] = [];

  constructor(readonly seatId: string, room: Room, place: SeatPlace, group: Group, glowTexture: Texture) {
    this.position = cellCenter(room, place.column, place.row);
    const pad = new Mesh(new BoxGeometry(0.56, 0.1, 0.56), flat(WOOD));
    pad.position.set(this.position.x, 0.26, this.position.z);
    const back = new Mesh(new BoxGeometry(0.56, 0.3, 0.07), flat(WOOD_DARK));
    back.position.set(this.position.x, 0.46, this.position.z + 0.3);
    this.parts.push(pad, back);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new Mesh(new BoxGeometry(0.07, 0.22, 0.07), flat(WOOD_DARK));
        leg.position.set(this.position.x + sx * 0.23, 0.11, this.position.z + sz * 0.23);
        group.add(leg);
      }
    }
    group.add(pad, back);
    this.pool = new Mesh(
      new CircleGeometry(0.95, 28),
      new MeshBasicMaterial({ map: glowTexture, transparent: true, depthWrite: false, opacity: 0 }),
    );
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.set(this.position.x, 0.015, this.position.z);
    this.pool.visible = false;
    group.add(this.pool);
  }

  applyGlow(): void {
    this.pool.material.opacity = this.glow.value;
    this.pool.visible = this.glow.value > 0.003;
  }
}

class TableNode {
  readonly centre: Vector3;
  readonly label = new Label('table');

  constructor(readonly tableId: string, room: Room, place: TablePlace, group: Group) {
    this.centre = cellCenter(room, place.column, place.row);
    const top = new Mesh(new CylinderGeometry(0.4, 0.4, 0.07, 8), flat(WOOD));
    top.position.set(this.centre.x, 0.58, this.centre.z);
    const stem = new Mesh(new CylinderGeometry(0.1, 0.14, 0.55, 6), flat(WOOD_DARK));
    stem.position.set(this.centre.x, 0.28, this.centre.z);
    group.add(top, stem);
    this.label.setText(tableId);
    this.label.sprite.position.set(this.centre.x, 0.82, this.centre.z);
    group.add(this.label.sprite);
  }
}

/** The board on the front wall: a slate-green slab showing the current slide at the board's strength. */
class BoardNode {
  readonly strength = new Transition(1);
  private readonly slab: Mesh<BoxGeometry, MeshLambertMaterial>;
  private readonly slide: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly slabColor = new Color(SLATE);

  constructor(room: Room, group: Group) {
    const centreX = cellX(room, room.boardColumn) + (BOARD_CELLS - 1) / 2;
    const wallZ = frontWallZ(room);
    this.slab = new Mesh(new BoxGeometry(BOARD_CELLS, 2.35, 0.14), flat(SLATE));
    this.slab.position.set(centreX, BOARD_CENTER_HEIGHT, wallZ + 0.1);
    this.slide = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ toneMapped: false }));
    this.slide.position.set(centreX, BOARD_CENTER_HEIGHT, wallZ + 0.18);
    this.slide.visible = false;
    const tray = new Mesh(new BoxGeometry(BOARD_CELLS - 0.4, 0.07, 0.22), flat(WOOD_DARK));
    tray.position.set(centreX, BOARD_CENTER_HEIGHT - 1.22, wallZ + 0.2);
    group.add(this.slab, this.slide, tray);
  }

  get centreX(): number {
    return this.slab.position.x;
  }

  showSlide(texture: Texture | null, aspect: number): void {
    this.slide.visible = texture !== null;
    if (!texture) return;
    texture.colorSpace = SRGBColorSpace;
    this.slide.material.map = texture;
    this.slide.material.needsUpdate = true;
    const width = Math.min(SLIDE_FRAME.width, SLIDE_FRAME.height * aspect);
    this.slide.scale.set(width, width / aspect, 1);
  }

  applyStrength(): void {
    const strength = this.strength.value;
    this.slide.material.color.setRGB(strength, strength, strength);
    this.slab.material.color.copy(this.slabColor).multiplyScalar(0.55 + 0.45 * strength);
  }
}

/** Where the model on show stands: beside the board, on the side with more floor. */
function plinthPlace(room: Room, boardCentreX: number): Vector3 {
  const boardRight = boardCentreX + BOARD_CELLS / 2;
  const boardLeft = boardCentreX - BOARD_CELLS / 2;
  const roomRight = room.columns / 2;
  const roomLeft = -room.columns / 2;
  const onRight = roomRight - boardRight >= boardLeft - roomLeft;
  const x = onRight ? boardRight + 0.65 : boardLeft - 0.65;
  const limit = room.columns / 2 - 0.5;
  return new Vector3(Math.max(-limit, Math.min(limit, x)), 0, frontWallZ(room) + 0.7);
}

export interface StaticRoom {
  group: Group;
  board: BoardNode;
  seats: Map<string, SeatNode>;
  tables: Map<string, TableNode>;
  plinth: Vector3;
  plinthTop: number;
}

/** Everything that does not move while a session runs: floor, walls, lights, board, tables and seats. */
export function buildRoom(room: Room, seats: SeatPlace[], tables: TablePlace[]): StaticRoom {
  const group = new Group();
  group.add(new HemisphereLight('#FFF6E2', '#D4BD94', 1.45));
  const lamp = new DirectionalLight('#FFE2B0', 1.9);
  lamp.position.set(-room.columns * 0.3, 7, room.rows * 0.4);
  lamp.target.position.set(0, 0, 0);
  group.add(lamp, lamp.target);

  const floor = new Mesh(new PlaneGeometry(room.columns, room.rows), new MeshLambertMaterial({ map: createFloorTexture(room.columns, room.rows) }));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const wallMaterial = new MeshLambertMaterial({ color: '#F7F1E3', emissive: '#7A7260' });
  const wall = new Mesh(new PlaneGeometry(room.columns, WALL_HEIGHT), wallMaterial);
  wall.position.set(0, WALL_HEIGHT / 2, frontWallZ(room));
  group.add(wall);
  const skirting = new Mesh(new BoxGeometry(room.columns, 0.16, 0.06), flat(WOOD_DARK));
  skirting.position.set(0, 0.08, frontWallZ(room) + 0.03);
  group.add(skirting);
  for (const side of [-1, 1]) {
    const partition = new Mesh(
      new PlaneGeometry(room.rows, 1.5),
      new MeshLambertMaterial({ color: '#EFE7D5', transparent: true, opacity: 0.4, depthWrite: false }),
    );
    partition.rotation.y = -side * Math.PI / 2;
    partition.position.set(side * room.columns / 2, 0.75, 0);
    group.add(partition);
  }

  const board = new BoardNode(room, group);
  const glowTexture = createGlowTexture();
  const seatNodes = new Map(seats.map((place) => [place.seatId, new SeatNode(place.seatId, room, place, group, glowTexture)]));
  const tableNodes = new Map(tables.map((place) => [place.tableId, new TableNode(place.tableId, room, place, group)]));

  const plinth = plinthPlace(room, board.centreX);
  const plinthTop = 0.85;
  const column = new Mesh(new CylinderGeometry(0.34, 0.4, plinthTop, 10), flat('#D8CDB6'));
  column.position.set(plinth.x, plinthTop / 2, plinth.z);
  const cap = new Mesh(new CylinderGeometry(0.42, 0.42, 0.06, 10), flat(WOOD_DARK));
  cap.position.set(plinth.x, plinthTop + 0.03, plinth.z);
  group.add(column, cap);
  return { group, board, seats: seatNodes, tables: tableNodes, plinth, plinthTop: plinthTop + 0.06 };
}
