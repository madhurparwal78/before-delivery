import { deriveCounts, type CountedItem } from "../shared/counts";
import { isCrew, type Item, type Member, type Note, type Photo, type Reply, type Role, type Room, type Trade } from "../shared/domain";
import { outlineAnchor, outlineBounds } from "../shared/geometry";
import { lineTotal } from "../shared/money";
import type { JobAccess } from "./access";
import { fieldsOf, visibleNotes, type ItemRecord, type NoteRecord, type PhotoRecord, type RoomRow } from "./records";

// Role projection: each resource gets exactly the keys published for the caller's role.
// Every route and every event that carries a job, item, note, member or photo goes through here.

type Viewer = Pick<JobAccess, "role" | "memberId">;

export function projectPhoto(photo: PhotoRecord): Photo {
  return {
    id: photo.id,
    kind: photo.kind,
    content_type: photo.content_type,
    bytes: photo.bytes,
    url: `/api/jobs/${photo.job_id}/photos/${photo.id}`,
    uploaded_by: { name: photo.uploader_name, role: photo.uploaded_by_role },
    created_at: photo.created_at,
  };
}

function projectReply(note: NoteRecord): Reply {
  return {
    id: note.id,
    body: note.body,
    audience: note.audience,
    author: { name: note.author_name, role: note.author_role },
    rev: note.rev,
    created_at: note.created_at,
  };
}

/** A note as the viewer sees it: a top-level note carries the replies they may see, a reply does not. */
export function projectNote(viewer: Viewer, note: NoteRecord, all: readonly NoteRecord[]): Note | Reply {
  if (note.parent_id !== null) return projectReply(note);
  const replies = visibleNotes(viewer, all.filter((reply) => reply.parent_id === note.id));
  return { ...projectReply(note), replies: replies.map(projectReply) };
}

export function projectItem(viewer: Viewer, item: ItemRecord): Item {
  const crew = isCrew(viewer.role);
  const fields = fieldsOf(item);
  const notes = visibleNotes(viewer, item.notes);
  return {
    id: item.id,
    number: item.number,
    title: fields.title,
    room_id: fields.room_id,
    trade: fields.trade,
    status: item.status,
    pin: fields.pin,
    pin_status: item.pin_status,
    blocked_by: item.blocked_by,
    ...(crew
      ? {
          cost_note: fields.cost_note,
          quantity: fields.quantity,
          unit_cost: fields.unit_cost,
          line_total: lineTotal(fields.quantity, fields.unit_cost),
        }
      : {}),
    ...(viewer.role !== "homeowner" ? { sent_back_reason: item.sent_back_reason } : {}),
    ...(crew
      ? {
          conflicts: item.conflicts.map((conflict) => ({
            field: conflict.field,
            server_value: conflict.server_value,
            server_by: conflict.server_by_name,
            phone_value: conflict.phone_value,
            phone_by: conflict.phone_by_name,
          })),
        }
      : {}),
    created_by: { name: item.creator_name, role: item.created_by_role },
    photos: item.photos.map(projectPhoto),
    notes: notes.filter((note) => note.parent_id === null).map((note) => projectNote(viewer, note, notes) as Note),
    updated_at: item.updated_at,
  };
}

export interface MemberRow {
  id: string;
  person_id: string;
  name: string;
  role: Role;
  trade: Trade | null;
  email: string;
  phone: string | null;
}

/** Trades and homeowners get contact details only for the owner, the lead and themselves. */
export function projectMember(viewer: Viewer, member: MemberRow): Member {
  const brief: Member = { id: member.id, name: member.name, role: member.role, trade: member.trade };
  const full = isCrew(viewer.role) || isCrew(member.role) || member.id === viewer.memberId;
  return full ? { ...brief, email: member.email, phone: member.phone } : brief;
}

/** Rooms with their derived geometry and counts over the items given (the viewer's scope). */
export function projectRooms(rooms: readonly RoomRow[], items: readonly CountedItem[]): Room[] {
  const counts = deriveCounts(items, rooms.map((room) => room.id)).rooms;
  return rooms.map((room) => ({
    id: room.id,
    name: room.name,
    outline: room.outline,
    bounds: outlineBounds(room.outline),
    anchor: outlineAnchor(room.outline),
    counts: counts.get(room.id)!,
  }));
}
