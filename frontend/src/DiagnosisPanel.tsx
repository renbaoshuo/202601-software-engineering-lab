import type { DiagnosisRun, ToolCall } from './diagnosis';

const names: Record<string, string> = {
  inspect_schema: '查看表结构',
  analyze_sql: '静态分析',
  execute_sql: '执行 SQLite',
  unknown_tool: '工具调用',
};

export function ToolDetails({ tool }: { tool: ToolCall }) {
  return (
    <section className="tool-details" aria-label="调用详情">
      <h2>{names[tool.name] ?? tool.name}</h2>
      <code>{tool.name}</code>
      {tool.sql && <pre>{tool.sql}</pre>}
      {tool.details ? <pre>{JSON.stringify(tool.details, null, 2)}</pre> : <p className="muted">等待工具返回结果。</p>}
    </section>
  );
}

export function DiagnosisPanel({ turns, openTool }: { turns: DiagnosisRun[]; openTool: (turnId: string, toolId: string) => void }) {
  if (!turns.length) return null;

  return (
    <section className="panel diagnosis-panel" aria-label="诊断对话">
      <h2>诊断对话</h2>
      {turns.map(turn => (
        <article className="diagnosis-turn" key={turn.id}>
          <p className="diagnosis-goal">{turn.snapshot.goal}</p>
          {turn.tools.length > 0 && (
            <ul className="tool-list">
              {turn.tools.map(tool => (
                <li key={tool.id}>
                  <button className="tool-step" type="button" onClick={() => openTool(turn.id, tool.id)}>
                    <span><strong>{names[tool.name] ?? tool.name}</strong><code>{tool.name}</code></span>
                    <span className={`status-badge ${tool.status === 'running' ? 'is-warning' : tool.status === 'ok' ? 'is-success' : 'is-error'}`}>
                      {tool.status === 'running' ? '◷ 执行中' : tool.status === 'ok' ? '✓ 完成' : '× 失败'}
                      {tool.elapsed !== undefined ? ` · ${tool.elapsed} ms` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {turn.status === 'running' && <p className="muted" role="status">正在生成诊断…</p>}
          {turn.error && <p className="diagnosis-error" role="alert">{turn.error}</p>}
          {turn.result && (
            <div className="diagnosis-card">
              <h3>诊断结论</h3>
              <p>{turn.result.summary}</p>
              {turn.result.causes.map((item, index) => <p key={index}>{item}</p>)}
              {turn.result.suggestion && <p>{turn.result.suggestion}</p>}
              {turn.result.suggested_sql && <pre>{turn.result.suggested_sql}</pre>}
              {turn.result.limitations.map((item, index) => <p className="muted" key={index}>{item}</p>)}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
