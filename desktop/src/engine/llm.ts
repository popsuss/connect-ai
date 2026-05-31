// 로컬 LLM 클라이언트 (LM Studio / Ollama 자동 감지) — vscode 의존성 없음.
// 익스텐션의 _callAgentLLM 핵심 로직을 데스크톱용으로 추출·단순화.
import axios from 'axios';

export interface LlmTarget { base: string; model: string; engine: 'lmstudio' | 'ollama'; }

const isLMStudio = (base: string) => /:1234(\/|$)/.test(base) || /lm[-_]?studio/i.test(base);

// 채팅용이 아닌 모델 — 임베딩·오디오·이미지·rerank 등은 비서 모델로 부적합. 자동 선택에서 제외.
const NON_CHAT = /embed|ace-step|whisper|\btts\b|rerank|\bclip\b|sdxl|stable-diffusion|\bflux\b|bark|musicgen|nomic|reranker/i;

interface ModelInfo { id: string; loaded: boolean; chat: boolean; }

// 한 엔진을 조사 → 모델 목록 + 각 모델의 (로드 여부 / 채팅 가능 여부).
async function probe(base: string): Promise<{ engine: 'lmstudio' | 'ollama'; models: ModelInfo[] } | null> {
  if (isLMStudio(base)) {
    // LM Studio 네이티브 API — state(loaded)·type(llm/vlm/embeddings) 제공
    try {
      const r = await axios.get(`${base}/api/v0/models`, { timeout: 1500 });
      const arr = r.data?.data || [];
      if (arr.length) return {
        engine: 'lmstudio',
        models: arr.map((m: any) => ({
          id: m.id,
          loaded: m.state === 'loaded',
          chat: /llm|vlm/i.test(m.type || '') && m.type !== 'embeddings' && !NON_CHAT.test(m.id),
        })),
      };
    } catch { /* 구버전 — OpenAI 호환으로 폴백 */ }
    try {
      const r = await axios.get(`${base}/v1/models`, { timeout: 1500 });
      const arr = r.data?.data || [];
      if (arr.length) return { engine: 'lmstudio', models: arr.map((m: any) => ({ id: m.id, loaded: true, chat: !NON_CHAT.test(m.id) })) };
    } catch { /* */ }
    return null;
  }
  // Ollama — /api/tags(전체) + /api/ps(현재 로드/실행 중)
  try {
    const tags = (await axios.get(`${base}/api/tags`, { timeout: 1500 })).data?.models || [];
    if (!tags.length) return null;
    let loaded: string[] = [];
    try { loaded = ((await axios.get(`${base}/api/ps`, { timeout: 1500 })).data?.models || []).map((m: any) => m.name); } catch { /* ps 미지원 */ }
    return { engine: 'ollama', models: tags.map((m: any) => ({ id: m.name, loaded: loaded.includes(m.name), chat: !NON_CHAT.test(m.name) })) };
  } catch { return null; }
}

// 채팅 가능 모델만, 로드된 것 먼저.
function rank(models: ModelInfo[]): ModelInfo[] {
  return models.filter(m => m.chat).sort((a, b) => (b.loaded ? 1 : 0) - (a.loaded ? 1 : 0));
}

// 엔진 자동 감지 → 로드된 채팅 모델 우선 선택. 사용자가 base/model 지정 시 우선.
export async function detectTarget(pref?: Partial<LlmTarget>): Promise<LlmTarget | null> {
  const candidates = [pref?.base, 'http://127.0.0.1:1234', 'http://127.0.0.1:11434'].filter(Boolean) as string[];
  for (const base of candidates) {
    const p = await probe(base);
    if (!p) continue;
    const ranked = rank(p.models);
    const model = pref?.model || ranked[0]?.id || p.models[0]?.id;
    if (model) return { base, model, engine: p.engine };
  }
  return null;
}

