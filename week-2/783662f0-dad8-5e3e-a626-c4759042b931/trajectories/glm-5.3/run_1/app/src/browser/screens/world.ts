/** The world view: map, rail, drawer, dialogs and the table panel. */

import { api, ApiError } from "../lib/api.js";
import { h, clear, statusRegion, setStatus, asInput } from "../lib/dom.js";
import { registerRoute, navigate, currentMe, renderTopbar } from "../app.js";
import { stream } from "../lib/sse.js";
import { setSound, Cues } from "../lib/sound.js";
import { Copy } from "../../shared/copy.js";
import { tileLabel, itemName, Recipes, BlockMaterials, Chapter } from "../../shared/data.js";

interface World {
  slug: string;
  name: string;
  width: number;
  height: number;
  tiles: string[];
  tables: { id: string; name: string; game: "chess" | "four" | "tricks"; x: number; y: number; state: string }[];
  blocks: { x: number; y: number; material: string }[];
  vehicles: { id: string; name: string; kind: "car" | "plane"; owner_character_id: string; x: number; y: number }[];
  characters: { id: string; name: string; x: number; y: number }[];
}

interface TableView {
  id: string;
  name: string;
  game: "chess" | "four" | "tricks";
  state: "open" | "seated" | "in_play" | "finished" | "settled";
  stake: number;
  turn_seconds: number;
  seats: { seat: number; label: string; character: { id: string; name: string } | null }[];
  spectators: { id: string; name: string }[];
  game_id: string | null;
  turn: number | null;
  to_move_seat: number | null;
  turn_remaining_ms: number | null;
  position: unknown;
  hand: string[] | null;
  hand_counts: number[] | null;
  result: { text: string; settlement: { character_id: string; amount: number }[] } | null;
  pending_store: boolean;
  rematch_offers: number[];
}

registerRoute("/s/([^/]+)/w/([^/]+)", (params, render) => renderWorld(params[0]!, params[1]!, null, render.main));
registerRoute("/s/([^/]+)/w/([^/]+)/t/([^/]+)", (params, render) => renderWorld(params[0]!, params[1]!, params[2]!, render.main));

export async function activeCharacterId(slug: string): Promise<string | null> {
  const res = await api<{ characters: { id: string; name: string }[] }>(`/api/servers/${slug}/characters?mine=true`);
  return res.data.characters[0]?.id ?? null;
}

export function chessSquareName(x: number, y: number): string {
  return `${String.fromCharCode(97 + x)}${8 - y}`;
}

