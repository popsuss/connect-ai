// 🧬 장기 기억 = HuggingFace. 지식을 파인튜닝용 데이터셋(JSONL)으로 HF에 업로드 → Unsloth/AutoTrain으로 학습.
import axios from 'axios';

// 지식 노트 → 챗 파인튜닝 JSONL
export function notesToJsonl(notes: { text: string }[]): string {
  const sys = '너는 사장님의 1인 기업 AI 비서다. 아래 지식을 체득해 답변에 활용한다.';
  return notes.map(n => JSON.stringify({ messages: [
    { role: 'system', content: sys },
    { role: 'user', content: '내 사업/지식에 대해 기억하고 있는 것을 알려줘.' },
    { role: 'assistant', content: n.text },
  ] })).join('\n');
}

export async function uploadDataset(token: string, repo: string, jsonl: string, filename = 'connect-ai-knowledge.jsonl'): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!token || !(repo || '').includes('/')) return { ok: false, error: '허깅페이스 토큰과 데이터셋 레포(user/name)를 🗂️ 연동에서 먼저 입력하세요.' };
  const headers = { Authorization: `Bearer ${token}` };
  const name = repo.split('/')[1];
  try {
    // 데이터셋 레포 생성 (이미 있으면 무시)
    try { await axios.post('https://huggingface.co/api/repos/create', { type: 'dataset', name, private: true }, { headers, timeout: 15000 }); } catch { /* 이미 존재 등 */ }
    // 커밋 API (NDJSON) — 작은 파일은 base64 인라인
    const ndjson =
      JSON.stringify({ key: 'header', value: { summary: '🧠 Connect AI 지식 데이터셋 업데이트' } }) + '\n' +
      JSON.stringify({ key: 'file', value: { path: filename, content: Buffer.from(jsonl, 'utf8').toString('base64'), encoding: 'base64' } }) + '\n';
    await axios.post(`https://huggingface.co/api/datasets/${repo}/commit/main`, ndjson, { headers: { ...headers, 'Content-Type': 'application/x-ndjson' }, timeout: 30000 });
    return { ok: true, url: `https://huggingface.co/datasets/${repo}` };
  } catch (e: any) {
    return { ok: false, error: e?.response?.data?.error || e?.response?.data?.message || e?.message || String(e) };
  }
}
