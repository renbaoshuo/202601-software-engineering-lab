# QueryPilot

202601 学期《软件工程实践》组队项目。

## 前端

需要 Node.js 24 和 pnpm 10.21.0。

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

访问 <http://127.0.0.1:5173>。

检查：`pnpm typecheck`、`pnpm lint`、`pnpm build`。

## 后端

需要 Docker 与 Docker Compose。在仓库根目录启动：

```sh
docker compose up --build -d
```

- FastAPI 示例：<http://127.0.0.1:8000/api/hello>
- 健康检查：<http://127.0.0.1:8000/api/health>
- API 文档：<http://127.0.0.1:8000/docs>
- backend 容器中的 `GO_JUDGE_URL` 为 `http://go-judge:5050`。

停止服务：

```sh
docker compose down
```

后端也可以在本机开发（Python 3.13、uv）：

```sh
cd backend
uv sync --locked
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

本机运行后端时先停止 Compose 中的 backend，避免占用相同端口。
