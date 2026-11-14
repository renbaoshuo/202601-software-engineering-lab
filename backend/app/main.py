from fastapi import FastAPI, HTTPException

from .contracts import Dataset, DatasetSchema, RunRequest, RunResult
from .datasets import DATASETS, dataset_schema
from .sandbox import execute_sql

app = FastAPI(title="QueryPilot API")


@app.get("/api/hello")
def hello():
    return {"message": "Hello from FastAPI"}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/datasets")
def list_datasets() -> list[Dataset]:
    return list(DATASETS.values())


@app.get("/api/datasets/{dataset_id}/schema")
def schema(dataset_id: str) -> DatasetSchema:
    if dataset_id not in DATASETS:
        raise HTTPException(status_code=404, detail="未知数据集")
    return dataset_schema(dataset_id)


@app.post("/api/sql/run")
def run_sql(request: RunRequest) -> RunResult:
    if request.dataset_id not in DATASETS:
        raise HTTPException(status_code=404, detail="未知数据集")
    return execute_sql(request.dataset_id, request.sql)
