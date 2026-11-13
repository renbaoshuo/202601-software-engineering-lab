import { useEffect, useState } from 'react';
import { requestJson } from './api';

type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error' };

export function useQueryResource<T>(path: string | undefined) {
  const [revision, setRevision] = useState(0);
  const key = `${path ?? ''}:${revision}`;
  const [response, setResponse] = useState<{ key: string; resource: Resource<T> }>();
  const resource: Resource<T> = response?.key === key ? response.resource : { status: 'loading' };

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    requestJson<T>(path, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResponse({ key, resource: { status: 'ready', data } }); })
      .catch(() => { if (!controller.signal.aborted) setResponse({ key, resource: { status: 'error' } }); });
    return () => controller.abort();
  }, [key, path]);

  return { resource, retry: () => setRevision(value => value + 1) };
}
