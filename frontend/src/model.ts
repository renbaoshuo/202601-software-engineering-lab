import { requestJson } from './api';

const MODEL_KEY = 'querypilot.model.v1';

export interface ModelConfig {
  base_url: string;
  api_key: string;
  model: string;
  context_length: number;
  max_output_tokens: number;
}

type Check = 'pass' | 'fail' | 'unchecked';
export interface Compatibility {
  connection: Check;
  authentication: Check;
  model: Check;
  tools: Check;
  message: string;
}

export function readModelConfig(): ModelConfig | null {
  try {
    const value: ModelConfig | null = JSON.parse(localStorage.getItem(MODEL_KEY) ?? 'null');
    if (value && typeof value.base_url === 'string' && typeof value.api_key === 'string' &&
      typeof value.model === 'string' && Number.isInteger(value.context_length) &&
      Number.isInteger(value.max_output_tokens)) return value;
  } catch {
    // A restricted or cleared browser can start with a fresh configuration.
  }
  return null;
}

export function storeModelConfig(config: ModelConfig | null) {
  if (config) localStorage.setItem(MODEL_KEY, JSON.stringify(config));
  else localStorage.removeItem(MODEL_KEY);
}

export function testModel(config: ModelConfig, signal: AbortSignal) {
  return requestJson<Compatibility>('/api/model/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal,
  }, 35_000);
}
