// 엔진 — 단일 에이전트(이름은 설정에서 지정) 1:1 대화 + 1인 기업 모드(멀티에이전트 dispatch).
import { chat, completeMessages, detectTarget, LlmTarget, ChatMessage } from './llm';
import { AGENTS, SPECIALIST_IDS, specialistPrompt, agentPrompt, triagePrompt } from './persona';

export interface ChatTurn { role: 'user' | 'assistant'; content: string; }

export type EngineEvent =
  | { kind: 'status'; text: string }
  | { kind: 'agentStart'; id: string; name: string; emoji: string }
  | { kind: 'agentDone'; id: string; output: string }
  | { kind: 'token'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'error'; text: string };

export interface RunOpts { company: string; agentName?: string; target?: Partial<LlmTarget>; }

const firstJson = (s: string) => { const m = s.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const noEngine = (onEvent: (e: EngineEvent) => void) =>
  onEvent({ kind: 'error', text: 'AI 엔진(LM Studio 또는 Ollama)을 찾지 못했어요. 사장님, 모델을 먼저 켜주세요.' });

// ── 일반 모드: 단일 에이전트와 1:1 대화 + 멀티턴 기억 ──────────────
export async function talkToMyAgent(history: ChatTurn[], userText: string, opts: RunOpts, onEvent: (e: EngineEvent) => void): Promise<string> {
  const company = opts.company || '1인 기업';
  const name = opts.agentName || '에이전트';
  const target = await detectTarget(opts.target);
  if (!target) { noEngine(onEvent); return ''; }
  onEvent({ kind: 'status', text: `${name} 생각 중…` });
  const messages: ChatMessage[] = [
    { role: 'system', content: agentPrompt(name, company) },
    ...history.map(h => ({ role: h.role, content: h.content } as ChatMessage)),
    { role: 'user', content: userText },
  ];
  let acc = '';
  try {
    acc = await completeMessages(target, messages, { temperature: 0.6, onToken: (t) => onEvent({ kind: 'token', text: t }) });
  } catch (e: any) { acc = `사장님, 잠시 문제가 생겼어요. (${e?.message || e})`; }
  acc = acc.trim();
  onEvent({ kind: 'final', text: acc });
  return acc;
}

// ── 1인 기업 모드: 에이전트가 분류 → 동료 dispatch → 종합 보고 ──────
export async function runCompany(userText: string, opts: RunOpts, onEvent: (e: EngineEvent) => void): Promise<void> {
  const company = opts.company || '1인 기업';
  const name = opts.agentName || '에이전트';
  const target = await detectTarget(opts.target);
  if (!target) { noEngine(onEvent); return; }

  onEvent({ kind: 'status', text: `${name}가 요청을 살펴봅니다…` });
  let plan: any = null;
  try {
    const raw = await chat(target, triagePrompt(name, company), `사장님 요청: ${userText}`, { temperature: 0.2 });
    plan = firstJson(raw);
  } catch { /* direct 폴백 */ }

  const mode = plan?.mode === 'dispatch' && Array.isArray(plan.agents) && plan.agents.length ? 'dispatch' : 'direct';
  if (mode === 'direct') { await report(target, name, company, userText, '', onEvent); return; }

  const agents: string[] = plan.agents.filter((id: string) => SPECIALIST_IDS.includes(id)).slice(0, 3);
  const brief: string = plan.brief || userText;
  const outputs: Record<string, string> = {};
  for (const id of agents) {
    const a = AGENTS[id];
    onEvent({ kind: 'agentStart', id, name: a.name, emoji: a.emoji });
    try {
      const out = await chat(target, specialistPrompt(id, company),
        `[사장님 요청]\n${userText}\n\n[${name}의 지시]\n${brief}\n\n위 요청을 당신의 전문성으로 처리해 결과를 내세요.`, { temperature: 0.6 });
      outputs[id] = out; onEvent({ kind: 'agentDone', id, output: out });
    } catch (e: any) { outputs[id] = `(${a.name} 작업 실패: ${e?.message || e})`; onEvent({ kind: 'agentDone', id, output: outputs[id] }); }
  }
  const digest = agents.map(id => `## ${AGENTS[id].name}\n${(outputs[id] || '').slice(0, 1200)}`).join('\n\n');
  await report(target, name, company, userText, digest, onEvent);
}

// 에이전트가 사장님께 종합 보고 (음성용).
async function report(target: LlmTarget, name: string, company: string, userText: string, digest: string, onEvent: (e: EngineEvent) => void): Promise<void> {
  onEvent({ kind: 'status', text: `${name}가 보고를 정리합니다…` });
  const user = digest
    ? `사장님 요청: ${userText}\n\n동료들이 낸 결과:\n${digest}\n\n이걸 사장님께 음성으로 보고하세요. 핵심 결과 + 다음 추천 액션 한 가지. 1~4문장.`
    : `사장님이 이렇게 말했습니다: ${userText}\n\n음성으로 자연스럽게 응답하세요. 1~4문장.`;
  let acc = '';
  try { acc = await chat(target, agentPrompt(name, company), user, { temperature: 0.6, onToken: (t) => onEvent({ kind: 'token', text: t }) }); }
  catch (e: any) { acc = `사장님, 보고 정리 중 문제가 생겼어요. (${e?.message || e})`; }
  onEvent({ kind: 'final', text: acc.trim() });
}
