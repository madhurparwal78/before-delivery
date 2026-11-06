/** Roster, admin, coins, purchase, leaderboards, history and replay. */

import { api, ApiError, errorFields } from "../lib/api.js";
import { h, clear, statusRegion, setStatus, asInput, asSelect } from "../lib/dom.js";
import { registerRoute, navigate, currentMe, renderTopbar } from "../app.js";
import { Appearances, AppearanceNames, LoadoutItems, TimeZones, CoinPacks } from "../../shared/data.js";

registerRoute("/s/([^/]+)/roster", (params, render) => renderRoster(params[0]!, render.main));
registerRoute("/s/([^/]+)/admin", (params, render) => renderAdmin(params[0]!, render.main));
registerRoute("/s/([^/]+)/coins", (params, render) => renderCoins(params[0]!, render.main));
registerRoute("/s/([^/]+)/coins/([^/]+)", (params, render) => renderPurchase(params[0]!, params[1]!, render.main));
registerRoute("/s/([^/]+)/leaderboards", (params, render) => renderLeaderboards(params[0]!, render.main));
registerRoute("/s/([^/]+)/games", (params, render) => renderHistory(params[0]!, render.main));
registerRoute("/s/([^/]+)/games/([^/]+)", (params, render) => renderReplay(params[0]!, params[1]!, render.main));

async function renderRoster(slug: string, main: HTMLElement): Promise<void> {
  clear(main);
  const status = statusRegion("Roster status", "roster-status");
  const roster = h("ul", { "aria-label": "Roster" });
  const details = h("div", { role: "region", "aria-label": "Character details", class: "card" });
  const newButton = h("button", { class: "primary", onclick: () => openNew() }, "New character");
  let characters: { id: string; name: string; appearance: string; loadout: string[]; balance: number; world: string; x: number; y: number }[] = [];

  const load = async (): Promise<void> => {
    const res = await api<{ characters: typeof characters }>(`/api/servers/${slug}/characters?mine=true`);
    characters = res.data.characters;
    clear(roster);
    for (const character of characters) {
      roster.append(h("li", { onclick: () => drawDetails(character) }, character.name));
    }
    if (characters[0] !== undefined) drawDetails(characters[0]);
  };

  const drawDetails = (character: (typeof characters)[number]): void => {
    clear(details);
    details.append(
      h("h3", {}, character.name),
      h("p", {}, `Appearance: ${AppearanceNames[character.appearance] ?? character.appearance}`),
      h("p", {}, `Loadout: ${character.loadout.join(", ") === "" ? "none" : character.loadout.join(", ")}`),
      h("p", { class: "mono" }, `Coins: ${character.balance}`),
      h("p", {}, `World: ${character.world} at ${character.x}, ${character.y}`)
    );
    const appearanceGroup = h("div", { role: "radiogroup", "aria-label": "Appearance" });
    for (const appearance of Appearances) {
      appearanceGroup.append(h("label", {}, h("input", { type: "radio", name: "appearance", checked: appearance === character.appearance, onchange: async () => {
        await api(`/api/characters/${character.id}`, { method: "PATCH", body: { appearance } });
        setStatus(status, "Appearance saved");
        await load();
      } }), AppearanceNames[appearance] ?? appearance));
    }
    details.append(appearanceGroup, h("button", { onclick: async () => { await api(`/api/characters/${character.id}`, { method: "PATCH", body: { appearance: character.appearance } }); setStatus(status, "Appearance saved"); } }, "Save appearance"));
  };

  const openNew = (): void => {
    const dialog = h("dialog", { class: "sheet modal-centre", "aria-label": "New character" }) as unknown as HTMLDialogElement;
    const name = asInput(h("input", { type: "text", "aria-label": "Name" }));
    const formStatus = statusRegion("New character status", "new-character-status");
    const appearanceGroup = h("div", { role: "radiogroup", "aria-label": "Appearance" });
    let appearance: string = Appearances[0];
    for (const option of Appearances) {
      appearanceGroup.append(h("label", {}, h("input", { type: "radio", name: "new-appearance", checked: option === Appearances[0], onchange: () => { appearance = option; } }), AppearanceNames[option] ?? option));
    }
    const loadout = asSelect(h("select", { multiple: "true", "aria-label": "Loadout", size: "6" }));
    for (const item of LoadoutItems) {
      loadout.append(h("option", { value: item }, item));
    }
    const create = h("button", { class: "primary", onclick: async () => {
      const chosen = Array.from(loadout.selectedOptions).map((o) => o.value);
      if (chosen.length > 3) {
        setStatus(formStatus, "Choose at most 3 items.");
        return;
      }
      try {
        const res = await api<{ character: { name: string } }>(`/api/servers/${slug}/characters`, {
          method: "POST",
          body: { name: name.value, appearance, loadout: chosen },
        });
        setStatus(status, `Character created: ${res.data.character.name}`);
        dialog.close();
        await load();
        await renderTopbar();
      } catch (err) {
        if (err instanceof ApiError) {
          const fields = errorFields(err);
          setStatus(formStatus, [fields.name, fields.appearance, fields.loadout].filter(Boolean).join(" ") || err.failure.message);
        }
      }
    } }, "Create");
    dialog.append(h("div", { class: "dialog-body" }, h("h2", { class: "dialog-title" }, "New character"), h("label", {}, "Name"), name, appearanceGroup, h("label", {}, "Loadout"), loadout, create, formStatus, h("button", { onclick: () => dialog.close() }, "Close")));
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    name.focus();
  };

  main.append(h("h1", {}, "Characters"), newButton, status, h("div", { class: "rail-layout" }, roster, details));
  await load();
}

