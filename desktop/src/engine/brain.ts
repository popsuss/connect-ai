// 🧠 두뇌 — Connect AI의 핵심. 지식 노트를 쌓고, 연결하고, RAG로 끌어온다.
//   저장: JSON 한 파일(노트 배열). 검색: 임베딩 코사인(있으면) → 키워드(폴백).
//   그래프: 노트=노드, 유사도/공유태그=엣지.
import * as fs from 'fs';
import * as path from 'path';

export interface Note { id: string; text: string; tags: string[]; ts: number; emb?: number[]; }

let _file = '';
export function setBrainFile(p: string) { _file = p; }
function load(): Note[] { try { return JSON.parse(fs.readFileSync(_file, 'utf8')); } catch { return []; } }
function persist(n: Note[]) { try { fs.mkdirSync(path.dirname(_file), { recursive: true }); fs.writeFileSync(_file, JSON.stringify(n)); } catch { /* */ } }

const STOP = new Set('그 이 저 것 수 등 및 더 좀 잘 안 못 의 가 이 은 는 을 를 에 와 과 도 로 으로 에서 the a an of to and or is are for in on with that this 합니다 입니다 있다 없다 하는 한 할 함'.split(/\s+/));
function keywords(text: string): string[] {
  const wiki = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim());
  const words = (text.toLowerCase().match(/[a-z0-9]{3,}|[가-힣]{2,}/g) || []).filter(w => !STOP.has(w));
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
  return [...new Set([...wiki, ...top])];
}

export function allNotes(): Note[] { return load(); }
export function noteCount(): number { return load().length; }

export function addNote(text: string, emb?: number[]): Note {
  const notes = load();
  const note: Note = { id: 'n' + Date.now() + Math.floor(Math.random() * 1e4), text: text.trim(), tags: keywords(text), ts: Date.now(), emb };
  notes.push(note); persist(notes); return note;
}
export function deleteNote(id: string) { persist(load().filter(n => n.id !== id)); }

// GitHub 등에서 불러온 노트를 병합(중복 텍스트 제외). 추가된 개수 반환.
export function importNotes(incoming: Partial<Note>[]): number {
  const cur = load(); const have = new Set(cur.map(n => n.text.trim()));
  let added = 0;
  for (const n of incoming) {
    const t = (n.text || '').trim(); if (!t || have.has(t)) continue;
    cur.push({ id: 'n' + Date.now() + Math.floor(Math.random() * 1e4), text: t, tags: n.tags || keywords(t), ts: n.ts || Date.now(), emb: n.emb });
    have.add(t); added++;
  }
  if (added) persist(cur); return added;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// 질문과 관련 있는 노트 top-K. queryEmb 주면 의미 검색, 없으면 키워드 겹침.
export function search(query: string, topK = 4, queryEmb?: number[]): Note[] {
  const notes = load();
  if (!notes.length) return [];
  if (queryEmb && notes.some(n => n.emb)) {
    return notes.filter(n => n.emb).map(n => ({ n, s: cosine(queryEmb, n.emb!) }))
      .sort((a, b) => b.s - a.s).filter(x => x.s > 0.3).slice(0, topK).map(x => x.n);
  }
  const qk = new Set(keywords(query));
  return notes.map(n => ({ n, s: n.tags.filter(t => qk.has(t)).length + (qk.size && [...qk].some(k => n.text.toLowerCase().includes(k)) ? 0.5 : 0) }))
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, topK).map(x => x.n);
}

// 그래프 데이터: 노드 + 엣지(임베딩 유사도 또는 공유 태그)
export function graph(): { nodes: { id: string; label: string; tags: string[] }[]; links: { source: string; target: string; w: number }[] } {
  const notes = load();
  const nodes = notes.map(n => ({ id: n.id, label: n.text.replace(/\[\[|\]\]/g, '').slice(0, 22), tags: n.tags }));
  const links: { source: string; target: string; w: number }[] = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i], b = notes[j];
      let w = 0;
      if (a.emb && b.emb) w = cosine(a.emb, b.emb);
      else { const shared = a.tags.filter(t => b.tags.includes(t)).length; w = shared ? Math.min(1, shared / 2) : 0; }
      if (w > 0.45) links.push({ source: a.id, target: b.id, w });
    }
  }
  return { nodes, links };
}
