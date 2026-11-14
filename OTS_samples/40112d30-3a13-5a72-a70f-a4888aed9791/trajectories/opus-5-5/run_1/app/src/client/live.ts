export type LiveMessage = { type: string } & Record<string, unknown>;

/** One WebSocket at /ws on this origin; it rejoins after a drop. */
export function connectLive(join: Record<string, unknown>, onMessage: (message: LiveMessage) => void): { send(message: unknown): void } {
  let socket: WebSocket | null = null;
  let closedForGood = false;
  const open = (): void => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    socket = new WebSocket(url);
    socket.addEventListener("open", () => socket?.send(JSON.stringify({ type: "join", ...join })));
    socket.addEventListener("message", (event) => {
      try {
        onMessage(JSON.parse(String(event.data)) as LiveMessage);
      } catch {
        // Ignore anything that is not a live message.
      }
    });
    socket.addEventListener("close", (event) => {
      if (event.code === 4404) closedForGood = true;
      if (!closedForGood) setTimeout(open, 2000);
    });
  };
  open();
  return {
    send(message: unknown) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
  };
}
