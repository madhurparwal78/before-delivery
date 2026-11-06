from __future__ import annotations

import argparse
import ast
import json
import math
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import tomllib
import urllib.error
import urllib.request
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path
from types import SimpleNamespace
from typing import Final, TypeAlias

import pytest
from pydantic import BaseModel, ConfigDict, ValidationError

import judge

GRADER: Final = Path(__file__).resolve().parent
LOGS: Final = Path("/logs/verifier")
SOURCE: Final = Path("/app")
APP: Final = Path("/srv/app")
APP_UID: Final = 10001
PATH: Final = "/usr/local/bin:/usr/bin:/bin"
APP_PATH: Final = f"{PATH}:/home/app/.local/bin"
REWARDKIT_VERSION: Final = "0.2.3"
INSTALL_TIMEOUT, BUILD_TIMEOUT, HEALTH_TIMEOUT = 1200, 900, 180
PYTEST_TIMEOUT = 10800
REWARDKIT_SLACK, REWARDKIT_MAX = 1800, 20000
JUDGE_EVIDENCE: Final = judge.WORKSPACE / "evidence"
CHANNELS: Final = ("experience", "source", "quality")
EVIDENCE: Final = {"experience": "screenshot", "source": "file_line", "quality": "file_line"}
TIERS: Final = {5: ("explicit", "critically_important"), 3: ("explicit", "important"),
                1: ("implicit", "somewhat_important")}
FILE_LINE: Final = re.compile(r"[^\s:]+\.[a-zA-Z0-9]+:\d+(?:-\d+)?")
BUNDLE_FILES: Final = ("Dockerfile", "docker-compose.yaml", "test.sh", "grader/grader.py", "grader/judge.py",
                       "grader/instrument.js", "grader/conftest.py", "grader/requirements.toml",
                       "grader/judge.toml", "grader/prompt.md", "grader/instruction.md")
MAX_TEST_FILES: Final = 12

Json: TypeAlias = None | bool | int | float | str | list["Json"] | dict[str, "Json"]

