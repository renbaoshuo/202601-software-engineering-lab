import Dexie, { type EntityTable } from 'dexie';
import { useEffect, useRef, useState } from 'react';
import { failDiagnosis, type DiagnosisRun } from './diagnosis';
import type { QueryOutput } from './QueryResult';

export interface Draft {
  id: string;
  datasetId: string;
  sql: string;
  goal: string;
  updatedAt: number;
  model?: { baseUrl: string; id: string };
}

interface StoredTurn extends DiagnosisRun {
  sessionId: string;
  createdAt: number;
}

export interface StoredRun extends QueryOutput {
  id: string;
  sessionId: string;
  createdAt: number;
  source: 'manual' | 'agent';
  datasetId?: string;
  turnId?: string;
}

export interface Session {
  draft: Draft;
  turns: StoredTurn[];
  runs: StoredRun[];
}

interface WorkspaceState {
  activeId: string;
  sessions: Session[];
}
type SaveStatus = 'saving' | 'saved' | 'failed';

const db = new Dexie('querypilot.workspace') as Dexie & {
  sessions: EntityTable<Draft, 'id'>;
  messages: EntityTable<StoredTurn, 'id'>;
  sqlRuns: EntityTable<StoredRun, 'id'>;
};
db.version(1).stores({
  sessions: '&id,updatedAt',
  messages: '&id,sessionId,[sessionId+createdAt]',
  sqlRuns: '&id,sessionId,[sessionId+createdAt]',
});

const ACTIVE_KEY = 'querypilot.active-session';
function readActive() {
  try { return sessionStorage.getItem(ACTIVE_KEY); } catch { return null; }
}
function rememberActive(id: string) {
  try { sessionStorage.setItem(ACTIVE_KEY, id); } catch { /* The latest updated session remains available. */ }
}
function freshSession(): Session {
  return { draft: { id: crypto.randomUUID(), datasetId: '', sql: '', goal: '', updatedAt: Date.now() }, turns: [], runs: [] };
}

async function loadSessions(): Promise<Session[]> {
  return db.transaction('r', [db.sessions, db.messages, db.sqlRuns], async () => {
    const [drafts, turns, runs] = await Promise.all([
      db.sessions.orderBy('updatedAt').reverse().toArray(), db.messages.toArray(), db.sqlRuns.toArray(),
    ]);
    return drafts.map(draft => ({
      draft,
      turns: turns.filter(turn => turn.sessionId === draft.id).sort((a, b) => a.createdAt - b.createdAt).map(turn =>
        turn.status === 'running' ? { ...turn, ...failDiagnosis(turn, '诊断在页面刷新前中断。') } : turn,
      ),
      runs: runs.filter(run => run.sessionId === draft.id).sort((a, b) => a.createdAt - b.createdAt),
    }));
  });
}

interface SaveQueue {
  pending: number;
  dirty: Set<string>;
  latest: Promise<void>;
}

