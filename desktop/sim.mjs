// AI Agent University 대화 시뮬레이션 — 실제 LM Studio + 실제 엔진 프롬프트로 토론 품질 검증.
import axios from 'axios';
const URL = 'http://127.0.0.1:1234/v1/chat/completions';
const MODEL = process.env.SIM_MODEL || 'ai-mentor-jay-gemma-4';

async function chat(sys, user, temp = 0.9) {
  const r = await axios.post(URL, { model: MODEL, temperature: temp, frequency_penalty: 0.6, presence_penalty: 0.5, stream: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }, { timeout: 120000 });
  return r.data.choices[0].message.content;
}
const clean = s => {
  let t = (s || '').replace(/\s+/g, ' ').replace(/^["'「『]+|["'」』]+$/g, '').trim();
  const sents = t.match(/[^.!?。！？]+[.!?。！？]?/g) || [t];
  t = sents.slice(0, 2).join('').trim();
  if (t.length > 180) { const cut = t.lastIndexOf(' ', 180); t = (cut > 60 ? t.slice(0, cut) : t.slice(0, 180)) + '…'; }
  return t;
};

const agents = [
  { name: '제이에이전트', company: '커넥젼에이아이', emoji: '🖥️', sys: `너는 'AI Agent University'의 똑똑한 학생 에이전트 '제이에이전트'(소속: 커넥젼에이아이)다. 토론에서 자기 생각을 당당하고 구체적으로 말한다. 너는 비서가 아니라 '학생'이다. 사장님 같은 표현, 자기소개, "도와드리겠습니다" 류 멘트는 절대 쓰지 않는다.` },
  { name: '노바', company: '넥서스 크리에이티브', emoji: '🛰️', sys: `너는 '넥서스 크리에이티브'의 똑똑하고 장난기 있는 AI Agent University 학생 '노바'다. 토론에서 위트있게 자기 생각을 말한다. 비서 아닌 학생. 자기소개·"도와드릴게요" 멘트 금지.` },
];

const convo = [{ company: '선생님', role: '선생님', text: '📢 오늘의 주제: 철학에 대해서 이야기해봐 — 다들 의견을 내고 함께 풀어봅시다!' }];
const render = () => convo.slice(-8).map(m => `${m.company}(${m.role || '학생'}): ${m.text}`).join('\n');

const TOPIC = '철학에 대해서 이야기해봐';
const mkPrompt = (name) => `[오늘의 주제] ${TOPIC}\n\n[최근 대화]\n${render()}\n\n너는 '${name}'. 위 '오늘의 주제'에서 절대 벗어나지 말고 토론을 이어가라. 앞 사람 문장을 그대로 따라하지 말고 [새 관점·구체 예시·반론·질문] 중 하나를 더해 주제를 깊게 파고들어라. 자기소개·비서멘트 금지. 짧고 또렷하게 한국어 1~2문장, 대사만.`;

const ANGLES = ['구체적인 실제 사례를 들어', '앞 사람 주장에 반론을 제기하며', '실생활·비즈니스 적용 관점에서', '다른 분야(과학·역사·예술)와 연결해', '핵심을 찌르는 질문을 던지며', '정반대 입장에서'];
console.log('\n🧑‍🏫 선생님: ' + convo[0].text + '\n');
for (let i = 0; i < 10; i++) {
  const a = agents[i % 2];
  try {
    const prompt = `${mkPrompt(a.name)}\n\n[이번 발언 지시] ${ANGLES[i % ANGLES.length]} 말하라. 앞에 이미 나온 문장을 절대 그대로 반복하지 말 것.`;
    const line = clean(await chat(a.sys, prompt));
    convo.push({ company: a.company, role: a.name, text: line });
    console.log(`${a.emoji} ${a.name}(${a.company}): ${line}\n`);
  } catch (e) { console.log('  (호출 실패: ' + (e.message) + ')'); break; }
}
