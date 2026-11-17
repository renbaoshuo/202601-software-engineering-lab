import { ResultTable } from './QueryResult';
import type { StoredRun } from './workspace';

export function RunHistory({ runs }: { runs: StoredRun[] }) {
  if (!runs.length) return null;
  return (
    <details className="panel run-history">
      <summary>运行记录 <span className="muted">{runs.length} 次</span></summary>
      <div className="previous-runs">
        {runs.slice().reverse().map(run => (
          <details key={run.id}>
            <summary>
              <span>{run.source === 'manual' ? '直接运行' : '诊断执行'} · {run.dataset}</span>
              <span className="muted">{run.result.elapsed_ms} ms</span>
            </summary>
            <pre>{run.sql}</pre>
            {'columns' in run.result ? (
              <>
                <p className="muted">{run.result.rows.length} 行{run.result.truncated ? ' · 部分结果' : ''}</p>
                <ResultTable columns={run.result.columns} rows={run.result.rows} />
              </>
            ) : <p className="muted">{run.result.message}</p>}
          </details>
        ))}
      </div>
    </details>
  );
}
