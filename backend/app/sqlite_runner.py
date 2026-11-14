"""Run a single query in a fresh SQLite database. Executed out of process."""

import json
import math
import re
import sqlite3
import sys
import time
from contextlib import closing

MAX_ROWS = 100
MAX_RESULT_BYTES = 128 * 1024
MAX_SQL_SECONDS = 5
LEADING_KEYWORD = re.compile(r"\A(?:[\s\ufeff]+|--[^\n]*(?:\n|$)|/\*.*?\*/)*([a-z]+)", re.I | re.S)
READ_ACTIONS = {sqlite3.SQLITE_READ, sqlite3.SQLITE_SELECT, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}


def load_seed(connection, statements):
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(statements)


def authorize(tables, action, name, column_or_function, database, _origin):
    if action not in READ_ACTIONS:
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_READ and (name not in tables or database not in {None, "main"}):
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_FUNCTION and column_or_function in {"load_extension", "readfile", "writefile"}:
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def json_cell(value):
    if isinstance(value, bytes):
        return "0x" + value.hex()
    if isinstance(value, int) and abs(value) >= 2**53:
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


def failure(code, message):
    return {"status": "timeout" if code == "timeout" else "error", "code": code, "message": message}


def run(seed, sql):
    keyword = LEADING_KEYWORD.match(sql)
    supported = keyword is not None and keyword[1].upper() in {"SELECT", "WITH"}

    with closing(sqlite3.connect(":memory:")) as connection:
        load_seed(connection, seed)
        connection.execute("PRAGMA query_only = ON")
        connection.execute("PRAGMA trusted_schema = OFF")
        connection.execute("PRAGMA temp_store = MEMORY")
        connection.execute("PRAGMA hard_heap_limit = 67108864")
        connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 64 * 1024)
        connection.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
        tables = frozenset(name for (name,) in connection.execute(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*'"
        ))

        def check(*args):
            return authorize(tables, *args) if supported else sqlite3.SQLITE_DENY

        connection.set_authorizer(check)
        deadline = time.monotonic() + MAX_SQL_SECONDS
        connection.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
        try:
            cursor = connection.execute(sql)
            if cursor.description is None or not supported:
                return failure("read_only", "仅支持单条只读 SELECT 或 WITH 查询。")
            columns = [column[0] for column in cursor.description]
            result_bytes = len(json.dumps(columns, ensure_ascii=True).encode())
            if result_bytes > MAX_RESULT_BYTES:
                return failure("limit", "结果列名超过大小限制。")
            rows = []
            truncated = False
            for values in cursor:
                row = [json_cell(value) for value in values]
                result_bytes += len(json.dumps(row, ensure_ascii=True).encode()) + 2
                if len(rows) >= MAX_ROWS or result_bytes > MAX_RESULT_BYTES:
                    truncated = True
                    break
                rows.append(row)
            return {
                "status": "ok" if rows or truncated else "empty",
                "columns": columns,
                "rows": rows,
                "truncated": truncated,
            }
        except sqlite3.Error as exc:
            error_code = getattr(exc, "sqlite_errorcode", None)
            if error_code == sqlite3.SQLITE_INTERRUPT:
                return failure("timeout", "查询超过执行时限。")
            if error_code in {sqlite3.SQLITE_TOOBIG, sqlite3.SQLITE_NOMEM}:
                return failure("limit", "查询超过 SQLite 资源限制。")
            if error_code in {sqlite3.SQLITE_AUTH, sqlite3.SQLITE_READONLY} or "prohibited" in str(exc):
                return failure("read_only", "仅允许读取内置数据表和使用受支持的 SQLite 函数。")
            return failure("sql_error", str(exc)[:400])


if __name__ == "__main__":
    data = json.load(sys.stdin)
    started = time.monotonic()
    result = run(data["seed"], data["sql"])
    result["elapsed_ms"] = round((time.monotonic() - started) * 1000, 2)
    print(json.dumps(result, ensure_ascii=True, allow_nan=False))
