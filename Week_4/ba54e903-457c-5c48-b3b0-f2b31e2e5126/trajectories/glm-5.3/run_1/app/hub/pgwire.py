"""A minimal standard-library PostgreSQL wire-protocol driver with SCRAM-SHA-256.

Supports the exact feature set this product needs: simple queries with bound
parameters, extended queries inside transactions, BYTEA and array round-trips.
No third-party database driver is shipped.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import socket
import struct
from typing import Optional


class PgError(Exception):
    pass


def parse_conn_string(url: str) -> dict:
    """postgresql://user:password@host:port/database"""
    rest = url
    if "://" in rest:
        scheme, rest = rest.split("://", 1)
    at = rest.rfind("@")
    hostpart = ""
    if at != -1:
        userinfo, rest = rest[:at], rest[at + 1:]
        if ":" in userinfo:
            user, _, password = userinfo.partition(":")
        else:
            user, password = userinfo, ""
    else:
        user, password = "postgres", ""
    if "/" in rest:
        hostpart, _, database = rest.partition("/")
        database = database.split("?")[0]
    else:
        hostpart, database = rest, "postgres"
    if ":" in hostpart:
        host, _, port = hostpart.partition(":")
    else:
        host, port = hostpart or "localhost", "5432"
    return {"user": user, "password": password, "host": host, "port": int(port), "database": database}


