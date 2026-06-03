// 엔진 — 통합 1인 기업 모드. 에이전트 하나가 스스로 판단해서 직접 처리하거나, 큰 일은 <team>으로 동료에게 위임(dispatch). 별도 모드 구분 없음.
import * as os from 'os';
import { chat, completeMessages, detectTarget, embed, LlmTarget, ChatMessage } from './llm';
import { AGENTS, SPECIALIST_IDS, specialistPrompt, agentPrompt, triagePrompt } from './persona';
import { parseTools, runTool, toolGuide, stripTools } from './tools';
import { search as brainSearch, addNote as brainAdd } from './brain';
import { addTask } from './tasks';
import { addApproval } from './approvals';
import { listMcpTools, callMcpTool } from './mcp';
import { webSearch, fetchUrl } from './web';

export interface ChatTurn { role: 'user' | 'assistant'; content: string; }

export type EngineEvent =
  | { kind: 'status'; text: string }
  | { kind: 'dispatch'; agents: { id: string; name: string; emoji: string }[] }  // 팀 소집 — 시네마틱 진입
  | { kind: 'agentStart'; id: string; name: string; emoji: string }
  | { kind: 'agentChunk'; id: string; text: string }                    // 실시간 스트리밍 (책상에 흐름)
  | { kind: 'agentDone'; id: string; output: string }
  | { kind: 'agentConfer'; from: string; fromName: string; to: string; toName: string; text: string } // 팀 회의 한마디
  | { kind: 'tool'; name: string; path: string; ok: boolean }
  | { kind: 'token'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'error'; text: string };

export interface RunOpts { company: string; agentName?: string; userTitle?: string; workspace?: string; servicesInfo?: string; target?: Partial<LlmTarget>; signal?: AbortSignal; realtimeFor?: (agentId: string) => Promise<string>; getRevenue?: () => Promise<string>; captureScreen?: () => Promise<string | null>; readClipboard?: () => Promise<string>; openPath?: (p: string) => Promise<string>; }
const aborted = (opts: { signal?: AbortSignal }) => !!opts.signal?.aborted;

