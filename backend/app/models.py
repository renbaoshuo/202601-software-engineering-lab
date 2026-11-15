import asyncio
import json
import os
from typing import Annotated, Literal
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints, field_validator, model_validator

Check = Literal["pass", "fail", "unchecked"]
MODEL_SLOTS = asyncio.Semaphore(4)
MAX_RESPONSE_BYTES = 256 * 1024
DEFAULT_ORIGINS = "https://api.openai.com,https://api.deepseek.com"


class ModelConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=400)]
    api_key: SecretStr
    model: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    context_length: int = Field(default=128_000, ge=1024, le=1_048_576)
    max_output_tokens: int = Field(default=2048, ge=128, le=16_384)

    @field_validator("api_key")
    @classmethod
    def valid_key(cls, key):
        value = key.get_secret_value()
        if not value or len(value) > 1024 or any(not 33 <= ord(char) <= 126 for char in value):
            raise ValueError("请输入有效的 API Key")
        return key

    @model_validator(mode="after")
    def valid_budget(self):
        if self.max_output_tokens >= self.context_length:
            raise ValueError("最大输出 Token 必须小于上下文长度")
        return self


class Compatibility(BaseModel):
    connection: Check = "unchecked"
    authentication: Check = "unchecked"
    model: Check = "unchecked"
    tools: Check = "unchecked"
    message: str


class ModelFailure(Exception):
    def __init__(self, code: str, message: str, *, reachable: bool = False):
        self.code = code
        self.reachable = reachable
        super().__init__(message)


def model_endpoint(base_url: str) -> str:
    try:
        parsed = urlsplit(base_url)
        if not parsed.hostname or parsed.username is not None or parsed.query or parsed.fragment:
            raise ValueError
        if parsed.scheme not in {"http", "https"} or any(not 33 <= ord(char) <= 126 for char in base_url):
            raise ValueError
        if "\\" in base_url or "%" in parsed.netloc:
            raise ValueError
        host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
        port = parsed.port
    except ValueError:
        raise ModelFailure("endpoint_invalid", "请输入有效的模型 Endpoint。") from None

    origin = f"{parsed.scheme}://{host}"
    if port and (parsed.scheme, port) not in {("https", 443), ("http", 80)}:
        origin += f":{port}"
    approved = {value.strip() for value in os.getenv("QUERY_PILOT_MODEL_ORIGINS", DEFAULT_ORIGINS).split(",")}
    dev_origin = os.getenv("QUERY_PILOT_DEV_MODEL_ORIGIN")
    if (parsed.scheme != "https" or origin not in approved) and origin != dev_origin:
        raise ModelFailure("endpoint_disallowed", "此工作台尚未启用该模型服务地址。")
    path = parsed.path.rstrip("/")
    return origin + (path if path.endswith("/chat/completions") else path + "/chat/completions")


def model_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(12, connect=4), follow_redirects=False, trust_env=False)


async def complete(client: httpx.AsyncClient, config: ModelConfig, messages: list[dict], *, tools=None,
                   tool_choice=None, max_tokens: int | None = None) -> dict:
    url = model_endpoint(config.base_url)
    payload = {"model": config.model, "messages": messages, "max_tokens": max_tokens or config.max_output_tokens}
    if tools:
        payload["tools"] = tools
    if tool_choice:
        payload["tool_choice"] = tool_choice
    credential = config.api_key.get_secret_value()
    try:
        async with asyncio.timeout(16):
            async with client.stream("POST", url, json=payload, headers={"Authorization": f"Bearer {credential}"}) as response:
                status = response.status_code
                if status in {401, 403}:
                    raise ModelFailure("authentication", "模型服务拒绝认证，请检查 API Key 和访问权限。", reachable=True)
                if status == 404:
                    raise ModelFailure("model_unavailable", "模型或 Chat Completions 路径不可用。", reachable=True)
                if status == 429:
                    raise ModelFailure("quota", "模型服务达到频率或额度限制。", reachable=True)
                if status in {400, 422}:
                    raise ModelFailure("request_rejected", "模型服务拒绝该请求，请检查模型和工具支持。", reachable=True)
                if not response.is_success:
                    raise ModelFailure("upstream", "模型服务暂不可用。", reachable=True)
                raw = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    raw.extend(chunk)
                    if len(raw) > MAX_RESPONSE_BYTES:
                        raise ModelFailure("response_limit", "模型响应超过大小限制。", reachable=True)
    except (TimeoutError, httpx.TimeoutException):
        raise ModelFailure("model_timeout", "模型服务响应超时。") from None
    except httpx.RequestError:
        raise ModelFailure("connection", "无法连接模型服务，请检查 Endpoint。") from None

    try:
        message = json.loads(raw)["choices"][0]["message"]
        if not isinstance(message, dict) or message.get("role") != "assistant":
            raise ValueError
        if message.get("content") is not None and not isinstance(message["content"], str):
            raise ValueError
        if message.get("tool_calls") is not None and not isinstance(message["tool_calls"], list):
            raise ValueError
        if not message.get("content") and not message.get("tool_calls"):
            raise ValueError
    except (ValueError, KeyError, TypeError, IndexError):
        raise ModelFailure("protocol", "模型返回的内容与 Chat Completions 协议不匹配。", reachable=True) from None
    return message


def function_tool(name: str, description: str, properties: dict) -> dict:
    return {"type": "function", "function": {
        "name": name, "description": description, "parameters": {
            "type": "object", "properties": properties, "required": list(properties), "additionalProperties": False,
        },
    }}


async def check_model(config: ModelConfig) -> Compatibility:
    if MODEL_SLOTS.locked():
        return Compatibility(message="模型请求较多，请稍后重试。")
    async with MODEL_SLOTS, model_client() as client:
        try:
            await complete(client, config, [{"role": "user", "content": "Reply with OK."}], max_tokens=128)
        except ModelFailure as exc:
            return Compatibility(
                connection="pass" if exc.reachable else "fail",
                authentication="fail" if exc.code == "authentication" else "unchecked",
                model="fail" if exc.code in {"protocol", "model_unavailable", "request_rejected"} else "unchecked",
                message=str(exc),
            )

        tool = function_tool("querypilot_probe", "Return a compatibility acknowledgement.", {})
        try:
            answer = await complete(
                client, config, [{"role": "user", "content": "Call querypilot_probe with no arguments."}],
                tools=[tool], tool_choice={"type": "function", "function": {"name": "querypilot_probe"}}, max_tokens=256,
            )
        except ModelFailure as exc:
            return Compatibility(connection="pass", authentication="pass", model="pass", tools="fail", message=str(exc))
        calls = answer.get("tool_calls") or []
        for call in calls:
            if not isinstance(call, dict) or call.get("type") != "function" or not isinstance(call.get("id"), str):
                continue
            function = call.get("function")
            if isinstance(function, dict) and function.get("name") == "querypilot_probe":
                try:
                    if json.loads(function["arguments"]) == {}:
                        return Compatibility(connection="pass", authentication="pass", model="pass", tools="pass",
                                             message="模型连接与函数工具调用通过。")
                except (KeyError, TypeError, ValueError):
                    continue
        return Compatibility(connection="pass", authentication="pass", model="pass", tools="fail",
                             message="该模型未返回兼容的函数工具调用。")
