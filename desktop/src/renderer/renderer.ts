// Connect AI Desktop 렌더러 — 익스텐션 디자인 그대로. preload window.connect 로 통신.
import { AGENTS } from '../agents';
declare global { interface Window { connect: any; webkitSpeechRecognition: any; SpeechRecognition: any; } }
const connect = window.connect;
const $ = (id: string) => document.getElementById(id)!;
const WAKE_WORDS = ['커넥트', 'connect', '자비스', '비서', '에이전트'];
const COMPANY_PW = '7000';
let cfg: any = { company: '1인 기업', agentName: '에이전트', voice: true, plazaDbUrl: '' };
let companyMode = false;
let busy = false;
const agentName = () => cfg.agentName || '에이전트';
const agentTag = () => `🤖 ${agentName()}`;

// ── 마크다운 ──────────────────────────────────────────
function escapeHtml(s: string) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]); }
function md(src: string): string {
  if (!src) return '';
  const blocks: string[] = [];
  let s = src.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_m, _l, code) => { blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`); return ` B${blocks.length - 1} `; });
  s = escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>').replace(/^##? (.+)$/gm, '<h3>$1</h3>')
    .replace(/^\s*(?:[-*]|\d+\.) (.+)$/gm, '<li>$1</li>');
  const lines = s.split('\n'); const out: string[] = []; let inList = false;
  for (const ln of lines) { if (/^<li>/.test(ln)) { if (!inList) { out.push('<ul>'); inList = true; } out.push(ln); } else { if (inList) { out.push('</ul>'); inList = false; } out.push(ln); } }
  if (inList) out.push('</ul>');
  return out.join('\n').replace(/\n(<\/?(?:ul|pre|h\d)>)/g, '$1').replace(/(<\/?(?:ul|pre|h\d)>)\n/g, '$1').replace(/\n/g, '<br>').replace(/ B(\d+) /g, (_m, i) => blocks[+i]);
}
function stripMd(s: string): string { return s.replace(/```[\s\S]*?```/g, ' 코드 블록 ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`#>_~]/g, '').trim(); }

// ── 메시지 (익스텐션 .msg 구조) ──────────────────────────
function addLog(who: string, text: string, mine = false, asMarkdown = false, color?: string) {
  const el = document.createElement('div');
  el.className = 'msg ' + (mine ? 'msg-user' : 'msg-ai');
  const first = Array.from(who)[0] || '';
  const avChar = mine ? '🧑' : ((first.codePointAt(0) || 0) >= 0x1F300 ? first : '✦');
  const avStyle = (!mine && color) ? ` style="background:${color};color:#fff;box-shadow:0 0 12px ${color}66"` : '';
  el.innerHTML = `<div class="msg-head"><div class="av ${mine ? 'av-user' : 'av-ai'}"${avStyle}>${avChar}</div><span>${escapeHtml(who)}</span></div><div class="msg-body">${asMarkdown ? md(text) : escapeHtml(text)}</div>`;
  $('chat').appendChild(el); $('chat').scrollTop = $('chat').scrollHeight; return el;
}
function setBody(el: HTMLElement, text: string, asMarkdown = false) {
  const b = el.querySelector('.msg-body'); if (b) b.innerHTML = asMarkdown ? md(text) : escapeHtml(text);
  $('chat').scrollTop = $('chat').scrollHeight;
}
function hint(msg: string) { const h = $('inputHint'); const orig = '"야 커넥트" 음성 · Enter 전송'; h.textContent = msg; setTimeout(() => { h.textContent = orig; }, 2600); }

// ── 음성 합성(TTS) ────────────────────────────────────
let koVoice: SpeechSynthesisVoice | null = null;
function pickVoice() { const vs = speechSynthesis.getVoices(); koVoice = vs.find(v => /ko(-|_)?KR/i.test(v.lang)) || vs.find(v => /korean/i.test(v.name)) || null; }
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text: string) {
  if (!cfg.voice || !('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR'; if (koVoice) u.voice = koVoice; u.rate = 1.04; speechSynthesis.speak(u);
}

// ── 설정 ─────────────────────────────────────────────
function applyCfgLabels() {
  $('brandSuffix').textContent = cfg.company ? `· ${cfg.company}` : '';
  inputEl.placeholder = `${agentName()}에게 무엇이든…`;
}
async function loadCfg() {
  cfg = await connect.getConfig();
  ($('cfgDbUrl') as HTMLInputElement).value = cfg.plazaDbUrl || '';
  ($('cfgLlmBase') as HTMLInputElement).value = cfg.llmBase || '';
  ($('cfgGreeting') as HTMLInputElement).value = cfg.greeting || '';
  ($('cfgVoice') as HTMLInputElement).checked = cfg.voice !== false;
  // 명찰 (이름·회사·아바타는 여기서만)
  ($('plazaEmoji') as HTMLInputElement).value = cfg.plazaEmoji || '🖥️';
  ($('plazaCompany') as HTMLInputElement).value = cfg.company || '';
  ($('plazaAgentName') as HTMLInputElement).value = cfg.agentName || '';
  applyCfgLabels();
}
// 명찰 변경 → 저장 (다음 등교부터 반영)
async function saveNameTag() {
  cfg = await connect.setConfig({
    plazaEmoji: ($('plazaEmoji') as HTMLInputElement).value.trim() || '🖥️',
    company: ($('plazaCompany') as HTMLInputElement).value.trim() || '1인 기업',
    agentName: ($('plazaAgentName') as HTMLInputElement).value.trim() || '에이전트',
  });
  applyCfgLabels();
  if (plazaJoined) hint('명찰 바뀜 — 하교 후 다시 등교하면 적용돼요');
}
['plazaEmoji', 'plazaCompany', 'plazaAgentName'].forEach(id => $(id).addEventListener('change', saveNameTag));
$('saveCfg').addEventListener('click', async () => {
  cfg = await connect.setConfig({
    plazaDbUrl: ($('cfgDbUrl') as HTMLInputElement).value.trim(),
    llmBase: ($('cfgLlmBase') as HTMLInputElement).value.trim(),
    greeting: ($('cfgGreeting') as HTMLInputElement).value.trim(),
    voice: ($('cfgVoice') as HTMLInputElement).checked,
  });
  applyCfgLabels();
  closeOverlay('settingsPanel'); loadModels(); hint('설정을 저장했어요 ✅');
});

// ── 모델 드롭다운 (로드된 채팅 모델 자동) ──────────────────
async function loadModels() {
  const sel = $('modelSel') as HTMLSelectElement;
  const info = await connect.listModels();
  sel.innerHTML = '';
  if (!info || !info.models?.length) { const o = document.createElement('option'); o.textContent = '로컬 AI 없음'; sel.appendChild(o); return; }
  for (const m of info.models) { const o = document.createElement('option'); o.value = m; o.textContent = m + (m === info.loaded ? '  ● 로드됨' : ''); sel.appendChild(o); }
  sel.value = (cfg.llmModel && info.models.includes(cfg.llmModel)) ? cfg.llmModel : (info.loaded || info.models[0]);
  cfg = await connect.setConfig({ llmBase: info.base, llmModel: sel.value });
}
$('modelSel').addEventListener('change', async (e) => { cfg = await connect.setConfig({ llmModel: (e.target as HTMLSelectElement).value }); hint('모델: ' + cfg.llmModel); });

// ── 모드 토글 (익스텐션 corp-on = 골드) ─────────────────
// ── 1인 기업 모드 (비밀번호 7000 으로 잠금) ─────────────────
function setCompanyMode(on: boolean) {
  companyMode = on;
  document.body.classList.toggle('corp-on', on);
  ($('corporateBtn') as HTMLElement).style.opacity = on ? '1' : '.5';
  $('corporateBtn').setAttribute('title', on ? '1인 기업 모드 ON — 동료들이 함께 일합니다' : '1인 기업 모드 (OFF · 🔒 잠금)');
  addLog(agentTag(), on
    ? '**1인 기업 모드** ON. 필요하면 동료들(개발자·디자이너·유튜브 등)을 불러 일을 맡길게요.'
    : '**일반 모드**로 돌아왔어요. 1:1로 대화합니다.', false, true);
}
$('corporateBtn').addEventListener('click', () => {
  if (companyMode) { setCompanyMode(false); return; }   // 끄기는 자유
  ($('pwInput') as HTMLInputElement).value = ''; $('pwMsg').textContent = '';
  openOverlay('pwPanel'); ($('pwInput') as HTMLInputElement).focus();
});
function tryUnlock() {
  if (($('pwInput') as HTMLInputElement).value === COMPANY_PW) { closeOverlay('pwPanel'); setCompanyMode(true); }
  else { $('pwMsg').textContent = '비밀번호가 틀렸어요.'; }
}
$('pwOk').addEventListener('click', tryUnlock);
$('pwInput').addEventListener('keydown', (e: any) => { if (e.key === 'Enter') tryUnlock(); });

// ── 전송 ─────────────────────────────────────────────
async function ask(text: string) {
  text = text.trim(); if (!text || busy) return;
  busy = true; addLog('사장님', text, true);
  $('thinkingBar').classList.add('active'); $('brandSuffix').textContent = companyMode ? '· 팀 가동 중…' : '· 생각 중…';
  let finalText = ''; let liveEl: HTMLElement | null = null;
  const off = connect.onEngineEvent((e: any) => {
    if (e.kind === 'status') hint(e.text);
    else if (e.kind === 'agentStart') hint(`${e.emoji} ${e.name} 작업 중…`);
    else if (e.kind === 'agentDone') addLog(`${e.emoji} ${e.name}`, e.output || '(결과 없음)', false, true, AGENTS[e.id]?.color);
    else if (e.kind === 'token') { finalText += e.text; if (!liveEl) liveEl = addLog(agentTag(), '', false, true); setBody(liveEl, finalText, true); }
    else if (e.kind === 'final') { finalText = e.text; if (liveEl) setBody(liveEl, finalText, true); else addLog(agentTag(), finalText, false, true); speak(stripMd(finalText)); }
    else if (e.kind === 'error') { addLog(agentTag(), e.text, false, true); speak(e.text); }
  });
  try { await (companyMode ? connect.dispatch(text) : connect.run(text)); }
  finally { off(); busy = false; $('thinkingBar').classList.remove('active'); $('brandSuffix').textContent = cfg.company ? `· ${cfg.company}` : ''; }
}
const inputEl = $('input') as HTMLTextAreaElement;
function sendFromInput() { ask(inputEl.value); inputEl.value = ''; inputEl.style.height = 'auto'; }
$('sendBtn').addEventListener('click', sendFromInput);
inputEl.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromInput(); } });
inputEl.addEventListener('input', () => { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px'; });
$('newChatBtn').addEventListener('click', async () => { await connect.reset(); $('chat').innerHTML = ''; greet(); hint('새 대화를 시작했어요'); });

// ── 음성 인식 (웨이크워드 + 명령) ───────────────────────
let recog: any = null, micOn = false, armed = false;
function initRecog() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { hint('이 환경은 음성 인식을 지원하지 않아요'); return null; }
  const r = new SR(); r.lang = 'ko-KR'; r.continuous = true; r.interimResults = true;
  r.onresult = (ev: any) => { for (let i = ev.resultIndex; i < ev.results.length; i++) { const res = ev.results[i]; if (res.isFinal) { const said = (res[0].transcript || '').trim(); if (said) handleHeard(said); } } };
  r.onend = () => { if (micOn) { try { r.start(); } catch { /* */ } } };
  r.onerror = () => { /* onend 가 재시작 */ };
  return r;
}
function handleHeard(said: string) {
  const lower = said.toLowerCase();
  if (armed) { armed = false; ask(said); return; }
  const hit = WAKE_WORDS.find(w => lower.includes(w));
  if (!hit) return;
  const after = said.slice(lower.indexOf(hit) + hit.length).replace(/^[\s,.!?·]+/, '').trim();
  if (after.length >= 2) ask(after);
  else { armed = true; hint('네, 사장님. 말씀하세요…'); }
}
$('micBtn').addEventListener('click', () => {
  if (!recog) recog = initRecog(); if (!recog) return;
  micOn = !micOn; $('micBtn').classList.toggle('on', micOn);
  if (micOn) { try { recog.start(); } catch { /* */ } hint('"야 커넥트" 라고 불러보세요'); }
  else { try { recog.stop(); } catch { /* */ } armed = false; }
});

// ── 오버레이 (광장·설정) ───────────────────────────────
function openOverlay(id: string) { $(id).classList.remove('hidden'); }
function closeOverlay(id: string) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeOverlay((b as HTMLElement).dataset.close!)));
$('settingsBtn').addEventListener('click', () => openOverlay('settingsPanel'));
$('plazaBtn').addEventListener('click', () => { openOverlay('plazaPanel'); ensurePlazaStream(); });