async function renderAdmin(slug: string, main: HTMLElement): Promise<void> {
  clear(main);
  const status = statusRegion("Admin status", "admin-status");
  const me = currentMe();
  const server = me?.servers.find((s) => s.slug === slug);

  const members = h("section", {}, h("h2", {}, "Members"));
  const handleInput = asInput(h("input", { type: "text", "aria-label": "Member handle" }));
  members.append(
    h("form", { onsubmit: async (e: Event) => { e.preventDefault(); try { const res = await api<{ member: { handle: string } }>(`/api/servers/${slug}/members`, { method: "POST", body: { handle: handleInput.value } }); setStatus(status, `${res.data.member.handle} added to the server`); handleInput.value = ""; await loadMembers(); } catch (err) { if (err instanceof ApiError) setStatus(status, err.failure.message); } } }, handleInput, h("button", { type: "submit" }, "Add member"))
  );
  const memberList = h("ul", {});
  members.append(memberList);

  async function loadMembers(): Promise<void> {
    const friends = await api<{ friends: { handle: string; display_name: string; online: boolean }[] }>(`/api/servers/${slug}/friends`);
    clear(memberList);
    for (const friend of friends.data.friends) {
      memberList.append(h("li", {}, `${friend.display_name} (${friend.handle}): ${friend.online ? "ONLINE" : "OFFLINE"}`));
    }
  }

  const tablesSection = h("section", {}, h("h2", {}, "Tables"));
  const worldsSection = h("section", {}, h("h2", {}, "Worlds"));
  const exportSection = h("section", {}, h("h2", {}, "Export"));
  const settingsSection = h("section", {}, h("h2", {}, "Server settings"));
  const purchasesSection = h("section", {}, h("h2", {}, "Coin purchases"));
  const mailSection = h("section", {}, h("h2", {}, "Outgoing mail"));

  const loadTables = async (): Promise<void> => {
    const worldSlug = server?.worlds[0]?.slug;
    if (worldSlug === undefined) return;
    const world = await api<{ tables: { id: string; name: string; game: string; state: string; stake: number; turn_seconds: number }[] }>(`/api/servers/${slug}/worlds/${worldSlug}`);
    clear(tablesSection);
    tablesSection.append(h("h2", {}, "Tables"));
    for (const table of world.data.tables) {
      tablesSection.append(h("p", {}, `${table.name} (${table.game}) — stake ${table.stake}, turn clock ${table.turn_seconds}s`));
      tablesSection.append(h("button", { onclick: () => openSettings(table.id, table.name, table.stake, table.turn_seconds) }, `Settings for ${table.name}`));
    }
  };

  const openSettings = (tableId: string, name: string, stake: number, turnSeconds: number): void => {
    const dialog = h("dialog", { class: "sheet modal-centre", "aria-label": `Table settings for ${name}` }) as unknown as HTMLDialogElement;
    const stakeInput = asInput(h("input", { type: "number", value: String(stake), "aria-label": "Stake" }));
    const clockInput = asInput(h("input", { type: "number", value: String(turnSeconds), "aria-label": "Turn clock seconds" }));
    const save = h("button", { class: "primary", onclick: async () => {
      try {
        await api(`/api/tables/${tableId}`, { method: "PATCH", body: { stake: Number(stakeInput.value), turn_seconds: Number(clockInput.value) } });
        setStatus(status, `Settings saved for ${name}`);
        dialog.close();
      } catch (err) {
        if (err instanceof ApiError) setStatus(status, err.failure.message);
      }
    } }, "Save settings");
    dialog.append(h("div", { class: "dialog-body" }, h("h2", { class: "dialog-title" }, `Table settings for ${name}`), h("label", {}, "Stake"), stakeInput, h("label", {}, "Turn clock seconds"), clockInput, save, h("button", { onclick: () => dialog.close() }, "Close")));
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    stakeInput.focus();
  };

  const loadWorlds = async (): Promise<void> => {
    const worldSlug = server?.worlds[0]?.slug;
    if (worldSlug === undefined) return;
    const world = await api<{ name: string }>(`/api/servers/${slug}/worlds/${worldSlug}`);
    const saves = await api<{ saves: { id: string; number: number; created_at: string }[] }>(`/api/servers/${slug}/worlds/${worldSlug}/saves`);
    clear(worldsSection);
    worldsSection.append(h("h2", {}, "Worlds"));
    const region = h("div", { role: "region", "aria-label": world.data.name });
    const nameInput = asInput(h("input", { type: "text", value: world.data.name, "aria-label": "World name" }));
    region.append(
      nameInput,
      h("button", { onclick: async () => {
        try {
          await api(`/api/servers/${slug}/worlds/${worldSlug}`, { method: "PATCH", body: { name: nameInput.value } });
          setStatus(status, `World renamed to ${nameInput.value}`);
        } catch (err) {
          if (err instanceof ApiError) setStatus(status, err.failure.message);
        }
      } }, "Rename world"),
      h("button", { onclick: async () => {
        setStatus(status, "Saving world");
        try {
          await api(`/api/servers/${slug}/worlds/${worldSlug}/saves`, { method: "POST", body: {} });
          setStatus(status, "World saved");
          await loadWorlds();
        } catch (err) {
          if (err instanceof ApiError) setStatus(status, err.failure.error === "storage_unavailable" ? "Save not written. Storage is unreachable, so nothing was saved and your world is unchanged. Try again in a minute." : err.failure.message);
        }
      } }, "Save world")
    );
    const saveList = h("ul", { "aria-label": "Saves" });
    for (const save of saves.data.saves) {
      saveList.append(
        h("li", {},
          `Save ${save.number}`,
          h("button", { onclick: async () => {
            try {
              await api(`/api/servers/${slug}/worlds/${worldSlug}/restore`, { method: "POST", body: { save_id: save.id } });
              setStatus(status, `World restored from save ${save.number}`);
            } catch (err) {
              if (err instanceof ApiError) setStatus(status, "Restore failed. Storage is unreachable, so the world is unchanged.");
            }
          } }, `Restore save ${save.number}`)
        )
      );
    }
    region.append(saveList);
    worldsSection.append(region);
  };

  const loadExports = async (): Promise<void> => {
    clear(exportSection);
    exportSection.append(h("h2", {}, "Export"));
    exportSection.append(
      h("button", { onclick: async () => {
        try {
          const res = await api<{ export: { id: string; download_url: string } }>(`/api/servers/${slug}/exports`, { method: "POST", body: {} });
          setStatus(status, "Export ready");
          exportSection.append(h("a", { href: res.data.export.download_url, class: "button" }, "Download export"));
        } catch (err) {
          if (err instanceof ApiError) setStatus(status, "Export not written. Storage is unreachable. Try again in a minute.");
        }
      } }, "Export worlds")
    );
  };

  const loadSettings = async (): Promise<void> => {
    clear(settingsSection);
    settingsSection.append(h("h2", {}, "Server settings"));
    const tz = asSelect(h("select", { "aria-label": "Time zone" }));
    for (const zone of TimeZones) {
      tz.append(h("option", { value: zone }, zone));
    }
    settingsSection.append(tz, h("button", { onclick: async () => {
      try {
        await api(`/api/servers/${slug}`, { method: "PATCH", body: { time_zone: tz.value } });
        setStatus(status, "Time zone saved");
      } catch (err) {
        if (err instanceof ApiError) setStatus(status, err.failure.message);
      }
    } }, "Save time zone"));
  };

  const loadPurchases = async (): Promise<void> => {
    const res = await api<{ purchases: { id: string; character_id: string; pack: string; state: string }[] }>(`/api/servers/${slug}/coin-purchases`);
    clear(purchasesSection);
    purchasesSection.append(h("h2", {}, "Coin purchases"));
    const list = h("ul", { "aria-label": "Coin purchases" });
    for (const purchase of res.data.purchases) {
      const character = await api<{ name: string }>(`/api/characters/${purchase.character_id}`);
      list.append(h("li", {}, h("a", { href: `/s/${slug}/coins/${purchase.id}`, onclick: (e: Event) => { e.preventDefault(); void navigate(`/s/${slug}/coins/${purchase.id}`); } }, `${character.data.name}: ${CoinPacks.find((p) => p.pack === purchase.pack)?.name ?? purchase.pack}`)));
    }
    purchasesSection.append(list);
  };

  const loadMail = async (): Promise<void> => {
    const res = await api<{ mail: { id: string; kind: string; to_handle: string | null; subject: string; state: string }[] }>(`/api/servers/${slug}/mail`);
    clear(mailSection);
    mailSection.append(h("h2", {}, "Outgoing mail"));
    const list = h("ul", { "aria-label": "Outgoing mail" });
    for (const mail of res.data.mail) {
      list.append(h("li", {}, `${mail.subject} to ${mail.to_handle ?? "email"}: ${mail.state.toUpperCase()}`));
    }
    mailSection.append(list);
  };

  main.append(h("h1", {}, `Server admin — ${server?.name ?? slug}`), status, members, tablesSection, exportSection, settingsSection, worldsSection, purchasesSection, mailSection);
  await loadMembers();
  await loadTables();
  await loadWorlds();
  await loadExports();
  await loadSettings();
  await loadPurchases();
  await loadMail();
}

