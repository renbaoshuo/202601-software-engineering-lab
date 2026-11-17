import type { Cell, RunResult } from './api';

export interface QueryOutput {
  dataset: string;
  sql: string;
  result: RunResult;
}

const failureLabels: Record<string, string> = {
  timeout: '运行超时',
  sql_error: 'SQL 错误',
  read_only: '只读查询受限',
  limit: '超出运行限制',
  busy: '运行队列已满',
  sandbox_error: '运行服务不可用',
};

export function QueryResult({ output, running, failed }: { output?: QueryOutput; running: boolean; failed: boolean }) {
  const result = output?.result;
  const success = result?.status === 'ok' || result?.status === 'empty' ? result : undefined;

  return (
    <section className="panel output" aria-label="运行结果" aria-busy={running}>
      <div className="output-heading">
        <h2>运行结果</h2>
        {result && !running && !failed && <span className="muted run-time">{output?.dataset} · {result.elapsed_ms} ms</span>}
      </div>
      {running && <p className="muted" role="status">正在运行 SQL…</p>}
      {!running && failed && (
        <div className="run-feedback" role="alert">
          <span className="status-badge is-error">× 网络或服务连接失败</span>
          <p>SQL 草稿仍在编辑器中。连接恢复后可重新运行。</p>
        </div>
      )}
      {!running && !failed && !result && <p className="muted">运行 SQL 后在此查看实际结果。</p>}
      {!running && !failed && result && 'message' in result && (
        <div className="run-feedback" role="alert">
          <span className={`status-badge ${result.status === 'timeout' ? 'is-warning' : 'is-error'}`}>
            {result.status === 'timeout' ? '◷' : '×'} {failureLabels[result.code] ?? '执行失败'}
          </span>
          <p>{result.message}</p>
        </div>
      )}
      {!running && !failed && success && (
        <>
          <div className="result-summary" role="status">
            <span className={`status-badge ${success.status === 'empty' ? 'is-neutral' : 'is-success'}`}>
              {success.status === 'empty' ? '○ 空结果' : '✓ 执行成功'}
            </span>
            <span className="muted">{success.rows.length} 行{success.truncated ? ' · 结果已截断' : ''}</span>
          </div>
          <ResultTable columns={success.columns} rows={success.rows} />
        </>
      )}
    </section>
  );
}


export function ResultTable({ columns, rows }: { columns: string[]; rows: Cell[][] }) {
  return (
    <div className="result-scroll" tabIndex={0} aria-label="查询结果表">
      <table className="result-table">
        <thead><tr>{columns.map((column, index) => <th scope="col" key={index}>{column}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => (
          <tr key={rowIndex}>{row.map((value, columnIndex) => (
            <td key={columnIndex}>{value === null ? <em className="null-cell">NULL</em> : value === 'NULL' ? '"NULL"' : value}</td>
          ))}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}
