from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

DatasetId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
SqlText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16_384)]
Cell = str | int | float | None


class Dataset(BaseModel):
    id: DatasetId
    name: str
    description: str
    sample_sql: str
    sample_goal: str


class Column(BaseModel):
    name: str
    type: str
    nullable: bool
    primary_key: int


class ForeignKey(BaseModel):
    column: str
    table: str
    target: str


class Table(BaseModel):
    name: str
    columns: list[Column]
    foreign_keys: list[ForeignKey]


class DatasetSchema(BaseModel):
    dataset: Dataset
    tables: list[Table]


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: DatasetId
    sql: SqlText


class RunSuccess(BaseModel):
    status: Literal["ok", "empty"]
    columns: list[str]
    rows: list[list[Cell]]
    truncated: bool
    elapsed_ms: float


class RunFailure(BaseModel):
    status: Literal["error", "timeout"]
    code: Literal["sql_error", "read_only", "timeout", "limit", "busy", "sandbox_error"]
    message: str
    elapsed_ms: float


RunResult = Annotated[RunSuccess | RunFailure, Field(discriminator="status")]