async function renderCoins(slug: string, main: HTMLElement): Promise<void> {
  clear(main);
  const chars = await api<{ characters: { id: string; name: string }[] }>(`/api/servers/${slug}/characters?mine=true`);
  let pack: string = CoinPacks[0]!.pack;
  let characterId: string = chars.data.characters[0]?.id ?? "";
  const status = statusRegion("Purchase status", "purchase-status");
  const checkout = h("div", { class: "card" });
  const purchases = h("div", {});

  const draw = (step: number): void => {
    clear(checkout);
    const heading = h("h2", {}, `Step ${step} of 3: ${step === 1 ? "Pack" : step === 2 ? "Review" : "Pay"}`);
    checkout.append(heading);
    if (step === 1) {
      const packGroup = h("div", { role: "radiogroup", "aria-label": "Coin pack" });
      for (const option of CoinPacks) {
        packGroup.append(h("label", {}, h("input", { type: "radio", name: "coin-pack", checked: option.pack === pack, onchange: () => { pack = option.pack; } }), `${option.name}, ${option.coins} coins, ${option.price} USD`));
      }
      const charGroup = h("div", { role: "radiogroup", "aria-label": "Character" });
      for (const character of chars.data.characters) {
        charGroup.append(h("label", {}, h("input", { type: "radio", name: "coin-character", checked: character.id === characterId, onchange: () => { characterId = character.id; } }), character.name));
      }
      checkout.append(packGroup, charGroup);
    } else if (step === 2) {
      checkout.append(h("p", {}, `Pack: ${CoinPacks.find((p) => p.pack === pack)?.name}`));
      checkout.append(h("p", {}, `Character: ${chars.data.characters.find((c) => c.id === characterId)?.name}`));
    } else {
      checkout.append(h("p", {}, `Pay ${CoinPacks.find((p) => p.pack === pack)?.price} USD`));
    }
    const buttons = h("div", { style: "display: flex; gap: 10px" });
    if (step > 1) {
      buttons.append(h("button", { onclick: () => draw(step - 1) }, "Back"));
    }
    if (step < 3) {
      buttons.append(h("button", { class: "primary", onclick: () => draw(step + 1) }, "Next"));
    } else {
      buttons.append(h("button", { class: "primary", onclick: async () => {
        try {
          const res = await api<{ id: string; state: string }>(`/api/servers/${slug}/coin-purchases`, {
            method: "POST",
            body: { character_id: characterId, pack },
          });
          if (res.data.state === "paid") {
            setStatus(status, `${CoinPacks.find((p) => p.pack === pack)?.coins} coins added to ${chars.data.characters.find((c) => c.id === characterId)?.name}.`);
          } else {
            setStatus(status, "Payment sent to the billing provider. Waiting for confirmation.");
          }
          await navigate(`/s/${slug}/coins/${res.data.id}`);
        } catch (err) {
          if (err instanceof ApiError) setStatus(status, err.failure.message);
        }
      } }, `Pay ${CoinPacks.find((p) => p.pack === pack)?.price} USD`));
    }
    checkout.append(buttons, status);
  };
  draw(1);

  const loadPurchases = async (): Promise<void> => {
    const res = await api<{ purchases: { id: string; character_id: string; pack: string; state: string }[] }>(`/api/servers/${slug}/coin-purchases`);
    clear(purchases);
    purchases.append(h("h2", {}, "Purchases"));
    const list = h("ul", { "aria-label": "Purchases" });
    for (const purchase of res.data.purchases) {
      const character = await api<{ name: string }>(`/api/characters/${purchase.character_id}`);
      list.append(h("li", {}, h("a", { href: `/s/${slug}/coins/${purchase.id}`, onclick: (e: Event) => { e.preventDefault(); void navigate(`/s/${slug}/coins/${purchase.id}`); } }, `${character.data.name}: ${CoinPacks.find((p) => p.pack === purchase.pack)?.name ?? purchase.pack}`), ` — ${purchase.state.toUpperCase()}`));
    }
    purchases.append(list);
  };

  main.append(h("h1", {}, "Coins"), h("div", { class: "rail-layout" }, checkout, purchases));
  await loadPurchases();
}