// 🛠️ 도구 쓰는 에이전트 — 파일 읽기/목록/쓰기를 직접 하고, 결과 보고 이어간다.
export async function agentWithTools(history: ChatTurn[], userText: string, opts: RunOpts, onEvent: (e: EngineEvent) => void): Promise<string> {
  const company = opts.company || '1인 기업';
  const name = opts.agentName || '에이전트';
  const title = opts.userTitle || '사장님';
  const workspace = opts.workspace || os.homedir();
  const target = await detectTarget(opts.target);
  if (!target) { noEngine(onEvent); return ''; }
  // 🧠 RAG — 질문에 관련된 지식을 두뇌에서 끌어와 시스템 프롬프트에 주입
  let ragBlock = '';
  try {
    const qEmb = await embed(target.base, userText);
    const notes = brainSearch(userText, 4, qEmb || undefined);
    if (notes.length) ragBlock = `\n\n## 내 두뇌 (기억한 지식 — 답변에 적극 활용)\n` + notes.map(n => `- ${n.text}`).join('\n');
  } catch { /* 두뇌 없어도 진행 */ }

  const mcpBlock = await buildMcpBlock();
  const sys = agentPrompt(name, company, title) + (opts.servicesInfo || '') + ragBlock + toolGuide(workspace) + mcpBlock;
  const messages: ChatMessage[] = [
    { role: 'system', content: sys },
    ...history.map(h => ({ role: h.role, content: h.content } as ChatMessage)),
    { role: 'user', content: userText },
  ];
  let finalText = '';
  for (let iter = 0; iter < 5; iter++) {
    onEvent({ kind: 'status', text: iter === 0 ? `${name} 생각 중…` : `${name}가 이어서 작업 중…` });
    let raw = '';
    try { raw = await completeMessages(target, messages, { temperature: 0.5, signal: opts.signal }); }
    catch (e: any) { onEvent({ kind: 'final', text: aborted(opts) ? '⏹️ 중단했어요.' : `잠시 문제가 생겼어요. (${e?.message || e})` }); return ''; }
    if (aborted(opts)) { onEvent({ kind: 'final', text: '⏹️ 중단했어요.' }); return ''; }
    // 🧠 기억하기 — 두뇌에 새 지식 저장 (임베딩 포함)
    const remembers = [...raw.matchAll(/<remember>([\s\S]*?)<\/remember>/g)].map(m => m[1].trim()).filter(Boolean);
    for (const r of remembers) {
      let e: number[] | null = null; try { e = await embed(target.base, r); } catch { /* */ }
      brainAdd(r, e || undefined);
      onEvent({ kind: 'tool', name: 'remember', path: r.slice(0, 40), ok: true });
    }
    // 📋 할 일 등록 — 태스크 보드에 쌓기
    const newTasks = [...raw.matchAll(/<task>([\s\S]*?)<\/task>/g)].map(m => m[1].trim()).filter(Boolean);
    for (const tk of newTasks) { addTask(tk, { owner: 'agent', agentEmoji: '🤖' }); onEvent({ kind: 'tool', name: 'task', path: tk.slice(0, 40), ok: true }); }
    // ✅ 승인 요청 — 결재 큐에 쌓기. <approve>제목|상세</approve> (정보) 또는 <approve do="run|write|telegram" path="">제목|페이로드</approve> (실행)
    for (const m of raw.matchAll(/<approve([^>]*)>([\s\S]*?)<\/approve>/g)) {
      const attrs = m[1] || '', body = (m[2] || '').trim(); if (!body) continue;
      const doKind = attrs.match(/do="([^"]+)"/)?.[1] as ('run' | 'write' | 'telegram' | 'email' | undefined);
      const apath = attrs.match(/path="([^"]+)"/)?.[1];
      const bar = body.indexOf('|'); const title = (bar >= 0 ? body.slice(0, bar) : body).trim(); const payload = (bar >= 0 ? body.slice(bar + 1) : '').trim();
      const action = (doKind === 'run' || doKind === 'write' || doKind === 'telegram' || doKind === 'email') ? { kind: doKind, payload, path: apath } : undefined;
      addApproval(title, action ? `⚡ ${doKind}: ${payload.slice(0, 80)}` : payload, '🤖', action);
      onEvent({ kind: 'tool', name: 'approve', path: title.slice(0, 40), ok: true });
    }
    let cleaned = raw.replace(/<remember>[\s\S]*?<\/remember>/g, '').replace(/<task>[\s\S]*?<\/task>/g, '').replace(/<approve[^>]*>[\s\S]*?<\/approve>/g, '');
    // 🏢 팀 위임 감지
    const teamBriefs = [...cleaned.matchAll(/<team>([\s\S]*?)<\/team>/g)].map(m => m[1].trim()).filter(Boolean);
    cleaned = cleaned.replace(/<team>[\s\S]*?<\/team>/g, '');
    // 🔌 MCP 도구 호출 감지
    const mcpCalls = [...cleaned.matchAll(/<mcp\s+server="([^"]+)"\s+tool="([^"]+)"\s*>([\s\S]*?)<\/mcp>/g)].map(m => ({ server: m[1], tool: m[2], args: m[3].trim() }));
    // 🌐 웹 + 💰 매출 + 👁️ 화면 + 📋 클립보드 도구 감지
    const hasWeb = /<web_search>|<fetch_url>/.test(cleaned);
    const wantRevenue = /<revenue[\s>/]/.test(cleaned);
    const wantShot = /<screenshot\s*\/?>/.test(cleaned) || /<screenshot>/.test(cleaned);
    const wantClip = /<clipboard\s*\/?>/.test(cleaned) || /<clipboard>/.test(cleaned);
    const opens = [...cleaned.matchAll(/<open>([\s\S]*?)<\/open>/g)].map(m => m[1].trim()).filter(Boolean);
    cleaned = cleaned.replace(/<mcp\s+[^>]*>[\s\S]*?<\/mcp>/g, '');
    const calls = parseTools(cleaned);
    if (!teamBriefs.length && !calls.length && !mcpCalls.length && !hasWeb && !wantRevenue && !wantShot && !wantClip && !opens.length) { finalText = stripTools(cleaned).trim(); onEvent({ kind: 'final', text: finalText }); return finalText; }
    messages.push({ role: 'assistant', content: raw });
    const results: string[] = [];
    if (hasWeb) { const web = await execWebTools(raw, onEvent); results.push(...web.results); }
    for (const op of opens) { if (!opts.openPath) break; onEvent({ kind: 'status', text: `🚀 여는 중 · ${op.slice(0, 40)}` }); const r = await opts.openPath(op).catch((e: any) => `열기 실패: ${e?.message || e}`); onEvent({ kind: 'tool', name: 'open', path: op.slice(0, 40), ok: !/실패/.test(r) }); results.push(`[열기: ${op}]\n${r}`); }
    if (wantRevenue && opts.getRevenue) { onEvent({ kind: 'status', text: '💰 매출 확인 중…' }); const rev = await opts.getRevenue().catch(() => ''); onEvent({ kind: 'tool', name: 'revenue', path: 'PayPal', ok: true }); results.push(`[내 매출 (PayPal 실데이터)]\n${rev}`); }
    if (wantClip && opts.readClipboard) { onEvent({ kind: 'status', text: '📋 클립보드 확인…' }); const clip = await opts.readClipboard().catch(() => ''); onEvent({ kind: 'tool', name: 'clipboard', path: '복사한 내용', ok: true }); results.push(`[클립보드(사장님이 복사한 것)]\n${(clip || '(비어 있음)').slice(0, 4000)}`); }
    // 👁️ 화면 캡처 — 비전 메시지로 추가
    let shot: string | null = null;
    if (wantShot && opts.captureScreen) {
      onEvent({ kind: 'status', text: '👁️ 화면 보는 중…' }); shot = await opts.captureScreen().catch(() => null); onEvent({ kind: 'tool', name: 'screenshot', path: '화면', ok: !!shot });
      if (!shot) results.push('[화면을 캡처하지 못했어요. macOS라면 시스템 설정 → 개인정보 보호 및 보안 → 화면 기록 에서 Connect AI를 켜주셔야 화면을 볼 수 있어요. 사장님께 그렇게 안내하세요.]');
    }
    for (const mc of mcpCalls) {
      onEvent({ kind: 'status', text: `🔌 MCP · ${mc.server}.${mc.tool}` });
      let args: any = {}; try { args = mc.args ? JSON.parse(mc.args) : {}; } catch { /* */ }
      const out = await callMcpTool(mc.server, mc.tool, args);
      onEvent({ kind: 'tool', name: 'mcp', path: `${mc.server}.${mc.tool}`, ok: !out.startsWith('(MCP') });
      results.push(`[MCP ${mc.server}.${mc.tool}]\n${out}`);
    }
    for (const brief of teamBriefs) {
      onEvent({ kind: 'status', text: '🏢 팀을 소집합니다…' });
      const digest = await dispatchTeam(target, brief, name, company, onEvent, opts.signal, opts.realtimeFor, workspace, title);
      results.push(`[팀 작업 결과]\n${digest}`);
    }
    for (const c of calls) {
      onEvent({ kind: 'status', text: `🔧 ${c.tool} · ${c.path}` });
      const r = runTool(c, workspace);
      onEvent({ kind: 'tool', name: c.tool, path: c.path, ok: r.ok });
      results.push(`[${c.tool} ${c.path}] ${r.ok ? '' : '(실패)'}\n${r.output}`);
    }
    if (results.length) messages.push({ role: 'user', content: `결과:\n${results.join('\n\n')}\n\n이 결과를 바탕으로 이어서 진행하거나, 다 됐으면 사용자에게 자연스럽게 종합 보고해라(도구 태그 없이).` });
    if (shot) messages.push({ role: 'user', content: [{ type: 'text', text: '다음은 방금 캡처한 사장님 화면입니다. 자세히 보고 질문에 답하거나 분석해 주세요.' }, { type: 'image_url', image_url: { url: shot } }] });
    if (!results.length && !shot) messages.push({ role: 'user', content: '계속 진행하거나 다 됐으면 종합 보고해라(도구 태그 없이).' });
  }
  finalText = '작업이 좀 길어졌어요. 더 구체적으로 말씀해 주시면 이어갈게요.';
  onEvent({ kind: 'final', text: finalText });
  return finalText;
}

