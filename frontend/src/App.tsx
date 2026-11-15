import { useState } from 'react';
import { runSql, type Dataset } from './api';
import { QueryResult, type QueryOutput } from './QueryResult';
import { SqlEditor } from './SqlEditor';
import { ModelSettings } from './ModelSettings';
import { readModelConfig, storeModelConfig, type ModelConfig } from './model';
import { SchemaPanel } from './SchemaPanel';
import { useQueryResource } from './useQueryResource';

export default function App() {
  const { resource: catalog, retry } = useQueryResource<Dataset[]>('/api/datasets');
  const [datasetId, setDatasetId] = useState('');
  const [sql, setSql] = useState('');
  const [goal, setGoal] = useState('');
  const [output, setOutput] = useState<QueryOutput>();
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [model, setModel] = useState(readModelConfig);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const datasets = catalog.status === 'ready' ? catalog.data : [];
  const dataset = datasets.find(item => item.id === datasetId) ?? datasets[0];

  async function runQuery() {
    if (!dataset || !sql.trim() || running) return;
    setRunning(true);
    setFailed(false);
    try {
      const result = await runSql(dataset.id, sql);
      setOutput({ dataset: dataset.name, sql, result });
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  }

  function saveModel(config: ModelConfig | null) {
    storeModelConfig(config);
    setModel(config);
    setModelSettingsOpen(false);
  }

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
        <button className="button secondary model-button" type="button" onClick={() => setModelSettingsOpen(true)}>
          <span aria-hidden="true" className={model ? 'model-dot configured' : 'model-dot'} />
          <span>{model ? model.model : '模型设置'}</span>
        </button>
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
          <SqlEditor sql={sql} change={setSql} run={runQuery} />
          <div className="query-actions">
            <button className="button primary" type="button" onClick={runQuery} disabled={!dataset || !sql.trim() || running}>{running ? '运行中…' : '运行 SQL'}</button>
            <button className="button secondary" type="button" disabled>请求诊断</button>
          </div>
        </section>
        <QueryResult output={output} running={running} failed={failed} />
      </main>
      {modelSettingsOpen && <ModelSettings config={model} close={() => setModelSettingsOpen(false)} save={saveModel} />}
      <SchemaPanel datasets={datasets} dataset={dataset} catalogStatus={catalog.status} selectDataset={setDatasetId} retryCatalog={retry} />
    </div>
  );
}