async function renderPurchase(slug: string, purchaseId: string, main: HTMLElement): Promise<void> {
  clear(main);
  const me = currentMe();
  const server = me?.servers.find((s) => s.slug === slug);
  const purchase = await api<{ id: string; character_id: string; pack: string; coins: number; price: string; state: string; receipt: string }>(`/api/coin-purchases/${purchaseId}`);
  const status = statusRegion("Purchase status", "purchase-status");
  const message = purchase.data.state === "paid"
    ? `${purchase.data.coins} coins added to ${(await api<{ name: string }>(`/api/characters/${purchase.data.character_id}`)).data.name}.`
    : purchase.data.state === "pending"
      ? "Payment sent to the billing provider. Waiting for confirmation."
      : "Refunded.";
  setStatus(status, message);
  if (purchase.data.receipt === "held") {
    setStatus(status, `${message} Receipt held: mail is down`);
  }
  main.append(
    h("h1", {}, "Purchase"),
    h("div", { class: "card" }, h("p", {}, `${purchase.data.pack} — ${purchase.data.coins} coins for ${purchase.data.price} USD`), status)
  );
  if (server?.role === "owner") {
    main.append(
      h("button", { onclick: async () => {
        try {
          const res = await api<{ coins: number; character_id: string }>(`/api/coin-purchases/${purchaseId}/refund`, { method: "POST", body: {} });
          const character = await api<{ name: string }>(`/api/characters/${res.data.character_id}`);
          setStatus(status, `Refunded. ${res.data.coins} coins were removed from ${character.data.name}.`);
        } catch (err) {
          if (err instanceof ApiError) setStatus(status, err.failure.message);
        }
      } }, "Refund")
    );
  }
}

