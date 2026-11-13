// table "Files" (List) and list "Files" (Grid): the same rows, sorted by the API.
import { ChevronDown, ChevronUp, EllipsisVertical, FileText, Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FolderItem } from '../../../shared/types.ts';
import { Link } from '../../router.tsx';
import { COLUMNS, isSample, itemHref, type Column, type Sort } from './model.ts';

interface RowActionProps {
  onMore: (item: FolderItem, anchor: HTMLElement, expanded: boolean) => void;
  openMenuId: string | null;
}

function MoreButton({ item, onMore, openMenuId }: RowActionProps & { item: FolderItem }) {
  if (isSample(item)) return null;
  const expanded = openMenuId === item.id;
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      aria-label={`More actions for ${item.name}`}
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={(event) => onMore(item, event.currentTarget, expanded)}
    >
      <EllipsisVertical aria-hidden="true" size={18} />
    </button>
  );
}

const kindLabel = (item: FolderItem): string => (item.kind === 'folder' ? 'Folder' : 'Drawing');
const KindIcon = ({ item }: { item: FolderItem }) => (item.kind === 'folder' ? <Folder aria-hidden="true" size={20} /> : <FileText aria-hidden="true" size={20} />);

interface TableProps extends RowActionProps {
  items: FolderItem[];
  sort: Sort;
  /** Recent keeps the server's order, so its headers are not sort buttons. */
  sortable: boolean;
  onSort: (column: Column) => void;
  newFolder: ReactNode;
}

export function FileTable({ items, sort, sortable, onSort, newFolder, onMore, openMenuId }: TableProps) {
  const ariaSort = (column: Column): 'ascending' | 'descending' | 'none' =>
    sortable && sort.key === column.key ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <table aria-label="Files" className="files-table">
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th key={column.key} scope="col" className={`col-${column.key}`} aria-sort={ariaSort(column)}>
              {sortable ? (
                <button type="button" className="sort-button" onClick={() => onSort(column)}>
                  {column.label}
                  {sort.key === column.key ? (sort.order === 'asc' ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />) : null}
                </button>
              ) : column.label}
            </th>
          ))}
          <th scope="col" className="col-actions"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {newFolder ? (
          <tr className="row-new">
            <td className="col-type"><Folder aria-hidden="true" size={20} /></td>
            <td colSpan={COLUMNS.length}>{newFolder}</td>
          </tr>
        ) : null}
        {items.map((item) => (
          <tr key={item.id}>
            <td className="col-type"><KindIcon item={item} /><span className="sr-only">{kindLabel(item)}</span></td>
            <td className="col-name"><Link to={itemHref(item)}>{item.name}</Link></td>
            <td className="col-modified">{item.modified_label}</td>
            <td className="col-size">{item.size_label}</td>
            <td className="col-owner">{item.owner}</td>
            <td className="col-shared">{item.shared}</td>
            <td className="col-actions"><MoreButton item={item} onMore={onMore} openMenuId={openMenuId} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface GridProps extends RowActionProps {
  items: FolderItem[];
  newFolder: ReactNode;
}

export function FileGrid({ items, newFolder, onMore, openMenuId }: GridProps) {
  return (
    <ul aria-label="Files" className="file-grid">
      {newFolder ? <li className="file-card"><div className="card-art"><Folder aria-hidden="true" size={40} /></div>{newFolder}</li> : null}
      {items.map((item) => (
        <li key={item.id} className="file-card">
          <div className="card-art"><KindIcon item={item} /></div>
          <div className="card-body">
            <Link to={itemHref(item)}>{item.name}</Link>
            <span className="muted">{item.modified_label}</span>
            <span className="muted">{item.kind === 'folder' ? kindLabel(item) : item.size_label} · {item.owner}{item.shared === 'Shared' ? ` · ${item.shared}` : ''}</span>
          </div>
          <MoreButton item={item} onMore={onMore} openMenuId={openMenuId} />
        </li>
      ))}
    </ul>
  );
}
