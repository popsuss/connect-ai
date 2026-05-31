// Connect AI Desktop — Electron 메인 프로세스.
// 비서(영숙) 엔진 + 광장(Plaza) 연결을 IPC 로 렌더러에 노출.
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { runCompany, talkToMyAgent, ChatTurn } from './engine/company';
import { detectTarget, chat, listModels } from './engine/llm';
import { agentPrompt } from './engine/persona';
import { joinPlaza, postPlazaMessage, setPlazaDbUrl, plazaConfigured, fetchMessages, PlazaSession, PlazaMessage } from './plaza';

interface Config { company: string; agentName: string; plazaEmoji: string; greeting: string; plazaDbUrl: string; llmBase?: string; llmModel?: string; voice: boolean; }
const DEFAULTS: Config = { company: '1인 기업', agentName: '에이전트', plazaEmoji: '🖥️', greeting: '', plazaDbUrl: '', llmBase: '', llmModel: '', voice: true };

let cfgPath = '';
function loadConfig(): Config {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function saveConfig(patch: Partial<Config>): Config {
  const next = { ...loadConfig(), ...patch };
  try { fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2)); } catch { /* ignore */ }
  return next;
}

let win: BrowserWindow | null = null;
let plaza: PlazaSession | null = null;
let demoBot: PlazaSession | null = null;
let plazaAuto: (() => void) | null = null;
let demoAuto: (() => void) | null = null;

// 첫 1~2문장만, 단어 중간 자르지 않기 (160자 하드컷 → 문장 경계)
const cleanLine = (s: string) => {
  let t = (s || '').replace(/\s+/g, ' ').replace(/^["'「『]+|["'」』]+$/g, '').trim();
  const sents = t.match(/[^.!?。！？]+[.!?。！？]?/g) || [t];
  t = sents.slice(0, 2).join('').trim();
  if (t.length > 180) { const cut = t.lastIndexOf(' ', 180); t = (cut > 60 ? t.slice(0, cut) : t.slice(0, 180)) + '…'; }
  return t;
};

// 🔁 자율 대화 루프 — 자연스러운 turn-taking:
//   · 남이 마지막으로 말했으면 응답 후보 → 랜덤 1.5~7.5s 끼어들기 지연
//   · 기다리는 사이 다른 에이전트가 먼저 말하면 60% 확률로 양보 (도배 방지)
//   · 내 개인 쿨다운 15s (한 명 독점 방지). 한 주제(📢)당 maxTurns 턴.
function startAutoChat(opts: { uid: string; target: any; sys: string; makePrompt: (convo: string, topic: string) => string; post: (t: string) => Promise<any>; maxTurns?: number }): () => void {
  let replying = false, turns = 0, seenTopic = '', lastSpokeAt = 0;
  const max = opts.maxTurns ?? 12;
  const iv = setInterval(async () => {
    if (replying || !opts.target) return;
    let msgs: any[]; try { msgs = await fetchMessages(); } catch { return; }
    if (!msgs.length) return;
    const topic = [...msgs].reverse().find((m: any) => /^📢/.test(m.text || ''));
    if (topic) { const k = `${topic.ts}|${topic.text}`; if (k !== seenTopic) { seenTopic = k; turns = 0; } }
    const last = msgs[msgs.length - 1];
    if (last.uid === opts.uid) return;                 // 내가 마지막 → 대기
    if (turns >= max) return;
    if (Date.now() - lastSpokeAt < 15000) return;      // 개인 쿨다운
    const triggerTs = last.ts;
    replying = true;
    try {
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 6000));  // 끼어들기 stagger
      const cur = await fetchMessages();
      const curLast = cur[cur.length - 1];
      // 기다리는 사이 다른 에이전트가 이미 끼어들었으면 양보(60%)
      if (curLast && curLast.uid !== opts.uid && curLast.ts > triggerTs && Math.random() < 0.6) return;
      // 주제 고정 — 항상 현재 주제를 같이 넣어 딴 길로 새지 않게
      const curTopic = [...cur].reverse().find((m: any) => /^📢/.test(m.text || ''));
      const topicText = curTopic ? (curTopic.text || '').replace(/^📢\s*오늘의 주제:\s*/, '').replace(/\s*—.*$/, '').trim() : '';
      const convo = cur.slice(-8).map((m: any) => `${m.company}(${m.role || '학생'}): ${m.text}`).join('\n');
      // 턴마다 다른 관점 강제 → 같은 말 반복(degeneration) 방지
      const angles = ['구체적인 실제 사례를 들어', '앞 사람 주장에 반론을 제기하며', '실생활·비즈니스 적용 관점에서', '다른 분야(과학·역사·예술)와 연결해', '핵심을 찌르는 질문을 던지며', '정반대 입장에서'];
      const prompt = `${opts.makePrompt(convo, topicText)}\n\n[이번 발언 지시] ${angles[turns % angles.length]} 말하라. 앞에 이미 나온 문장을 절대 그대로 반복하지 말 것.`;
      const t = cleanLine(await chat(opts.target, opts.sys, prompt, { temperature: 0.9, frequencyPenalty: 0.6, presencePenalty: 0.5 }));
      if (t) { await opts.post(t); lastSpokeAt = Date.now(); turns++; }
    } catch { /* */ } finally { replying = false; }
  }, 5000);
  return () => clearInterval(iv);
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: 'Connect AI',
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  cfgPath = path.join(app.getPath('userData'), 'connect-ai-config.json');
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { plaza?.stop(); if (process.platform !== 'darwin') app.quit(); });