async function renderLeaderboards(slug: string, main: HTMLElement): Promise<void> {
  clear(main);
  const me = currentMe();
  const server = me?.servers.find((s) => s.slug === slug);
  const status = statusRegion("Leaderboard status", "leaderboard-status");
  let game: "chess" | "four" | "tricks" = "chess";
  const tabs = h("div", { role: "tablist", "aria-label": "Game" });
  const table = h("table", { class: "plain", "aria-label": "Leaderboard" });
  const load = async (): Promise<void> => {
    const res = await api<{ season: number; entries: { rank: number; name: string; wins: number }[] }>(`/api/servers/${slug}/leaderboards/${game}`);
    clear(table);
    table.append(h("tr", {}, h("th", {}, "Rank"), h("th", {}, "Character"), h("th", {}, "Wins")));
    for (const entry of res.data.entries) {
      table.append(h("tr", {}, h("td", {}, String(entry.rank)), h("td", {}, entry.name), h("td", {}, String(entry.wins))));
    }
    if (res.data.entries.length === 0) {
      table.append(h("tr", {}, h("td", { colspan: "3" }, "No wins yet this season.")));
    }
    clear(main);
    main.append(h("h1", {}, "Leaderboards"), h("h2", {}, `Season ${res.data.season}`), tabs, table, status);
    if (server?.role === "owner") {
      const dialog = h("dialog", { class: "sheet modal-centre", "aria-label": "Start a new season?" }) as unknown as HTMLDialogElement;
      main.append(
        h("button", { onclick: () => {
          dialog.append(h("div", { class: "dialog-body" }, h("h2", { class: "dialog-title" }, "Start a new season?"), h("button", { class: "primary", onclick: async () => {
            const res2 = await api<{ season: number }>(`/api/servers/${slug}/seasons`, { method: "POST", body: {} });
            setStatus(status, `Season ${res2.data.season} started`);
            dialog.close();
            await load();
          } }, "Start season"), h("button", { onclick: () => dialog.close() }, "Keep season")));
          document.body.append(dialog);
          dialog.addEventListener("close", () => dialog.remove());
          dialog.showModal();
        } }, "Start new season")
      );
    }
  };
  for (const option of ["chess", "four", "tricks"] as const) {
    const tab = h("button", { role: "tab", "aria-selected": String(option === game), onclick: () => { game = option; void load(); } }, option === "chess" ? "Chess" : option === "four" ? "Four in a row" : "Card game");
    tabs.append(tab);
  }
  await load();
}

