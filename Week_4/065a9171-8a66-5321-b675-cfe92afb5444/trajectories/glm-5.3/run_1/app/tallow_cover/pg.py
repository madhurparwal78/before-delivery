"""Minimal PostgreSQL client: SCRAM-SHA-256 auth and the extended query protocol.

Everything is sent in text format; values are returned as decoded strings or None,
and callers convert dates, numbers and timestamps themselves. A connection is a
single socket guarded by a lock; Pool hands out fresh connections and returns
them to the pool on release.
"""
import base64
import hashlib
import hmac
import os
import socket
import struct
import threading


class DbError(Exception):
    def __init__(self, payload):
        fields = {}
        i = 0
        while i < len(payload) - 1:
            code = payload[i:i + 1]
            if code == b"\x00":
                break
            end = payload.index(b"\x00", i + 1)
            fields[code.decode()] = payload[i + 1:end].decode(errors="replace")
            i = end + 1
        self.fields = fields
        super().__init__(fields.get("M", "database error"))


def _recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError("connection closed")
        buf += chunk
    return bytes(buf)


def _recv_msg(sock):
    tag = _recv_exact(sock, 1)
    length = struct.unpack("!i", _recv_exact(sock, 4))[0]
    return tag, _recv_exact(sock, length - 4)


class Conn:
    def __init__(self, host, port, user, password, database):
        self.sock = socket.create_connection((host, port), timeout=15)
        self.sock.settimeout(600)
        self.lock = threading.Lock()
        self.tx_status = None
        self.last_tag = ""
        params = f"user\x00{user}\x00database\x00{database}\x00\x00".encode()
        body = struct.pack("!i", 196608) + params
        self.sock.sendall(struct.pack("!i", len(body) + 4) + body)
        while True:
            tag, payload = _recv_msg(self.sock)
            if tag == b"E":
                raise DbError(payload)
            if tag == b"R":
                code = struct.unpack("!i", payload[:4])[0]
                if code == 10:
                    self._sasl(password)
                elif code not in (0,):
                    raise RuntimeError(f"unsupported auth code {code}")
            elif tag == b"Z":
                self.tx_status = payload[0:1]
                break

    def _sasl(self, password):
        cnonce = base64.b64encode(os.urandom(18)).decode()
        client_first_bare = f"n=,r={cnonce}".encode()
        client_first = b"n,," + client_first_bare
        mech = b"SCRAM-SHA-256"
        inner = mech + b"\x00" + struct.pack("!i", len(client_first)) + client_first
        self.sock.sendall(b"p" + struct.pack("!i", len(inner) + 4) + inner)
        tag, payload = _recv_msg(self.sock)
        if tag == b"E":
            raise DbError(payload)
        server_first = payload[4:].decode()
        d = dict(x.split("=", 1) for x in server_first.split(","))
        r, s_b64, iterations = d["r"], d["s"], int(d["i"])
        if not r.startswith(cnonce):
            raise RuntimeError("bad nonce")
        salt = base64.b64decode(s_b64)
        salted = hashlib.pbkdf2_hmac("sha256", (password + "\x00").encode(), salt, iterations)
        client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
        stored_key = hashlib.sha256(client_key).digest()
        client_final_wo = f"c=biws,r={r}".encode()
        auth_message = client_first_bare + b"," + server_first.encode() + b"," + client_final_wo
        client_sig = hmac.new(stored_key, auth_message, hashlib.sha256).digest()
        proof = base64.b64encode(bytes(a ^ b for a, b in zip(client_key, client_sig))).decode()
        client_final = client_final_wo + f",p={proof}".encode()
        self.sock.sendall(b"p" + struct.pack("!i", len(client_final) + 4) + client_final)
        while True:
            tag, payload = _recv_msg(self.sock)
            if tag == b"E":
                raise DbError(payload)
            if tag == b"R":
                code = struct.unpack("!i", payload[:4])[0]
                if code == 12:
                    d2 = dict(x.split("=", 1) for x in payload[4:].decode().split(","))
                    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
                    expect = hmac.new(server_key, auth_message, hashlib.sha256).digest()
                    if base64.b64decode(d2["v"]) != expect:
                        raise RuntimeError("server signature mismatch")
                elif code == 0:
                    return

    def execute(self, sql, params=()):
        with self.lock:
            return self._execute_locked(sql, list(params))

    def _execute_locked(self, sql, params):
        out = bytearray()
        q = sql.encode()
        parse_body = b"\x00" + q + b"\x00" + struct.pack("!h", 0)
        out += b"P" + struct.pack("!i", len(parse_body) + 4) + parse_body
        bind = bytearray(b"\x00\x00")
        bind += struct.pack("!h", 0)
        bind += struct.pack("!h", len(params))
        for p in params:
            if p is None:
                bind += struct.pack("!i", -1)
            elif isinstance(p, bytes):
                # bytea travels as hex text: the only safe text-format spelling.
                pb = b"\\x" + p.hex().encode()
                bind += struct.pack("!i", len(pb)) + pb
            else:
                pb = str(p).encode()
                bind += struct.pack("!i", len(pb)) + pb
        bind += struct.pack("!h", 0)
        out += b"B" + struct.pack("!i", len(bind) + 4) + bind
        out += b"D" + struct.pack("!i", 6) + b"P\x00"
        out += b"E" + struct.pack("!i", 9) + b"\x00" + struct.pack("!i", 0)
        out += b"S" + struct.pack("!i", 4)
        self.sock.sendall(out)
        rows = []
        while True:
            tag, payload = _recv_msg(self.sock)
            if tag == b"D":
                ncols = struct.unpack("!h", payload[:2])[0]
                i = 2
                row = []
                for _ in range(ncols):
                    ln = struct.unpack("!i", payload[i:i + 4])[0]
                    i += 4
                    if ln == -1:
                        row.append(None)
                    else:
                        row.append(payload[i:i + ln])
                        i += ln
                rows.append(tuple(row))
            elif tag == b"C":
                self.last_tag = payload.rstrip(b"\x00").decode()
            elif tag == b"Z":
                self.tx_status = payload[0:1]
                return rows
            elif tag == b"E":
                err = DbError(payload)
                while True:
                    t2, _ = _recv_msg(self.sock)
                    if t2 == b"Z":
                        break
                raise err

    def close(self):
        try:
            self.sock.sendall(b"X" + struct.pack("!i", 4))
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


class Pool:
    def __init__(self, host, port, user, password, database, size=8):
        self.host, self.port, self.user, self.password, self.database = host, port, user, password, database
        self.size = size
        self.free = []
        self.lock = threading.Lock()

    def acquire(self):
        with self.lock:
            while self.free:
                conn = self.free.pop()
                if conn.tx_status in (b"I", b"T", b"E"):
                    return conn
                conn.close()
        return Conn(self.host, self.port, self.user, self.password, self.database)

    def release(self, conn):
        if conn.tx_status not in (b"I", b"T", b"E"):
            conn.close()
            return
        with self.lock:
            if len(self.free) < self.size:
                self.free.append(conn)
            else:
                conn.close()
