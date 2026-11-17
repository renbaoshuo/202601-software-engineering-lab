import type { Cell } from './api';
import type { DiagnosisRun, KnowledgeEntry, ToolCall } from './diagnosis';
import { ResultTable } from './QueryResult';

const verificationLabels = {
  passed: { label: '验证通过', style: 'is-success' },
  still_has_issue: { label: '仍有问题', style: 'is-error' },
  uncertain: { label: '待进一步验证', style: 'is-warning' },
};
const names: Record<string, string> = {
  inspect_schema: '查看表结构',
  analyze_sql: '静态分析',
  execute_sql: '执行 SQLite',
  search_sql_knowledge: '检索知识',
  unknown_tool: '工具调用',
};

export function KnowledgeDetails({ entry }: { entry: KnowledgeEntry }) {
  return (
    <section className="tool-details knowledge-detail" aria-label="知识详情">
      <code>{entry.id} · SQLite {entry.sqlite_version}</code>
      <h2>{entry.title}</h2>
      <p>{entry.rule}</p>
      <h3>适用条件</h3>
      <p>{entry.applicable}</p>
      <h3>常见写法</h3>
      <pre>{entry.wrong_sql}</pre>
      <h3>修正示例</h3>
      <pre>{entry.example_sql}</pre>
      <p className="muted">示例数据集 <code>{entry.dataset_id}</code></p>
      <a href={entry.source} target="_blank" rel="noreferrer">查看 SQLite 官方文档 ↗</a>
    </section>
  );
}

export function ToolDetails({ tool, openKnowledge }: { tool: ToolCall; openKnowledge: (entry: KnowledgeEntry) => void }) {
  const details = tool.details;
  const matches = tool.name === 'search_sql_knowledge' && Array.isArray(details?.matches)
    ? details.matches as KnowledgeEntry[] : undefined;
  const columns = Array.isArray(details?.columns) ? details.columns as string[] : undefined;
  const rows = Array.isArray(details?.preview) ? details.preview as Cell[][] : undefined;

  return (
    <section className="tool-details" aria-label="调用详情">
      <h2>{names[tool.name] ?? tool.name}</h2>
      <code>{tool.name}</code>
      {tool.sql && <pre>{tool.sql}</pre>}
      {!details && <p className="muted">{tool.status === 'running' ? '等待工具返回结果。' : '工具尚未返回结果。'}</p>}
      {typeof details?.message === 'string' && <p>{details.message}</p>}
      {columns && rows && (
        <>
          <p className="muted">实际返回 {String(details?.row_count ?? rows.length)} 行{details?.preview_truncated ? ` · 预览 ${rows.length} 行` : ''}</p>
          <ResultTable columns={columns} rows={rows} />
        </>
      )}
      {matches && (matches.length ? (
        <ul className="reference-list">
          {matches.map(entry => (
            <li key={entry.id}><button className="text-button" onClick={() => openKnowledge(entry)}>{entry.id} · {entry.title}</button></li>
          ))}
        </ul>
      ) : <p className="muted">没有匹配的知识条目。</p>)}
      {details && <details className="raw-tool"><summary>工具原始结果</summary><pre>{JSON.stringify(details, null, 2)}</pre></details>}
    </section>
  );
}

interface Props {
  turns: DiagnosisRun[];
  openTool: (turnId: string, toolId: string) => void;
  openKnowledge: (entry: KnowledgeEntry) => void;
  applySql: (sql: string) => void;
}

export function DiagnosisPanel({ turns, openTool, openKnowledge, applySql }: Props) {
  if (!turns.length) return null;

  return (
    <section className="panel diagnosis-panel" aria-label="诊断对话">
      <h2>诊断对话</h2>
      {turns.map(turn => {
        const result = turn.result;
        const citations = result?.knowledge_refs ?? [];
        const evidence = result?.evidence_ids.flatMap(id => turn.tools.filter(tool => tool.id === id)) ?? [];
        return (
          <article className="diagnosis-turn" key={turn.id}>
            <div className="diagnosis-input">
              <p className="diagnosis-goal">{turn.snapshot.goal}</p>
              <details className="input-snapshot"><summary>{turn.mode === 'verify' ? '复验输入' : '诊断输入'} · {turn.snapshot.dataset_id}</summary>
                {turn.snapshot.sql && <pre>{turn.snapshot.sql}</pre>}
              </details>
            </div>
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
            {result && (
              <div className="diagnosis-card">
                <div className="output-heading">
                  <h3>{turn.mode === 'verify' ? '复验结论' : '诊断结论'}</h3>
                  {turn.mode === 'verify' && turn.status === 'complete' && (
                    <span className={`status-badge ${verificationLabels[result.verification].style}`}>{verificationLabels[result.verification].label}</span>
                  )}
                </div>
                <p>{result.summary}</p>
                {result.causes.length > 0 && <>
                  <h4>问题与原因</h4>
                  <ul>{result.causes.map((item, index) => <li key={index}>{item}</li>)}</ul>
                </>}
                {evidence.length > 0 && <>
                  <h4>工具证据</h4>
                  <div className="citation-row">{evidence.map(tool => (
                    <button className="citation" key={tool.id} onClick={() => openTool(turn.id, tool.id)}>{names[tool.name] ?? tool.name}</button>
                  ))}</div>
                </>}
                {(result.suggestion || result.suggested_sql) && <h4>修改建议</h4>}
                {result.suggestion && <p>{result.suggestion}</p>}
                {result.suggested_sql && <>
                  <pre>{result.suggested_sql}</pre>
                  <button className="button secondary apply-sql" type="button" onClick={() => applySql(result.suggested_sql!)}>填入候选 SQL</button>
                </>}
                {citations.length > 0 && <>
                  <h4>知识引用</h4>
                  <div className="citation-row">{citations.map(entry => (
                    <button className="citation" key={entry.id} onClick={() => openKnowledge(entry)}>{entry.id} · {entry.title}</button>
                  ))}</div>
                </>}
                {result.limitations.length > 0 && <>
                  <h4>验证限制</h4>
                  <ul>{result.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
                </>}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