async function renderHistory(slug: string, main: HTMLElement): Promise<void> {
  clear(main);
  const search = asInput(h("input", { type: "search", "aria-label": "Search games", oninput: () => void load() }));
  const results = statusRegion("Search results", "search-results");
  const list = h("ul", { "aria-label": "Games" });
  const load = async (): Promise<void> => {
    const res = await api<{ games: { id: string; table_name: string; players: string[]; result_text: string }[]; total: number }>(`/api/servers/${slug}/games?q=${encodeURIComponent(search.value)}`);
    clear(list);
    for (const game of res.data.games) {
      list.append(h("li", {}, h("a", { href: `/s/${slug}/games/${game.id}`, onclick: (e: Event) => { e.preventDefault(); void navigate(`/s/${slug}/games/${game.id}`); } }, `${game.table_name}: ${game.players.join(" vs ")}`)));
    }
    setStatus(results, res.data.total === 1 ? "1 game found" : res.data.total === 0 ? "No games found" : `${res.data.total} games found`);
  };
  main.append(h("h1", {}, "Game history"), search, results, list);
  await load();
}

async function renderReplay(_slug: string, gameId: string, main: HTMLElement): Promise<void> {
  clear(main);
  const record = await api<{
    table_name: string;
    game: string;
    moves: { move: string; announcement: string }[];
    seats: { label: string; character: { id: string; name: string } | null }[];
    result: { text: string; settlement: { character_id: string; amount: number }[] } | null;
  }>(`/api/games/${gameId}`);
  const announcements = statusRegion("Replay announcements", "replay-announcements");
  const board = h("div", { role: "region", "aria-label": "Replay board", class: "card" });
  const result = h("div", { role: "region", "aria-label": "Result" });
  let index = record.data.moves.length;
  const counter = h("p", { class: "mono" });

  const drawAt = (n: number): void => {
    const move = record.data.moves[n - 1];
    const text = move === undefined ? "Start position" : move.announcement;
    clear(board);
    board.append(h("p", {}, text));
    counter.textContent = `Move ${n} of ${record.data.moves.length}`;
    if (n > 0 && record.data.moves[n - 1] !== undefined) {
      setStatus(announcements, `Move ${n} of ${record.data.moves.length}: ${record.data.moves[n - 1]!.announcement}`);
    } else {
      setStatus(announcements, `Move 0 of ${record.data.moves.length}: start position`);
    }
  };

  const controls = h("div", { style: "display: flex; gap: 8px" });
  controls.append(
    h("button", { onclick: () => { index = 1; drawAt(index); } }, "First move"),
    h("button", { onclick: () => { index = Math.max(1, index - 1); drawAt(index); } }, "Previous move"),
    h("button", { onclick: () => { index = Math.min(record.data.moves.length, index + 1); drawAt(index); } }, "Next move"),
    h("button", { onclick: () => { index = record.data.moves.length; drawAt(index); } }, "Last move")
  );
  controls.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      index = Math.max(1, index - 1);
      drawAt(index);
    }
    if (event.key === "ArrowRight") {
      index = Math.min(record.data.moves.length, index + 1);
      drawAt(index);
    }
    if (event.key === "Home") {
      index = 1;
      drawAt(index);
    }
    if (event.key === "End") {
      index = record.data.moves.length;
      drawAt(index);
    }
  });

  if (record.data.result !== null) {
    result.append(h("p", {}, record.data.result.text));
    for (const seat of record.data.seats) {
      const line = record.data.result.settlement.find((s) => s.character_id === seat.character?.id);
      const amount = line?.amount ?? 0;
      const signed = amount > 0 ? `+${amount}` : amount < 0 ? `${amount}` : "0";
      result.append(h("p", { class: "mono" }, `${seat.character?.name ?? seat.label}: ${signed}`));
    }
  }

  index = record.data.moves.length;
  drawAt(index);
  main.append(
    h("h1", {}, record.data.table_name),
    h("div", { class: "rail-layout" }, h("div", {}, board, announcements), h("div", {}, counter, controls, result))
  );
}
