import { useState } from 'react';
import type { Dataset } from './api';

const previewDatasets: Dataset[] = [
  {
    id: 'retail',
    name: '零售订单',
    description: '通过客户、商品和订单学习连接与分组。',
    sample_goal: '统计每位客户的已支付订单数，包括没有已支付订单的客户。',
    sample_sql: "SELECT c.name, COUNT(o.id) AS paid_orders\nFROM customers AS c\nLEFT JOIN orders AS o ON o.customer_id = c.id AND o.status = 'paid'\nGROUP BY c.id, c.name\nORDER BY c.id;",
  },
  {
    id: 'library',
    name: '图书借阅',
    description: '通过书目和借阅记录练习过滤与 NULL。',
    sample_goal: '列出尚未归还的借阅记录。',
    sample_sql: 'SELECT b.title, l.borrower, l.borrowed_on\nFROM loans AS l JOIN books AS b ON b.id = l.book_id\nWHERE l.returned_on IS NULL\nORDER BY l.id;',
  },
];

export default function App() {
  const [datasetId, setDatasetId] = useState(previewDatasets[0].id);
  const [sql, setSql] = useState('');
  const [goal, setGoal] = useState('');
  const dataset = previewDatasets.find(item => item.id === datasetId)!;

  function fillExample() {
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
          <button className="button secondary" type="button" onClick={fillExample}>填入示例</button>
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
      <aside className="inspector" aria-label="数据与详情">
        <h2>数据集与结构</h2>
        <label className="field">数据集
          <select value={datasetId} onChange={event => setDatasetId(event.target.value)}>
            {previewDatasets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <p className="muted">{dataset.description}</p>
      </aside>
    </div>
  );
}