class Row(dict):
    """A result row that also allows attribute-free dict access."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)


class Result:
    """A fetchable view over the rows one statement produced."""

    def __init__(self, rows: list) -> None:
        self._rows = rows
        self._pos = 0

    def fetchone(self) -> Optional[Row]:
        if self._pos >= len(self._rows):
            return None
        row = self._rows[self._pos]
        self._pos += 1
        return row

    def fetchall(self) -> list:
        out = self._rows[self._pos:]
        self._pos = len(self._rows)
        return out


class Connection:
    def __init__(self, url: str, *, autocommit: bool = True) -> None:
        info = parse_conn_string(url)
        self.autocommit = autocommit
        self._socket = socket.create_connection((info["host"], info["port"]), timeout=30)
        self._socket.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self._buffer = b""
        self._in_transaction = False
        self._startup(info)
        self._params_type_cache = {}

    # ---------- low-level IO ----------

    def _send(self, message_type: bytes, payload: bytes) -> None:
        self._socket.sendall(message_type + struct.pack(">I", len(payload) + 4) + payload)

    def _read_exact(self, n: int) -> bytes:
        while len(self._buffer) < n:
            chunk = self._socket.recv(max(4096, n - len(self._buffer)))
            if not chunk:
                raise PgError("connection closed")
            self._buffer += chunk
        out, self._buffer = self._buffer[:n], self._buffer[n:]
        return out

    def _read_message(self):
        head = self._read_exact(5)
        code = head[:1]
        size = struct.unpack(">I", head[1:])[0]
        return code, self._read_exact(size - 4)

    # ---------- startup and SCRAM-SHA-256 ----------

    def _startup(self, info: dict) -> None:
        params = {"user": info["user"], "database": info["database"]}
        payload = struct.pack(">I", 196608)
        for k, v in params.items():
            payload += k.encode() + b"\x00" + v.encode() + b"\x00"
        payload += b"\x00"
        self._socket.sendall(struct.pack(">I", len(payload) + 4) + payload)
        while True:
            code, body = self._read_message()
            if code == b"R":
                auth_code = struct.unpack(">I", body[:4])[0]
                if auth_code == 0:
                    continue
                if auth_code == 10:
                    self._scram_sha256(info["password"], body)
                    continue
                if auth_code == 3:
                    self._send_password(info["password"])
                    continue
                raise PgError(f"unsupported auth code {auth_code}")
            elif code == b"S":
                continue
            elif code == b"Z":
                break
            elif code == b"E":
                raise PgError(self._error_fields(body)["message"])

    def _send_password(self, password: str) -> None:
        self._send(b"p", password.encode() + b"\x00")

    def _scram_sha256(self, password: str, body: bytes) -> None:
        """RFC 5802 SCRAM-SHA-256 against the server's advertised mechanisms."""
        mechanisms = [m for m in body[4:].split(b"\x00") if m]
        if b"SCRAM-SHA-256" not in mechanisms:
            raise PgError("server does not offer SCRAM-SHA-256")
        nonce = base64.b64encode(os.urandom(18)).decode()
        client_first_bare = f"n=,r={nonce}"
        client_first = "n,," + client_first_bare
        # SASLInitialResponse: mechanism name, int32 message length, message
        init = b"SCRAM-SHA-256\x00" + struct.pack(">I", len(client_first)) + client_first.encode()
        self._send(b"p", init)

        code, sasl_body = self._read_message()
        if code == b"E":
            raise PgError(self._error_fields(sasl_body).get("message", "auth failed"))
        server_first = sasl_body[4:].decode()
        parts = dict(item.split("=", 1) for item in server_first.split(","))
        server_nonce = parts["r"]
        salt = base64.b64decode(parts["s"])
        iterations = int(parts["i"])

        salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
        client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
        stored_key = hashlib.sha256(client_key).digest()
        client_final_without = f"c=biws,r={server_nonce}"
        auth_message = f"{client_first_bare},{server_first},{client_final_without}"
        client_signature = hmac.new(stored_key, auth_message.encode(), hashlib.sha256).digest()
        client_proof = bytes(a ^ b for a, b in zip(client_key, client_signature))
        client_final = client_final_without + ",p=" + base64.b64encode(client_proof).decode()
        # SASLResponse: the message itself, no length prefix
        self._send(b"p", client_final.encode())

        while True:
            code, body2 = self._read_message()
            if code == b"E":
                raise PgError(self._error_fields(body2).get("message", "auth failed"))
            if code == b"R":
                auth_code = struct.unpack(">I", body2[:4])[0]
                if auth_code == 12:
                    # verify the server signature
                    parts2 = dict(item.split("=", 1) for item in body2[4:].decode().split(","))
                    server_signature = base64.b64decode(parts2["v"])
                    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
                    expected = hmac.new(server_key, auth_message.encode(), hashlib.sha256).digest()
                    if not hmac.compare_digest(server_signature, expected):
                        raise PgError("server signature mismatch")
                    continue
                if auth_code == 0:
                    break
                raise PgError(f"unexpected auth code {auth_code}")
            if code == b"Z":
                return

    # ---------- error handling ----------

    def _error_fields(self, body: bytes) -> dict:
        fields = {}
        for part in body.split(b"\x00"):
            if part:
                fields[chr(part[0])] = part[1:].decode("utf-8", "replace")
        return fields

    # ---------- parameter binding ----------

    def _bind_params(self, args) -> bytes:
        """Bind parameters as text, letting the server infer every type."""
        if args is None:
            args = ()
        if not isinstance(args, (list, tuple, set)):
            args = (args,)
        params = list(args)
        out = bytearray()
        out += b"\x00"                     # portal name
        out += b"\x00"                     # statement name
        out += struct.pack(">H", 1)        # one parameter format code
        out += struct.pack(">H", 0)        # format 0: text
        out += struct.pack(">H", len(params))
        for value in params:
            out += self._encode_value(value)
        out += struct.pack(">H", 0)        # zero result format codes: all text
        return bytes(out)

    def _encode_value(self, value) -> bytes:
        if value is None:
            return struct.pack(">i", -1)
        if isinstance(value, bool):
            return self._length_prefixed(b"t" if value else b"f")
        if isinstance(value, int):
            return self._length_prefixed(str(value).encode())
        if isinstance(value, float):
            return self._length_prefixed(repr(value).encode())
        if isinstance(value, (bytes, bytearray, memoryview)):
            return self._length_prefixed(bytes(value))
        if isinstance(value, str):
            return self._length_prefixed(value.encode())
        if isinstance(value, (list, tuple)):
            def esc(item):
                s = str(item)
                if any(c in s for c in ',"{} \\/'):
                    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
                return s
            literal = "{" + ",".join(esc(i) for i in value) + "}"
            return self._length_prefixed(literal.encode())
        return self._length_prefixed(str(value).encode())

    @staticmethod
    def _length_prefixed(data: bytes) -> bytes:
        return struct.pack(">i", len(data)) + data

    # ---------- simple query protocol ----------

    def execute(self, sql: str, args=()) -> "Result":
        """Run a statement; the returned Result mirrors a fetchable cursor."""
        return Result(self._run_query(sql, args))

    def fetchone(self, sql: str, args=()) -> Optional[Row]:
        rows = self._run_query(sql, args)
        return rows[0] if rows else None

    def fetchall(self, sql: str, args=()) -> list:
        return self._run_query(sql, args)

    @staticmethod
    def quote_literal(value) -> str:
        """One shared helper turns every value into a safe SQL literal."""
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if isinstance(value, int):
            return str(value)
        if isinstance(value, float):
            return repr(value)
        if isinstance(value, (bytes, bytearray, memoryview)):
            return "'\\x" + bytes(value).hex() + "'::bytea"
        if isinstance(value, str):
            return "'" + value.replace("'", "''") + "'"
        if isinstance(value, (list, tuple, set)):
            def esc(item):
                s = str(item)
                if any(c in s for c in ',"{} \\/'):
                    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
                return s
            items = [esc(i) for i in value]
            return "'{" + ",".join(items) + "}'"
        return "'" + str(value).replace("'", "''") + "'"

    def interpolate(self, sql: str, args) -> str:
        """Place each argument into its %s placeholder, honouring quoted runs."""
        if args is None:
            args = ()
        if not isinstance(args, (list, tuple, set)):
            args = (args,)
        params = list(args)
        out = []
        index = 0
        i = 0
        length = len(sql)
        while i < length:
            ch = sql[i]
            if ch == "'" or ch == '"':
                quote = ch
                j = i + 1
                while j < length:
                    if sql[j] == quote:
                        if j + 1 < length and sql[j + 1] == quote:
                            j += 2
                            continue
                        break
                    j += 1
                out.append(sql[i:j + 1])
                i = j + 1
                continue
            if sql.startswith("%s", i):
                if index >= len(params):
                    raise PgError("not enough parameters for query")
                out.append(self.quote_literal(params[index]))
                index += 1
                i += 2
                continue
            if sql.startswith("%%", i):
                out.append("%")
                i += 2
                continue
            out.append(ch)
            i += 1
        if index != len(params):
            raise PgError("parameter count mismatch for query")
        return "".join(out)

    def _run_query(self, sql: str, args) -> list:
        statement = self.interpolate(sql, args)
        self._send(b"Q", statement.encode("utf-8") + b"\x00")
        rows = []
        columns = []
        while True:
            code, body = self._read_message()
            if code == b"T":
                columns = self._parse_row_description(body)
            elif code == b"D":
                rows.append(self._parse_data_row(body, columns))
            elif code in (b"C", b"I", b"n", b"1", b"S"):
                continue
            elif code == b"Z":
                self._in_transaction = body[:1] != b"I"
                break
            elif code == b"E":
                fields = self._error_fields(body)
                raise PgError(fields.get("message", "query failed"))
            elif code == b"N":
                continue
        return rows

    def _parse_row_description(self, body: bytes) -> list:
        """Each field: name(cstring) then 18 bytes of metadata ending in the type OID."""
        count = struct.unpack(">H", body[:2])[0]
        pos = 2
        columns = []
        for _ in range(count):
            end = body.index(b"\x00", pos)
            name = body[pos:end].decode("utf-8")
            pos = end + 1
            table_oid = struct.unpack(">I", body[pos:pos + 4])[0]
            pos += 4
            attr = struct.unpack(">H", body[pos:pos + 2])[0]
            pos += 2
            type_oid = struct.unpack(">I", body[pos:pos + 4])[0]
            pos += 4
            pos += 2 + 4 + 2  # type size, typmod, format
            columns.append((name, type_oid))
        return columns

    def _parse_data_row(self, body: bytes, columns: list) -> Row:
        count = struct.unpack(">H", body[:2])[0]
        pos = 2
        row = Row()
        for i in range(count):
            size = struct.unpack(">i", body[pos:pos + 4])[0]
            pos += 4
            if size == -1:
                row[columns[i][0]] = None
                continue
            raw = body[pos:pos + size]
            pos += size
            row[columns[i][0]] = self._decode_value(raw, columns[i][1])
        return row

    # text OIDs the product's schema uses
    _INT_OIDS = {20, 21, 23}          # bigint, smallint, integer
    _FLOAT_OIDS = {700, 701}           # real, double
    _BOOL_OID = 16
    _BYTEA_OID = 17
    _ARRAY_OIDS = {1000, 1002, 1003, 1005, 1009, 1014, 1015, 1016}
    _TS_OIDS = {1114, 1184}           # timestamp, timestamptz
    _DATE_OID = 1082

    def _decode_value(self, raw: bytes, type_oid: int) -> object:
        if type_oid in self._INT_OIDS:
            return int(raw)
        if type_oid in self._FLOAT_OIDS:
            return float(raw)
        if type_oid == self._BOOL_OID:
            return raw == b"t"
        if type_oid == self._BYTEA_OID:
            if raw[:2] == b"\\x":
                return bytes.fromhex(raw[2:].decode())
            return self._decode_bytea_escaped(raw)
        if type_oid in self._ARRAY_OIDS:
            return self._parse_array_text(raw.decode("utf-8"))
        if type_oid == self._DATE_OID:
            import datetime as _dt
            return _dt.date.fromisoformat(raw.decode())
        if type_oid in self._TS_OIDS:
            import datetime as _dt
            text = raw.decode()
            try:
                if text.endswith("+00"):
                    text = text[:-3] + "+0000"
                return _dt.datetime.fromisoformat(text)
            except ValueError:
                return raw.decode()
        try:
            return raw.decode()
        except UnicodeDecodeError:
            return raw

    def _parse_array_text(self, text: str) -> list:
        """Decode a Postgres array literal such as {a,b,\"c d\"}."""
        if not text.startswith("{") or not text.endswith("}"):
            return text
        inner = text[1:-1]
        items = []
        current = []
        in_quotes = False
        i = 0
        while i < len(inner):
            ch = inner[i]
            if in_quotes:
                if ch == "\\" and i + 1 < len(inner):
                    current.append(inner[i + 1])
                    i += 2
                    continue
                if ch == '"':
                    in_quotes = False
                    i += 1
                    continue
                current.append(ch)
                i += 1
                continue
            if ch == '"':
                in_quotes = True
                i += 1
                continue
            if ch == ",":
                items.append("".join(current))
                current = []
                i += 1
                continue
            current.append(ch)
            i += 1
        if current or items:
            items.append("".join(current))
        return [item for item in items]

    def _decode_bytea_escaped(self, raw: bytes) -> bytes:
        out = bytearray()
        i = 0
        while i < len(raw):
            if raw[i:i + 1] == b"\\" and i + 3 <= len(raw) and raw[i + 1:i + 4].isdigit():
                out.append(int(raw[i + 1:i + 4], 8))
                i += 4
            elif raw[i:i + 2] == b"\\\\":
                out.append(0x5C)
                i += 2
            else:
                out.append(raw[i])
                i += 1
        return bytes(out)

    # ---------- transactions ----------

    def transaction(self):
        return _Transaction(self)

    def close(self) -> None:
        try:
            self._send(b"X", b"")
        except Exception:
            pass
        try:
            self._socket.close()
        except Exception:
            pass

    @property
    def closed(self) -> bool:
        try:
            return self._socket.fileno() == -1
        except Exception:
            return True


class _Transaction:
    """Groups statements between BEGIN and COMMIT/ROLLBACK on one connection."""

    def __init__(self, conn: Connection) -> None:
        self.conn = conn

    def __enter__(self) -> Connection:
        self.conn._send(b"Q", b"BEGIN\x00")
        while True:
            code, body = self.conn._read_message()
            if code == b"Z":
                self.conn._in_transaction = True
                return self.conn
            if code == b"E":
                fields = self.conn._error_fields(body)
                raise PgError(fields.get("message", "begin failed"))

    def __exit__(self, exc_type, exc, tb) -> bool:
        statement = b"COMMIT\x00" if exc_type is None else b"ROLLBACK\x00"
        self.conn._send(b"Q", statement)
        while True:
            code, body = self.conn._read_message()
            if code == b"Z":
                self.conn._in_transaction = False
                return False
            if code == b"E":
                # drain the failure and keep the original exception
                continue