// 드롭다운용 목록 — 채팅 모델만, 로드된 것 먼저. loaded = 현재 로드된 모델 이름.
export async function listModels(pref?: Partial<LlmTarget>): Promise<{ base: string; engine: 'lmstudio' | 'ollama'; models: string[]; loaded: string | null } | null> {
  const candidates = [pref?.base, 'http://127.0.0.1:1234', 'http://127.0.0.1:11434'].filter(Boolean) as string[];
  for (const base of candidates) {
    const p = await probe(base);
    if (!p) continue;
    const ranked = rank(p.models);
    if (!ranked.length) continue;
    return { base, engine: p.engine, models: ranked.map(m => m.id), loaded: ranked.find(m => m.loaded)?.id || null };
  }
  return null;
}

export interface ChatOpts { temperature?: number; onToken?: (t: string) => void; signal?: AbortSignal; frequencyPenalty?: number; presencePenalty?: number; }
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

// 한 번의 system+user 호출. onToken 주면 스트리밍.
export async function chat(t: LlmTarget, system: string, user: string, opts: ChatOpts = {}): Promise<string> {
  return completeMessages(t, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], opts);
}

// 멀티턴(대화 히스토리 포함) 호출 — 1인 에이전트가 직전 대화를 기억하게.
export async function completeMessages(t: LlmTarget, messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const stream = !!opts.onToken;

  if (t.engine === 'lmstudio') {
    const url = `${t.base}/v1/chat/completions`;
    const body: any = { model: t.model, messages, temperature: opts.temperature ?? 0.6, stream };
    if (opts.frequencyPenalty != null) body.frequency_penalty = opts.frequencyPenalty;
    if (opts.presencePenalty != null) body.presence_penalty = opts.presencePenalty;
    if (!stream) {
      const r = await axios.post(url, body, { timeout: 120000, signal: opts.signal as any });
      return r.data?.choices?.[0]?.message?.content || '';
    }
    return streamSSE(url, body, opts.onToken!, opts.signal, (j) => j?.choices?.[0]?.delta?.content || '');
  }

  // Ollama
  const url = `${t.base}/api/chat`;
  const body: any = { model: t.model, messages, stream, options: { temperature: opts.temperature ?? 0.6, num_predict: -1 } };
  if (opts.frequencyPenalty != null) body.options.repeat_penalty = 1 + opts.frequencyPenalty; // 0.6 → 1.6
  if (!stream) {
    const r = await axios.post(url, body, { timeout: 120000, signal: opts.signal as any });
    return r.data?.message?.content || '';
  }
  return streamNdjson(url, body, opts.onToken!, opts.signal);
}

// ── 스트리밍 파서 (Node response stream) ──
async function streamSSE(url: string, body: any, onToken: (t: string) => void, signal: AbortSignal | undefined, pick: (j: any) => string): Promise<string> {
  const res = await axios.post(url, body, { responseType: 'stream', timeout: 0, signal: signal as any });
  let acc = '';
  await new Promise<void>((resolve, reject) => {
    let buf = '';
    res.data.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (payload === '[DONE]') continue;
        try { const tok = pick(JSON.parse(payload)); if (tok) { acc += tok; onToken(tok); } } catch { /* keep-alive */ }
      }
    });
    res.data.on('end', resolve);
    res.data.on('error', reject);
  });
  return acc;
}

async function streamNdjson(url: string, body: any, onToken: (t: string) => void, signal: AbortSignal | undefined): Promise<string> {
  const res = await axios.post(url, body, { responseType: 'stream', timeout: 0, signal: signal as any });
  let acc = '';
  await new Promise<void>((resolve, reject) => {
    let buf = '';
    res.data.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try { const tok = JSON.parse(s)?.message?.content; if (tok) { acc += tok; onToken(tok); } } catch { /* partial */ }
      }
    });
    res.data.on('end', resolve);
    res.data.on('error', reject);
  });
  return acc;
}