const firstJson = (s: string) => { const m = s.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const noEngine = (onEvent: (e: EngineEvent) => void) =>
  onEvent({ kind: 'error', text: 'AI 엔진(LM Studio 또는 Ollama)을 찾지 못했어요. 사장님, 모델을 먼저 켜주세요.' });

// 🔌 연결된 MCP 서버 도구를 프롬프트용 텍스트로
async function buildMcpBlock(): Promise<string> {
  try {
    const mt = await listMcpTools();
    if (!mt.length) return '';
    return `\n\n## 🔌 MCP 외부 도구 (필요하면 아래 태그로 호출 — 디자인은 Stitch 등)\n`
      + mt.map(t => `- ${t.server}.${t.name}: ${(t.description || '').slice(0, 120)}`).join('\n')
      + `\n호출법: <mcp server="서버명" tool="도구명">{"인자":"값"}</mcp>  (인자는 JSON 객체).`;
  } catch { return ''; }
}
const MCP_RE = /<mcp\s+server="([^"]+)"\s+tool="([^"]+)"\s*>([\s\S]*?)<\/mcp>/g;

// 🌐 웹 도구 실행 (검색·페이지 읽기) — 텍스트에서 태그 찾아 실행하고 결과 반환
async function execWebTools(text: string, onEvent: (e: EngineEvent) => void): Promise<{ results: string[]; count: number }> {
  const results: string[] = [];
  for (const m of text.matchAll(/<web_search>([\s\S]*?)<\/web_search>/g)) {
    const q = m[1].trim(); if (!q) continue;
    onEvent({ kind: 'status', text: `🌐 웹 검색 · ${q.slice(0, 30)}` });
    const out = await webSearch(q);
    onEvent({ kind: 'tool', name: 'web_search', path: q.slice(0, 40), ok: !out.startsWith('(') });
    results.push(`[웹 검색: ${q}]\n${out}`);
  }
  for (const m of text.matchAll(/<fetch_url>([\s\S]*?)<\/fetch_url>/g)) {
    const u = m[1].trim(); if (!u) continue;
    onEvent({ kind: 'status', text: `🌐 페이지 읽기 · ${u.slice(0, 30)}` });
    const out = await fetchUrl(u);
    onEvent({ kind: 'tool', name: 'fetch_url', path: u.slice(0, 40), ok: !out.startsWith('(') });
    results.push(`[페이지: ${u}]\n${out}`);
  }
  return { results, count: results.length };
}

// 🧑‍🔧 specialist 도구 루프 — 동료(디자이너 등)가 직접 MCP·파일·실행 도구를 쓰며 일한다
async function runSpecialist(target: LlmTarget, id: string, company: string, brief: string, rt: string, workspace: string, mcpBlock: string, onEvent: (e: EngineEvent) => void, signal?: AbortSignal, title = '사장님'): Promise<string> {
  const sys = specialistPrompt(id, company, title) + mcpBlock + toolGuide(workspace);
  const messages: ChatMessage[] = [
    { role: 'system', content: sys },
    { role: 'user', content: `[요청]\n${brief}\n\n당신의 전문성으로 처리하세요. 도구가 필요하면 쓰고(특히 디자인은 MCP 도구), 다 되면 결과를 보고하세요.` + (rt ? `\n\n${rt}\n⚠️ 위 실데이터만 근거로, 숫자를 지어내지 마세요.` : '') },
  ];
  let finalText = '';
  for (let iter = 0; iter < 3; iter++) {
    if (signal?.aborted) break;
    let raw = '';
    try { raw = await completeMessages(target, messages, { temperature: 0.6, signal, onToken: (t) => onEvent({ kind: 'agentChunk', id, text: t }) }); } catch { break; }
    let cleaned = raw;
    const mcpCalls = [...cleaned.matchAll(MCP_RE)].map(m => ({ server: m[1], tool: m[2], args: m[3].trim() }));
    const hasWeb = /<web_search>|<fetch_url>/.test(cleaned);
    cleaned = cleaned.replace(/<mcp\s+[^>]*>[\s\S]*?<\/mcp>/g, '');
    const calls = parseTools(cleaned);
    finalText = stripTools(cleaned).trim();
    if (!mcpCalls.length && !calls.length && !hasWeb) break;
    messages.push({ role: 'assistant', content: raw });
    const results: string[] = [];
    if (hasWeb) { const web = await execWebTools(raw, onEvent); results.push(...web.results); }
    for (const mc of mcpCalls) {
      onEvent({ kind: 'status', text: `🔌 ${AGENTS[id].name} · ${mc.server}.${mc.tool}` });
      let args: any = {}; try { args = mc.args ? JSON.parse(mc.args) : {}; } catch { /* */ }
      const out = await callMcpTool(mc.server, mc.tool, args);
      onEvent({ kind: 'tool', name: 'mcp', path: `${mc.server}.${mc.tool}`, ok: !out.startsWith('(MCP') });
      results.push(`[MCP ${mc.server}.${mc.tool}]\n${out}`);
    }
    for (const c of calls) {
      const r = runTool(c, workspace);
      onEvent({ kind: 'tool', name: c.tool, path: c.path, ok: r.ok });
      results.push(`[${c.tool} ${c.path}] ${r.ok ? '' : '(실패)'}\n${r.output}`);
    }
    messages.push({ role: 'user', content: `결과:\n${results.join('\n\n')}\n\n이어서 진행하거나 다 됐으면 보고하세요(도구 태그 없이).` });
  }
  return finalText || '(완료)';
}

// 팀 소집 — 브리프를 전문 동료들에게 분배·작업시키고(실시간 스트리밍) → 짧은 팀 회의 → 결과 종합 반환
async function dispatchTeam(target: LlmTarget, brief: string, name: string, company: string, onEvent: (e: EngineEvent) => void, signal?: AbortSignal, realtimeFor?: (id: string) => Promise<string>, workspace = '', title = '사장님'): Promise<string> {
  let plan: any = null;
  try { const raw = await chat(target, triagePrompt(name, company, title), `요청: ${brief}`, { temperature: 0.2, signal }); plan = firstJson(raw); } catch { /* */ }
  if (signal?.aborted) return '(중단됨)';
  let agents: string[] = (plan?.agents || []).filter((id: string) => SPECIALIST_IDS.includes(id)).slice(0, 3);
  if (!agents.length) agents = ['developer'];
  const mcpBlock = await buildMcpBlock();   // 동료들도 MCP(Stitch 등) 도구를 쓴다
  // 🎬 팀 소집 — 시네마틱 진입(배너 + 책상 thinking + CEO 지휘)
  onEvent({ kind: 'dispatch', agents: agents.map(id => ({ id, name: AGENTS[id].name, emoji: AGENTS[id].emoji })) });
  await sleep(2000);   // 소집 연출(모임→자리 복귀)이 보이도록 텀
  const outputs: Record<string, string> = {};
  for (const id of agents) {
    if (signal?.aborted) break;
    const a = AGENTS[id]; onEvent({ kind: 'agentStart', id, name: a.name, emoji: a.emoji });
    try {
      // 🤝 실데이터 주입(유튜브·매출) + 🧑‍🔧 도구 루프(MCP·파일·실행) — 동료가 직접 도구를 쓴다
      const rt = realtimeFor ? await realtimeFor(id).catch(() => '') : '';
      const out = await runSpecialist(target, id, company, brief, rt, workspace, mcpBlock, onEvent, signal, title);
      outputs[id] = out; onEvent({ kind: 'agentDone', id, output: out });
    } catch (e: any) { outputs[id] = `(${a.name} 실패: ${e?.message || e})`; onEvent({ kind: 'agentDone', id, output: outputs[id] }); }
  }
  // 🗣️ 팀 회의 — 2명 이상이면 서로 한마디씩 (동의·보완·제안)
  const present = agents.filter(id => outputs[id] && !outputs[id].startsWith('('));
  if (present.length >= 2 && !signal?.aborted) { onEvent({ kind: 'status', text: '🗣️ 팀 회의 중…' }); await conferRound(target, present, brief, outputs, company, onEvent, signal); }
  return agents.map(id => `## ${AGENTS[id].name}\n${(outputs[id] || '').slice(0, 1200)}`).join('\n\n');
}

// 짧은 팀 회의 한 바퀴 — 각자 다음 동료에게 한 문장씩. 에이전트끼리 대화하는 느낌(Layer 1).
async function conferRound(target: LlmTarget, present: string[], brief: string, outputs: Record<string, string>, company: string, onEvent: (e: EngineEvent) => void, signal?: AbortSignal): Promise<void> {
  const transcript: string[] = [];
  const summary = present.map(id => `- ${AGENTS[id].name}: ${(outputs[id] || '').replace(/\s+/g, ' ').slice(0, 140)}`).join('\n');
  for (let i = 0; i < present.length; i++) {
    if (signal?.aborted) return;
    const from = present[i], to = present[(i + 1) % present.length];
    const fromA = AGENTS[from], toA = AGENTS[to];
    const user = `[회의 주제]\n${brief}\n\n[동료들 결과 요약]\n${summary}` +
      (transcript.length ? `\n\n[방금 오간 말]\n${transcript.join('\n')}` : '') +
      `\n\n너는 ${fromA.name}. ${toA.name}에게 회의에서 한마디 해줘 — 동의·보완·제안 중 하나. 한 문장, 50자 이내. 이름표·인사 없이 내용만.`;
    let line = '';
    try { line = (await chat(target, specialistPrompt(from, company), user, { temperature: 0.75, signal })).split('\n').map(s => s.trim()).filter(Boolean)[0] || ''; } catch { /* */ }
    line = line.replace(/^["'`\-•\s]+/, '').replace(/^.*?[:：]\s*/, '').slice(0, 80).trim();
    if (!line) continue;
    transcript.push(`${fromA.name}→${toA.name}: ${line}`);
    onEvent({ kind: 'agentConfer', from, fromName: fromA.name, to, toName: toA.name, text: line });
  }
}

// ── 도구 끔(설정) 시 폴백: 단일 에이전트와 1:1 대화 + 멀티턴 기억 ──────────────
export async function talkToMyAgent(history: ChatTurn[], userText: string, opts: RunOpts, onEvent: (e: EngineEvent) => void): Promise<string> {
  const company = opts.company || '1인 기업';
  const name = opts.agentName || '에이전트';
  const title = opts.userTitle || '사장님';
  const target = await detectTarget(opts.target);
  if (!target) { noEngine(onEvent); return ''; }
  onEvent({ kind: 'status', text: `${name} 생각 중…` });
  const messages: ChatMessage[] = [
    { role: 'system', content: agentPrompt(name, company, title) + (opts.servicesInfo || '') },
    ...history.map(h => ({ role: h.role, content: h.content } as ChatMessage)),
    { role: 'user', content: userText },
  ];
  let acc = '';
  try {
    acc = await completeMessages(target, messages, { temperature: 0.6, signal: opts.signal, onToken: (t) => onEvent({ kind: 'token', text: t }) });
  } catch (e: any) { acc = aborted(opts) ? '⏹️ 중단했어요.' : `사장님, 잠시 문제가 생겼어요. (${e?.message || e})`; }
  acc = acc.trim();
  onEvent({ kind: 'final', text: acc });
  return acc;
}