async function renderWorld(slug: string, worldSlug: string, tableId: string | null, main: HTMLElement): Promise<void> {
  clear(main);
  const me = currentMe();
  const server = me?.servers.find((s) => s.slug === slug) ?? null;
  const res = await api<World>(`/api/servers/${slug}/worlds/${worldSlug}`);
  let world = res.data;
  let characterId: string | null = null;
  const chars = await api<{ characters: { id: string; name: string; x: number; y: number; balance: number; appearance: string }[] }>(
    `/api/servers/${slug}/characters?mine=true`
  );
  characterId = chars.data.characters[0]?.id ?? null;
  let active = chars.data.characters[0] ?? null;

  const announcements = statusRegion("World announcements", "world-announcements");
  const weatherStatus = statusRegion("Weather", "weather-status");
  const achievements = statusRegion("Achievements", "achievements");
  const coinGroup = h("div", { role: "group", "aria-label": "Coin balance", class: "mono" });
  const header = h("div", { style: "display:flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 8px 0" });
  const worldName = h("span", {}, world.name);
  const nightVeil = h("div", { class: "night-veil", "data-anim": "night-tint", "data-phase": "end" });

  // ---- The map ----
  const mapCanvas = h("div", { class: "map-canvas" });
  const tileGrid = h("div", { role: "grid", "aria-label": "World map", class: "tile-grid" });
  const tileSize = window.innerWidth < 768 ? 44 : 32;
  tileGrid.style.gridTemplateColumns = `repeat(${world.width}, ${tileSize}px)`;
  tileGrid.style.gridAutoRows = `${tileSize}px`;
  mapCanvas.append(tileGrid, nightVeil);
  const mapScroll = h("div", { class: "map-scroll", style: "border: 1px solid var(--ink); border-radius: 4px; height: 480px" }, mapCanvas);
  const worldRoot = h("div", { id: "world-root" }, header, mapScroll);

  let cursor = { x: active?.x ?? 16, y: active?.y ?? 8 };
  let parking: { vehicleId: string; vehicleName: string; kind: "car" | "plane" } | null = null;
  let material: string = BlockMaterials[0];

  function tileContents(x: number, y: number): string | null {
    const block = world.blocks.find((b) => b.x === x && b.y === y);
    const vehicle = world.vehicles.find((v) => v.x === x && v.y === y);
    const people = world.characters.filter((c) => c.x === x && c.y === y).map((c) => c.name);
    const parts: string[] = [];
    if (block !== undefined) parts.push(`${block.material} block`);
    if (vehicle !== undefined) parts.push(vehicle.name);
    for (const person of people) parts.push(person);
    return parts.length === 0 ? null : parts.join(", ");
  }

  function drawMap(): void {
    clear(tileGrid);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const code = world.tiles[y]![x]!;
        const tableHere = world.tables.find((t) => t.x === x && t.y === y);
        const label = code === "T" ? (tableHere?.name ?? "Table") : tileLabel(code);
        const contents = tileContents(x, y);
        const name = `${x}, ${y}, ${label}${contents !== null ? `, ${contents}` : ""}`;
        const cell = h(
          "div",
          {
            role: "gridcell",
            class: `tile ${code === "." ? "grass" : code === "~" ? "water" : code === "=" ? "road" : code === "#" ? "runway" : code === "s" ? "sand" : "table"}`,
            "aria-label": name,
            tabindex: x === cursor.x && y === cursor.y ? "0" : "-1",
            onclick: () => {
              cursor = { x, y };
              drawMap();
              drawInspector();
            },
            ondblclick: () => {
              cursor = { x, y };
              void parkHere();
            },
          },
          h("span", { class: "glyph" })
        );
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        const block = world.blocks.find((b) => b.x === x && b.y === y);
        if (block !== undefined) {
          cell.append(h("span", { class: "block-art", style: `background: ${block.material === "wood" ? "#a97b48" : block.material === "stone" ? "#9b9b93" : block.material === "brick" ? "#b4553a" : "#bcd8dd"}` }));
        }
        if (parking !== null && code === (parking.kind === "car" ? "=" : "#")) {
          cell.style.boxShadow = "inset 0 0 0 3px var(--accent)";
        }
        tileGrid.append(cell);
      }
    }
    const cursorCell = Array.from(tileGrid.children).find((c) => (c as HTMLElement).dataset.x === String(cursor.x) && (c as HTMLElement).dataset.y === String(cursor.y)) as HTMLElement | undefined;
    cursorCell?.classList.add("cursor");
  }

  async function walkCharacter(direction: "north" | "east" | "south" | "west"): Promise<void> {
    if (characterId === null) return;
    try {
      const res = await api<{ character: { x: number; y: number }; announcement: string; checkpoint: { name: string; stored: boolean } | null }>(
        `/api/characters/${characterId}/walk`,
        { method: "POST", body: { direction } }
      );
      setStatus(announcements, res.data.announcement);
      if (active !== null) {
        active.x = res.data.character.x;
        active.y = res.data.character.y;
      }
      cursor = { x: res.data.character.x, y: res.data.character.y };
      const chars2 = world.characters.find((c) => c.id === characterId);
      if (chars2 !== undefined) {
        chars2.x = res.data.character.x;
        chars2.y = res.data.character.y;
      }
      drawMap();
    } catch (err) {
      if (err instanceof ApiError) setStatus(announcements, err.failure.message);
    }
  }

  async function blockAction(kind: "place" | "break"): Promise<void> {
    if (characterId === null) return;
    try {
      if (kind === "place") {
        const res = await api<{ announcement: string }>(`/api/servers/${slug}/worlds/${worldSlug}/blocks`, {
          method: "POST",
          body: { character_id: characterId, x: cursor.x, y: cursor.y, material },
        });
        setStatus(announcements, res.data.announcement);
        world.blocks.push({ x: cursor.x, y: cursor.y, material });
      } else {
        const res = await api<{ announcement: string }>(`/api/servers/${slug}/worlds/${worldSlug}/blocks/break`, {
          method: "POST",
          body: { character_id: characterId, x: cursor.x, y: cursor.y },
        });
        setStatus(announcements, res.data.announcement);
        world.blocks = world.blocks.filter((b) => !(b.x === cursor.x && b.y === cursor.y));
      }
      drawMap();
      drawInspector();
    } catch (err) {
      if (err instanceof ApiError) setStatus(announcements, err.failure.message);
    }
  }

  async function parkHere(): Promise<void> {
    if (parking === null) return;
    try {
      const res = await api<{ announcement: string }>(`/api/vehicles/${parking.vehicleId}/park`, {
        method: "POST",
        body: { x: cursor.x, y: cursor.y },
      });
      setStatus(announcements, res.data.announcement);
      const vehicle = world.vehicles.find((v) => v.id === parking!.vehicleId);
      if (vehicle !== undefined) {
        vehicle.x = cursor.x;
        vehicle.y = cursor.y;
      }
      parking = null;
      drawMap();
      drawInspector();
    } catch (err) {
      if (err instanceof ApiError) setStatus(announcements, err.failure.message);
    }
  }

  // ---- The rail ----
  const partyRegion = h("section", { class: "rail-section", "aria-label": "Party", role: "region" });
  const inspectorRegion = h("section", { class: "rail-section", "aria-label": "Tile inspector", role: "region" });
  const chatRegion = h("section", { class: "rail-section", "aria-label": "Chat", role: "region" });
  const soundButton = h("button", { "aria-pressed": "true", onclick: async () => {
    const on = soundButton.getAttribute("aria-pressed") !== "true";
    setSound(on);
    soundButton.setAttribute("aria-pressed", String(on));
    await api("/api/me/preferences", { method: "POST", body: { sound: on } });
  } }, "Sound");
  const rail = h(
    "aside",
    { class: "complementary", role: "complementary", "aria-label": "World rail" },
    partyRegion,
    inspectorRegion,
    chatRegion,
    h("section", { class: "rail-section" }, soundButton)
  );

  function drawInspector(): void {
    clear(inspectorRegion);
    inspectorRegion.append(h("h3", {}, "Tile inspector"));
    const code = world.tiles[cursor.y]![cursor.x]!;
    const tableHere = world.tables.find((t) => t.x === cursor.x && t.y === cursor.y);
    const label = code === "T" ? (tableHere?.name ?? "Table") : tileLabel(code);
    inspectorRegion.append(h("p", {}, `${label} at ${cursor.x}, ${cursor.y}`));
    const contents = tileContents(cursor.x, cursor.y);
    if (contents !== null) inspectorRegion.append(h("p", {}, contents));
    const materialGroup = h("div", { role: "radiogroup", "aria-label": "Block material" });
    for (const mat of BlockMaterials) {
      materialGroup.append(h("label", {}, h("input", { type: "radio", name: "material", checked: mat === material, onchange: () => { material = mat; } }), mat[0]!.toUpperCase() + mat.slice(1)));
    }
    inspectorRegion.append(materialGroup);
    const buttons = h("div", { style: "display: flex; flex-wrap: wrap; gap: 8px" });
    if (active !== null && Math.abs(active.x - cursor.x) <= 1 && Math.abs(active.y - cursor.y) <= 1 && (Math.abs(active.x - cursor.x) + Math.abs(active.y - cursor.y)) === 1) {
      buttons.append(h("button", { onclick: () => void walkCharacter(directionTo(active!, cursor)) }, "Walk here"));
    }
    if ((code === "." || code === "s") && !world.blocks.some((b) => b.x === cursor.x && b.y === cursor.y)) {
      buttons.append(h("button", { onclick: () => void blockAction("place") }, "Place block"));
    }
    if (world.blocks.some((b) => b.x === cursor.x && b.y === cursor.y)) {
      buttons.append(h("button", { onclick: () => void blockAction("break") }, "Break block"));
    }
    if (tableHere !== undefined) {
      if (tableHere.state === "open" || tableHere.state === "seated") {
        buttons.append(h("button", { onclick: () => void takeSeat(tableHere.id) }, "Take seat"));
      }
      buttons.append(h("button", { onclick: () => void watchTable(tableHere.id) }, "Watch"));
    }
    const vehicleHere = world.vehicles.find((v) => v.x === cursor.x && v.y === cursor.y && v.owner_character_id === characterId);
    if (vehicleHere !== undefined) {
      buttons.append(h("button", { onclick: () => { parking = { vehicleId: vehicleHere.id, vehicleName: vehicleHere.name, kind: vehicleHere.kind }; setStatus(announcements, vehicleHere.kind === "car" ? Copy.vehicles.parkingCar(vehicleHere.name) : Copy.vehicles.parkingPlane(vehicleHere.name)); drawMap(); } }, `Move ${vehicleHere.name}`));
    }
    if (parking !== null) {
      buttons.append(h("button", { onclick: () => void parkHere() }, "Park here"));
      buttons.append(h("button", { onclick: () => { setStatus(announcements, Copy.vehicles.cancelled); parking = null; drawMap(); drawInspector(); } }, "Cancel parking"));
    }
    inspectorRegion.append(buttons);
  }

  function directionTo(from: { x: number; y: number }, to: { x: number; y: number }): "north" | "east" | "south" | "west" {
    if (to.y < from.y) return "north";
    if (to.y > from.y) return "south";
    if (to.x > from.x) return "east";
    return "west";
  }

  // ---- Chat ----
  function drawChat(messages: { id: string; character: { name: string }; text: string }[]): void {
    clear(chatRegion);
    chatRegion.append(h("h3", {}, "Chat"));
    const log = h("div", { role: "log", "aria-label": "Chat messages", class: "chat-log mono" });
    for (const message of messages) {
      log.append(h("div", {}, `${message.character.name}: ${message.text}`));
    }
    const input = asInput(h("input", { type: "text", "aria-label": "Message" }));
    chatRegion.append(
      log,
      h("form", { onsubmit: async (e: Event) => { e.preventDefault(); if (characterId === null) return; try { await api(`/api/servers/${slug}/worlds/${worldSlug}/chat`, { method: "POST", body: { character_id: characterId, text: input.value } }); input.value = ""; } catch (err) { if (err instanceof ApiError) setStatus(announcements, err.failure.message); } } }, input, h("button", { type: "submit" }, "Send"))
    );
  }

  async function loadChat(): Promise<void> {
    const messages = await api<{ messages: { id: string; character: { name: string }; text: string }[] }>(`/api/servers/${slug}/worlds/${worldSlug}/chat`);
    drawChat(messages.data.messages);
  }

  // ---- Parties ----
  async function drawParty(): Promise<void> {
    clear(partyRegion);
    partyRegion.append(h("h3", {}, "Party"));
    const parties = await api<{ parties: { id: string; name: string; leader_id: string; members: { character_id: string; name: string }[] }[] }>(`/api/servers/${slug}/parties`);
    const mine = parties.data.parties.find((p) => p.members.some((m) => m.character_id === characterId));
    if (mine === undefined) {
      const name = asInput(h("input", { type: "text", "aria-label": "Party name" }));
      partyRegion.append(h("form", { onsubmit: async (e: Event) => { e.preventDefault(); try { await api(`/api/servers/${slug}/parties`, { method: "POST", body: { character_id: characterId, name: name.value } }); await drawParty(); } catch (err) { if (err instanceof ApiError) setStatus(announcements, err.failure.message); } } }, name, h("button", { type: "submit" }, "Start party")));
      for (const party of parties.data.parties) {
        if (party.members.some((m) => m.character_id === characterId)) continue;
        partyRegion.append(h("button", { onclick: async () => { await api(`/api/parties/${party.id}/members`, { method: "POST", body: { character_id: characterId } }); await drawParty(); } }, `Join ${party.name}`));
      }
      return;
    }
    const list = h("ul", { "aria-label": "Party members" });
    for (const member of mine.members) {
      list.append(h("li", {}, member.name, member.character_id === mine.leader_id ? " (Leader)" : ""));
    }
    const leave = h("button", { onclick: async () => { await api(`/api/parties/${mine.id}/members/${characterId}`, { method: "DELETE" }); await drawParty(); } }, "Leave party");
    const chapter = h("button", { onclick: async () => { try { await api(`/api/parties/${mine.id}/chapter-runs`, { method: "POST", body: { chapter_id: Chapter.id } }); setStatus(announcements, `Chapter started: ${Chapter.title}`); } catch (err) { if (err instanceof ApiError) setStatus(announcements, err.failure.message); } } }, "Start chapter");
    partyRegion.append(list, h("div", { style: "display:flex; gap:8px" }, leave, chapter));
  }

  // ---- The header strip ----
  const inventoryButton = h("button", { onclick: () => openInventory() }, "Inventory");
  const tradeButton = h("button", { onclick: () => openTradeOffer() }, "Offer a trade");
  const fullscreenButton = h("button", { onclick: () => void toggleFullscreen() }, "Full screen");
  const saveButton = h("button", { onclick: async () => {
    setStatus(announcements, Copy.saves.saving);
    try {
      await api(`/api/servers/${slug}/worlds/${worldSlug}/saves`, { method: "POST", body: {} });
      setStatus(announcements, Copy.saves.saved);
    } catch (err) {
      if (err instanceof ApiError) setStatus(announcements, err.failure.error === "storage_unavailable" ? Copy.saves.notWritten : err.failure.message);
    }
  } }, "Save world");

  header.append(
    worldName,
    h("span", { class: "weather-badge status-word", role: "status", "aria-label": "Weather" }, "CLEAR"),
    weatherStatus,
    coinGroup,
    inventoryButton,
    tradeButton,
    fullscreenButton,
    saveButton
  );

  function drawCoins(): void {
    clear(coinGroup);
    const balance = active?.balance ?? 0;
    coinGroup.append(String(balance));
  }

  async function toggleFullscreen(): Promise<void> {
    const root = document.getElementById("world-root");
    if (root === null) return;
    if (document.fullscreenElement === null) {
      try {
        await root.requestFullscreen();
        fullscreenButton.textContent = "Exit full screen";
      } catch {
        setStatus(announcements, Copy.fullscreen.error);
      }
    } else {
      await document.exitFullscreen();
      fullscreenButton.textContent = "Full screen";
      fullscreenButton.focus();
    }
  }

  worldRoot.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement === null) fullscreenButton.textContent = "Full screen";
  });

  // ---- Keyboard ----
  worldRoot.addEventListener("keydown", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const typing = target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
    if (!typing && event.key === "f") {
      event.preventDefault();
      void toggleFullscreen();
    }
    if (!typing && event.key === "i") {
      event.preventDefault();
      openInventory();
    }
    if (!typing && event.key === "Escape" && parking !== null) {
      parking = null;
      setStatus(announcements, Copy.vehicles.cancelled);
      drawMap();
    }
    if (!typing && event.key === "Enter" && parking !== null) {
      event.preventDefault();
      void parkHere();
    }
    if (target !== null && target.role === "gridcell") {
      if (event.shiftKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const map: Record<string, "north" | "south" | "west" | "east"> = { ArrowUp: "north", ArrowDown: "south", ArrowLeft: "west", ArrowRight: "east" };
        void walkCharacter(map[event.key]!);
      } else if (!event.shiftKey && event.key === "b") {
        event.preventDefault();
        void blockAction("place");
      } else if (!event.shiftKey && event.key === "x") {
        event.preventDefault();
        void blockAction("break");
      }
    }
  });

  // ---- Dialogs ----
  function openInventory(): void {
    if (characterId === null) return;
    const dialog = h("dialog", { class: "sheet modal-centre", "aria-label": "Inventory" }) as unknown as HTMLDialogElement;
    const invStatus = statusRegion("Inventory announcements", "inventory-announcements");
    const grid = h("div", { role: "grid", "aria-label": "Inventory", class: "inventory-grid" });
    const crafting = h("div", { role: "region", "aria-label": "Crafting" });
    let carried: { slot: number; kind: string } | null = null;
    const load = async (): Promise<void> => {
      const inv = await api<{ slots: { slot: number; kind: string | null; count: number; held: number }[] }>(`/api/characters/${characterId}/inventory`);
      clear(grid);
      for (const slot of inv.data.slots) {
        const col = "abcdef"[(slot.slot - 1) % 6]!;
        const row = Math.ceil(slot.slot / 6);
        const name = slot.kind === null || slot.count === 0 ? "empty" : `${col}${row}, ${itemName(slot.kind)}, ${slot.count}`;
        const cell = h(
          "div",
          { role: "gridcell", class: "inv-cell", "aria-label": name, tabindex: slot.slot === 1 ? "0" : "-1", onclick: () => { cellAction(slot); } },
          slot.kind === null || slot.count === 0 ? "" : `${itemName(slot.kind)} ×${slot.count}`
        );
        cell.dataset.slot = String(slot.slot);
        grid.append(cell);
      }
      clear(crafting);
      crafting.append(h("h3", {}, "Crafting"));
      for (const recipe of Recipes) {
        crafting.append(
          h("button", {
            onclick: async () => {
              try {
                const res = await api<{ crafted: { kind: string } }>(`/api/characters/${characterId}/crafts`, { method: "POST", body: { recipe: recipe.id } });
                setStatus(invStatus, `Crafted ${itemName(res.data.crafted.kind)}`);
                await load();
              } catch (err) {
                if (err instanceof ApiError) setStatus(invStatus, err.failure.error === "missing_ingredients" ? `Missing ingredients for ${recipe.name}.` : err.failure.message);
              }
            },
          }, `Craft ${recipe.name}`)
        );
      }
    };
    const cellAction = (slot: { slot: number; kind: string | null; count: number }): void => {
      if (carried === null) {
        if (slot.kind === null || slot.count === 0) {
          setStatus(invStatus, "That slot is empty.");
          return;
        }
        carried = { slot: slot.slot, kind: slot.kind };
        setStatus(invStatus, `Picked up ${itemName(slot.kind)} from ${cellName(slot.slot)}`);
        return;
      }
      void (async () => {
        try {
          await api(`/api/characters/${characterId}/inventory/moves`, { method: "POST", body: { from: carried!.slot, to: slot.slot } });
          setStatus(invStatus, `Moved ${itemName(carried!.kind)} to ${cellName(slot.slot)}`);
        } catch (err) {
          if (err instanceof ApiError) setStatus(invStatus, err.failure.message);
        }
        carried = null;
        await load();
      })();
    };
    grid.addEventListener("keydown", (event) => {
      const cell = event.target instanceof HTMLElement ? event.target : null;
      if (cell === null || cell.dataset.slot === undefined) return;
      const slot = Number(cell.dataset.slot);
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        void api<{ slots: { slot: number; kind: string | null; count: number }[] }>(`/api/characters/${characterId}/inventory`)
          .then((inv) => cellAction(inv.data.slots[slot - 1]!))
          .catch(() => undefined);
      }
      if (event.key === "Escape" && carried !== null) {
        setStatus(invStatus, "Move cancelled");
        carried = null;
      }
    });
    const close = h("button", { onclick: () => dialog.close() }, "Close");
    dialog.append(
      h("div", { class: "dialog-body" },
        h("h2", { class: "dialog-title" }, "Inventory"),
        grid,
        crafting,
        invStatus,
        close
      )
    );
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    const first = grid.querySelector<HTMLElement>("[role=gridcell]");
    first?.focus();
    void load();
  }

  function cellName(slot: number): string {
    return `${"abcdef"[(slot - 1) % 6]!}${Math.ceil(slot / 6)}`;
  }

  function openTradeOffer(): void {
    if (characterId === null) return;
    const dialog = h("dialog", { class: "sheet modal-centre", "aria-label": "Offer a trade" }) as unknown as HTMLDialogElement;
    const partner = h("select", { "aria-label": "Partner" }) as unknown as HTMLSelectElement;
    const coins = asInput(h("input", { type: "number", value: "0", min: "0", "aria-label": "Coins to offer" }));
    const items = h("div", {});
    const status = statusRegion("Trade status", "trade-status");
    const load = async (): Promise<void> => {
      const chars = await api<{ characters: { id: string; name: string }[] }>(`/api/servers/${slug}/characters`);
      clear(partner);
      for (const character of chars.data.characters) {
        if (character.id === characterId) continue;
        partner.append(h("option", { value: character.id }, character.name));
      }
    };
    void load();
    const open = h("button", { class: "primary", onclick: async () => {
      try {
        await api(`/api/servers/${slug}/trades`, { method: "POST", body: { character_id: characterId, partner_id: partner.value, coins: Number(coins.value), items: {} } });
        setStatus(status, `Trade opened with ${partner.selectedOptions[0]?.textContent ?? ""}`);
        dialog.close();
      } catch (err) {
        if (err instanceof ApiError) setStatus(status, err.failure.message);
      }
    } }, "Open trade");
    dialog.append(h("div", { class: "dialog-body" }, h("h2", { class: "dialog-title" }, "Offer a trade"), partner, h("label", {}, "Coins to offer"), coins, items, open, status, h("button", { onclick: () => dialog.close() }, "Close")));
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }

  // ---- Tables ----
  async function takeSeat(tableId2: string): Promise<void> {
    if (characterId === null) return;
    try {
      await api(`/api/tables/${tableId2}/seats`, { method: "POST", body: { character_id: characterId } });
      Cues.seatTaken();
      await navigate(`/s/${slug}/w/${worldSlug}/t/${tableId2}`);
    } catch (err) {
      if (err instanceof ApiError) setStatus(announcements, err.failure.message);
    }
  }

  async function watchTable(tableId2: string): Promise<void> {
    if (characterId === null) return;
    try {
      await api(`/api/tables/${tableId2}/spectators`, { method: "POST", body: { character_id: characterId } });
      await navigate(`/s/${slug}/w/${worldSlug}/t/${tableId2}`);
    } catch (err) {
      if (err instanceof ApiError) setStatus(announcements, err.failure.message);
    }
  }

  // ---- Assemble ----
  const layout = h("div", { class: "rail-layout" }, h("div", {}, worldRoot, announcements, achievements), rail);
  main.append(layout);
  drawMap();
  drawInspector();
  drawCoins();
  await loadChat();
  await drawParty();
  void renderTopbar();

  // ---- Streams ----
  const serverStream = stream(`/api/servers/${slug}/events`, {
    onEvent: (event) => {
      if (event.event === "world") {
        world = event.data as World;
        drawMap();
        drawInspector();
      }
      if (event.event === "chat") {
        const message = event.data as { character: { name: string }; text: string };
        const log = chatRegion.querySelector("[role=log]");
        if (log !== null) log.append(h("div", {}, `${message.character.name}: ${message.text}`));
      }
      if (event.event === "weather") {
        const weather = event.data as { weather: string; night_level: number };
        const badge = header.querySelector(".weather-badge");
        if (badge !== null) badge.textContent = weather.weather.toUpperCase();
        setStatus(weatherStatus, weather.weather === "storm" ? Copy.weather.storm : weather.weather === "rain" ? Copy.weather.rain : Copy.weather.clear);
        nightVeil.style.opacity = String(weather.night_level);
      }
      if (event.event === "party") {
        void drawParty();
      }
      if (event.event === "achievement") {
        const achievement = event.data as { name: string };
        setStatus(achievements, `Achievement unlocked: ${achievement.name}`);
      }
      if (event.event === "trade") {
        setStatus(announcements, "A trade window is open.");
      }
    },
  });

  window.addEventListener("pick-character", (event) => {
    const detail = (event as CustomEvent<string>).detail;
    const found = chars.data.characters.find((c) => c.id === detail);
    if (found !== undefined) {
      active = found;
      characterId = found.id;
      cursor = { x: found.x, y: found.y };
      drawMap();
      drawInspector();
      drawCoins();
    }
  });

  // ---- The table panel ----
  if (tableId !== null) {
    const close = () => {
      void navigate(`/s/${slug}/w/${worldSlug}`);
    };
    const panel = h("dialog", { class: "sheet modal-centre felt-panel", "aria-label": "Table" }) as unknown as HTMLDialogElement;
    const gameAnnouncements = statusRegion("Game announcements", "game-announcements");
    const timer = h("div", { class: "clock", role: "timer", "aria-label": "Turn clock" });
    let table: TableView | null = null;

    const drawPanel = (): void => {
      if (table === null) return;
      clear(panel);
      const title = h("h2", { class: "dialog-title" }, table.name);
      const seats = h("ul", { "aria-label": "Seats" });
      for (const seat of table.seats) {
        seats.append(h("li", {}, `${seat.label}: ${seat.character?.name ?? "empty"}`));
      }
      const spectators = h("ul", { "aria-label": "Spectators" });
      for (const spectator of table.spectators) {
        spectators.append(h("li", {}, spectator.name));
      }
      const controls = h("div", { style: "display:flex; flex-wrap: wrap; gap: 8px; margin-top: 10px" });
      if (table.state === "seated") {
        controls.append(h("button", { class: "primary", onclick: async () => {
          await api(`/api/tables/${table!.id}/start`, { method: "POST", body: { character_id: characterId } });
        } }, "Start game"));
      }
      if (table.state === "in_play") {
        controls.append(h("button", { onclick: async () => { await api(`/api/tables/${table!.id}/forfeit`, { method: "POST", body: { character_id: characterId } }); } }, "Forfeit"));
      }
      if (table.state === "settled") {
        controls.append(h("button", { onclick: async () => { await api(`/api/tables/${table!.id}/rematch`, { method: "POST", body: { character_id: characterId } }); } }, "Offer rematch"));
      }
      if (table.result !== null) {
        controls.append(h("div", { role: "region", "aria-label": "Result" }, h("p", {}, table.result.text)));
      }
      const board = drawBoard(table);
      panel.append(h("div", { class: "dialog-body" }, title, seats, spectators, timer, board, controls, gameAnnouncements,
        h("div", { style: "display:flex; gap: 8px" },
          h("button", { onclick: () => void togglePanelFullscreen() }, "Full screen"),
          h("button", { onclick: close }, "Close table"),
          h("button", { onclick: async () => { await api(`/api/tables/${table!.id}/seats/${characterId}`, { method: "DELETE" }); close(); } }, "Stand up")
        )
      ));
    };

    const drawBoard = (t: TableView): HTMLElement => {
      if (t.game === "chess") {
        const position = t.position as { fen: string };
        const board = h("div", { role: "grid", "aria-label": "Chess board", class: "board-grid chess-board", style: "max-width: 480px; margin: 0 auto" });
        const parts = position.fen.split(" ")[0]!;
        const ranks = parts.split("/");
        let selected: { x: number; y: number } | null = null;
        const render = (): void => {
          clear(board);
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              const piece = ranks[y]![x]!;
              const squareName = chessSquareName(x, y);
              const label = piece === undefined ? `${squareName}, empty` : `${squareName}, ${pieceName(piece)}`;
              const cell = h("div", {
                role: "gridcell",
                class: `square ${(x + y) % 2 === 0 ? "light" : "dark"}`,
                "aria-label": label,
                tabindex: x === 0 && y === 0 ? "0" : "-1",
                onclick: () => {
                  if (selected === null) {
                    selected = { x, y };
                    cell.classList.add("selected");
                  } else {
                    void sendMove(`${chessSquareName(selected.x, selected.y)}${squareName}`);
                    selected = null;
                  }
                },
              }, piece === undefined ? "" : piece);
              cell.dataset.x = String(x);
              cell.dataset.y = String(y);
              if (selected !== null && selected.x === x && selected.y === y) cell.classList.add("selected");
              board.append(cell);
            }
          }
        };
        const sendMove = async (move: string): Promise<void> => {
          try {
            const res = await api<{ announcement: string }>(`/api/tables/${t.id}/moves`, {
              method: "POST",
              body: { character_id: characterId, turn: t.turn, move },
            });
            setStatus(gameAnnouncements, res.data.announcement);
            Cues.moveAccepted();
          } catch (err) {
            if (err instanceof ApiError) {
              setStatus(gameAnnouncements, err.failure.message);
              Cues.moveRefused();
            }
          }
        };
        board.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          const cell = event.target as HTMLElement;
          if (cell.dataset.x === undefined) return;
          const x = Number(cell.dataset.x);
          const y = Number(cell.dataset.y);
          event.preventDefault();
          if (selected === null) {
            selected = { x, y };
            render();
          } else {
            void sendMove(`${chessSquareName(selected.x, selected.y)}${chessSquareName(x, y)}`);
          }
        });
        render();
        return board;
      }
      if (t.game === "four") {
        const position = t.position as { rows: string[] };
        const board = h("div", { role: "grid", "aria-label": "Four in a row board", class: "board-grid four-board", style: "max-width: 380px; margin: 0 auto" });
        const dropButtons = h("div", { style: "display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 6px" });
        for (let col = 1; col <= 7; col++) {
          dropButtons.append(h("button", { onclick: () => void drop(col), "aria-label": `Drop in column ${col}` }, String(col)));
        }
        const drop = async (col: number): Promise<void> => {
          try {
            const res = await api<{ announcement: string }>(`/api/tables/${t.id}/moves`, {
              method: "POST",
              body: { character_id: characterId, turn: t.turn, move: String(col) },
            });
            setStatus(gameAnnouncements, res.data.announcement);
          } catch (err) {
            if (err instanceof ApiError) setStatus(gameAnnouncements, err.failure.message);
        }
        };
        for (let y = 0; y < 6; y++) {
          for (let x = 0; x < 7; x++) {
            const cellChar = position.rows[y]![x]!;
            const square = `${String.fromCharCode(97 + x)}${6 - y}`;
            const label = cellChar === "I" ? `${square}, Ink disc` : cellChar === "G" ? `${square}, Gold disc` : `${square}, empty`;
            board.append(h("div", {
              role: "gridcell",
              class: `square four-cell ${cellChar === "I" ? "ink" : cellChar === "G" ? "gold" : ""}`,
              "aria-label": label,
              tabindex: x === 0 && y === 0 ? "0" : "-1",
              onclick: () => void drop(x + 1),
            }, cellChar === "." ? "" : cellChar));
          }
        }
        return h("div", {}, dropButtons, board);
      }
      // The card game.
      const position = t.position as { trick: { seat: number; card: string }[]; led_suit: string | null };
      const handList = h("ul", { role: "listbox", "aria-label": "Your hand", "aria-activedescendant": "" });
      const trick = h("div", { role: "region", "aria-label": "Current trick" });
      for (const card of t.hand ?? []) {
        handList.append(h("li", { role: "option", tabindex: "-1", onclick: async () => { await playCard(card); } }, card));
      }
      for (const entry of position.trick) {
        trick.append(h("div", {}, `${entry.seat}: ${entry.card}`));
      }
      const playCard = async (card: string): Promise<void> => {
        try {
          const res = await api<{ announcement: string }>(`/api/tables/${t.id}/moves`, {
            method: "POST",
            body: { character_id: characterId, turn: t.turn, move: card },
          });
          setStatus(gameAnnouncements, res.data.announcement);
        } catch (err) {
          if (err instanceof ApiError) setStatus(gameAnnouncements, err.failure.message);
        }
      };
      return h("div", {}, handList, trick);
    };

    async function togglePanelFullscreen(): Promise<void> {
      if (document.fullscreenElement === null) {
        try {
          await panel.requestFullscreen();
        } catch {
          setStatus(gameAnnouncements, Copy.fullscreen.error);
        }
      } else {
        await document.exitFullscreen();
        const button = panel.querySelector("button");
        button?.focus();
      }
    }

    const reload = async (): Promise<void> => {
      const res = await api<TableView>(`/api/tables/${tableId}`);
      table = res.data;
      drawPanel();
    };
    await reload();
    document.body.append(panel);
    panel.addEventListener("close", () => {
      panel.remove();
      serverStream.close();
    });
    panel.showModal();
    void stream(`/api/tables/${tableId}/events`, {
      onEvent: (event) => {
        if (event.event === "table") {
          table = event.data as TableView;
          drawPanel();
        }
        if (event.event === "announcement") {
          const data = event.data as { text: string };
          setStatus(gameAnnouncements, data.text);
        }
      },
    });
    const clock = setInterval(() => {
      if (table === null || table.turn_remaining_ms === null) return;
      const elapsed = performance.now();
      const seconds = Math.max(0, Math.ceil((table!.turn_remaining_ms! - elapsed) / 1000));
      timer.textContent = seconds > 0 ? `${seconds} s` : "0 s";
    }, 1000);
    panel.addEventListener("close", () => clearInterval(clock));
  }
  void server;
}

function pieceName(piece: string): string {
  const map: Record<string, string> = { p: "Black Pawn", n: "Black Knight", b: "Black Bishop", r: "Black Rook", q: "Black Queen", k: "Black King" };
  const upperMap: Record<string, string> = { P: "White Pawn", N: "White Knight", B: "White Bishop", R: "White Rook", Q: "White Queen", K: "White King" };
  return map[piece] ?? upperMap[piece] ?? "empty";
}
