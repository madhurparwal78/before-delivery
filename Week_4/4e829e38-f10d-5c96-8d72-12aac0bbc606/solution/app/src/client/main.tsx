import { render } from "preact";
import { App } from "./App";
import { get } from "./api";
import { configStore, session } from "./store";
import type { Config, Me } from "./types";
import "./app.css";

async function boot(): Promise<void> {
  const [config, me] = await Promise.all([get<Config>("/api/config"), get<Me>("/api/me")]);
  if (config.ok) configStore.set(config.data);
  document.documentElement.style.setProperty("--move-ms", `${configStore.get().moveMs}ms`);
  session.set(me.ok ? me.data : null);
  render(<App />, document.getElementById("app")!);
}

void boot();