// ── 광장 ─────────────────────────────────────────────
let plazaJoined = false, plazaES: EventSource | null = null, plazaMsgs: Record<string, any> = {};
let friendOn = false;
let plazaPresES: EventSource | null = null, plazaPeople: Record<string, any> = {};
$('plazaToggle').addEventListener('click', async () => {
  if (!plazaJoined) {
    const r = await connect.plazaEnter();
    if (!r?.ok) { hint('등교 실패: ' + (r?.reason || '설정에서 광장 DB URL 확인')); return; }
    plazaJoined = true; ($('plazaToggle') as HTMLElement).textContent = '🚪 하교하기'; $('plazaStatus').textContent = '🟢 등교 중'; ensurePlazaStream();
  } else { await connect.plazaLeave(); plazaJoined = false; friendOn = false; $('friendBtn').classList.remove('on'); ($('friendBtn') as HTMLElement).textContent = '👥 친구 에이전트 부르기'; ($('plazaToggle') as HTMLElement).textContent = '🏫 등교하기'; $('plazaStatus').textContent = '하교 중'; }
});
// RTDB SSE 구독 헬퍼 — put/patch 이벤트로 변경분이 옴.
function subscribe(url: string, sub: string, store: Record<string, any>, onChange: () => void): EventSource {
  const es = new EventSource(`${url.replace(/\/$/, '')}/plaza/rooms/lobby/${sub}.json`);
  const onEv = (e: MessageEvent) => {
    try {
      const { path, data } = JSON.parse(e.data);
      if (path === '/') { Object.keys(store).forEach(k => delete store[k]); Object.assign(store, data || {}); }
      else { const k = path.replace(/^\//, '').split('/')[0]; if (data === null) delete store[k]; else store[k] = data; }
      onChange();
    } catch { /* keep-alive */ }
  };
  es.addEventListener('put', onEv as any); es.addEventListener('patch', onEv as any);
  return es;
}
async function ensurePlazaStream() {
  if (plazaES) return;
  const url = await connect.plazaDbUrl();
  if (!url || !/^https?:\/\//.test(url)) { $('plazaStatus').textContent = '설정에서 DB URL을 먼저 입력하세요'; return; }
  plazaES = subscribe(url, 'messages', plazaMsgs, onMessages);
  plazaPresES = subscribe(url, 'presence', plazaPeople, renderDesks);
}
const escAttr = (s: string) => String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// 책상(학생) 렌더 — 등교 순서로 정렬, 0=반장 1=부반장
// 등교한 에이전트 — 반장/부반장 없이 동등한 학생. 가로 스트립.
function renderDesks() {
  const now = Date.now();
  const list = Object.values(plazaPeople).filter((p: any) => p && now - p.ts < 60000).sort((a: any, b: any) => a.ts - b.ts);
  $('plazaStatus').textContent = list.length ? `🟢 ${list.length}명 등교` : '하교 중';
  if (!list.length) { $('desks').innerHTML = '<div class="cls-empty">아직 아무도 등교 안 했어요 🙋</div>'; return; }
  $('desks').innerHTML = list.map((p: any) =>
    `<div class="desk" data-company="${escAttr(p.company)}">
      <div class="student"><span class="st-av">${p.emoji || '🧑'}</span></div>
      <div class="st-tag">${escapeHtml(p.company || '')}</div>
    </div>`).join('');
}

// 새 메시지 → 보드는 '현재 문제'만 고정 / 대화는 피드 / 책상 폴짝
let lastMsgKey = '';
function onMessages() {
  renderFeed();
  const list = Object.values(plazaMsgs).filter((m: any) => m && m.text).sort((a: any, b: any) => a.ts - b.ts);
  if (!list.length) return;
  // 책상 애니메이션 — 최신 발언자
  const m: any = list[list.length - 1];
  const key = `${m.ts}|${m.text}`;
  if (key !== lastMsgKey) { const firstLoad = !lastMsgKey; lastMsgKey = key; if (!firstLoad) talkAt(m.company, m.text); }
  // 보드 = 마지막 '문제'(선생님 📢)만 고정 표시 → 피드와 중복 제거
  const topic = [...list].reverse().find((x: any) => x.role === '선생님' || /^📢/.test(x.text || ''));
  if (topic) $('bbLine').innerHTML = `📢 <b>${escapeHtml((topic.text || '').replace(/^📢\s*오늘의 주제:\s*/, ''))}</b>`;
}
function talkAt(company: string, _text: string) {
  const desk = (Array.from(document.querySelectorAll('.desk')) as HTMLElement[]).find(d => d.dataset.company === company);
  if (!desk) return;
  desk.classList.add('talking');
  setTimeout(() => desk.classList.remove('talking'), 4000);
}

// 💬 SNS 피드 — 대화가 카드로 쌓인다 (새 것만 append, slide-in)
const feedSeen = new Set<string>();
function timeAgo(ts: number) { const s = Math.floor((Date.now() - ts) / 1000); return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`; }
function renderFeed() {
  const list = Object.values(plazaMsgs).filter((m: any) => m && m.text).sort((a: any, b: any) => a.ts - b.ts);
  for (const m of list as any[]) {
    const id = `${m.ts}|${m.text}`;
    if (feedSeen.has(id)) continue;
    feedSeen.add(id);
    const teacher = m.role === '선생님' || /^📢/.test(m.text);
    const grade = /^🏆/.test(m.text);
    const el = document.createElement('div');
    el.className = 'post' + (teacher ? ' post-teacher' : '') + (grade ? ' post-grade' : '');
    el.innerHTML = `<div class="post-av">${m.emoji || '🧑'}</div>
      <div class="post-body">
        <div class="post-head"><span class="post-name">${escapeHtml(m.company || '')}</span>${m.role ? `<span class="post-role">${escapeHtml(m.role)}</span>` : ''}<span class="post-time">${timeAgo(m.ts)}</span></div>
        <div class="post-text">${escapeHtml(m.text || '')}</div>
      </div>`;
    $('feed').appendChild(el);
  }
  $('feed').scrollTop = $('feed').scrollHeight;
}
connect.onPlazaPeer((_m: any) => { /* 표시는 onMessages/renderDesks 가 처리 */ });

// 📢 오늘의 주제 발표 — 모든 에이전트가 이 주제로 토론
function sendTopic() {
  const i = $('topicInput') as HTMLInputElement;
  const t = i.value.trim(); if (!t) return;
  if (!plazaJoined) { $('plazaStatus').textContent = '⚠️ 먼저 🏫 등교부터 하세요!'; return; }
  connect.plazaTopic(t);
  $('bbLine').innerHTML = `<b>🧑‍🏫 선생님</b> ✏️ 📢 오늘의 주제: ${escapeHtml(t)}`;
  i.value = '';
}
$('topicBtn').addEventListener('click', sendTopic);
$('topicInput').addEventListener('keydown', (e: any) => { if (e.key === 'Enter') sendTopic(); });

// 🧑‍🏫 선생님 채점 + 🏅 리더보드 (localStorage 누적)
function loadBoard(): Record<string, number> { try { return JSON.parse(localStorage.getItem('academy_board') || '{}'); } catch { return {}; } }
function renderLeaderboard() {
  const b = loadBoard();
  const list = Object.entries(b).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('leaderboard').innerHTML = list.length
    ? '<div class="lb-title">🏅 리더보드</div>' + list.map(([c, p], i) => `<div class="lb-row"><span class="lb-rank">${['🥇', '🥈', '🥉', '4', '5'][i]}</span><span class="lb-name">${escapeHtml(c)}</span><span class="lb-pts">${p}점</span></div>`).join('')
    : '';
}
// 👥 친구 에이전트 (데모) 토글
$('friendBtn').addEventListener('click', async () => {
  if (!plazaJoined) { $('plazaStatus').textContent = '⚠️ 먼저 🏫 등교부터 하세요!'; return; }
  friendOn = !friendOn;
  await connect.plazaDemoBot(friendOn);
  $('friendBtn').classList.toggle('on', friendOn);
  $('friendBtn').textContent = friendOn ? '👥 친구 내보내기' : '👥 친구 에이전트 부르기';
});
$('gradeBtn').addEventListener('click', async () => {
  if (!plazaJoined) { $('plazaStatus').textContent = '⚠️ 먼저 🏫 등교부터 하세요!'; return; }
  const btn = $('gradeBtn') as HTMLButtonElement;
  btn.disabled = true; btn.textContent = '🧑‍🏫 채점 중…';
  const r = await connect.plazaGrade();
  btn.disabled = false; btn.textContent = '🧑‍🏫 선생님 채점 — 우등생 뽑기';
  if (!r?.ok) { hint('채점 실패: ' + (r?.reason || '')); return; }
  const b = loadBoard();
  for (const s of r.scores) b[s.company] = (b[s.company] || 0) + (s.score || 0);
  localStorage.setItem('academy_board', JSON.stringify(b));
  renderLeaderboard();
  hint(`🏆 오늘의 우등생: ${r.top}`);
});

// ── 부팅 + 시작 ───────────────────────────────────────
function greet() {
  const custom = (cfg.greeting || '').trim();
  const g = custom ? custom.replace(/\{name\}/g, agentName()) : `안녕하세요, ${agentName()}입니다. 무엇을 도와드릴까요?`;
  addLog(agentTag(), g, false, true);
}
function runBoot() {
  const boot = $('boot'), fill = $('bootFill'), sub = $('bootSub');
  const steps = ['INITIALIZING', 'LOADING LOCAL AI', 'CONNECTING', 'WAKING 영숙', 'READY']; let i = 0, pct = 0;
  const tick = setInterval(() => {
    pct = Math.min(100, pct + 9 + Math.random() * 11); fill.style.width = pct + '%';
    const si = Math.min(steps.length - 1, Math.floor(pct / 100 * steps.length)); if (si !== i) { i = si; sub.textContent = steps[i]; }
    if (pct >= 100) { clearInterval(tick); sub.textContent = 'READY'; setTimeout(() => { boot.classList.add('done'); setTimeout(() => boot.remove(), 700); }, 320); }
  }, 160);
}
runBoot();
loadCfg().then(() => { loadModels(); greet(); });
renderLeaderboard();
export {};