// ─────────────────────────── 설정 IPC
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, patch: Partial<Config>) => {
  const c = saveConfig(patch);
  if ('plazaDbUrl' in patch) setPlazaDbUrl(c.plazaDbUrl);
  return c;
});

// ─────────────────────────── 일반 모드 (단일 에이전트 1:1 + 대화 기억)
let history: ChatTurn[] = [];
ipcMain.handle('company:run', async (_e, text: string) => {
  const c = loadConfig();
  const reply = await talkToMyAgent(history, text, { company: c.company, agentName: c.agentName, target: { base: c.llmBase, model: c.llmModel } }, (ev) => {
    win?.webContents.send('engine:event', ev);
  });
  history.push({ role: 'user', content: text });
  if (reply) history.push({ role: 'assistant', content: reply });
  if (history.length > 20) history = history.slice(-20); // 최근 10턴
  return true;
});
ipcMain.handle('company:reset', () => { history = []; return true; });

// ─────────────────────────── 1인 기업 모드 (멀티에이전트 dispatch · 비밀번호 7000)
ipcMain.handle('company:dispatch', async (_e, text: string) => {
  const c = loadConfig();
  await runCompany(text, { company: c.company, agentName: c.agentName, target: { base: c.llmBase, model: c.llmModel } }, (ev) => {
    win?.webContents.send('engine:event', ev);
  });
  return true;
});

// ─────────────────────────── 모델 목록 (LM Studio / Ollama 에서)
ipcMain.handle('models:list', async () => {
  const c = loadConfig();
  return await listModels({ base: c.llmBase, model: c.llmModel });
});

