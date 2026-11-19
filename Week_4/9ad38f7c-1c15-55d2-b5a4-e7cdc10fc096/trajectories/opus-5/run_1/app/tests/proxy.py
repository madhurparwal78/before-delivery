"""A tiny TCP forwarder, so the checks can take the database away and give it back."""

from __future__ import annotations

import socket
import sys
import threading
import time


class Proxy:
    def __init__(self, listen_port: int, target_host: str, target_port: int) -> None:
        self.listen_port = listen_port
        self.target = (target_host, target_port)
        self._server: socket.socket | None = None
        self._connections: list[socket.socket] = []
        self._running = False

    def start(self) -> None:
        self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server.bind(("127.0.0.1", self.listen_port))
        self._server.listen(64)
        self._running = True
        threading.Thread(target=self._accept_loop, daemon=True).start()

    def _accept_loop(self) -> None:
        while self._running:
            try:
                client, _ = self._server.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, 5)
            except OSError:
                client.close()
                continue
            self._connections += [client, upstream]
            threading.Thread(
                target=self._pump, args=(client, upstream), daemon=True
            ).start()
            threading.Thread(
                target=self._pump, args=(upstream, client), daemon=True
            ).start()

    @staticmethod
    def _pump(source: socket.socket, sink: socket.socket) -> None:
        try:
            while True:
                chunk = source.recv(65536)
                if not chunk:
                    break
                sink.sendall(chunk)
        except OSError:
            pass
        finally:
            for side in (source, sink):
                try:
                    side.close()
                except OSError:
                    pass

    def stop(self) -> None:
        self._running = False
        if self._server is not None:
            try:
                self._server.close()
            except OSError:
                pass
            self._server = None
        for connection in self._connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                connection.close()
            except OSError:
                pass
        self._connections = []

    def serve_forever(self) -> None:
        self.start()
        while self._running:
            time.sleep(0.2)


def main() -> None:
    listen_port, target_host, target_port = (
        int(sys.argv[1]),
        sys.argv[2],
        int(sys.argv[3]),
    )
    Proxy(listen_port, target_host, target_port).serve_forever()


if __name__ == "__main__":
    main()
