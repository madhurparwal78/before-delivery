import { Download } from '../../ui/icons';
import type { Pack } from '../../../shared/types';
import type { Length, Units } from '../../../shared/units';
import { PackTable, type Column } from './PackTable';

type PackRoom = Pack['room'];
type PackPlacement = Pack['placements'][number];
type PackNode = Pack['nodes'][number];
type PackProp = Pack['props'][number];

const NONE = '—';

/** A length column whose header names the unit and whose cells are the pack's own string for it. */
function lengthColumn<Row>(header: string, units: Units, pick: (row: Row) => Length): Column<Row> {
  return { header: `${header} (${units})`, render: (row) => pick(row)[units], numeric: true };
}

const wiringColumns: Column<PackNode>[] = [
  { header: 'Title', render: (node) => node.title },
  { header: 'Kind', render: (node) => node.kind },
  { header: 'Needs', render: (node) => node.needs.join(', ') || NONE },
  { header: 'Linked placement', render: (node) => node.linkedPlacement ?? NONE },
  { header: 'Answer', render: (node) => node.answer ?? NONE },
];

const fileColumns: Column<PackProp>[] = [
  { header: 'Prop name', render: (prop) => prop.name },
  { header: 'Bytes', render: (prop) => prop.bytes, numeric: true },
  { header: 'SHA-256', render: (prop) => prop.sha256, className: 'hash' },
  {
    header: 'Download',
    render: (prop) => (
      <a className="download-link" href={prop.downloadPath} download aria-label={`Download ${prop.name}`}>
        <Download size={14} aria-hidden="true" />
        Download
      </a>
    ),
  },
];

/** The four tables of a build pack, its lengths in the chosen units. */
export function PackTables({ pack, units }: { pack: Pack; units: Units }) {
  const roomColumns: Column<PackRoom>[] = [
    lengthColumn('Width', units, (room) => room.width),
    lengthColumn('Depth', units, (room) => room.depth),
    lengthColumn('Height', units, (room) => room.height),
  ];
  const placementColumns: Column<PackPlacement>[] = [
    { header: 'Label', render: (placement) => placement.label },
    { header: 'Kind', render: (placement) => placement.kind },
    lengthColumn('X', units, (placement) => placement.x),
    lengthColumn('Y', units, (placement) => placement.y),
    lengthColumn('Z', units, (placement) => placement.z),
    lengthColumn('Width', units, (placement) => placement.width),
    lengthColumn('Depth', units, (placement) => placement.depth),
    lengthColumn('Height', units, (placement) => placement.height),
    { header: 'Rotation', render: (placement) => `${placement.rotationDeg}°`, numeric: true },
  ];

  return (
    <>
      <PackTable title="Room" rows={[pack.room]} columns={roomColumns} />
      <PackTable title="Placements" rows={pack.placements} columns={placementColumns} />
      <PackTable title="Trigger wiring" rows={pack.nodes} columns={wiringColumns} />
      <PackTable title="Files" rows={pack.props} columns={fileColumns} />
    </>
  );
}