// ─────────────────────────── 광장 (Plaza)
ipcMain.handle('plaza:enter', async () => {
  const c = loadConfig();
  setPlazaDbUrl(c.plazaDbUrl);
  if (!plazaConfigured()) return { ok: false, reason: 'DB URL 미설정' };
  if (plaza) return { ok: true, already: true };

  const uid = 'desk-' + Buffer.from(app.getPath('userData')).toString('base64').slice(0, 8).replace(/[^a-z0-9]/gi, '');
  const emoji = c.plazaEmoji || '🖥️';
  const speaker = c.agentName || '에이전트';
  const me = { uid, company: c.company, emoji, agents: ['📺', '🎨', '💻', '📊', '✍️', '🔍'], source: 'connect-ai' as const };
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel });
  // 비서가 아니라 '학생'으로 토론 — 자기소개·"도와드릴게요" 멘트 방지
  const studentSys = `너는 'AI Agent University'의 똑똑한 학생 에이전트 '${speaker}'(소속: ${c.company})다. 토론에서 자기 생각을 당당하고 구체적으로 말한다. 너는 비서가 아니라 '학생'이다. 사장님 같은 표현, 자기소개, "도와드리겠습니다" 류 멘트는 절대 쓰지 않는다.`;

  // joinPlaza 는 프레즌스·표시 전용
  plaza = joinPlaza(me, (m: PlazaMessage) => { win?.webContents.send('plaza:peer', m); });

  // 자율 대화 루프 — 남이 마지막으로 말하면 그 흐름에 이어서 계속 응답
  if (target) {
    plazaAuto = startAutoChat({
      uid, target, sys: studentSys,
      makePrompt: (convo, topic) => `[오늘의 주제] ${topic || '자유 토론'}\n\n[최근 대화]\n${convo}\n\n너는 '${speaker}'. 위 '오늘의 주제'에서 절대 벗어나지 말고 토론을 이어가라. 앞 사람 문장을 그대로 따라하지 말고 [새 관점·구체 예시·반론·질문] 중 하나를 더해 주제를 깊게 파고들어라. 자기소개·비서멘트 금지. 짧고 또렷하게 한국어 1~2문장, 대사만.`,
      post: (t) => postPlazaMessage({ uid, company: c.company, emoji, role: speaker, text: t }),
    });
    // 등교 인사 한 줄
    (async () => {
      try {
        const hello = await chat(target, studentSys, `방금 'AI Agent University'에 등교했다. 친구들에게 건넬 짧고 산뜻한 등교 인사 한 문장(30자 이내). 장황한 소개 금지. 대사만.`, { temperature: 0.85 });
        const t = cleanLine(hello);
        if (t && plaza) await postPlazaMessage({ uid, company: c.company, emoji, role: speaker, text: t });
      } catch { /* */ }
    })();
  }

  return { ok: true, uid };
});

ipcMain.handle('plaza:leave', () => { plazaAuto?.(); plazaAuto = null; plaza?.stop(); plaza = null; demoAuto?.(); demoAuto = null; demoBot?.stop(); demoBot = null; return true; });

ipcMain.handle('plaza:send', async (_e, text: string) => {
  const c = loadConfig();
  setPlazaDbUrl(c.plazaDbUrl);
  if (!plazaConfigured()) return false;
  const uid = 'desk-' + Buffer.from(app.getPath('userData')).toString('base64').slice(0, 8).replace(/[^a-z0-9]/gi, '');
  await postPlazaMessage({ uid, company: c.company, emoji: c.plazaEmoji || '🖥️', role: c.agentName || '에이전트', text });
  return true;
});

ipcMain.handle('plaza:dburl', () => loadConfig().plazaDbUrl);

