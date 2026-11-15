import { useEffect, useState } from "react";
import type { ClientConfig, ShelfLibrary } from "../shared/types.js";
import { api } from "./api.js";

let loaded: Promise<ClientConfig> | null = null;
let shelf: Promise<ShelfLibrary[]> | null = null;

export function loadConfig(): Promise<ClientConfig> {
  loaded ??= api.get<ClientConfig>("/api/config");
  return loaded;
}

export function loadShelf(): Promise<ShelfLibrary[]> {
  shelf ??= api.get<{ libraries: ShelfLibrary[] }>("/api/shelf").then((answer) => answer.libraries);
  return shelf;
}

export function useConfig(): ClientConfig | null {
  const [config, setConfig] = useState<ClientConfig | null>(null);
  useEffect(() => {
    void loadConfig().then(setConfig);
  }, []);
  return config;
}
