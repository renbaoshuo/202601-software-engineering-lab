import { lazy, Suspense, useRef, useState } from 'react';
import { runSql, type Cell, type Dataset, type RunResult } from './api';
import { DiagnosisPanel, KnowledgeDetails, ToolDetails } from './DiagnosisPanel';
import { applyDiagnosisEvent, failDiagnosis, streamDiagnosis, type ChatMessage, type DiagnosisMode, type DiagnosisRun, type KnowledgeEntry } from './diagnosis';
import { readModelConfig, storeModelConfig, type ModelConfig } from './model';
import { QueryResult } from './QueryResult';
import { RunHistory } from './RunHistory';
import { SchemaPanel } from './SchemaPanel';
import { SqlEditor } from './SqlEditor';
import { useQueryResource } from './useQueryResource';
import { useWorkspace, type StoredRun } from './workspace';

const ModelSettings = lazy(() => import('./ModelSettings').then(module => ({ default: module.ModelSettings })));

function executionPreview(details: Record<string, unknown>): RunResult | undefined {
  const { status, elapsed_ms, columns, preview, message, code } = details;
  if (typeof elapsed_ms !== 'number') return;
  if ((status === 'ok' || status === 'empty') && Array.isArray(columns) && Array.isArray(preview)) {
    return {
      status, elapsed_ms, columns: columns as string[], rows: preview as Cell[][],
      truncated: Boolean(details.truncated || details.preview_truncated),
    };
  }
  if ((status === 'error' || status === 'timeout') && typeof message === 'string' && typeof code === 'string') {
    return { status, elapsed_ms, code, message };
  }
}

function titleFor(goal: string) {
  return goal.trim().split('\n', 1)[0]?.slice(0, 38) || '新会话';
}

type Inspector = { sessionId: string } & ({ turnId: string; toolId: string } | { entry: KnowledgeEntry });

