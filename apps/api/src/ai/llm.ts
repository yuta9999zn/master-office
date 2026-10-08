// A small client for a local Ollama server (docs/ARCHITECTURE.md §80). The AI layer talks to models only through
// this interface, so a hosted provider (Anthropic, the cdfl_harness sidecar) can be added beside it later.

export interface LlmRequest {
  model: string;
  system: string;
  prompt: string;
  /** A JSON schema the answer must follow (Ollama structured outputs), or 'json' for any JSON, or nothing for text. */
  format?: object | 'json';
  temperature?: number;
  /** Context window in tokens; larger is slower on CPU. */
  numCtx?: number;
  /** Upper bound on generated tokens. */
  maxTokens?: number;
  /** Base64 images for vision models. */
  images?: string[];
  signal?: AbortSignal;
  /** Called while the answer streams in: the text so far. */
  onText?: (text: string, tokens: number) => void;
}

export interface LlmResult {
  text: string;
  model: string;
  promptTokens: number;
  outputTokens: number;
  ms: number;
  loadMs: number;
}

export interface LlmModel {
  name: string;
  size: number;
  family: string | null;
  parameters: string | null;
  quantization: string | null;
  vision: boolean;
}

export class OllamaClient {
  constructor(readonly url: string) {}

  private endpoint(path: string) {
    return `${this.url.replace(/\/+$/, '')}${path}`;
  }

  async models(timeoutMs = 4000): Promise<LlmModel[]> {
    const res = await fetch(this.endpoint('/api/tags'), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
    const body = (await res.json()) as { models?: { name: string; size: number; details?: { family?: string; parameter_size?: string; quantization_level?: string; families?: string[] }; capabilities?: string[] }[] };
    return (body.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      family: m.details?.family ?? null,
      parameters: m.details?.parameter_size ?? null,
      quantization: m.details?.quantization_level ?? null,
      vision: (m.capabilities ?? []).includes('vision') || /vl|vision|llava/i.test(m.name),
    }));
  }

  /** Streams a chat completion; returns the whole answer. */
  async chat(req: LlmRequest): Promise<LlmResult> {
    const started = Date.now();
    const res = await fetch(this.endpoint('/api/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        stream: true,
        ...(req.format ? { format: req.format } : {}),
        // repeat_penalty keeps small models from looping on one phrase until the token limit.
        options: { temperature: req.temperature ?? 0.2, num_ctx: req.numCtx ?? 8192, repeat_penalty: 1.12, repeat_last_n: 128, ...(req.maxTokens ? { num_predict: req.maxTokens } : {}) },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt, ...(req.images?.length ? { images: req.images } : {}) },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Ollama answered ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let text = '';
    let tokens = 0;
    let final: { prompt_eval_count?: number; eval_count?: number; load_duration?: number; error?: string } = {};
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string } & typeof final;
        if (msg.error) throw new Error(msg.error);
        if (msg.message?.content) {
          text += msg.message.content;
          tokens++;
          req.onText?.(text, tokens);
        }
        if (msg.done) final = msg;
      }
    }
    return {
      text,
      model: req.model,
      promptTokens: final.prompt_eval_count ?? 0,
      outputTokens: final.eval_count ?? tokens,
      ms: Date.now() - started,
      loadMs: Math.round((final.load_duration ?? 0) / 1e6),
    };
  }
}

/** The first JSON object in a model's answer (tolerates prose or code fences around it). */
export function parseJsonLoose<T = unknown>(text: string): T {
  const t = text.trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    /* fall through */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) {
    try {
      return JSON.parse(fence[1]) as T;
    } catch {
      /* fall through */
    }
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1)) as T;
    } catch {
      /* fall through */
    }
  }
  const repaired = repairTruncatedJson(t);
  if (repaired) {
    try {
      return JSON.parse(repaired) as T;
    } catch {
      /* fall through */
    }
  }
  throw new Error('The model did not answer with JSON');
}

/**
 * Saves an answer cut off by the token limit (small models sometimes repeat a phrase until they run out): keeps every
 * complete member up to the last comma outside a string, drops a dangling key, and closes the open brackets.
 */
export function repairTruncatedJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const t = text.slice(start);
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let lastCut: { at: number; stack: string[] } | null = null;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (!stack.length) return t.slice(0, i + 1); // complete after all
    } else if (ch === ',' && stack.length) lastCut = { at: i, stack: [...stack] };
  }
  if (!lastCut) return null;
  let body = t.slice(0, lastCut.at).replace(/,\s*$/, '');
  // A cut inside an object right after a key ("key":) is not valid: drop that key.
  body = body.replace(/,\s*"[^"]*"\s*:\s*$/, '');
  return body + [...lastCut.stack].reverse().join('');
}
