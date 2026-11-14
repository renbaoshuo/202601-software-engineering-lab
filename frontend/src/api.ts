export interface Dataset {
  id: string;
  name: string;
  description: string;
  sample_sql: string;
  sample_goal: string;
}

export interface DatasetColumn {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: number;
}

export interface DatasetSchema {
  dataset: Dataset;
  tables: {
    name: string;
    columns: DatasetColumn[];
    foreign_keys: { column: string; table: string; target: string }[];
  }[];
}

export type Cell = string | number | null;

export type RunResult =
  | { status: 'ok' | 'empty'; columns: string[]; rows: Cell[][]; truncated: boolean; elapsed_ms: number }
  | { status: 'error' | 'timeout'; code: string; message: string; elapsed_ms: number };

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const deadline = AbortSignal.timeout(12_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const response = await fetch(path, { ...init, signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function runSql(datasetId: string, sql: string) {
  return requestJson<RunResult>('/api/sql/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, sql }),
  });
}
