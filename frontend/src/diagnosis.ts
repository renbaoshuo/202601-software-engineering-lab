import type { ModelConfig } from './model';

export type Verification = 'passed' | 'still_has_issue' | 'uncertain';
export interface KnowledgeEntry {
  id: string;
  title: string;
  rule: string;
  applicable: string;
  sqlite_version: string;
  dataset_id: string;
  wrong_sql: string;
  example_sql: string;
  source: string;
}

export interface Diagnosis {
  summary: string;
  causes: string[];
  evidence_ids: string[];
  knowledge_refs: KnowledgeEntry[];
  suggestion: string | null;
  suggested_sql: string | null;
  limitations: string[];
  verification: Verification;
}

export type DiagnosisMode = 'diagnose' | 'verify';
export interface Snapshot {
  dataset_id: string;
  sql: string;
  goal: string;
}

interface Envelope {
  request_id: string;
  sequence: number;
}
export type DiagnosisEvent = Envelope & (
  | { type: 'start'; mode: DiagnosisMode }
  | { type: 'tool_started'; call_id: string; name: string; sql: string | null }
  | { type: 'tool_result'; call_id: string; name: string; status: 'ok' | 'error'; elapsed_ms: number; details: Record<string, unknown> }
  | { type: 'diagnosis'; result: Diagnosis }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string }
);

export interface ToolCall {
  id: string;
  name: string;
  sql: string | null;
  status: 'running' | 'ok' | 'error';
  elapsed?: number;
  details?: Record<string, unknown>;
}

export interface DiagnosisRun {
  id: string;
  snapshot: Snapshot;
  mode: DiagnosisMode;
  status: 'running' | 'complete' | 'failed';
  tools: ToolCall[];
  result?: Diagnosis;
  error?: string;
}

export function applyDiagnosisEvent(turn: DiagnosisRun, event: DiagnosisEvent): DiagnosisRun {
  switch (event.type) {
    case 'tool_started':
      return { ...turn, tools: [...turn.tools, { id: event.call_id, name: event.name, sql: event.sql, status: 'running' }] };
    case 'tool_result':
      return {
        ...turn,
        tools: turn.tools.map(tool => tool.id === event.call_id
          ? { ...tool, status: event.status, elapsed: event.elapsed_ms, details: event.details }
          : tool),
      };
    case 'diagnosis':
      return { ...turn, result: event.result };
    case 'done':
      return turn.result ? { ...turn, status: 'complete' } : failDiagnosis(turn, '诊断提前结束，未收到结论。');
    case 'error':
      return failDiagnosis(turn, event.message);
    default:
      return turn;
  }
}

export function failDiagnosis(turn: DiagnosisRun, error: string): DiagnosisRun {
  return { ...turn, status: 'failed', error, tools: turn.tools.map(tool => tool.status === 'running' ? { ...tool, status: 'error' } : tool) };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function streamDiagnosis(
  model: ModelConfig, snapshot: Snapshot, mode: DiagnosisMode, messages: ChatMessage[],
  signal: AbortSignal, handle: (event: DiagnosisEvent) => void,
) {
  const response = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ model_config: model, workspace: snapshot, mode, messages }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(85_000)]),
  });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('无法建立诊断连接。');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let requestId: string | undefined;
  let sequence = 0;
  let terminal = false;

  try {
    while (!terminal) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 512_000) throw new Error('诊断响应超出限制。');
      let separator = /\r?\n\r?\n/.exec(buffer);
      while (!terminal && separator) {
        const lines = buffer.slice(0, separator.index).split(/\r?\n/);
        buffer = buffer.slice(separator.index + separator[0].length);
        separator = /\r?\n\r?\n/.exec(buffer);
        const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const event = { ...JSON.parse(data), type } as DiagnosisEvent;
        if (typeof event.request_id !== 'string' || (requestId && requestId !== event.request_id) ||
          event.sequence !== sequence + 1 || (sequence === 0 && type !== 'start')) {
          throw new Error('诊断事件顺序异常。');
        }
        requestId = event.request_id;
        sequence = event.sequence;
        handle(event);
        terminal = type === 'done' || type === 'error';
      }
    }
    if (!terminal) throw new Error('诊断连接中断，已保留收到的内容。');
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
