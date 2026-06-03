// ⚡ 단기 기억 = GitHub. 지식 노트를 레포에 버전관리로 동기화(push) / 불러오기(pull).
import axios from 'axios';

const FILE_PATH = 'connect-ai/knowledge.json';
const hdr = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'connect-ai-desktop' });
const split = (repo: string) => { const [owner, name] = (repo || '').split('/'); return { owner, name }; };

// 범용 파일 푸시(생성/업데이트). 텍스트 내용을 레포 path 에 커밋.
export async function pushFile(token: string, repo: string, filePath: string, text: string, message: string): Promise<{ ok: boolean; error?: string; url?: string }> {
  if (!token || !(repo || '').includes('/')) return { ok: false, error: 'GitHub 토큰과 레포(owner/repo)를 🗂️ 연동에서 먼저 입력하세요.' };
  const { owner, name } = split(repo);
  const url = `https://api.github.com/repos/${owner}/${name}/contents/${filePath}`;
  try {
    let sha: string | undefined;
    try { const cur = await axios.get(url, { headers: hdr(token), timeout: 15000 }); sha = cur.data?.sha; } catch { /* 신규 */ }
    const content = Buffer.from(text, 'utf8').toString('base64');
    await axios.put(url, { message, content, sha }, { headers: hdr(token), timeout: 20000 });
    return { ok: true, url: `https://github.com/${owner}/${name}/blob/main/${filePath}` };
  } catch (e: any) { return { ok: false, error: e?.response?.data?.message || e?.message || String(e) }; }
}

export async function pushKnowledge(token: string, repo: string, notes: any[]): Promise<{ ok: boolean; count?: number; error?: string; url?: string }> {
  const r = await pushFile(token, repo, FILE_PATH, JSON.stringify(notes, null, 2), `🧠 Connect AI 지식 동기화 (${notes.length}개)`);
  return r.ok ? { ok: true, count: notes.length, url: r.url } : r;
}

export async function pullKnowledge(token: string, repo: string): Promise<{ ok: boolean; notes?: any[]; error?: string }> {
  if (!token || !(repo || '').includes('/')) return { ok: false, error: 'GitHub 토큰과 레포를 🗂️ 연동에서 먼저 입력하세요.' };
  const { owner, name } = split(repo);
  const url = `https://api.github.com/repos/${owner}/${name}/contents/${FILE_PATH}`;
  try {
    const r = await axios.get(url, { headers: hdr(token), timeout: 15000 });
    const json = Buffer.from(r.data.content, 'base64').toString('utf8');
    const notes = JSON.parse(json);
    return { ok: true, notes: Array.isArray(notes) ? notes : [] };
  } catch (e: any) {
    if (e?.response?.status === 404) return { ok: false, error: '아직 GitHub에 동기화된 지식이 없어요. 먼저 ⬆ 동기화하세요.' };
    return { ok: false, error: e?.response?.data?.message || e?.message || String(e) };
  }
}