export default function App() {
  const workspace = useWorkspace();
  const { resource: catalog, retry } = useQueryResource<Dataset[]>('/api/datasets');
  const [model, setModel] = useState(readModelConfig);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [goalError, setGoalError] = useState('');
  const [diagnosisIssue, setDiagnosisIssue] = useState('');
  const [detail, setDetail] = useState<Inspector>();
  const [runningRuns, setRunningRuns] = useState<Record<string, 'running' | 'failed' | undefined>>({});
  const diagnosisRequests = useRef(new Map<string, AbortController>());
  const runningRequests = useRef(new Set<string>());
  const goalInput = useRef<HTMLTextAreaElement>(null);
  const session = workspace.state?.sessions.find(item => item.draft.id === workspace.state?.activeId);

  if (!session || !workspace.state) return <main className="loading-workspace" role="status">正在恢复工作台…</main>;

  const { draft, turns, runs } = session;
  const { id: sessionId, goal, sql } = draft;
  const datasets = catalog.status === 'ready' ? catalog.data : [];
  const dataset = datasets.find(item => item.id === draft.datasetId) ?? datasets[0];
  const output = runs.filter(run => run.source === 'manual').at(-1);
  const running = runningRuns[sessionId] === 'running';
  const diagnosing = turns.some(turn => turn.status === 'running');
  const canVerify = turns.some(turn => turn.status === 'complete');
  const selectedDetail = detail?.sessionId === sessionId ? detail : undefined;
  const tool = selectedDetail && 'toolId' in selectedDetail
    ? turns.find(turn => turn.id === selectedDetail.turnId)?.tools.find(item => item.id === selectedDetail.toolId)
    : undefined;
  const entry = selectedDetail && 'entry' in selectedDetail ? selectedDetail.entry : undefined;
  const openKnowledge = (item: KnowledgeEntry) => setDetail({ sessionId, entry: item });
  const saveStatus = workspace.saveStates[sessionId];

  function switchSession(id?: string) {
    setGoalError('');
    setDiagnosisIssue('');
    setDetail(undefined);
    if (id) workspace.selectSession(id);
    else workspace.addSession();
  }

  async function diagnose(mode: DiagnosisMode) {
    if (!dataset || diagnosisRequests.current.has(sessionId)) return;
    setDiagnosisIssue('');
    if (!goal.trim()) {
      setGoalError('发起诊断前请填写查询目标。');
      goalInput.current?.focus();
      return;
    }
    if (!model) {
      setModelSettingsOpen(true);
      return;
    }
    const identity = { id: model.model, baseUrl: model.base_url.replace(/\/$/, '').replace(/\/chat\/completions$/, '') };
    if (draft.model && (draft.model.id !== identity.id || draft.model.baseUrl !== identity.baseUrl)) {
      setDiagnosisIssue(`此会话绑定 ${draft.model.id}。请恢复原模型配置，或新建会话后使用当前模型。`);
      return;
    }

    const snapshot = { dataset_id: dataset.id, sql, goal };
    const turn: DiagnosisRun = { id: crypto.randomUUID(), snapshot, mode, status: 'running', tools: [] };
    const messages: ChatMessage[] = turns.filter(previous => previous.status === 'complete' && previous.result)
      .slice(-3).flatMap(previous => [
        { role: 'user', content: previous.snapshot.goal.slice(0, 1800) },
        { role: 'assistant', content: previous.result!.summary.slice(0, 1800) },
      ]);
    const controller = new AbortController();
    const toolSql = new Map<string, string>();
    diagnosisRequests.current.set(sessionId, controller);
    workspace.addTurn(sessionId, turn, identity);
    try {
      await streamDiagnosis(model, snapshot, mode, messages, controller.signal, event => {
        let execution: StoredRun | undefined;
        if (event.type === 'tool_started' && event.sql) toolSql.set(event.call_id, event.sql);
        if (event.type === 'tool_result' && event.name === 'execute_sql') {
          const statement = toolSql.get(event.call_id);
          const result = executionPreview(event.details);
          if (statement && result) execution = {
            id: `${turn.id}:${event.call_id}`, sessionId, createdAt: Date.now(), source: 'agent', turnId: turn.id,
            sql: statement, dataset: dataset.name, datasetId: dataset.id, result,
          };
        }
        workspace.updateTurn(sessionId, turn.id, current => applyDiagnosisEvent(current, event), execution);
      });
    } catch (error) {
      const message = error instanceof TypeError ? '诊断连接失败，可重新请求。'
        : error instanceof Error && error.name === 'Error' ? error.message : '诊断中断，可重新请求。';
      workspace.updateTurn(sessionId, turn.id, current => failDiagnosis(current, message));
    } finally {
      diagnosisRequests.current.delete(sessionId);
    }
  }

  async function runQuery() {
    if (!dataset || !sql.trim() || runningRequests.current.has(sessionId)) return;
    runningRequests.current.add(sessionId);
    setRunningRuns(previous => ({ ...previous, [sessionId]: 'running' }));
    const record = {
      id: crypto.randomUUID(), sessionId, createdAt: Date.now(), sql,
      dataset: dataset.name, datasetId: dataset.id, source: 'manual' as const,
    };
    try {
      const result = await runSql(dataset.id, sql);
      workspace.addRun({ ...record, result });
      setRunningRuns(previous => ({ ...previous, [sessionId]: undefined }));
    } catch {
      setRunningRuns(previous => ({ ...previous, [sessionId]: 'failed' }));
    } finally {
      runningRequests.current.delete(sessionId);
    }
  }

  function saveModel(config: ModelConfig | null) {
    storeModelConfig(config);
    setModel(config);
    setModelSettingsOpen(false);
    setDiagnosisIssue('');
  }

  function fillExample() {
    if (!dataset) return;
    workspace.edit(sessionId, { datasetId: dataset.id, sql: dataset.sample_sql, goal: dataset.sample_goal });
    setGoalError('');
  }

  return (
    <div className="workspace">
      <aside className="sidebar" aria-label="会话">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden="true">›_</span>QueryPilot</a>
        <div className="session-heading">
          <span>会话</span><button className="session-add" type="button" aria-label="新建会话" title="新建会话" onClick={() => switchSession()}>+</button>
        </div>
        <div className="session-list">
          {workspace.state.sessions.slice().sort((a, b) => b.draft.updatedAt - a.draft.updatedAt).map(item => (
            <button className={`session-item ${item.draft.id === sessionId ? 'selected' : ''}`} key={item.draft.id}
              type="button" aria-current={item.draft.id === sessionId} onClick={() => switchSession(item.draft.id)}>
              <span>{titleFor(item.draft.goal)}</span>
              {item.draft.datasetId && <small>{datasets.find(entry => entry.id === item.draft.datasetId)?.name ?? item.draft.datasetId}</small>}
            </button>
          ))}
        </div>
      </aside>
      <header className="topbar">
        <div className="topbar-label">
          <span>SQL 工作台</span>
          {draft.model && <span className="locked-model" title={draft.model.id}>会话模型 · {draft.model.id}</span>}
        </div>
        <button className="button secondary model-button" type="button" onClick={() => setModelSettingsOpen(true)}>
          <span aria-hidden="true" className={model ? 'model-dot configured' : 'model-dot'} />
          <span>{model ? model.model : '模型设置'}</span>
        </button>
      </header>
      <main className="main">
        <div className="workspace-title">
          <div>
            <h1>查询工作台</h1>
            {saveStatus === 'saving' && <p className="muted" role="status">正在保存…</p>}
            {saveStatus === 'saved' && <p className="muted" role="status">已保存在此浏览器</p>}
            {saveStatus === 'failed' && <p className="model-error" role="alert">尚未保存 <button className="text-button" onClick={() => workspace.retry(sessionId)}>重试保存</button></p>}
            {workspace.loadError && <p className="model-error" role="alert">未能读取本地会话。</p>}
          </div>
          <button className="button secondary" type="button" onClick={fillExample} disabled={!dataset}>填入示例</button>
        </div>
        <section className="panel query-panel" aria-label="当前查询">
          <label className="field">查询目标
            <textarea ref={goalInput} className="goal-input" rows={2} value={goal} maxLength={4000}
              aria-invalid={Boolean(goalError)} aria-describedby={goalError ? 'goal-error' : undefined}
              onChange={event => {
                workspace.edit(sessionId, { goal: event.target.value, datasetId: dataset?.id ?? draft.datasetId });
                setGoalError('');
              }} placeholder="你希望查询得到什么结果？" />
            {goalError && <span id="goal-error" className="model-error" role="alert">{goalError}</span>}
          </label>
          <SqlEditor sql={sql} change={value => workspace.edit(sessionId, { sql: value, datasetId: dataset?.id ?? draft.datasetId })} run={runQuery} />
          {diagnosisIssue && <p className="model-error" role="alert">{diagnosisIssue}</p>}
          <div className="query-actions">
            <button className="button primary" type="button" onClick={runQuery} disabled={!dataset || !sql.trim() || running}>{running ? '运行中…' : '运行 SQL'}</button>
            <button className="button secondary" type="button" onClick={() => diagnose('diagnose')} disabled={!dataset || diagnosing}>
              {diagnosing ? '诊断中…' : '请求诊断'}
            </button>
            {canVerify && <button className="button secondary" type="button" disabled={!dataset || !sql.trim() || diagnosing}
              onClick={() => diagnose('verify')}>再次验证</button>}
          </div>
        </section>
        <QueryResult output={output} running={running} failed={runningRuns[sessionId] === 'failed'} />
        <RunHistory runs={runs} />
        <DiagnosisPanel turns={turns} openTool={(turnId, toolId) => setDetail({ sessionId, turnId, toolId })}
          openKnowledge={openKnowledge} applySql={(value, datasetId) => {
            workspace.edit(sessionId, { sql: value, datasetId });
            document.getElementById('sql')?.focus();
          }} />
      </main>
      {modelSettingsOpen && (
        <Suspense fallback={null}>
          <ModelSettings config={model} close={() => setModelSettingsOpen(false)} save={saveModel} />
        </Suspense>
      )}
      <SchemaPanel datasets={datasets} dataset={dataset} catalogStatus={catalog.status}
        selectDataset={id => workspace.edit(sessionId, { datasetId: id })} retryCatalog={retry}
        detail={entry ? <KnowledgeDetails entry={entry} /> : tool && <ToolDetails tool={tool} openKnowledge={openKnowledge} />}
        closeDetail={() => setDetail(undefined)} />
    </div>
  );
}
