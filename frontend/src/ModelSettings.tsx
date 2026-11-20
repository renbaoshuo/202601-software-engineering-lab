import { Modal } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { MAX_OUTPUT_TOKENS, testModel, type Compatibility, type ModelConfig } from './model';

const defaultConfig: ModelConfig = {
  base_url: '', api_key: '', model: '', context_length: 128_000, max_output_tokens: 2048,
};

const checks = [
  ['connection', '服务连通'],
  ['authentication', 'API Key 认证'],
  ['model', '模型可用'],
  ['tools', '函数工具调用'],
] as const;
const checkText = { pass: '通过', fail: '失败', unchecked: '未检查' };
const checkStyle = { pass: 'is-success', fail: 'is-error', unchecked: 'is-neutral' };

interface Props {
  config: ModelConfig | null;
  close: () => void;
  save: (config: ModelConfig | null) => void;
}

export function ModelSettings({ config, close, save }: Props) {
  const [draft, setDraft] = useState(config ?? defaultConfig);
  const [result, setResult] = useState<Compatibility>();
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const request = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => () => request.current?.abort(), []);

  function change<K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) {
    setDraft(current => ({ ...current, [key]: value }));
    setError('');
    setResult(undefined);
  }

  function checkedDraft() {
    if (!form.current?.reportValidity()) return;
    const value = { ...draft, base_url: draft.base_url.trim(), model: draft.model.trim(), api_key: draft.api_key.trim() };
    if (!value.model || !value.api_key || /[^\x21-\x7e]/.test(value.api_key)) {
      setError('请填写 Model ID 和有效的 API Key。');
      return;
    }
    if (value.max_output_tokens >= value.context_length) {
      setError('最大输出 Token 必须小于上下文长度。');
      return;
    }
    return value;
  }

  async function test() {
    const value = checkedDraft();
    if (!value || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setTesting(true);
    setError('');
    setResult(undefined);
    try {
      const response = await testModel(value, controller.signal);
      if (!controller.signal.aborted) setResult(response);
    } catch {
      if (!controller.signal.aborted) setError('兼容性检查请求失败，可稍后重试。');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setTesting(false);
    }
  }

  function persist(value: ModelConfig | null) {
    try {
      save(value);
    } catch {
      setError('浏览器无法写入模型配置，请检查站点存储权限。');
    }
  }

  return (
    <Modal opened onClose={close} title="模型配置" centered size="md" closeButtonProps={{ 'aria-label': '关闭模型配置' }}>
      <form ref={form} className="model-form" onSubmit={event => {
        event.preventDefault();
        const value = checkedDraft();
        if (value) persist(value);
      }}>
        <p className="muted">配置保存在此浏览器。测试和诊断会使用你的模型额度。</p>
        <fieldset disabled={testing}>
          <label className="field">API Endpoint
            <input data-autofocus type="url" placeholder="https://api.openai.com/v1" required maxLength={400}
              value={draft.base_url} onChange={event => change('base_url', event.target.value)} />
          </label>
          <label className="field">API Key
            <input type="password" autoComplete="new-password" required maxLength={1024}
              value={draft.api_key} onChange={event => change('api_key', event.target.value)} />
          </label>
          <label className="field">Model ID
            <input placeholder="模型服务提供的标识" required maxLength={160}
              value={draft.model} onChange={event => change('model', event.target.value)} />
          </label>
          <div className="model-budget">
            <label className="field">上下文长度
              <input type="number" min={1024} max={1048576} step={1} required value={draft.context_length || ''}
                onChange={event => change('context_length', event.target.valueAsNumber)} />
            </label>
            <label className="field">最大输出 Token
              <input type="number" min={128} max={MAX_OUTPUT_TOKENS} step={1} required value={draft.max_output_tokens || ''}
                aria-describedby="output-budget-hint"
                onChange={event => change('max_output_tokens', event.target.valueAsNumber)} />
            </label>
          </div>
          <p id="output-budget-hint" className="muted">最多 393,216 Tokens，实际可用值取决于模型和上下文长度。</p>
        </fieldset>
        {testing && <p className="muted" role="status">正在检查模型服务和工具支持…</p>}
        {error && <p className="model-error" role="alert">{error}</p>}
        {result && (
          <div className="model-result" role="status">
            <ul>{checks.map(([key, label]) => (
              <li key={key}>{label}<span className={`status-badge ${checkStyle[result[key]]}`}>{checkText[result[key]]}</span></li>
            ))}</ul>
            <p>{result.message}</p>
          </div>
        )}
        <div className="model-actions">
          {config && <button className="button secondary clear-model" type="button" disabled={testing} onClick={() => persist(null)}>清除配置</button>}
          <button className="button secondary" type="button" disabled={testing} onClick={test}>测试连接</button>
          <button className="button primary" type="submit" disabled={testing}>保存配置</button>
        </div>
      </form>
    </Modal>
  );
}