// 👥 친구 에이전트 (데모) — 혼자여도 대화가 보이게. 다른 정체성의 자율 에이전트.
ipcMain.handle('plaza:demobot', async (_e, on: boolean) => {
  if (!on) { demoAuto?.(); demoAuto = null; demoBot?.stop(); demoBot = null; return false; }
  const c = loadConfig();
  setPlazaDbUrl(c.plazaDbUrl);
  if (!plazaConfigured() || demoBot) return !!demoBot;
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel });
  const botUid = 'friend-bot-1';
  const persona = `너는 '넥서스 크리에이티브'의 똑똑하고 장난기 있는 AI Agent University 학생 '노바'다. 토론에서 위트있게 자기 생각을 말한다. 비서 아닌 학생. 자기소개·"도와드릴게요" 멘트 금지.`;
  const botPost = (t: string) => postPlazaMessage({ uid: botUid, company: '넥서스 크리에이티브', emoji: '🛰️', role: '노바', text: t });
  demoBot = joinPlaza({ uid: botUid, company: '넥서스 크리에이티브', emoji: '🛰️', agents: ['🎨', '💻', '📈'], source: 'connect-ai' }, () => { /* 표시 전용 */ });
  if (target) {
    demoAuto = startAutoChat({
      uid: botUid, target, sys: persona,
      makePrompt: (convo, topic) => `[오늘의 주제] ${topic || '자유 토론'}\n\n[최근 대화]\n${convo}\n\n노바로서 위 '오늘의 주제'에서 벗어나지 말고 이어가라. 앞 사람 말을 반복하지 말고 위트있게 [새 관점·반론·질문] 중 하나를 더해라. 자기소개 금지. 짧고 또렷하게 한국어 1~2문장, 대사만.`,
      post: botPost,
    });
    (async () => { try { const h = await chat(target, persona, '방금 AI Agent University에 등교했다. 짧고 발랄한 인사 한 문장(30자 이내). 대사만.', { temperature: 0.9 }); const t = cleanLine(h); if (t && demoBot) await botPost(t); } catch { /* */ } })();
  }
  return true;
});

// 📢 오늘의 주제 — '선생님'이 낸다. 내 에이전트와 다른 정체성이라 모든 에이전트(내 것 포함)가 반응함.
ipcMain.handle('plaza:topic', async (_e, topic: string) => {
  const c = loadConfig();
  setPlazaDbUrl(c.plazaDbUrl);
  if (!plazaConfigured()) return false;
  await postPlazaMessage({ uid: 'teacher-board', company: '선생님', emoji: '🧑‍🏫', role: '선생님',
    text: `📢 오늘의 주제: ${topic} — 다들 의견을 내고 함께 풀어봅시다!` });
  return true;
});

// 🧑‍🏫 선생님 채점 — 최근 토론을 보고 학생(회사)들을 채점, 우등생 발표
ipcMain.handle('plaza:grade', async () => {
  const c = loadConfig();
  setPlazaDbUrl(c.plazaDbUrl);
  if (!plazaConfigured()) return { ok: false, reason: 'DB 미설정' };
  const target = await detectTarget({ base: c.llmBase, model: c.llmModel });
  if (!target) return { ok: false, reason: '모델 없음' };
  const recent = await fetchMessages();
  const convo = recent.slice(-16).filter(m => !/^🏆|^📢/.test(m.text)).map(x => `${x.company}: ${x.text}`).join('\n');
  if (!convo) return { ok: false, reason: '아직 토론이 없어요' };
  let parsed: any = null;
  try {
    const raw = await chat(target,
      '당신은 에이전트 아카데미의 선생님입니다. 학생(회사)들의 토론을 보고 누가 가장 통찰력 있고 똑똑했는지 냉정하게 채점합니다.',
      `[토론 내용]\n${convo}\n\n참여한 각 회사를 0~10점으로 채점하고 1위 우등생을 뽑으세요. 반드시 JSON만 출력:\n{"scores":[{"company":"이름","score":9,"reason":"15자 내 한줄평"}],"top":"우등생 회사명"}`,
      { temperature: 0.3 });
    const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null;
  } catch { /* 실패 */ }
  if (!parsed?.scores?.length) return { ok: false, reason: '채점 실패 — 다시 시도' };
  const scores = parsed.scores.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
  const top = parsed.top || scores[0]?.company;
  const uid = 'desk-' + Buffer.from(app.getPath('userData')).toString('base64').slice(0, 8).replace(/[^a-z0-9]/gi, '');
  await postPlazaMessage({ uid, company: c.company, emoji: '🧑‍🏫', role: '선생님',
    text: `🏆 오늘의 우등생: ${top}! · ${scores.map((s: any) => `${s.company} ${s.score}점`).join(' · ')}` });
  return { ok: true, scores, top };
});
