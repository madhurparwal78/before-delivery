// API smoke test against a running server with GRADING_ROUTES=on.

const BASE = "http://localhost:4173";
let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) { failures++; console.error(`FAIL ${name}`, detail ?? ""); } else console.log(`ok   ${name}`);
}

async function api(method: string, path: string, body?: unknown, cookie?: string, headers?: Record<string, string>): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(headers ?? {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    redirect: "manual"
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  const headerMap: Record<string, string> = {};
  for (const [k, v] of (res.headers as unknown as Iterable<[string, string]>)) headerMap[k.toLowerCase()] = v;
  return { status: res.status, body: parsed, headers: headerMap };
}

const cookieJar = new Map<string, string>();
function cookieOf(res: { headers: Record<string, string> }): string {
  const raw = res.headers["set-cookie"] ?? "";
  const m = /hushfoot_session=([^;]+)/.exec(String(raw));
  if (m) {
    const value = `hushfoot_session=${m[1]}`;
    cookieJar.set("latest", value);
    return value;
  }
  return cookieJar.get("latest") ?? "";
}

async function main() {
  // health
  const health = await api("GET", "/api/health");
  check("health 200 ok", health.status === 200 && health.body.status === "ok", health.body);

  // grading world
  const world = await api("POST", "/api/grading/world", {});
  check("grading world 201", world.status === 201, world.body);
  const w = world.body;
  const explorerEmail: string = w.explorer.email;
  const friendEmail: string = w.friend.email;
  const rivalEmail: string = w.rival.email;
  const rangerEmail: string = w.ranger.email;

  // sign in explorer
  const signin = await api("POST", "/api/session", { email: explorerEmail, password: "Harbour-Explorer-1" });
  check("signin 200", signin.status === 200, signin.body);
  const explorerCookie = cookieOf(signin);
  check("signin sets cookie", explorerCookie.length > 0);

  // me
    const me = await api("GET", "/api/me", undefined, explorerCookie);
  check("me film 30", me.body.film === 30, me.body);
  check("me stamps 2", me.body.stamps === 2, me.body);
  check("me position 3,12 E", JSON.stringify(me.body.position.tile) === "[3,12]" && me.body.position.heading === "E", me.body.position);
  check("me lighthouse closed", me.body.lighthouse === "closed");

  // albums
  const albums = await api("GET", "/api/me/albums", undefined, explorerCookie);
  const saltmarsh = albums.body.albums[0];
  check("saltmarsh 3 of 4", saltmarsh.pages_filled === 3, saltmarsh);
  check("newt page empty", saltmarsh.pages.find((p: any) => p.creature === "mossback-newt").filled === false);
  check("albums stamps 2", albums.body.stamps === 2);

  // world
  const worldGet = await api("GET", "/api/world", undefined, explorerCookie);
  check("world tick 6000", worldGet.body.tick === 6000, worldGet.body.tick);
  check("world time 10:00", worldGet.body.time === "10:00", worldGet.body.time);
  const creatures6000 = worldGet.body.creatures.filter((c: any) => c.island === 1).map((c: any) => `${c.id}@${c.x},${c.y},${c.heading}`).join(";");
  check("DP-30 creatures", creatures6000 === "mossback-newt@12,6,S;reedpipe-heron@6,16,E", creatures6000);
  check("world ignores query", (await api("GET", "/api/world?tick=9999", undefined, explorerCookie)).body.tick === 6000);

  // clock route
  const clock = await api("POST", "/api/grading/clock", { world: w.world.id, tick: 6030 });
  check("clock 200", clock.status === 200 && clock.body.tick === 6030, clock.body);
  const worldAfter = await api("GET", "/api/world", undefined, explorerCookie);
  const heron = worldAfter.body.creatures.find((c: any) => c.id === "reedpipe-heron");
  check("DP-31 heron 9,16 E", heron.x === 9 && heron.y === 16 && heron.heading === "E", heron);

  // worked example 4 at tick 6030 from 8,20 N zoom 1 focus 4
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082", "hex");
  const form = new FormData();
  form.append("image", new Blob([png], { type: "image/png" }), "shot.png");
  form.append("pose", JSON.stringify({ island: 1, tile: [8, 20], camera: [8, 20], heading: "N", zoom: 1, focus: 4, tick: 6030 }));
  const shotRes = await fetch(BASE + "/api/photos", { method: "POST", headers: { cookie: explorerCookie, "Shot-Key": "sk-test-1" }, body: form });
  const shot = await shotRes.json();
  check("photo 201", shotRes.status === 201, shot);
  check("ex4 subject heron", shot.photo?.creature === "reedpipe-heron", shot.photo);
  check("ex4 total 80", shot.photo?.score?.total === 80, shot.photo?.score);
  check("ex4 rows 30/15/15/20", shot.photo?.score?.size === 30 && shot.photo?.score?.centring === 15 && shot.photo?.score?.facing === 15 && shot.photo?.score?.sharpness === 20, shot.photo?.score);
  check("ex4 film 29", shot.photo?.film === 29, shot.photo?.film);

  // shot key replay
  const form2 = new FormData();
  form2.append("image", new Blob([png], { type: "image/png" }), "shot.png");
  form2.append("pose", JSON.stringify({ island: 1, tile: [8, 20], camera: [8, 20], heading: "N", zoom: 1, focus: 4, tick: 6030 }));
  const replay = await fetch(BASE + "/api/photos", { method: "POST", headers: { cookie: explorerCookie, "Shot-Key": "sk-test-1" }, body: form2 });
  const replayBody = await replay.json();
  check("shot key replay same photo id", replay.status === 201 && replayBody.photo?.id === shot.photo.id, replayBody);

  // shot key reuse with another pose
  const form3 = new FormData();
  form3.append("image", new Blob([png], { type: "image/png" }), "shot.png");
  form3.append("pose", JSON.stringify({ island: 1, tile: [13, 10], camera: [13, 10], heading: "N", zoom: 2, focus: 8, tick: 6030 }));
  const reused = await fetch(BASE + "/api/photos", { method: "POST", headers: { cookie: explorerCookie, "Shot-Key": "sk-test-1" }, body: form3 });
  const reusedBody = await reused.json();
  check("DP-26 shot_key_reused 409", reused.status === 409 && reusedBody.error === "shot_key_reused", reusedBody);

  // photo refusals in the published order
  async function tryShot(pose: unknown, name: string, code: string, status: number, extra?: string) {
    const f = new FormData();
    f.append("image", new Blob([png], { type: "image/png" }), "shot.png");
    f.append("pose", JSON.stringify(pose));
    const r = await fetch(BASE + "/api/photos", { method: "POST", headers: { cookie: explorerCookie, "Shot-Key": `sk-${name}-${Math.random()}` }, body: f });
    const b = await r.json();
    check(`refusal ${name} -> ${code}`, r.status === status && b.error === code, b);
    if (extra) check(`refusal ${name} message`, b.message === extra, b.message);
  }
  await tryShot({ island: 1, tile: [15, 4], camera: [15, 4], heading: "N", zoom: 1, focus: 2, tick: 6030 }, "water", "cannot_stand", 422, "No one could stand there. Photo refused.");
  await tryShot({ island: 1, tile: [8, 20], camera: [12, 20], heading: "N", zoom: 1, focus: 4, tick: 6030 }, "camfar", "camera_too_far", 422, "The camera was too far from the explorer. Photo refused.");
  await tryShot({ island: 1, tile: [8, 20], camera: [8, 20], heading: "N", zoom: 1, focus: 4, tick: 6030 - 2000 }, "passed", "tick_passed", 422, "That moment has passed. Photo refused.");
  await tryShot({ island: 1, tile: [8, 20], camera: [8, 20], heading: "N", zoom: 1, focus: 4, tick: 6031 }, "ahead", "tick_ahead", 422, "That moment hasn't happened yet. Photo refused.");
  await tryShot({ island: 1, tile: [3, 12], camera: [3, 12], heading: "E", zoom: 1, focus: 4, tick: 6030 }, "empty", "nothing_in_frame", 422, "No creature in frame. Photo refused.");
  await tryShot({ island: 9, tile: [8, 20], camera: [8, 20], heading: "N", zoom: 1, focus: 4, tick: 6030 }, "badpose", "bad_pose", 422, "That photo's details aren't valid.");

  // notes
  const note = await api("POST", "/api/notes", { text: "<b>Low</b> tide **today**" }, explorerCookie, { "Request-Key": "rk-note-1" });
  check("note 201 pending", note.status === 201 && note.body.note.status === "pending", note.body);
  const noteReplay = await api("POST", "/api/notes", { text: "<b>Low</b> tide **today**" }, explorerCookie, { "Request-Key": "rk-note-1" });
  check("note request key replay", noteReplay.status === 201 && noteReplay.body.note.id === note.body.note.id, noteReplay.body);
  const noteReuse = await api("POST", "/api/notes", { text: "different" }, explorerCookie, { "Request-Key": "rk-note-1" });
  check("note request key reused 409", noteReuse.status === 409 && noteReuse.body.error === "request_key_reused", noteReuse.body);

  // newcomer cannot pin
  const newcomerSignin = await api("POST", "/api/session", { email: w.newcomer.email, password: "Harbour-Explorer-1" });
  const newcomerCookie = cookieOf(newcomerSignin);
  const newcomerNote = await api("POST", "/api/notes", { text: "hello" }, newcomerCookie);
  check("DP-63 newcomer 403 unconfirmed", newcomerNote.status === 403 && newcomerNote.body.error === "unconfirmed", newcomerNote.body);

  // ranger flows
  const rangerSignin = await api("POST", "/api/session", { email: rangerEmail, password: "Harbour-Explorer-1" });
  const rangerCookie = cookieOf(rangerSignin);
  const rangerNotes = await api("GET", "/api/ranger/notes", undefined, rangerCookie);
  check("ranger sees pending notes", rangerNotes.status === 200 && rangerNotes.body.notes.some((n: any) => n.id === w.notes.pending), rangerNotes.body);
  const approve = await api("POST", `/api/notes/${w.notes.pending}/approve`, {}, rangerCookie);
  check("approve 200", approve.status === 200 && approve.body.note.status === "approved", approve.body);
  const ranger2Signin = await api("POST", "/api/session", { email: w.ranger2.email, password: "Harbour-Explorer-1" });
  const ranger2Cookie = cookieOf(ranger2Signin);
  const approve2 = await api("POST", `/api/notes/${w.notes.pending}/approve`, {}, ranger2Cookie);
  check("DP-61 note_decided 409", approve2.status === 409 && approve2.body.error === "note_decided", approve2.body);

  // boards
  const board = await api("GET", "/api/boards/1", undefined, explorerCookie);
  check("board 200", board.status === 200, board.body);
  const entry = await api("POST", "/api/boards/1/entries", { photo: w.photos.heron, score: 999 }, explorerCookie);
  check("DP-77 ignores score", entry.status === 201 && entry.body.entry.total === 74, entry.body);

  // halls
  const hall = await api("GET", `/api/halls/${w.explorer.handle}`, undefined, explorerCookie);
  check("explorer hall 200", hall.status === 200 && hall.body.hall.frames.length === 3, hall.body);
  const rivalHall = await api("GET", `/api/halls/${w.rival.handle}`, undefined, explorerCookie);
  check("DP-90 rival private hall 404", rivalHall.status === 404 && rivalHall.body.error === "not_found", rivalHall.body);
  const rivalImage = await api("GET", `/api/photos/${w.photos.rival_private}/image`, undefined, explorerCookie);
  check("DP-90 rival private image 404", rivalImage.status === 404, rivalImage.status);

  // likes
  const friendSignin = await api("POST", "/api/session", { email: friendEmail, password: "Harbour-Explorer-1" });
  const friendCookie = cookieOf(friendSignin);
  const like = await api("PUT", `/api/photos/${w.photos.heron}/like`, {}, friendCookie);
  check("like 200", like.status === 200 && like.body.likes === 1, like.body);
  const ownLike = await api("PUT", `/api/photos/${w.photos.heron}/like`, {}, explorerCookie);
  check("own_photo 403", ownLike.status === 403 && ownLike.body.error === "own_photo", ownLike.body);
  const unlike = await api("DELETE", `/api/photos/${w.photos.heron}/like`, {}, friendCookie);
  check("unlike 0 likes", unlike.status === 200 && unlike.body.likes === 0, unlike.body);

  // safaris
  const safariStart = await api("POST", "/api/safaris", {}, explorerCookie);
  check("existing safari returns 200", safariStart.status === 200 && safariStart.body.safari.code === w.safari.code, safariStart.body);
  const join = await api("POST", `/api/safaris/${w.safari.code}/join`, {}, friendCookie);
  check("join 200", join.status === 200 && join.body.safari.status === "joined", join.body);
  const rivalSignin = await api("POST", "/api/session", { email: rivalEmail, password: "Harbour-Explorer-1" });
  const rivalCookie = cookieOf(rivalSignin);
  const rivalJoin = await api("POST", `/api/safaris/${w.safari.code}/join`, {}, rivalCookie);
  check("safari_full 409", rivalJoin.status === 409 && rivalJoin.body.error === "safari_full", rivalJoin.body);
  const leave = await api("POST", `/api/safaris/${w.safari.code}/leave`, {}, friendCookie);
  check("leave 200", leave.status === 200, leave.body);
  const rivalJoin2 = await api("POST", `/api/safaris/${w.safari.code}/join`, {}, rivalCookie);
  check("rival joins after seat free", rivalJoin2.status === 200, rivalJoin2.body);

  // postcard
  const clockTo6000 = await api("POST", "/api/grading/clock", { world: w.world.id, tick: 6000 });
  check("clock back to 6000", clockTo6000.status === 200);
  const postcard = await api("POST", "/api/postcards", { photo: w.photos.moth, recipient: "grand@example.test", line: "<i>Wish you were here</i>" }, explorerCookie, { "Request-Key": "rk-pc-1" });
  check("postcard 201", postcard.status === 201, postcard.body);
  const pcId = postcard.body.postcard?.id;
  const pcGet = await api("GET", `/api/postcards/${pcId}`, undefined);
  check("postcard get 200", pcGet.status === 200 && pcGet.body.postcard.creature_name === "Gloamfin moth", pcGet.body);
  check("postcard hides address", !JSON.stringify(pcGet.body).includes("explorer@"), pcGet.body);

  // restart
  const restart = await api("POST", "/api/me/restart", {}, explorerCookie);
  check("restart 200", restart.status === 200 && restart.body.film === 36 && restart.body.stamps === 0, restart.body);
  const afterRestart = await api("GET", "/api/me/albums", undefined, explorerCookie);
  check("restart clears pages", afterRestart.body.albums.every((a: any) => a.pages_filled === 0), afterRestart.body.albums);
  const photosAfter = await api("GET", "/api/me/photos", undefined, explorerCookie);
  check("restart keeps photos", photosAfter.body.photos.length >= 4, photosAfter.body.photos.length);

  console.log(failures === 0 ? "ALL API CHECKS PASSED" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
