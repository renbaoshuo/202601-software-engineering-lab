import { useState } from 'react';
import type { Dataset } from './api';
import { SchemaPanel } from './SchemaPanel';
import { useQueryResource } from './useQueryResource';

export default function App() {
  const { resource: catalog, retry } = useQueryResource<Dataset[]>('/api/datasets');
  const [datasetId, setDatasetId] = useState('');
  const [sql, setSql] = useState('');
  const [goal, setGoal] = useState('');
  const datasets = catalog.status === 'ready' ? catalog.data : [];
  const dataset = datasets.find(item => item.id === datasetId) ?? datasets[0];

  function fillExample() {
    if (!dataset) return;
    setSql(dataset.sample_sql);
    setGoal(dataset.sample_goal);
  }

  return (
    <div className="workspace">
      <aside className="sidebar" aria-label="会话">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden="true">›_</span>QueryPilot</a>
        <div className="session-heading"><span>会话</span></div>
        <button className="session-item selected" type="button" aria-current="true">当前工作区</button>
      </aside>
      <header className="topbar">
        <span>SQL 工作台</span>
        <button className="button secondary" type="button" disabled>模型设置</button>
      </header>
      <main className="main">
        <div className="workspace-title">
          <h1>查询工作台</h1>
          <button className="button secondary" type="button" onClick={fillExample} disabled={!dataset}>填入示例</button>
        </div>
        <section className="panel query-panel" aria-label="当前查询">
          <label className="field">查询目标
            <textarea className="goal-input" rows={2} value={goal} onChange={event => setGoal(event.target.value)} placeholder="你希望查询得到什么结果？" />
          </label>
          <div className="editor">
            <label htmlFor="sql" className="editor-heading"><span>SQL 编辑器</span><small>SQLite · 只读</small></label>
            <textarea id="sql" spellCheck={false} rows={8} value={sql} onChange={event => setSql(event.target.value)} placeholder="SELECT …" />
          </div>
          <div className="query-actions">
            <button className="button primary" type="button" disabled>运行 SQL</button>
            <button className="button secondary" type="button" disabled>请求诊断</button>
          </div>
        </section>
        <section className="panel output" aria-label="运行结果">
          <h2>运行结果</h2>
          <p className="muted">运行 SQL 后在此查看实际结果。</p>
        </section>
      </main>
      <SchemaPanel datasets={datasets} dataset={dataset} catalogStatus={catalog.status} selectDataset={setDatasetId} retryCatalog={retry} />
    </div>
  );
}
