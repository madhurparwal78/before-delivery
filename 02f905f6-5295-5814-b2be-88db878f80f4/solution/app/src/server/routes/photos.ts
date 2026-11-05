// Photo upload (attached only once storage confirms it) and download (the exact stored bytes).
import { createHash, randomUUID } from "node:crypto";
import type { PhotoUpload } from "../../shared/api";
import { isStaff } from "../auth";
import { pool } from "../db";
import { HttpError, invalidFields, notFound, type Route } from "../http";
import { getPhoto, putPhoto, StorageUnavailable } from "../storage";

const storageDown = (message: string) => new HttpError(503, "storage_unavailable", message);

interface PhotoRow {
  id: string;
  uploader_id: number;
  content_type: string;
  bytes: number;
}

export const photoRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/photos",
    auth: true,
    body: "multipart",
    handler: async (ctx) => {
      const photo = ctx.files.photo;
      if (!photo) throw invalidFields({ photo: "Add a photo of the piece" });
      const id = randomUUID();
      try {
        await putPhoto(id, photo.data, photo.contentType);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw storageDown("Photo not saved — storage is unreachable. Try again in a minute.");
        throw error;
      }
      const sha256 = createHash("sha256").update(photo.data).digest("hex");
      await pool.query(
        "INSERT INTO photos (id, uploader_id, content_type, bytes, sha256, created_at) VALUES ($1, $2, $3, $4, $5, now())",
        [id, ctx.user.id, photo.contentType, photo.data.length, sha256],
      );
      const body: PhotoUpload = { photo_id: id, content_type: photo.contentType, bytes: photo.data.length, sha256 };
      return { status: 201, body };
    },
  },
  {
    method: "GET",
    path: "/api/photos/:photo_id",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      const user = ctx.user;
      const found = await pool.query<PhotoRow>(
        `SELECT ph.* FROM photos ph WHERE ph.id = $1 AND ($2 OR ph.uploader_id = $3
           OR EXISTS (SELECT 1 FROM pieces p WHERE p.intake_photo_id = ph.id AND p.member_id = $3)
           OR EXISTS (SELECT 1 FROM damage_reports d JOIN pieces p ON p.number = d.piece_number
                       WHERE d.unload_photo_id = ph.id AND p.member_id = $3))`,
        [ctx.params.photo_id, isStaff(user), user.id],
      );
      const row = found.rows[0];
      if (!row) throw notFound();
      let data: Buffer | null;
      try {
        data = await getPhoto(row.id);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw storageDown("Photo unavailable while storage is down.");
        throw error;
      }
      if (!data) throw notFound();
      return { status: 200, bytes: { data, contentType: row.content_type } };
    },
  },
];
