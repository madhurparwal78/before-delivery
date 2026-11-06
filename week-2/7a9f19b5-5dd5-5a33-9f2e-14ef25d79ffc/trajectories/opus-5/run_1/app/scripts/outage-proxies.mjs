/** Brings the dead provider ports to life so the recovery checks can run. */
import { connect, createServer } from "node:net";

const FORWARDS = [
  [18080, "killbill", 8080],
  [19000, "minio", 9000],
  [18090, "pocketbase", 8090],
];

export async function startProxies() {
  for (const [listenPort, host, port] of FORWARDS) {
    const server = createServer((client) => {
      const upstream = connect({ host, port });
      client.pipe(upstream);
      upstream.pipe(client);
      const drop = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on("error", drop);
      upstream.on("error", drop);
    });
    server.unref();
    await new Promise((resolve) => server.listen(listenPort, "127.0.0.1", resolve));
    console.log(`  proxy up: ${listenPort} -> ${host}:${port}`);
  }
}
