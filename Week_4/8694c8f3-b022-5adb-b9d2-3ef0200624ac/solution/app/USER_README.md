# Afterglass

Afterglass is a browser studio where one independent VJ builds a real-time 3D shader set: a layer tree with transform gizmos,
GLSL layers, a node graph, a beat-locked timeline, sandboxed scripts and uploaded GLB models and textures. The owner can invite a
guest VJ to co-edit live, publish an immutable show version that a venue computer plays from a show link, and roll the show back
in one action.

## Run

`run.json` holds the three commands:

```
npm ci          # install from the lockfile
npm run build   # builds the frontend (dist/web) and the server (dist/server/main.mjs)
npm run start   # serves on 0.0.0.0, port APP_PUBLIC_PORT (default 4173)
```

Node 22 and npm are required. The app talks to three services and keeps no other state.

## Environment

| Variable | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | accounts, sets, layers, keys, graph, scripts, op log, shader versions, show versions, activity |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3 API) | uploaded models and textures, frozen show bundles, export zips, imported uploads |
| `VALKEY_URL` | Valkey | layer lock leases, presence, fan-out of committed ops |
| `APP_PUBLIC_PORT` | none | port to listen on, default 4173 |

None of these values is sent to the browser or written to a log line. If MinIO or Valkey is unreachable the app still starts,
reports the dependency in `GET /api/status`, and recovers by itself when it answers again. If PostgreSQL is unreachable the app
retries every two seconds and `GET /api/health` answers 503 until it connects.

## Using it

- `/` is the public demo ('Low Tide Tunnel') with the sign-in dialog over it. Create an account to get a workspace.
- New set > Blank stage gives a starting layer tree. Everything you do is a committed op; the Autosave region shows its state.
- Shows tile: Publish show, Make version live, Roll back, the show link and Members (invite links).
- `/show/<token>` plays the live version full-window; the Show info button (or the I key) shows its version and sha256.
- Set menu: Import set and Export set move a whole set between machines as a zip.
