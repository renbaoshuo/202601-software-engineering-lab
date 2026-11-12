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
