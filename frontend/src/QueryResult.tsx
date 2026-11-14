import type { RunResult } from './api';

export interface QueryOutput {
  dataset: string;
  sql: string;
  result: RunResult;
}

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
      {!running && failed && <p role="alert">无法取得运行结果。</p>}
      {!running && !failed && !result && <p className="muted">运行 SQL 后在此查看实际结果。</p>}
      {!running && !failed && !success && result && 'message' in result && <p role="alert">{result.message}</p>}
      {!running && !failed && success && (
        <>
          <p className="muted" role="status">{success.rows.length} 行{success.truncated ? ' · 结果已截断' : ''}</p>
          <div className="result-scroll" tabIndex={0} aria-label="查询结果表">
            <table className="result-table">
              <thead><tr>{success.columns.map((column, index) => <th scope="col" key={index}>{column}</th>)}</tr></thead>
              <tbody>{success.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{row.map((value, columnIndex) => (
                  <td key={columnIndex}>{value === null ? <em className="null-cell">NULL</em> : value === 'NULL' ? '"NULL"' : value}</td>
                ))}</tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