def provider_postgres() -> SimpleNamespace:
    import os
    import re
    import secrets
    import subprocess
    import urllib.parse

    NAME = "postgres"
    HOST, PORT = "postgres", "5432"
    ADMIN = ("gf_admin", "gf-admin-5c1e8a37")


    def _psql(sql: str, db: str = "postgres", user: tuple[str, str] = ADMIN) -> str:
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PGHOST": HOST, "PGPORT": PORT,
               "PGDATABASE": db, "PGUSER": user[0], "PGPASSWORD": user[1], "PGCONNECT_TIMEOUT": "5"}
        result = subprocess.run(["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql],
                                env=env, capture_output=True, text=True, timeout=60, check=False)
        if result.returncode:
            raise RuntimeError(f"psql failed: {result.stderr.strip()}")
        return result.stdout


    def _create_db(db: str, suffix: str) -> None:
        app, obs = f"gf_app_{suffix}", f"gf_obs_{suffix}"
        _psql(f'CREATE DATABASE "{db}" OWNER "{app}"')
        _psql(f'REVOKE ALL ON DATABASE "{db}" FROM PUBLIC; GRANT CONNECT ON DATABASE "{db}" TO "{app}", "{obs}"')


    def provision() -> dict[str, str]:
        suffix = secrets.token_hex(6)
        app, obs = (f"gf_app_{suffix}", secrets.token_hex(16)), (f"gf_obs_{suffix}", secrets.token_hex(16))
        _psql(f"CREATE ROLE \"{app[0]}\" LOGIN CREATEDB PASSWORD '{app[1]}';"
              f"CREATE ROLE \"{obs[0]}\" LOGIN PASSWORD '{obs[1]}' IN ROLE pg_read_all_data;"
              f'ALTER ROLE "{obs[0]}" SET default_transaction_read_only = on')
        db = f"gf_{suffix}"
        _create_db(db, suffix)
        return {
            "DATABASE_URL": f"postgresql://{app[0]}:{app[1]}@{HOST}:{PORT}/{db}",
            "POSTGRES_OBSERVER_URL": f"postgresql://{obs[0]}:{obs[1]}@{HOST}:{PORT}/{db}",
        }


    def reset() -> None:
        rows = _psql("SELECT datname || ' ' || pg_get_userbyid(datdba) FROM pg_database "
                     "WHERE datname LIKE 'gf\\_%' AND pg_get_userbyid(datdba) LIKE 'gf\\_app\\_%'")
        for db, owner in (line.split() for line in rows.splitlines() if line.strip()):
            _psql(f'DROP DATABASE "{db}" WITH (FORCE)')
            _create_db(db, owner.removeprefix("gf_app_"))


    def prepare(base: dict[str, str], env: dict[str, str]) -> None:
        url, home = urllib.parse.urlsplit(env.get("DATABASE_URL", "")), urllib.parse.urlsplit(base.get("DATABASE_URL", ""))
        db, provisioned = url.path.lstrip("/"), home.path.lstrip("/")
        if url.netloc != home.netloc or db == provisioned or not db.startswith(provisioned):
            return
        if not re.fullmatch(r"gf_[a-z0-9_]{1,50}", db):
            raise RuntimeError(f"derived database name {db!r} is not [a-z0-9_]")
        if not _psql(f"SELECT 1 FROM pg_database WHERE datname = '{db}'").strip():
            _create_db(db, provisioned.removeprefix("gf_"))


    def healthy() -> bool:
        try:
            return _psql("SELECT 1").strip() == "1"
        except (RuntimeError, OSError, subprocess.TimeoutExpired):
            return False

    return SimpleNamespace(NAME=NAME, provision=provision, reset=reset, healthy=healthy,
                           JUDGE_ORIGIN=locals().get("JUDGE_ORIGIN"),
                           prepare=locals().get("prepare"))

def provider_minio() -> SimpleNamespace:
    import datetime
    import hashlib
    import hmac
    import secrets
    import urllib.error
    import urllib.parse
    import urllib.request
    import xml.etree.ElementTree as ET

    NAME = "minio"
    ENDPOINT, REGION = "http://minio:9000", "us-east-1"
    JUDGE_ORIGIN = ENDPOINT
    ROOT = ("gf-root-6d29b4", "gf-root-secret-a83f17c5")


    def _s3(method: str, path: str, query: dict[str, str] | None = None, body: bytes = b"") -> tuple[int, bytes]:
        now = datetime.datetime.now(datetime.UTC)
        amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        qs = "&".join(f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
                      for k, v in sorted((query or {}).items()))
        host, payload = urllib.parse.urlsplit(ENDPOINT).netloc, hashlib.sha256(body).hexdigest()
        headers = {"host": host, "x-amz-content-sha256": payload, "x-amz-date": amz_date}
        signed = ";".join(headers)
        canonical = "\n".join([method, urllib.parse.quote(path), qs,
                               "".join(f"{k}:{v}\n" for k, v in headers.items()), signed, payload])
        scope = f"{day}/{REGION}/s3/aws4_request"
        to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
        key = f"AWS4{ROOT[1]}".encode()
        for part in (day, REGION, "s3", "aws4_request"):
            key = hmac.new(key, part.encode(), hashlib.sha256).digest()
        signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
        headers["Authorization"] = f"AWS4-HMAC-SHA256 Credential={ROOT[0]}/{scope}, SignedHeaders={signed}, Signature={signature}"
        url = ENDPOINT + urllib.parse.quote(path) + (f"?{qs}" if qs else "")
        request = urllib.request.Request(url, data=body or None, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()


    def _names(xml: bytes, tag: str) -> list[str]:
        return [node.text or "" for node in ET.fromstring(xml).iter() if node.tag.endswith("}" + tag)]


    def provision() -> dict[str, str]:
        bucket = f"gf-{secrets.token_hex(8)}"
        status, body = _s3("PUT", f"/{bucket}")
        if status != 200:
            raise RuntimeError(f"MinIO CreateBucket returned {status}: {body[:200]!r}")
        return {"S3_ENDPOINT": ENDPOINT, "S3_REGION": REGION, "S3_BUCKET": bucket, "S3_FORCE_PATH_STYLE": "true",
                "S3_ACCESS_KEY_ID": ROOT[0], "S3_SECRET_ACCESS_KEY": ROOT[1]}


    def prepare(base: dict[str, str], env: dict[str, str]) -> None:
        bucket = env.get("S3_BUCKET", "")
        if env.get("S3_ENDPOINT") != ENDPOINT or not bucket or bucket == base.get("S3_BUCKET"):
            return
        if not bucket.startswith("gf-") or not 3 <= len(bucket) <= 63 or not set(bucket) <= set("abcdefghijklmnopqrstuvwxyz0123456789-"):
            raise RuntimeError(f"derived bucket name {bucket!r} is not a gf- bucket of [a-z0-9-]")
        status, body = _s3("PUT", f"/{bucket}")
        if status not in (200, 409):
            raise RuntimeError(f"MinIO CreateBucket {bucket} returned {status}: {body[:200]!r}")


    def reset() -> None:
        status, body = _s3("GET", "/")
        if status != 200:
            raise RuntimeError(f"MinIO ListBuckets returned {status}")
        for bucket in _names(body, "Name"):
            while keys := _names(_s3("GET", f"/{bucket}", {"list-type": "2"})[1], "Key"):
                for key in keys:
                    if (status := _s3("DELETE", f"/{bucket}/{key}")[0]) != 204:
                        raise RuntimeError(f"MinIO DeleteObject {bucket}/{key} returned {status}")
            if not bucket.startswith("gf-") and (status := _s3("DELETE", f"/{bucket}")[0]) != 204:
                raise RuntimeError(f"MinIO DeleteBucket {bucket} returned {status}")


    def healthy() -> bool:
        try:
            with urllib.request.urlopen(f"{ENDPOINT}/minio/health/ready", timeout=5) as response:
                return response.status == 200
        except (urllib.error.URLError, OSError):
            return False

    return SimpleNamespace(NAME=NAME, provision=provision, reset=reset, healthy=healthy,
                           JUDGE_ORIGIN=locals().get("JUDGE_ORIGIN"),
                           prepare=locals().get("prepare"))

def provider_killbill() -> SimpleNamespace:
    import base64
    import json
    import secrets
    import time
    import urllib.error
    import urllib.request

    NAME = "killbill"
    URL = "http://killbill:8080"
    ADMIN = ("admin", "password")


    def _status(method: str, path: str, body: dict | None = None, timeout: float = 10) -> int:
        headers = {"X-Killbill-CreatedBy": "gfkit-verifier",
                   "Authorization": "Basic " + base64.b64encode(":".join(ADMIN).encode()).decode()}
        if body is not None:
            headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f"{URL}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code
        except (urllib.error.URLError, OSError):
            return 0


    def provision() -> dict[str, str]:
        deadline = time.monotonic() + 600
        while not healthy():
            if time.monotonic() > deadline:
                raise RuntimeError("Kill Bill healthcheck did not return 200 within 600 s")
            time.sleep(1)
        key, secret = f"grading-{secrets.token_hex(12)}", secrets.token_urlsafe(24)
        status = _status("POST", "/1.0/kb/tenants", {"apiKey": key, "apiSecret": secret}, 60)
        if status != 201:
            raise RuntimeError(f"Kill Bill tenant creation returned {status}")
        return {"KILLBILL_URL": URL, "KILLBILL_USERNAME": ADMIN[0], "KILLBILL_PASSWORD": ADMIN[1],
                "KILLBILL_API_KEY": key, "KILLBILL_API_SECRET": secret}


    def reset() -> None:
        return None


    def healthy() -> bool:
        return _status("GET", "/1.0/healthcheck", timeout=3) == 200

    return SimpleNamespace(NAME=NAME, provision=provision, reset=reset, healthy=healthy,
                           JUDGE_ORIGIN=locals().get("JUDGE_ORIGIN"),
                           prepare=locals().get("prepare"))

def provider_mailpit() -> SimpleNamespace:
    import time
    import urllib.error
    import urllib.request

    NAME = "mailpit"
    API = "http://mailpit:8025"
    ENV = {"SMTP_HOST": "mailpit", "SMTP_PORT": "1025", "MAILPIT_URL": API}
    JUDGE_ORIGIN = API


    def _status(method: str, path: str) -> int:
        request = urllib.request.Request(f"{API}{path}", method=method)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code
        except (urllib.error.URLError, OSError):
            return 0


    def provision() -> dict[str, str]:
        reset()
        return dict(ENV)


    def reset() -> None:
        deadline = time.monotonic() + 120
        while not healthy():
            if time.monotonic() > deadline:
                raise RuntimeError("Mailpit API unavailable")
            time.sleep(1)
        if _status("DELETE", "/api/v1/messages") != 200:
            raise RuntimeError("Mailpit messages could not be deleted")


    def healthy() -> bool:
        return _status("GET", "/api/v1/messages") == 200

    return SimpleNamespace(NAME=NAME, provision=provision, reset=reset, healthy=healthy,
                           JUDGE_ORIGIN=locals().get("JUDGE_ORIGIN"),
                           prepare=locals().get("prepare"))

PROVIDERS: Final[tuple[SimpleNamespace, ...]] = (provider_postgres(), provider_minio(), provider_killbill(), provider_mailpit())


@dataclass(frozen=True, slots=True)
class InvalidArtifact(ValueError):
    reason: str

    def __str__(self) -> str:
        return self.reason


def mapping(value: Json) -> dict[str, Json]:
    if not isinstance(value, dict):
        raise InvalidArtifact("expected JSON object")
    return value


def sequence(value: Json) -> list[Json]:
    if not isinstance(value, list):
        raise InvalidArtifact("expected JSON array")
    return value


def text(value: Json) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InvalidArtifact("expected nonempty string")
    return value


def number(value: Json) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidArtifact("expected finite number")
    result = float(value)
    if not math.isfinite(result):
        raise InvalidArtifact("nonfinite number")
    return result


def unit(value: Json) -> float:
    result = number(value)
    if not 0 <= result <= 1:
        raise InvalidArtifact("score outside [0, 1]")
    return result


def count(value: Json) -> int:
    if type(value) is not int or value < 0:
        raise InvalidArtifact("expected nonnegative integer count")
    return value


def unique_object(pairs: list[tuple[str, Json]]) -> dict[str, Json]:
    result: dict[str, Json] = {}
    for key, value in pairs:
        if key in result:
            raise InvalidArtifact(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_constant(value: str) -> None:
    raise InvalidArtifact(f"invalid JSON constant: {value}")


def parse(raw: str) -> Json:
    return json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)


def load(path: Path) -> dict[str, Json]:
    return mapping(parse(path.read_text()))


def atomic(path: Path, payload: dict[str, Json]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            json.dump(payload, handle, allow_nan=False, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    os.replace(temporary, path)


class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Requirement(Frozen):
    id: str
    title: str
    text: str
    kind: str
    primary: str
    workflow: str
    tests: tuple[str, ...]
    criteria: tuple[str, ...]
    parameter_cases: tuple[str, ...] = ()


class IfRule(Frozen):
    id: str
    text: str
    tests: tuple[str, ...]
    parameter_cases: tuple[str, ...] = ()


class WorkflowSpec(Frozen):
    id: str
    requirements: tuple[str, ...]
    critical: tuple[str, ...]
    checkpoints: tuple[str, ...] = ()
    critical_checkpoints: tuple[str, ...] = ()


class Runtime(Frozen):
    app_port: int
    health_path: str
    manifest: str
    bootstrap_probe: str = ""


class Service(Frozen):
    name: str
    env: dict[str, str] = {}


class Outage(Frozen):
    id: str
    port: int
    url_env: str
    env: dict[str, str]


class Registry(Frozen):
    schema_version: int
    id_prefix: str
    mandatory_count: int
    allowed_kinds: tuple[str, ...]
    test_files: tuple[str, ...]
    workflow_ids: tuple[str, ...]
    criterion_ids: tuple[str, ...]
    criterion_weights: dict[str, int]
    rubric_total_weight: int
    runtime: Runtime
    services: tuple[Service, ...]
    outages: tuple[Outage, ...] = ()
    requirements: tuple[Requirement, ...]
    if_rules: tuple[IfRule, ...] = ()
    workflows: tuple[WorkflowSpec, ...]


def load_registry(root: Path = GRADER) -> Registry:
    try:
        registry = Registry.model_validate(tomllib.loads((root / "requirements.toml").read_text()))
    except ValidationError as error:
        raise InvalidArtifact(f"malformed registry: {error}") from error
    if registry.schema_version != 1:
        raise InvalidArtifact("unsupported registry schema version")
    return registry


def load_rubric(root: Path = GRADER) -> dict:
    return tomllib.loads((root / "judge.toml").read_text())


def cases(items: tuple[Requirement, ...] | tuple[IfRule, ...]) -> set[str]:
    return {f"{ref}[{case}]" if case else ref
            for item in items for ref in item.tests for case in item.parameter_cases or ("",)}


def expected_cases(registry: Registry) -> set[str]:
    return cases(registry.requirements) | cases(registry.if_rules)


def check_collected(registry: Registry, nodeids: list[str]) -> None:
    if len(nodeids) != len(set(nodeids)) or set(nodeids) != expected_cases(registry):
        raise InvalidArtifact("missing/unknown/duplicate collected parameter cases")


def render_requirements(registry: Registry) -> str:
    return "\n".join(f"- **{item.id} — {item.title}**" + (" " + item.text.replace("\n", "\n  ") if item.text else "")
                     for item in registry.requirements)


def static_ids(expression: ast.expr, constants: dict[str, object]) -> tuple[str, ...]:
    if isinstance(expression, ast.Name):
        value = constants[expression.id]
    elif (
        isinstance(expression, ast.Call)
        and isinstance(expression.func, ast.Name)
        and expression.func.id in ("list", "tuple")
        and len(expression.args) == 1
        and not expression.keywords
        and isinstance(expression.args[0], ast.Name)
    ):
        value = list(constants[expression.args[0].id])
    else:
        value = ast.literal_eval(expression)
    if not isinstance(value, (list, tuple)) or not all(isinstance(item, str) for item in value):
        raise ValueError("ids must be strings")
    return tuple(value)


def function_inventory(root: Path, files: tuple[str, ...]) -> dict[str, tuple[str, ...]]:
    result: dict[str, tuple[str, ...]] = {}
    for filename in files:
        body = ast.parse((root / filename).read_text()).body
        constants: dict[str, object] = {}
        for node in body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                try:
                    constants[node.targets[0].id] = ast.literal_eval(node.value)
                except ValueError:
                    constants.pop(node.targets[0].id, None)
        for node in body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or not node.name.startswith("test_"):
                continue
            ids: tuple[str, ...] = ()
            for decorator in node.decorator_list:
                if not (
                    isinstance(decorator, ast.Call)
                    and isinstance(decorator.func, ast.Attribute)
                    and decorator.func.attr == "parametrize"
                ):
                    continue
                literal = next((kw.value for kw in decorator.keywords if kw.arg == "ids"), None)
                if literal is None or ids:
                    raise InvalidArtifact(f"one parametrize with explicit ids= required: {node.name}")
                try:
                    ids = static_ids(literal, constants)
                except (ValueError, KeyError, TypeError) as error:
                    raise InvalidArtifact(f"non-literal parameter ids: {node.name}") from error
            result[f"{filename}::{node.name}"] = ids
    return result


def check_rubric(registry: Registry, rubric: dict) -> dict[str, int]:
    config = rubric["judge"]
    servers = [server["name"] for server in config["mcp_servers"]]
    if servers != [*judge.BROWSER_SERVERS, "source"] or not all(s["allowed_tools"] for s in config["mcp_servers"]):
        raise InvalidArtifact("judge.toml needs the 3 browser MCP modes + source MCP, each with an allowlist")
    if (config["judge"], config["cwd"], config["prompt_template"], config["guard"]) != (
            "codex", str(judge.WORKSPACE), "prompt.md", "penalize"):
        raise InvalidArtifact("judge backend, workspace, prompt or guard changed")
    criteria: dict[str, int] = {}
    totals = dict.fromkeys(CHANNELS, 0)
    implicit = dict.fromkeys(CHANNELS, 0)
    for item in rubric["criterion"]:
        notes = item["annotations"]
        if item["id"] in criteria or item["name"] != item["id"] or item["type"] != "binary":
            raise InvalidArtifact(f"duplicate, renamed or nonbinary criterion: {item['id']}")
        if notes["channel"] not in CHANNELS or notes["evidence"] != EVIDENCE[notes["channel"]]:
            raise InvalidArtifact(f"unknown channel or wrong evidence kind: {item['id']}")
        if (notes["basis"], notes["importance"]) != TIERS.get(item["weight"]):
            raise InvalidArtifact(f"weight/basis/importance tier mismatch: {item['id']}")
        if notes["basis"] == "implicit" and not str(notes.get("cites", "")).strip():
            raise InvalidArtifact(f"implicit criterion must cite the brief: {item['id']}")
        cited = tuple(r.id for r in registry.requirements if item["id"] in r.criteria)
        if tuple(notes["requirements"]) != cited:
            raise InvalidArtifact(f"criterion/requirement cross-reference mismatch: {item['id']}")
        criteria[item["id"]] = item["weight"]
        totals[notes["channel"]] += item["weight"]
        implicit[notes["channel"]] += item["weight"] if notes["basis"] == "implicit" else 0
    if any(implicit[name] * 5 > totals[name] for name in CHANNELS) or not totals["experience"] + totals["source"]:
        raise InvalidArtifact("implicit weight above 20% of a channel, or no experience/source criteria")
    if (criteria != registry.criterion_weights or set(criteria) != set(registry.criterion_ids)
            or sum(criteria.values()) != registry.rubric_total_weight):
        raise InvalidArtifact("native criterion IDs/weights do not match registry")
    return criteria


def check_bundle(task_root: Path) -> Registry:
    tests = task_root / "tests"
    grader = tests / "grader"
    registry = load_registry(grader)
    files = {path.relative_to(tests).as_posix() for path in tests.rglob("*") if path.is_file()}
    if files != {*BUNDLE_FILES, *(f"grader/{name}" for name in registry.test_files)} or len(files) > MAX_TEST_FILES:
        raise InvalidArtifact(f"tests/ must hold exactly the runtime files (<= {MAX_TEST_FILES}): {sorted(files)}")
    expected = [f"{registry.id_prefix}-{i:02d}" for i in range(1, registry.mandatory_count + 1)]
    instruction = (task_root / "instruction.md").read_text()
    pattern = rf"(?m)^- \*\*({re.escape(registry.id_prefix)}-[0-9]{{2}}) —"
    if [item.id for item in registry.requirements] != expected or re.findall(pattern, instruction) != expected:
        raise InvalidArtifact("missing, duplicate, unknown or out-of-order requirement IDs")
    block, heading = render_requirements(registry), "\n## Mandatory requirements\n"
    if heading not in instruction or block not in instruction.split(heading, 1)[1].split("\n## ", 1)[0]:
        raise InvalidArtifact("instruction.md requirement list differs from the registry (byte check)")
    rubric = load_rubric(grader)
    criteria = check_rubric(registry, rubric)
    if f"@openai/codex@{rubric['judge']['version']} " not in (tests / "Dockerfile").read_text():
        raise InvalidArtifact("tests/Dockerfile Codex pin differs from the rubric judge version")
    metadata = tomllib.loads((task_root / "task.toml").read_text()).get("metadata", {})
    declared = tuple(metadata.get(key) for key in ("mandatory_requirement_count", "workflow_count",
                                                   "rubric_criterion_count", "rubric_total_weight",
                                                   "if_constraint_count"))
    if declared != (registry.mandatory_count, len(registry.workflow_ids), len(criteria),
                    registry.rubric_total_weight, len(registry.if_rules)):
        raise InvalidArtifact("task.toml [metadata] counts differ from the registry")
    functions = function_inventory(grader, registry.test_files)
    mapped: dict[str, tuple[str, ...]] = {}
    for item in (*registry.requirements, *registry.if_rules):
        if isinstance(item, Requirement):
            if item.kind not in registry.allowed_kinds or item.workflow not in registry.workflow_ids:
                raise InvalidArtifact(f"unknown kind/workflow: {item.id}")
            if not set(item.criteria) <= criteria.keys():
                raise InvalidArtifact(f"unknown criterion reference: {item.id}")
            if (item.primary == "rubric") != (not item.tests) or (item.primary == "rubric" and not item.criteria):
                raise InvalidArtifact(f"rubric-primary requirements (only) are judged without tests: {item.id}")
            if item.kind == "behavior" and not item.tests:
                raise InvalidArtifact(f"behavior requires executable coverage: {item.id}")
        elif not item.tests:
            raise InvalidArtifact(f"IF rule without a test case: {item.id}")
        for ref in item.tests:
            if ref not in functions or ref in mapped or functions[ref] != item.parameter_cases:
                raise InvalidArtifact(f"unknown, duplicate or parameter-mismatched test: {ref}")
            mapped[ref] = item.parameter_cases
    if mapped.keys() != functions.keys():
        raise InvalidArtifact("unmapped executable test function")
    if tuple(item.id for item in registry.workflows) != registry.workflow_ids or not registry.workflows:
        raise InvalidArtifact("workflow order/coverage mismatch")
    for workflow in registry.workflows:
        members = [item for item in registry.requirements if item.workflow == workflow.id]
        if tuple(item.id for item in members) != workflow.requirements:
            raise InvalidArtifact(f"workflow requirement partition mismatch: {workflow.id}")
        refs = {ref for item in members for ref in item.tests}
        if not refs or not workflow.critical or not set(workflow.critical) <= refs:
            raise InvalidArtifact(f"empty workflow or unknown critical refs: {workflow.id}")
    return registry


@dataclass(frozen=True, slots=True)
class WorkflowOutcome:
    id: str
    passed: bool
    substeps_passed: int
    substeps_total: int
    critical_failed: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Functionality:
    score: float
    total: int
    passed: int
    critical_failures: tuple[str, ...]
    workflows: tuple[WorkflowOutcome, ...]
    if_passed: int
    if_total: int

    @property
    def workflow_score(self) -> float:
        return sum(item.passed for item in self.workflows) / len(self.workflows)

    @property
    def if_score(self) -> float:
        return self.if_passed / self.if_total if self.if_total else 1.0


def base(nodeid: str) -> str:
    return nodeid.split("[", 1)[0]


def evaluate_workflows(registry: Registry, observed: dict[str, bool]) -> tuple[WorkflowOutcome, ...]:
    families: dict[str, bool] = {}
    for name, ok in observed.items():
        families[base(name)] = families.get(base(name), True) and ok
    outcomes = []
    for workflow in registry.workflows:
        refs = [ref for item in registry.requirements if item.workflow == workflow.id for ref in item.tests]
        passed = sum(families[ref] for ref in refs)
        critical_failed = tuple(ref for ref in workflow.critical if not families[ref])
        outcomes.append(WorkflowOutcome(workflow.id, passed * 10 >= len(refs) * 9 and not critical_failed,
                                        passed, len(refs), critical_failed))
    return tuple(outcomes)


def read_functionality(logs: Path, run_id: str) -> Functionality:
    report = mapping(load(logs / "ctrf.json").get("results"))
    if not run_id or mapping(report.get("extra")).get("run_id") != run_id:
        raise InvalidArtifact("missing or stale pytest run identity")
    registry = load_registry()
    expected = expected_cases(registry)
    observed: dict[str, bool] = {}
    for case in (mapping(item) for item in sequence(report.get("tests"))):
        name = text(case.get("name"))
        if name in observed or name not in expected:
            raise InvalidArtifact(f"duplicate or unknown test nodeid: {name}")
        status = text(case.get("status"))
        if status not in ("passed", "failed"):
            raise InvalidArtifact(f"ungraded test status: {name}: {status}")
        observed[name] = status == "passed"
    if set(observed) != expected:
        raise InvalidArtifact("test report does not cover every registry case")
    outcome, rules = cases(registry.requirements), cases(registry.if_rules)
    passed = sum(observed[name] for name in outcome)
    critical = {ref for workflow in registry.workflows for ref in workflow.critical}
    failures = tuple(sorted(name for name, ok in observed.items() if not ok and base(name) in critical))
    outcomes = evaluate_workflows(registry, {name: observed[name] for name in outcome})
    return Functionality(passed / len(outcome), len(outcome), passed, failures, outcomes,
                         sum(observed[name] for name in rules), len(rules))


PHASES: Final[dict[str, list[pytest.TestReport]]] = {}


def pytest_collection_finish(session: pytest.Session) -> None:
    try:
        check_collected(load_registry(), [item.nodeid for item in session.items])
    except InvalidArtifact as error:
        raise pytest.UsageError(f"collection differs from registry: {error}") from error
    marked = [item.nodeid for item in session.items if item.get_closest_marker("xfail") or
              item.get_closest_marker("skip") or item.get_closest_marker("skipif")]
    if marked:
        raise pytest.UsageError(f"skip/xfail markers on graded cases: {marked}")


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    PHASES.setdefault(report.nodeid, []).append(report)


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    if session.config.option.collectonly:
        return
    logs = Path(os.environ.get("GRADER_LOGS", str(LOGS)))
    results = []
    for nodeid, phases in PHASES.items():
        status = "passed"
        if any(phase.failed for phase in phases):
            status = "failed"
        elif any(phase.skipped or hasattr(phase, "wasxfail") for phase in phases):
            status = "skipped"
        elif {phase.when for phase in phases} != {"setup", "call", "teardown"}:
            status = "other"
        results.append({"name": nodeid, "status": status})
    summary = {key: sum(case["status"] == key for case in results)
               for key in ("passed", "failed", "skipped", "pending", "other")}
    summary["tests"] = len(results)
    atomic(logs / "ctrf.json", {"results": {"extra": {"run_id": os.environ["SCORING_RUN_ID"]},
                                            "summary": summary, "tests": results}})


@dataclass(frozen=True, slots=True)
class NativeScore:
    score: float
    weights: dict[str, int]
    values: dict[str, float]
    channels: dict[str, str]

    def ratio(self, channels: tuple[str, ...]) -> float | None:
        ids = [key for key, channel in self.channels.items() if channel in channels]
        total = sum(self.weights[key] for key in ids)
        return sum(self.weights[key] * self.values[key] for key in ids) / total if total else None

    def earned(self, channels: tuple[str, ...]) -> float:
        return sum(self.weights[k] * self.values[k] for k, c in self.channels.items() if c in channels)


def same(actual: Json, expected: float) -> None:
    if abs(number(actual) - expected) > 0.000051:
        raise InvalidArtifact(f"native score/formula mismatch; expected {expected}")


def diagnostics(detail: dict[str, Json]) -> None:
    if detail.get("error") is not None or detail.get("warnings") or detail.get("timed_out"):
        raise InvalidArtifact("native diagnostic error, warning or timeout")


def evidence_path(ref: str, logs: Path) -> Path:
    path = Path(ref)
    if not path.is_absolute():
        path = JUDGE_EVIDENCE.parent / path
    if path.is_relative_to(JUDGE_EVIDENCE):
        path = logs / "browser-evidence" / path.relative_to(JUDGE_EVIDENCE)
    return path


PNG_REF: Final = re.compile(r"[^\s\"'`()<>\[\],;]+\.png\b", re.I)


def browser_png(refs: list[str], logs: Path) -> None:
    from PIL import Image, UnidentifiedImageError

    root = (logs / "browser-evidence").resolve()
    images = [match for ref in refs for match in PNG_REF.findall(ref)]
    if not images:
        raise InvalidArtifact("missing current-run screenshot evidence")
    for ref in images:
        resolved = evidence_path(ref, logs).resolve()
        if not resolved.is_relative_to(root):
            raise InvalidArtifact(f"browser evidence escaped current-run root: {ref}")
        if not resolved.is_file():
            raise InvalidArtifact(f"missing browser PNG evidence: {ref}")
        try:
            with Image.open(resolved) as image:
                if image.format != "PNG":
                    raise InvalidArtifact(f"not a PNG: {ref}")
                image.verify()
        except (OSError, UnidentifiedImageError, SyntaxError) as error:
            raise InvalidArtifact(f"malformed browser PNG evidence: {ref}") from error


def judge_score(detail: dict[str, Json], logs: Path, rubric: dict) -> NativeScore:
    declared = {criterion["id"]: criterion for criterion in rubric["criterion"]}
    if detail.get("kind") != "agent":
        raise InvalidArtifact("wrong judge backend kind")
    guard = mapping(detail.get("guard"))
    if guard.get("flagged") is not False or guard.get("error") is not None:
        raise InvalidArtifact("judge guard flagged injection or failed")
    text(detail.get("judge_output"))
    weights: dict[str, int] = {}
    values: dict[str, float] = {}
    channels: dict[str, str] = {}
    for item in (mapping(entry) for entry in sequence(detail.get("criteria"))):
        diagnostics(item)
        identifier = text(item.get("id"))
        if identifier not in declared or identifier in weights:
            raise InvalidArtifact("unknown or duplicate judge criterion")
        criterion = declared[identifier]
        if item.get("name") != criterion["name"] or number(item.get("weight")) != criterion["weight"]:
            raise InvalidArtifact("judge criterion name or weight changed")
        if item.get("negate", False) is not False or item.get("optional", False) is not False:
            raise InvalidArtifact("criterion polarity or coverage changed")
        value = unit(item.get("value"))
        if item.get("raw") not in ("yes", "no") or value != float(item["raw"] == "yes"):
            raise InvalidArtifact("nonbinary or inconsistent judge result")
        if "confidence" in item:
            unit(item["confidence"])
        evidence = mapping(parse(text(item.get("reasoning"))))
        refs = [text(ref) for ref in sequence(evidence.get("evidence"))]
        if evidence.get("observed") is not True or not refs:
            raise InvalidArtifact(f"unobserved or unsupported judgment: {identifier}")
        channel = criterion["annotations"]["channel"]
        match channel:
            case "experience":
                browser_png(refs, logs)
            case "source" | "quality":
                if not any(FILE_LINE.search(ref) for ref in refs):
                    raise InvalidArtifact(f"{channel} evidence requires inspected file/line references")
            case _:
                raise InvalidArtifact(f"unknown criterion channel: {identifier}")
        weights[identifier] = count(criterion["weight"])
        values[identifier] = value
        channels[identifier] = channel
    if weights.keys() != declared.keys() or not sum(weights.values()):
        raise InvalidArtifact("incomplete or weightless judge criterion coverage")
    score = sum(weights[key] * values[key] for key in weights) / sum(weights.values())
    same(detail.get("score"), round(score, 4))
    return NativeScore(score, weights, values, channels)


def read_native(logs: Path) -> NativeScore:
    scores = load(logs / "native.json")
    details = load(logs / "reward-details.json")
    if set(scores) != {"reward"} or set(details) != {"reward"}:
        raise InvalidArtifact("unexpected native output streams")
    detail = mapping(details["reward"])
    diagnostics(detail)
    result = judge_score(detail, logs, load_rubric())
    same(scores["reward"], round(result.score, 4))
    return result


def combine(workflow: float, pytest_score: float, rubric: float) -> float:
    return round(workflow**0.50 * pytest_score**0.25 * rubric**0.25, 4)


def initialize(logs: Path, run_id: str) -> None:
    (logs / "reward.json").unlink(missing_ok=True)
    atomic(logs / "scoring-context.json", {"run_id": run_id, "phase": "setup", "complete": False})
    atomic(logs / "final-score.json", {"status": "pending", "run_id": run_id, "reward": 0.0})


def checked_context(logs: Path, run_id: str) -> dict[str, Json]:
    context = load(logs / "scoring-context.json")
    if context.get("invalid") or context.get("complete") is not True:
        raise InvalidArtifact(f"incomplete or invalid run: {context.get('invalid') or context.get('phase')}")
    if count(context.get("pytest_exit_code")) not in (0, 1):
        raise InvalidArtifact("pytest infrastructure error")
    return context


def judged_workflows(functional, values: dict[str, float]) -> tuple[float, list[dict[str, Json]]]:
    by_id = {w.id: w for w in load_registry().workflows}
    rows, passed = [], 0
    for item in functional.workflows:
        spec = by_id[item.id]
        judged = {cid: values.get(cid, 0.0) >= 0.5 for cid in spec.checkpoints}
        if set(judged) - set(values):
            raise InvalidArtifact(f"workflow {item.id}: checkpoint(s) {sorted(set(judged) - set(values))} not judged")
        total, ok = item.substeps_total + len(judged), item.substeps_passed + sum(judged.values())
        critical = [*item.critical_failed, *(cid for cid in spec.critical_checkpoints if not judged[cid])]
        done = ok * 10 >= total * 9 and not critical
        passed += done
        rows.append({"id": item.id, "passed": done, "steps_passed": ok, "steps_total": total,
                     "checkpoints": {cid: bool(v) for cid, v in judged.items()}, "critical_failed": critical})
    return passed / len(functional.workflows), rows


def judge_signals(logs: Path, context: dict, functional, scores: dict[str, float]) -> dict[str, Json]:
    status = str(context.get("judge_status", "missing"))
    if status != "ran":
        return {"status": status}
    try:
        native = read_native(logs)
        rubric = native.ratio(("experience", "source"))
        if rubric is None:
            raise InvalidArtifact("no experience/source criteria to score R")
        quality = native.ratio(("quality",))
    except Exception as error:
        return {"status": "invalid", "error": f"{type(error).__name__}: {error}"}
    workflow, rows, basis = functional.workflow_score, [], "pytest"
    if getattr(functional, "workflows", None) and any(w.checkpoints for w in load_registry().workflows):
        try:
            workflow, rows = judged_workflows(functional, native.values)
            basis = "pytest + judge checkpoints"
        except InvalidArtifact as error:
            rows, basis = [{"error": str(error)}], "pytest (checkpoints in doubt)"
    scores.update(rubric=round(rubric, 4), quality=round(1.0 if quality is None else quality, 4),
                  combined_score=combine(workflow, functional.score, rubric))
    if basis.startswith("pytest + judge"):
        scores["workflow"] = round(workflow, 4)
    return {
        "status": "scored",
        "workflow_basis": basis, "W_pytest": functional.workflow_score, "W": workflow, "workflow_checkpoints": rows,
        "R": rubric,
        "combined_score": scores["combined_score"],
        "combined_formula": "W^0.50 * P^0.25 * R^0.25 (diagnostic; R excludes quality)",
        "native_diagnostic": native.score,
        "rubric_weights": dict(native.weights),
        "rubric_values": dict(native.values),
        "rubric_channels": dict(native.channels),
        "rubric_earned": native.earned(("experience", "source")),
        "rubric_total_weight": sum(w for k, w in native.weights.items() if native.channels[k] != "quality"),
    }


def finalize(logs: Path, run_id: str) -> int:
    (logs / "reward.json").unlink(missing_ok=True)
    try:
        context = load(logs / "scoring-context.json")
        if not run_id or context.get("run_id") != run_id:
            raise InvalidArtifact("missing or stale scoring context")
        if context.get("smoke") and context.get("status") != "deployment-failed":
            ok = context.get("complete") is True and not context.get("invalid")
            atomic(logs / "final-score.json", {"status": "smoke-ok" if ok else "smoke-failed", "run_id": run_id,
                                               "instances": context.get("instances"), "invalid": context.get("invalid"),
                                               "agent_bridge": context.get("agent_bridge")})
            return 0 if ok else 2
        if context.get("status") == "deployment-failed" and not context.get("invalid"):
            atomic(logs / "final-score.json", {"status": "deployment-failed", "run_id": run_id,
                                               "reward": 0.0, "error": context.get("error")})
            atomic(logs / "reward.json", {"reward": 0.0, "pytest": 0.0, "workflow": 0.0, "if_score": 0.0})
            return 0
        if context.get("judge_only"):
            if context.get("invalid") or context.get("complete") is not True:
                raise InvalidArtifact(f"incomplete judge-only run: {context.get('invalid') or context.get('phase')}")
            scores: dict[str, float] = {}
            proven = SimpleNamespace(workflow_score=1.0, score=1.0)
            judge_result = judge_signals(logs, context, proven, scores)
            atomic(logs / "final-score.json", {"status": "judge-only", "run_id": run_id, "judge": judge_result,
                                               "note": "pytest skipped (GFKIT_JUDGE_ONLY=1); combined_score assumes W = P = 1"})
            atomic(logs / "reward.json", {**scores, "judge_only": 1.0})
            return 0
        context = checked_context(logs, run_id)
        functional = read_functionality(logs, run_id)
        if (context["pytest_exit_code"] == 0) != (functional.score == 1 and functional.if_score == 1):
            raise InvalidArtifact("pytest exit code contradicts report")
        reward, if_score = round(functional.score, 4), round(functional.if_score, 4)
        scores: dict[str, float] = {"reward": reward, "pytest": functional.score,
                                    "workflow": functional.workflow_score, "if_score": if_score}
        summary: dict[str, Json] = {
            "status": "scored",
            "run_id": run_id,
            "reward": reward,
            "if_score": if_score,
            "W": functional.workflow_score,
            "P": functional.score,
            "workflow_outcomes": [
                {"id": w.id, "passed": w.passed, "substeps_passed": w.substeps_passed,
                 "substeps_total": w.substeps_total, "critical_failed": list(w.critical_failed)}
                for w in functional.workflows
            ],
            "passed_workflows": sum(w.passed for w in functional.workflows),
            "total_workflows": len(functional.workflows),
            "critical_failed_cases": list(functional.critical_failures),
            "passed_tests": functional.passed,
            "total_tests": functional.total,
            "if_passed": functional.if_passed,
            "if_total": functional.if_total,
            "reward_formula": "P = passed pytest outcome cases / outcome cases (IF cases excluded)",
            "judge": judge_signals(logs, context, functional, scores),
        }
        atomic(logs / "final-score.json", summary)
        atomic(logs / "reward.json", scores)
        return 0
    except Exception as error:
        atomic(logs / "final-score.json", {"status": "infrastructure-invalid", "run_id": run_id,
                                           "reward": 0.0, "error": f"{type(error).__name__}: {error}"})
        print(f"scoring rejected: {error}", file=sys.stderr)
        return 2


class DeploymentFailed(Exception):
    pass


def log(message: str) -> None:
    print(f"[grader {time.strftime('%H:%M:%S')}] {message}", flush=True)


def get_status(url: str, timeout: float = 3) -> int:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (urllib.error.URLError, OSError):
        return 0


def wait_ok(url: str, seconds: float, process: subprocess.Popen | None = None) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if get_status(url) == 200:
            return True
        if process is not None and process.poll() is not None:
            return False
        time.sleep(1)
    return False


def as_app(command: str) -> list[str]:
    return ["setpriv", f"--reuid={APP_UID}", f"--regid={APP_UID}", "--clear-groups",
            "--no-new-privs", "--", "/bin/sh", "-ec", command]


def kill_app_processes() -> None:
    for _ in range(50):
        found = False
        for status in Path("/proc").glob("[0-9]*/status"):
            try:
                fields = dict(line.split(":", 1) for line in status.read_text().splitlines() if ":" in line)
                if int(fields["Uid"].split()[0]) == APP_UID and not fields["State"].strip().startswith(("Z", "X")):
                    found = True
                    os.kill(int(status.parent.name), signal.SIGKILL)
            except (OSError, KeyError, ValueError):
                continue
        try:
            while os.waitpid(-1, os.WNOHANG)[0]:
                pass
        except ChildProcessError:
            pass
        if not found:
            return
        time.sleep(0.1)
    raise RuntimeError("submission processes survived SIGKILL")


def provision(registry: Registry) -> dict[str, str]:
    if tuple(p.NAME for p in PROVIDERS) != tuple(s.name for s in registry.services):
        raise RuntimeError("embedded providers differ from the registry services")
    env: dict[str, str] = {}
    for provider, service in zip(PROVIDERS, registry.services, strict=True):
        env.update(provider.provision(), **service.env)
    return env


def manifest(registry: Registry) -> dict[str, str]:
    name = registry.runtime.manifest
    try:
        raw = json.loads((SOURCE / name).read_text())
    except (OSError, ValueError) as error:
        raise DeploymentFailed(f"unreadable /app/{name}: {error}") from error
    commands = {key: raw.get(key, "") if isinstance(raw, dict) else None for key in ("install", "build", "serve")}
    if not all(isinstance(value, str) for value in commands.values()) or not commands["serve"].strip():
        raise DeploymentFailed(f"{name} needs string install/build and nonempty serve")
    return commands


def deploy(commands: dict[str, str], port: int) -> None:
    shutil.rmtree(APP, ignore_errors=True)
    shutil.copytree(SOURCE, APP, symlinks=True, ignore=shutil.ignore_patterns("node_modules", ".git"))
    for path in [APP, *APP.rglob("*")]:
        os.lchown(path, APP_UID, APP_UID)
    env = {"PATH": APP_PATH, "HOME": "/home/app", "APP_PUBLIC_PORT": str(port),
           "APP_PUBLIC_URL": f"http://127.0.0.1:{port}"}
    for step, timeout in (("install", INSTALL_TIMEOUT), ("build", BUILD_TIMEOUT)):
        if not commands[step].strip():
            continue
        log(f"{step}: {commands[step]}")
        with (LOGS / f"app-{step}.log").open("w") as stream:
            try:
                result = subprocess.run(as_app(commands[step]), cwd=APP, env=env, stdin=subprocess.DEVNULL,
                                        stdout=stream, stderr=subprocess.STDOUT, timeout=timeout,
                                        start_new_session=True, check=False)
            except subprocess.TimeoutExpired as error:
                raise DeploymentFailed(f"{step} exceeded {timeout} s") from error
            finally:
                kill_app_processes()
        if result.returncode:
            raise DeploymentFailed(f"{step} exited {result.returncode}; see app-{step}.log")


OUTAGE_VAR: Final = re.compile(r"\$\{([A-Z][A-Z0-9_]*)\}")


def outage_env(overrides: dict[str, str], services: dict[str, str]) -> dict[str, str]:
    def value(match: re.Match) -> str:
        if match[1] not in services:
            raise RuntimeError(f"outage env names ${{{match[1]}}}, which no provisioned service provides")
        return services[match[1]]

    return {key: OUTAGE_VAR.sub(value, text) for key, text in overrides.items()}


def serve(command: str, registry: Registry, services: dict[str, str], primary_only: bool = False) -> None:
    port = registry.runtime.app_port
    instances = {port: {}} if primary_only else {port: {}, **{o.port: o.env for o in registry.outages}}
    processes = {}
    for listen, overrides in instances.items():
        app_services = {k: v for k, v in services.items() if "_OBSERVER_" not in k}
        env = {"PATH": APP_PATH, "HOME": "/home/app", "NODE_ENV": "production", **app_services,
               "APP_PUBLIC_PORT": str(listen), "APP_PUBLIC_URL": f"http://127.0.0.1:{listen}",
               **outage_env(overrides, app_services)}
        for provider in PROVIDERS:
            if getattr(provider, "prepare", None):
                provider.prepare(app_services, env)
        stream = (LOGS / f"app-{listen}.log").open("a")
        process = processes[listen] = subprocess.Popen(as_app(command), cwd=APP, env=env, stdin=subprocess.DEVNULL,
                                                       stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        stream.close()
        if not wait_ok(f"http://127.0.0.1:{listen}{registry.runtime.health_path}", HEALTH_TIMEOUT, process):
            raise DeploymentFailed(f"{registry.runtime.health_path} on :{listen} did not return 200; "
                                   f"see app-{listen}.log")
    log(f"serving on {sorted(processes)}")


SERVICE_RECOVERY_S: Final = 60


def services_down() -> list[str]:
    return [str(getattr(p, "NAME", "service")) for p in PROVIDERS if not p.healthy()]


def deterministic(registry: Registry, services: dict[str, str], run_id: str) -> int:
    env = {
        "PATH": PATH,
        "HOME": "/root",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
        "PLAYWRIGHT_BROWSERS_PATH": os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/playwright"),
        **services,
        "APP_PUBLIC_URL": f"http://127.0.0.1:{registry.runtime.app_port}",
        **{o.url_env: f"http://127.0.0.1:{o.port}" for o in registry.outages},
        "APP_SOURCE_DIR": str(APP),
        "SCORING_RUN_ID": run_id,
        "GRADER_LOGS": str(LOGS),
    }
    args = [sys.executable, "-m", "pytest", "-p", "grader", "-c", "/dev/null", f"--rootdir={GRADER}",
            *registry.test_files]
    log("running deterministic suite")
    with (LOGS / "pytest.log").open("w") as stream:
        code = subprocess.run(args, cwd=GRADER, env=env, stdout=stream, stderr=subprocess.STDOUT,
                              timeout=PYTEST_TIMEOUT, check=False).returncode
    if code not in (0, 1):
        raise RuntimeError(f"pytest infrastructure or collection error (exit {code}); see pytest.log")
    if sick := services_down():
        log(f"service(s) unhealthy after the suite: {', '.join(sick)}; stopping the app and re-checking")
        kill_app_processes()
        deadline = time.monotonic() + SERVICE_RECOVERY_S
        while (sick := services_down()) and time.monotonic() < deadline:
            time.sleep(5)
        if sick:
            raise RuntimeError(f"service(s) stayed unhealthy after the deterministic suite: {', '.join(sick)}")
        log("services recovered once the app stopped: the suite's results stand")
    functional = read_functionality(LOGS, run_id)
    log(f"deterministic: {functional.passed}/{functional.total} cases, W={functional.workflow_score:.4f}, "
        f"IF {functional.if_passed}/{functional.if_total}")
    return code


def judge_configured() -> bool:
    return all(os.environ.get(key, "").strip() for key in ("JUDGE_SECRET", "JUDGE_URL"))


def judges(registry: Registry, services: dict[str, str]) -> int:
    pinned = load_rubric()["judge"]["version"]
    if version("harbor-rewardkit") != REWARDKIT_VERSION:
        raise RuntimeError(f"RewardKit version differs from pinned {REWARDKIT_VERSION}")
    try:
        found = subprocess.check_output([judge.BINARY, "--version"], text=True, timeout=60).strip()
    except subprocess.TimeoutExpired:
        found = "timed out"
    if found != f"codex-cli {pinned}":
        raise RuntimeError(f"Codex version differs from pinned {pinned}: {found}")
    judge.prepare(LOGS, SOURCE, f"http://127.0.0.1:{registry.runtime.app_port}",
                  *(p.JUDGE_ORIGIN for p in PROVIDERS if getattr(p, "JUDGE_ORIGIN", None)))
    if not judge_configured():
        raise RuntimeError("JUDGE_SECRET/JUDGE_URL must be forwarded via [verifier.env]")
    dropped = {"CODEX_AUTH_JSON", "CODEX_HOME", "CODEX_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "JUDGE_SECRET",
               *services}
    env = {key: value for key, value in os.environ.items()
           if key not in dropped and not key.startswith(("REWARDKIT_", "ANTHROPIC_"))}
    env.update(PATH=f"/opt/judge/bin:{PATH}", PYTHONDONTWRITEBYTECODE="1", OPENAI_API_KEY=os.environ["JUDGE_SECRET"])
    ratings = Path(tempfile.mkdtemp(prefix="gf-ratings-"))
    ratings.chmod(0o755)
    shutil.copy2(GRADER / "prompt.md", ratings / "prompt.md")
    rubric = (GRADER / "judge.toml").read_text()
    config = tomllib.loads(rubric)["judge"]
    call = max(int(config["timeout"]), judge.CALL_TIMEOUT_FLOOR)
    rubric, found = re.subn(r"(?m)^timeout = \d+$", f"timeout = {call}", rubric, count=1)
    if not found:
        raise RuntimeError("judge.toml has no `timeout = <seconds>` line to raise to the kit's floor")
    (ratings / "judge.toml").write_text(rubric)
    budget = min(int(config.get("samples", 1)) * call + REWARDKIT_SLACK, REWARDKIT_MAX)
    with (LOGS / "rewardkit.log").open("w") as stream:
        return subprocess.run(
            ["rewardkit", str(ratings), "--yolo", "--max-concurrent-agent", "1",
             "--workspace", str(judge.WORKSPACE),
             "--output", str(LOGS / "native.json")],
            env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=budget, check=False,
        ).returncode


def run() -> int:
    os.umask(0o022)
    LOGS.mkdir(parents=True, exist_ok=True)
    LOGS.chmod(0o755)
    run_id = secrets.token_hex(24)
    os.environ["SCORING_RUN_ID"] = run_id
    initialize(LOGS, run_id)
    context: dict = {"run_id": run_id, "phase": "setup", "complete": False}

    def mark(**fields) -> None:
        context.update(fields)
        atomic(LOGS / "scoring-context.json", context)

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    try:
        registry = load_registry()
        mark(phase="services")
        services = provision(registry)
        app_services = {k: v for k, v in services.items() if "_OBSERVER_" not in k}
        for outage in registry.outages:
            outage_env(outage.env, app_services)
        mark(phase="deployment")
        commands = manifest(registry)
        deploy(commands, registry.runtime.app_port)
        serve(commands["serve"], registry, services)
        if os.environ.get("GFKIT_SMOKE") == "1":
            reach = APP / "smoke-reach.txt"
            mark(smoke=True, complete=True, instances=[registry.runtime.app_port, *(o.port for o in registry.outages)],
                 agent_bridge=reach.read_text().strip() if reach.is_file() else "not recorded")
        else:
            if os.environ.get("GFKIT_JUDGE_ONLY") == "1":
                mark(phase="judging", complete=True, judge_only=True)
            else:
                mark(phase="deterministic")
                mark(pytest_exit_code=deterministic(registry, services, run_id))
                mark(phase="judging", complete=True)
            if not judge_configured():
                mark(judge_status="skipped: no judge bridge env (pytest-only reward)")
            else:
                try:
                    kill_app_processes()
                    for provider in PROVIDERS:
                        provider.reset()
                    serve(commands["serve"], registry, services, primary_only=True)
                    rewardkit_code = judges(registry, services)
                    mark(rewardkit_exit_code=rewardkit_code,
                         judge_status="ran" if rewardkit_code == 0 else f"failed: RewardKit exited {rewardkit_code}")
                except (Exception, SystemExit) as error:
                    log(f"judging failed: {type(error).__name__}: {error}")
                    mark(judge_status=f"failed: {type(error).__name__}: {error}")
        mark(phase="finalize")
    except DeploymentFailed as error:
        log(f"deployment failed: {error}")
        mark(status="deployment-failed", error=str(error))
    except BaseException as error:
        log(f"{context['phase']} failed: {type(error).__name__}: {error}")
        mark(complete=False, invalid=[f"{context['phase']} failed: {type(error).__name__}: {error}"])
    finally:
        try:
            kill_app_processes()
        except RuntimeError as error:
            mark(complete=False, invalid=[*context.get("invalid", []), f"cleanup failed: {error}"])
    code = finalize(LOGS, run_id)
    log(f"final: {json.dumps(load(LOGS / 'final-score.json').get('status'))}")
    return code


def main() -> int:
    if len(sys.argv) == 1:
        return run()
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("validate", "finalize"))
    parser.add_argument("--task-root", type=Path, default=GRADER.parents[1],
                        help="validate: task bundle root (needs instruction.md and task.toml)")
    parser.add_argument("--logs", type=Path, default=LOGS)
    parser.add_argument("--run-id", default=os.environ.get("SCORING_RUN_ID", ""))
    args = parser.parse_args()
    if args.command == "validate":
        registry = check_bundle(args.task_root)
        print(f"bundle ok: {len(registry.requirements)} requirements, {len(registry.workflows)} workflows, "
              f"{len(cases(registry.requirements))} outcome cases, {len(cases(registry.if_rules))} IF cases, "
              f"rubric weight {registry.rubric_total_weight}")
        return 0
    return finalize(args.logs, args.run_id)


if __name__ == "__main__":
    raise SystemExit(main())
