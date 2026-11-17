import { useRef, useState } from 'react';
import { runSql, type Dataset } from './api';
import { QueryResult, type QueryOutput } from './QueryResult';
import { SqlEditor } from './SqlEditor';
import { ModelSettings } from './ModelSettings';
import { DiagnosisPanel, KnowledgeDetails, ToolDetails } from './DiagnosisPanel';
import { applyDiagnosisEvent, failDiagnosis, streamDiagnosis, type DiagnosisRun, type KnowledgeEntry } from './diagnosis';
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
  const [turns, setTurns] = useState<DiagnosisRun[]>([]);
  const [goalError, setGoalError] = useState(false);
  const [detail, setDetail] = useState<{ turnId: string; toolId: string } | { entry: KnowledgeEntry }>();
  const diagnosisRequest = useRef<AbortController | null>(null);
  const goalInput = useRef<HTMLTextAreaElement>(null);
  const datasets = catalog.status === 'ready' ? catalog.data : [];
  const dataset = datasets.find(item => item.id === datasetId) ?? datasets[0];

  const diagnosing = turns.some(turn => turn.status === 'running');
  const tool = detail && 'toolId' in detail
    ? turns.find(turn => turn.id === detail.turnId)?.tools.find(item => item.id === detail.toolId)
    : undefined;
  const entry = detail && 'entry' in detail ? detail.entry : undefined;
  const openKnowledge = (item: KnowledgeEntry) => setDetail({ entry: item });

  async function diagnose() {
    if (!dataset || diagnosisRequest.current) return;
    if (!goal.trim()) {
      setGoalError(true);
      goalInput.current?.focus();
      return;
    }
    if (!model) {
      setModelSettingsOpen(true);
      return;
    }
    const snapshot = { dataset_id: dataset.id, sql, goal };
    const turn: DiagnosisRun = { id: crypto.randomUUID(), snapshot, mode: 'diagnose', status: 'running', tools: [] };
    const controller = new AbortController();
    diagnosisRequest.current = controller;
    setTurns(previous => [...previous, turn]);
    try {
      await streamDiagnosis(model, snapshot, 'diagnose', [], controller.signal, event => {
        setTurns(previous => previous.map(item => item.id === turn.id ? applyDiagnosisEvent(item, event) : item));
      });
    } catch (error) {
      const message = error instanceof TypeError ? '诊断连接失败，可重新请求。'
        : error instanceof Error ? error.message : '诊断中断。';
      setTurns(previous => previous.map(item => item.id === turn.id ? failDiagnosis(item, message) : item));
    } finally {
      diagnosisRequest.current = null;
    }
  }

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
            <textarea ref={goalInput} className="goal-input" rows={2} value={goal} maxLength={4000}
              aria-invalid={goalError} aria-describedby={goalError ? 'goal-error' : undefined}
              onChange={event => { setGoal(event.target.value); setGoalError(false); }} placeholder="你希望查询得到什么结果？" />
            {goalError && <span id="goal-error" className="model-error" role="alert">发起诊断前请填写查询目标。</span>}
          </label>
          <SqlEditor sql={sql} change={setSql} run={runQuery} />
          <div className="query-actions">
            <button className="button primary" type="button" onClick={runQuery} disabled={!dataset || !sql.trim() || running}>{running ? '运行中…' : '运行 SQL'}</button>
            <button className="button secondary" type="button" onClick={diagnose} disabled={!dataset || diagnosing}>
              {diagnosing ? '诊断中…' : '请求诊断'}
            </button>
          </div>
        </section>
        <QueryResult output={output} running={running} failed={failed} />
        <DiagnosisPanel turns={turns} openTool={(turnId, toolId) => setDetail({ turnId, toolId })}
          openKnowledge={openKnowledge} applySql={setSql} />
      </main>
      {modelSettingsOpen && <ModelSettings config={model} close={() => setModelSettingsOpen(false)} save={saveModel} />}
      <SchemaPanel datasets={datasets} dataset={dataset} catalogStatus={catalog.status} selectDataset={setDatasetId} retryCatalog={retry}
        detail={entry ? <KnowledgeDetails entry={entry} /> : tool && <ToolDetails tool={tool} openKnowledge={openKnowledge} />} closeDetail={() => setDetail(undefined)} />
    </div>
  );
}
