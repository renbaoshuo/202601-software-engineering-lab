import json
import os
import subprocess
import sys
import time
from pathlib import Path
from threading import BoundedSemaphore
from urllib.request import ProxyHandler, Request, build_opener

from pydantic import TypeAdapter

from .contracts import RunResult
from .datasets import seed_sql
from .sqlite_runner import MAX_RESULT_BYTES, MAX_SQL_SECONDS, failure

RUNNER = Path(__file__).with_name("sqlite_runner.py")
RESULT_ADAPTER = TypeAdapter(RunResult)
SLOTS = BoundedSemaphore(4)
RESPONSE_LIMIT = MAX_RESULT_BYTES + 8192
MEMORY_LIMIT = 96 * 1024 * 1024
OUTER_TIMEOUT = MAX_SQL_SECONDS + 3


class RunnerFailure(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def run_locally(payload):
    completed = subprocess.run(
        [sys.executable, "-I", str(RUNNER)],
        input=payload, capture_output=True, check=True, timeout=OUTER_TIMEOUT,
        env={}, cwd="/tmp",
    )
    return completed.stdout


def run_in_judge(origin, payload):
    command = {
        "args": ["/usr/local/bin/python3", "-I", "/w/run_sql.py"],
        "files": [
            {"content": payload.decode()},
            {"name": "stdout", "max": RESPONSE_LIMIT},
            {"name": "stderr", "max": 4096},
        ],
        "copyIn": {"run_sql.py": {"content": RUNNER.read_text(encoding="utf-8")}},
        "cpuLimit": (MAX_SQL_SECONDS + 1) * 10**9,
        "clockLimit": (MAX_SQL_SECONDS + 2) * 10**9,
        "memoryLimit": MEMORY_LIMIT,
        "procLimit": 4,
    }
    request = Request(
        f"{origin.rstrip('/')}/run",
        data=json.dumps({"cmd": [command]}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with build_opener(ProxyHandler({})).open(request, timeout=OUTER_TIMEOUT) as response:
        output = json.loads(response.read(2 * RESPONSE_LIMIT + 8192))[0]
    status = output["status"]
    if status == "Time Limit Exceeded":
        raise RunnerFailure("timeout", "查询超过执行时限。")
    if status in {"Memory Limit Exceeded", "Output Limit Exceeded"}:
        raise RunnerFailure("limit", "查询超过沙箱资源限制。")
    if status != "Accepted":
        raise RunnerFailure("sandbox_error", "SQLite 沙箱暂不可用。")
    return output["files"]["stdout"]


def execute_sql(dataset_id: str, sql: str) -> RunResult:
    started = time.monotonic()
    if not SLOTS.acquire(blocking=False):
        result = failure("busy", "运行请求较多，请稍后重试。")
    else:
        try:
            payload = json.dumps({"seed": seed_sql(dataset_id), "sql": sql}).encode()
            origin = os.environ.get("GO_JUDGE_URL")
            output = run_in_judge(origin, payload) if origin else run_locally(payload)
            return RESULT_ADAPTER.validate_json(output)
        except RunnerFailure as exc:
            result = failure(exc.code, str(exc))
        except subprocess.TimeoutExpired:
            result = failure("timeout", "查询超过执行时限。")
        except (OSError, ValueError, LookupError, TypeError, subprocess.CalledProcessError):
            result = failure("sandbox_error", "SQLite 沙箱暂不可用。")
        finally:
            SLOTS.release()
    return RESULT_ADAPTER.validate_python({
        **result, "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
    })
