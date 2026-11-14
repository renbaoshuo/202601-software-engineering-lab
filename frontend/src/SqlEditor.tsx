import { useRef } from 'react';

const sqlTokens = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|AS|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|WITH|RECURSIVE|VALUES|UNION|ALL|DISTINCT|AND|OR|NOT|NULL|IN|IS|BETWEEN|LIKE|EXISTS|CASE|WHEN|THEN|ELSE|END|ASC|DESC)\b|\b(\d+(?:\.\d+)?)\b/gi;

function highlight(sql: string) {
  const parts = [];
  let offset = 0;
  for (const match of sql.matchAll(sqlTokens)) {
    const start = match.index;
    parts.push(sql.slice(offset, start));
    const kind = match[1] ? 'comment' : match[2] ? 'string' : match[3] ? 'keyword' : 'number';
    parts.push(<span key={start} className={`sql-${kind}`}>{match[0]}</span>);
    offset = start + match[0].length;
  }
  parts.push(sql.slice(offset), '\n');
  return parts;
}

export function SqlEditor({ sql, change, run }: { sql: string; change: (value: string) => void; run: () => void }) {
  const highlightRef = useRef<HTMLPreElement>(null);

  return (
    <div className="editor">
      <div className="editor-heading">
        <label htmlFor="sql">SQL 编辑器</label><small>SQLite · 只读</small>
      </div>
      <div className="editor-surface">
        <pre ref={highlightRef} aria-hidden="true">{highlight(sql)}</pre>
        <textarea id="sql" spellCheck={false} autoCapitalize="off" wrap="off" rows={7} maxLength={16384} value={sql} placeholder="SELECT …"
          onChange={event => change(event.target.value)}
          onScroll={event => {
            highlightRef.current?.scrollTo(event.currentTarget.scrollLeft, event.currentTarget.scrollTop);
          }}
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              run();
            }
          }}
        />
      </div>
    </div>
  );
}
