#!/usr/bin/env node
// Backend smoke test: exercises the API end to end against a running server.
const BASE = process.env.BASE ?? "http://127.0.0.1:4173";
let failures = 0;

function ok(cond, label) {
  if (cond) console.log("  ok:", label);
  else {
    failures++;
    console.log("  FAIL:", label);
  }
}

async function api(method, path, { body, cookie, raw } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined && !raw) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, cookie: setCookie };
}

function cookieOf(res) {
  return res.cookie?.split(";")[0] ?? "";
}

const PUZZLE_TEXT = `Overlap 1
Title: Test Puzzle
Author: Test Author
Size: 5x5

Grid:
SCONE
T#V#N
EJECT
A#N#E
MISER

Across:
1. Crumbly bake served with jam
4. Push the tape out of the deck
5. One who hoards every coin

Down:
1. What rises from a kettle spout
2. Hot boxes that bake the bread
3. Step inside, or key in data
`;

async function main() {
  console.log("health & config");
  const health = await api("GET", "/api/health");
  ok(health.status === 200 && health.json.status === "ok", "health ok");
  const config = await api("GET", "/api/config");
  ok(config.status === 200 && typeof config.json.replay_step_ms === "number", "config ok");

  console.log("players");
  const p1 = await api("POST", "/api/players", { body: { display_name: "  Ada  " } });
  ok(p1.status === 201 && p1.json.display_name === "Ada", "create player trims name");
  const adaCookie = cookieOf(p1);
  const bad = await api("POST", "/api/players", { body: { display_name: "x".repeat(30) } });
  ok(bad.status === 422 && bad.json.error === "invalid" && bad.json.fields?.display_name, "long name refused with fields");
  const p2 = await api("POST", "/api/players", { body: { display_name: "Ben" } });
  const benCookie = cookieOf(p2);
  const me = await api("GET", "/api/players/me", { cookie: adaCookie });
  ok(me.status === 200 && me.json.display_name === "Ada", "me returns player");
  const noPlayer = await api("GET", "/api/players/me");
  ok(noPlayer.status === 401 && noPlayer.json.error === "no_player", "no player 401");

  console.log("settings");
  const putSettings = await api("PUT", "/api/players/me/settings", { cookie: adaCookie, body: { skip_filled: true, jump_next_clue: false, autocheck: true } });
  ok(putSettings.status === 200 && putSettings.json.autocheck === true, "settings save");
  const badSettings = await api("PUT", "/api/players/me/settings", { cookie: adaCookie, body: { skip_filled: true, jump_next_clue: false, autocheck: "yes" } });
  ok(badSettings.status === 422 && badSettings.json.fields?.autocheck, "bad settings refused with field");
  const getSettings = await api("GET", "/api/players/me/settings", { cookie: adaCookie });
  ok(getSettings.status === 200 && getSettings.json.autocheck === true, "settings persist");
  await api("PUT", "/api/players/me/settings", { cookie: adaCookie, body: { skip_filled: true, jump_next_clue: false, autocheck: false } });

  console.log("board");
  const board = await api("GET", "/api/puzzles", { cookie: adaCookie });
  ok(board.status === 200 && board.json.puzzles.length >= 5, "library puzzles listed");
  const titles = board.json.puzzles.map((p) => p.title);
  ok(titles.includes("Morning Kettle") && titles.includes("Long Table"), "fixtures present");
  ok(board.json.puzzles[0].source === "library", "library source");

  console.log("upload");
  const upload = await api("POST", "/api/puzzles", { cookie: adaCookie, raw: PUZZLE_TEXT });
  ok(upload.status === 201 && upload.json.puzzle.title === "Test Puzzle", "upload accepted");
  const puzzleId = upload.json.puzzle.id;
  const sha = upload.json.puzzle.sha256;
  ok(typeof sha === "string" && sha.length === 64, "sha256 recorded");
  const uploadBad = await api("POST", "/api/puzzles", { cookie: adaCookie, raw: "nope" });
  ok(uploadBad.status === 422 && uploadBad.json.error === "invalid_puzzle" && Array.isArray(uploadBad.json.lines), "bad upload refused with lines");
  const tooBig = await api("POST", "/api/puzzles", { cookie: adaCookie, raw: "x".repeat(70000) });
  ok(tooBig.status === 413 && tooBig.json.error === "too_large", "oversize refused 413");

  const original = await api("GET", `/api/puzzles/${puzzleId}/original`, { cookie: adaCookie });
  ok(original.status === 200 && original.text === PUZZLE_TEXT, "original bytes round-trip");
  const originalOther = await api("GET", `/api/puzzles/${puzzleId}/original`, { cookie: benCookie });
  ok(originalOther.status === 404, "other player's upload original is 404");
  const puzzleOther = await api("GET", `/api/puzzles/${puzzleId}`, { cookie: benCookie });
  ok(puzzleOther.status === 404, "other player's private puzzle is 404");

  console.log("game create & write");
  const game = await api("POST", "/api/games", { cookie: adaCookie, body: { puzzle_id: puzzleId } });
  ok(game.status === 201 && game.json.players.length === 1 && game.json.players[0].host, "game created with host");
  const gameId = game.json.id;
  ok(game.json.timer_state === "paused" && game.json.status === "open", "new game open and paused");
  ok(game.json.code.length === 12, "code is 12 chars");

  // writes via POST ops
  const write = await api("POST", `/api/games/${gameId}/ops`, {
    cookie: adaCookie,
    body: { type: "cell", row: 0, col: 1, value: "C", pencil: false, client_op_id: "op1" },
  });
  ok(write.status === 200 && write.json.seq === 1 && write.json.value === "C", "cell write sequenced");
  const writeAgain = await api("POST", `/api/games/${gameId}/ops`, {
    cookie: adaCookie,
    body: { type: "cell", row: 0, col: 1, value: "C", pencil: false, client_op_id: "op1" },
  });
  ok(writeAgain.status === 200 && writeAgain.json.seq === 1, "replayed op returns stored result");
  const writeReuse = await api("POST", `/api/games/${gameId}/ops`, {
    cookie: adaCookie,
    body: { type: "cell", row: 0, col: 1, value: "D", pencil: false, client_op_id: "op1" },
  });
  ok(writeReuse.status === 409 && writeReuse.json.error === "op_id_reused", "reused id for different body is 409");

  const check = await api("POST", `/api/games/${gameId}/ops`, {
    cookie: adaCookie,
    body: { type: "check", scope: "word", row: 0, col: 0, direction: "across", client_op_id: "op2" },
  });
  ok(check.status === 200 && check.json.wrong === 0, "check word with the one right letter is 0 wrong");
  const checkedGame = await api("GET", `/api/games/${gameId}`, { cookie: adaCookie });
  ok(checkedGame.json.checked_count === 1, "checked_count counts check writes");

  const reveal = await api("POST", `/api/games/${gameId}/ops`, {
    cookie: adaCookie,
    body: { type: "reveal", scope: "square", row: 0, col: 0, client_op_id: "op3" },
  });
  ok(reveal.status === 200 && reveal.json.revealed === 1, "reveal square");
  const locked = await api("POST", `/api/games/${gameId}/ops`, {
    cookie: adaCookie,
    body: { type: "cell", row: 0, col: 0, value: "X", pencil: false, client_op_id: "op4" },
  });
  ok(locked.status === 409 && locked.json.error === "square_locked", "write to revealed square is locked");

  const clear = await api("POST", `/api/games/${gameId}/ops`, {
    cookie: adaCookie,
    body: { type: "clear", scope: "word", row: 0, col: 0, direction: "across", client_op_id: "op5" },
  });
  ok(clear.status === 200 && clear.json.cleared === 0, "clear word keeps the locked square");
  const afterClear = await api("GET", `/api/games/${gameId}`, { cookie: adaCookie });
  const sq00 = afterClear.json.squares.find((s) => s.row === 0 && s.col === 0);
  ok(sq00.state === "revealed" && sq00.value === "S", "cleared word keeps revealed square");

  console.log("links");
  const linkInfo = await api("GET", `/api/links/${game.json.code}`, { cookie: benCookie });
  ok(linkInfo.status === 200 && linkInfo.json.game_id === gameId, "link info");
  const join = await api("POST", `/api/links/${game.json.code}/join`, { cookie: benCookie, body: {} });
  ok(join.status === 200 && join.json.players.length === 2, "join by link adds player");
  const joinColour = join.json.players[1].colour;
  ok(joinColour === "coral", "second player gets next free colour");
  const joinAgain = await api("POST", `/api/links/${game.json.code}/join`, { cookie: benCookie, body: {} });
  ok(joinAgain.status === 200 && joinAgain.json.players.length === 2, "rejoin keeps seat");

  const notHost = await api("POST", `/api/games/${gameId}/link/off`, { cookie: benCookie, body: {} });
  ok(notHost.status === 403 && notHost.json.error === "not_host", "non-host cannot change link");
  const linkOff = await api("POST", `/api/games/${gameId}/link/off`, { cookie: adaCookie, body: {} });
  ok(linkOff.status === 200 && linkOff.json.link_state === "off" && linkOff.json.code === null, "link off");
  const offAgain = await api("POST", `/api/games/${gameId}/link/off`, { cookie: adaCookie, body: {} });
  ok(offAgain.status === 409 && offAgain.json.error === "link_already_off", "turning off twice is 409");
  const deadLink = await api("GET", `/api/links/${game.json.code}`, { cookie: benCookie });
  ok(deadLink.status === 410 || deadLink.status === 404, "old code is dead");

  const replaceFromOff = await api("POST", `/api/games/${gameId}/link/replace`, { cookie: adaCookie, body: {} });
  ok(replaceFromOff.status === 409 || replaceFromOff.status === 200, "replace after off answers");

  console.log("solve flow");
  const game2 = await api("POST", "/api/games", { cookie: adaCookie, body: { puzzle_id: puzzleId } });
  const gid2 = game2.json.id;
  const code2 = game2.json.code;
  const joined = await api("POST", `/api/links/${code2}/join`, { cookie: benCookie, body: {} });
  ok(joined.status === 200, "friend joins second game");

  // Fill the grid via POST ops (except locked square 0,0 was revealed in game 1; this is game 2)
  const answer = [
    "SCONE",
    "T#V#N",
    "EJECT",
    "A#N#E",
    "MISER",
  ];
  let seq = 0;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (answer[r][c] === "#") continue;
      seq++;
      const res = await api("POST", `/api/games/${gid2}/ops`, {
        cookie: adaCookie,
        body: { type: "cell", row: r, col: c, value: answer[r][c], pencil: false, client_op_id: `fill-${r}-${c}` },
      });
      if (res.status !== 200) {
        ok(false, `fill ${r},${c}: ${res.status} ${JSON.stringify(res.json)}`);
      }
    }
  }
  const solvedGame = await api("GET", `/api/games/${gid2}`, { cookie: adaCookie });
  ok(solvedGame.json.status === "solved", "game solved at the final write");
  ok(solvedGame.json.timer_state === "solved", "timer frozen");
  ok(solvedGame.json.solved_at !== null, "solved_at set");
  const writeSolved = await api("POST", `/api/games/${gid2}/ops`, {
    cookie: adaCookie,
    body: { type: "cell", row: 1, col: 2, value: "Z", pencil: false },
  });
  ok(writeSolved.status === 409 && writeSolved.json.error === "game_solved", "write after solve refused");

  console.log("history & record");
  const history = await api("GET", "/api/history", { cookie: adaCookie });
  ok(history.status === 200 && history.json.entries.length >= 1, "history entry for solver");
  const entry = history.json.entries.find((e) => e.game_id === gid2);
  ok(entry && entry.record_ready === true, "record ready");
  const historyOther = await api("GET", "/api/history", { cookie: benCookie });
  const benEntry = historyOther.json.entries.find((e) => e.game_id === gid2);
  ok(benEntry, "participant also has an entry");
  const stranger = await api("POST", "/api/players", { body: { display_name: "Stranger" } });
  const strangerHistory = await api("GET", "/api/history", { cookie: cookieOf(stranger) });
  ok(!strangerHistory.json.entries.some((e) => e.game_id === gid2), "stranger has no entry");
  const record = await api("GET", `/api/history/${gid2}/record`, { cookie: benCookie });
  ok(record.status === 200 && record.json.format === "overlap-solve-record-1", "solve record downloads");
  ok(record.json.ops.length === 25, `record ops count (${record.json.ops?.length})`);
  ok(Array.isArray(record.json.initial) && record.json.initial.length > 0, "record has initial squares");
  const recordOther = await api("GET", `/api/history/${gid2}/record`, { cookie: cookieOf(stranger) });
  ok(recordOther.status === 404, "stranger cannot download the record");

  console.log("race");
  const race = await api("POST", "/api/games", { cookie: adaCookie, body: { puzzle_id: puzzleId, mode: "race" } });
  ok(race.status === 201 && race.json.mode === "race" && race.json.race_state === "lobby", "race created in lobby");
  const rid = race.json.id;
  const rcode = race.json.code;
  const rJoin = await api("POST", `/api/links/${rcode}/join`, { cookie: benCookie, body: {} });
  ok(rJoin.status === 200, "friend joins race");
  const earlyWrite = await api("POST", `/api/games/${rid}/ops`, {
    cookie: adaCookie,
    body: { type: "cell", row: 0, col: 0, value: "S", pencil: false },
  });
  ok(earlyWrite.status === 409 && earlyWrite.json.error === "race_not_started", "write before race start refused");
  const teamSet = await api("POST", `/api/games/${rid}/team`, { cookie: adaCookie, body: { team: 1 } });
  ok(teamSet.status === 200 && teamSet.json.players.find((p) => p.host).team === 1, "host picks team 1");
  const teamSet2 = await api("POST", `/api/games/${rid}/team`, { cookie: benCookie, body: { team: 2 } });
  ok(teamSet2.status === 200, "friend picks team 2");
  const start = await api("POST", `/api/games/${rid}/race/start`, { cookie: benCookie, body: {} });
  ok(start.status === 403 && start.json.error === "not_host", "non-host cannot start");
  const startOk = await api("POST", `/api/games/${rid}/race/start`, { cookie: adaCookie, body: {} });
  ok(startOk.status === 200 && startOk.json.race_state === "racing", "race started");
  const startAgain = await api("POST", `/api/games/${rid}/race/start`, { cookie: adaCookie, body: {} });
  ok(startAgain.status === 409 && startAgain.json.error === "race_started", "start twice refused");
  const teamAfter = await api("POST", `/api/games/${rid}/team`, { cookie: adaCookie, body: { team: 2 } });
  ok(teamAfter.status === 409, "team change after start refused");

  // claim a square: host writes S then checks
  const claimWrite = await api("POST", `/api/games/${rid}/ops`, { cookie: adaCookie, body: { type: "cell", row: 0, col: 0, value: "S", pencil: false } });
  ok(claimWrite.status === 200, "race cell write");
  const claim = await api("POST", `/api/games/${rid}/ops`, { cookie: adaCookie, body: { type: "check", scope: "square", row: 0, col: 0, client_op_id: "claim1" } });
  ok(claim.status === 200 && claim.json.type === "claim" && claim.json.scores["1"] === 1, "right check claims and scores");
  const raceGame = await api("GET", `/api/games/${rid}`, { cookie: adaCookie });
  ok(raceGame.json.scores["1"] === 1 && raceGame.json.scores["2"] === 0, "scores stored");
  const benView = await api("GET", `/api/games/${rid}`, { cookie: benCookie });
  const benSq = benView.json.squares.find((s) => s.row === 0 && s.col === 0);
  ok(benSq && benSq.value === "S" && benSq.state === "right", "claim visible in both team grids");
  const lockedClaim = await api("POST", `/api/games/${rid}/ops`, { cookie: benCookie, body: { type: "check", scope: "square", row: 0, col: 0 } });
  ok(lockedClaim.status === 409 && lockedClaim.json.error === "square_locked", "second claim of same square refused");
  const wrongWrite = await api("POST", `/api/games/${rid}/ops`, { cookie: benCookie, body: { type: "cell", row: 0, col: 1, value: "Z", pencil: false } });
  ok(wrongWrite.status === 200, "team 2 writes own grid");
  const wrongCheck = await api("POST", `/api/games/${rid}/ops`, { cookie: benCookie, body: { type: "check", scope: "square", row: 0, col: 1 } });
  ok(wrongCheck.status === 200 && wrongCheck.json.type === "check" && wrongCheck.json.wrong === 1, "wrong check marks own grid");
  const revealRace = await api("POST", `/api/games/${rid}/ops`, { cookie: adaCookie, body: { type: "reveal", scope: "square", row: 0, col: 2 } });
  ok(revealRace.status === 422, "reveal in race refused");
  const clearRace = await api("POST", `/api/games/${rid}/ops`, { cookie: adaCookie, body: { type: "clear", scope: "puzzle" } });
  ok(clearRace.status === 422 && clearRace.json.fields?.scope, "puzzle clear in race refused with scope field");

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