export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>();
  const [saveStates, setSaveStates] = useState<Record<string, SaveStatus>>({});
  const [loadError, setLoadError] = useState(false);
  const current = useRef<WorkspaceState | undefined>(undefined);
  const queues = useRef(new Map<string, SaveQueue>());

  useEffect(() => {
    let cancelled = false;
    function initialize(restored: Session[]) {
      if (cancelled) return;
      const sessions = restored.length ? restored : [freshSession()];
      const activeId = sessions.find(session => session.draft.id === readActive())?.draft.id ?? sessions[0].draft.id;
      const value = { activeId, sessions };
      current.current = value;
      setState(value);
      setSaveStates(Object.fromEntries(restored.map(session => [session.draft.id, 'saved'])));
    }
    loadSessions().then(initialize, () => {
      if (!cancelled) setLoadError(true);
      initialize([]);
    });
    return () => { cancelled = true; };
  }, []);

  function publish(value: WorkspaceState) {
    current.current = value;
    setState(value);
  }

  function enqueue(id: string, key: string, write: () => Promise<unknown>) {
    let queue = queues.current.get(id);
    if (!queue) {
      queue = { pending: 0, dirty: new Set(), latest: Promise.resolve() };
      queues.current.set(id, queue);
    }
    const entry = queue;
    entry.pending += 1;
    setSaveStates(previous => ({ ...previous, [id]: 'saving' }));
    entry.latest = entry.latest.then(async () => {
      try {
        await write();
        if (key === 'all') entry.dirty.clear();
        else entry.dirty.delete(key);
      } catch {
        entry.dirty.add(key);
      } finally {
        entry.pending -= 1;
        const status = entry.pending ? 'saving' : entry.dirty.size ? 'failed' : 'saved';
        setSaveStates(previous => ({ ...previous, [id]: status }));
        if (!entry.pending && !entry.dirty.size) queues.current.delete(id);
      }
    });
  }

  function update(id: string, change: (session: Session) => Session) {
    const value = current.current;
    const session = value?.sessions.find(item => item.draft.id === id);
    if (!value || !session) return;
    const next = change(session);
    if (next === session) return;
    next.draft = { ...next.draft, updatedAt: Date.now() };
    publish({ ...value, sessions: value.sessions.map(item => item === session ? next : item) });
    return next;
  }

  function edit(id: string, patch: Partial<Pick<Draft, 'datasetId' | 'sql' | 'goal'>>) {
    const next = update(id, session => ({ ...session, draft: { ...session.draft, ...patch } }));
    if (next) enqueue(id, 'draft', () => db.sessions.put(next.draft));
  }

  function addSession() {
    const value = current.current;
    if (!value) return;
    const session = freshSession();
    const id = session.draft.id;
    rememberActive(id);
    publish({ activeId: id, sessions: [session, ...value.sessions] });
    enqueue(id, 'draft', () => db.sessions.put(session.draft));
  }

  function selectSession(id: string) {
    const value = current.current;
    if (!value?.sessions.some(session => session.draft.id === id)) return;
    rememberActive(id);
    publish({ ...value, activeId: id });
  }

  function addTurn(sessionId: string, turn: DiagnosisRun, model: NonNullable<Draft['model']>) {
    const record = { ...turn, sessionId, createdAt: Date.now() };
    const next = update(sessionId, session => ({
      ...session, draft: { ...session.draft, model }, turns: [...session.turns, record],
    }));
    if (next) enqueue(sessionId, turn.id, () => db.transaction('rw', [db.sessions, db.messages], async () => {
      await db.sessions.put(next.draft);
      await db.messages.put(record);
    }));
  }

  function updateTurn(sessionId: string, turnId: string, change: (turn: DiagnosisRun) => DiagnosisRun, run?: StoredRun) {
    let record: StoredTurn | undefined;
    const next = update(sessionId, session => {
      const turn = session.turns.find(item => item.id === turnId);
      if (!turn) return session;
      const changed = change(turn);
      if (changed === turn) return session;
      record = { ...turn, ...changed };
      return {
        ...session, turns: session.turns.map(item => item === turn ? record! : item),
        runs: run ? [...session.runs, run] : session.runs,
      };
    });
    if (!next || !record) return;
    const saved = record;
    const executions = next.runs.filter(item => item.turnId === turnId);
    const tables = executions.length ? [db.sessions, db.messages, db.sqlRuns] : [db.sessions, db.messages];
    enqueue(sessionId, turnId, () => db.transaction('rw', tables, async () => {
      await db.sessions.put(next.draft);
      await db.messages.put(saved);
      if (executions.length) await db.sqlRuns.bulkPut(executions);
    }));
  }

  function addRun(record: StoredRun) {
    const next = update(record.sessionId, session => ({ ...session, runs: [...session.runs, record] }));
    if (next) enqueue(record.sessionId, record.id, () => db.transaction('rw', [db.sessions, db.sqlRuns], async () => {
      await db.sessions.put(next.draft);
      await db.sqlRuns.put(record);
    }));
  }

  function retry(id: string) {
    const session = current.current?.sessions.find(item => item.draft.id === id);
    if (!session) return;
    enqueue(id, 'all', () => db.transaction('rw', [db.sessions, db.messages, db.sqlRuns], async () => {
      await db.sessions.put(session.draft);
      await db.messages.bulkPut(session.turns);
      await db.sqlRuns.bulkPut(session.runs);
    }));
  }

  return { state, saveStates, loadError, edit, addSession, selectSession, addTurn, updateTurn, addRun, retry };
}
