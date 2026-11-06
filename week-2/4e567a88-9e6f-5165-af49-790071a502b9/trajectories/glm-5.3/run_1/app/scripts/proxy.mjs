// A TCP proxy for outage tests: pass-through or silent (forwards, never responds).
// usage: node proxy.mjs <listenPort> <targetHost> <targetPort> <pass|silent>
import net from "node:net";

const [port, host, targetPort, mode] = [Number(process.argv[2]), process.argv[3], Number(process.argv[4]), process.argv[5]];
if (!port || !host || !targetPort || !mode) {
  console.error("usage: node proxy.mjs <listenPort> <targetHost> <targetPort> <pass|silent>");
  process.exit(1);
}

net
  .createServer((socket) => {
    const upstream = net.connect({ host, port: targetPort });
    socket.pipe(upstream);
    if (mode === "silent") {
      // Swallow the response: the caller times out while the request reached the target.
      upstream.on("data", () => {
        upstream.resume();
      });
      socket.on("error", () => undefined);
    } else {
      upstream.pipe(socket);
    }
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`proxy ${mode} listening on ${port} -> ${host}:${targetPort}`);
  });
