import type { ReactNode } from 'react';
import type { Dataset, DatasetSchema } from './api';
import { useQueryResource } from './useQueryResource';

interface Props {
  datasets: Dataset[];
  dataset?: Dataset;
  catalogStatus: 'loading' | 'ready' | 'error';
  selectDataset: (id: string) => void;
  retryCatalog: () => void;
  detail?: ReactNode;
  closeDetail: () => void;
}

export function SchemaPanel({ datasets, dataset, catalogStatus, selectDataset, retryCatalog, detail, closeDetail }: Props) {
  const { resource, retry } = useQueryResource<DatasetSchema>(
    dataset ? `/api/datasets/${encodeURIComponent(dataset.id)}/schema` : undefined,
  );

  if (detail) return (
    <aside className="inspector" aria-label="数据与详情">
      <button className="button secondary detail-back" type="button" onClick={closeDetail}>← 数据集与结构</button>
      {detail}
    </aside>
  );

  return (
    <aside className="inspector" aria-label="数据与详情">
      <h2>数据集与结构</h2>
      {catalogStatus === 'loading' && <p className="muted" role="status">正在加载数据集…</p>}
      {catalogStatus === 'error' && (
        <div role="alert"><p>数据集加载失败。</p><button className="button secondary" onClick={retryCatalog}>重试数据集</button></div>
      )}
      {catalogStatus === 'ready' && !dataset && <p className="muted">暂无可用数据集。</p>}
      {dataset && (
        <>
          <label className="field" htmlFor="dataset">数据集</label>
          <select id="dataset" className="dataset-select" value={dataset.id} onChange={event => selectDataset(event.target.value)}>
            {datasets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <p className="muted">{dataset.description}</p>
          {resource.status === 'loading' && <p className="muted" role="status">正在加载表结构…</p>}
          {resource.status === 'error' && (
            <div role="alert"><p>表结构加载失败。</p><button className="button secondary" onClick={retry}>重试表结构</button></div>
          )}
          {resource.status === 'ready' && (
            <div className="schema-tables" key={dataset.id}>
              {resource.data.tables.map(table => (
                <details key={table.name} className="schema-table">
                  <summary><code>{table.name}</code><span>{table.columns.length} 列</span></summary>
                  <ul>
                    {table.columns.map(column => (
                      <li key={column.name}>
                        <span><code>{column.name}</code>{column.primary_key > 0 && <small title="主键">PK</small>}</span>
                        <span className="column-type" title={column.nullable ? '可为空' : '不能为空'}>{column.type}{column.nullable ? ' · NULL' : ''}</span>
                      </li>
                    ))}
                  </ul>
                  {table.foreign_keys.length > 0 && (
                    <div className="schema-relations">
                      {table.foreign_keys.map(key => (
                        <code key={key.column}>{key.column} → {key.table}.{key.target}</code>
                      ))}
                    </div>
                  )}
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
