"""Run the four diagnosis groups against one configured provider and save evidence."""

import argparse
import asyncio
import json
import os
import time
from pathlib import Path

from pydantic import ValidationError

from app.agent import DOMAIN_PROMPT, TOOLS, AgentRequest, diagnosis_events, tool_result
from app.models import ModelConfig
from app.sandbox import execute_sql

GENERIC_PROMPT = """You are a SQL assistant. Respond in Simplified Chinese.
Explain the supplied SQL relative to the goal. Return one JSON object with summary, causes (array),
evidence_ids (use observed call_id values), suggestion, suggested_sql, and limitations (array).
Use available input and tools when applicable."""
CASES = Path(__file__).with_name("cases.json")
GROUPS = {
    "A": ([], GENERIC_PROMPT),
    "B": ([], GENERIC_PROMPT),
    "C": (TOOLS[:3], GENERIC_PROMPT),
    "D": (TOOLS, DOMAIN_PROMPT),
}


async def compare(case: dict, group: str, model: ModelConfig) -> dict:
    started = time.monotonic()
    workspace = {key: case[key] for key in ("dataset_id", "goal", "sql")}
    request = AgentRequest.model_validate({"model_config": model, "workspace": workspace})
    tools, prompt = GROUPS[group]
    fixed = None
    if group == "B":
        fixed = []
        for index, name in enumerate(("analyze_sql", "execute_sql"), 1):
            ok, evidence = await asyncio.to_thread(tool_result, name, {"sql": case["sql"]}, request.workspace)
            fixed.append({"call_id": f"fixed{index}", "tool": name, "ok": ok, "details": evidence})

    events = []
    async for event in diagnosis_events(request, tools=tools, prompt=prompt, fixed_evidence=fixed):
        name, detail = event.strip().split("\n", 1)
        events.append({"type": name.removeprefix("event: "), **json.loads(detail.removeprefix("data: "))})
    result = next((event["result"] for event in events if event["type"] == "diagnosis"), None)
    candidate = result.get("suggested_sql") if result else None
    expected = case["expected_rows"]
    candidate_run = None
    if result and expected is not None:
        candidate_run = (await asyncio.to_thread(execute_sql, case["dataset_id"], candidate or case["sql"])).model_dump()
    matches = (None if not candidate_run else
               candidate_run.get("rows") == expected and not candidate_run.get("truncated", False))
    return {
        "case": case["id"], "group": group, "model": model.model, "input": workspace,
        "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
        "expected_rows": expected, "candidate_result": candidate_run, "matches_expected_rows": matches,
        "fixed_evidence": fixed, "events": events,
    }


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group", choices=GROUPS, action="append")
    parser.add_argument("--case", action="append")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        model = ModelConfig(
            base_url=os.environ["QUERY_PILOT_EVAL_BASE_URL"],
            model=os.environ["QUERY_PILOT_EVAL_MODEL"],
            api_key=os.environ["QUERY_PILOT_EVAL_API_KEY"],
        )
    except (KeyError, ValidationError):
        parser.error("Set valid QUERY_PILOT_EVAL_BASE_URL, QUERY_PILOT_EVAL_MODEL and QUERY_PILOT_EVAL_API_KEY.")

    cases = json.loads(CASES.read_text(encoding="utf-8"))
    if args.case and set(args.case) - {case["id"] for case in cases}:
        parser.error("Unknown --case")
    with args.output.open("x", encoding="utf-8") as output:
        for group in args.group or GROUPS:
            for case in cases:
                if args.case and case["id"] not in args.case:
                    continue
                record = await compare(case, group, model)
                output.write(json.dumps(record, ensure_ascii=False) + "\n")
                output.flush()
                gate = record["matches_expected_rows"]
                print(group, case["id"], record["events"][-1]["type"],
                      "review" if gate is None else "rows match" if gate else "rows differ",
                      f"{record['elapsed_ms']} ms")


if __name__ == "__main__":
    asyncio.run(main())
