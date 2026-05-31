// 🏛️ 로컬 광장 릴레이 — Firebase RTDB REST 의 필요한 부분만 흉내내는 작은 HTTP 서버.
// Firebase 없이도 광장이 돌아가게. 같은 PC/LAN 의 여러 인스턴스가 이 서버로 만난다.
//   - GET  .../messages.json            → 전체 맵 (JSON) 또는 SSE(text/event-stream)
//   - POST .../messages.json            → 메시지 추가, {name:id} 반환
//   - GET  .../presence.json            → 전체 맵
//   - PUT/DELETE .../presence/<uid>.json → 프레즌스 설정/삭제
import * as http from 'http';

const store = { messages: {} as Record<string, any>, presence: {} as Record<string, any> };
const sseClients: http.ServerResponse[] = [];
let server: http.Server | null = null;
let seq = 0;
const PORT = 4830;

function broadcast(path: string, data: any) {
  const payload = `event: put\ndata: ${JSON.stringify({ path, data })}\n\n`;
  for (const res of [...sseClients]) { try { res.write(payload); } catch { /* dropped */ } }
}
function readBody(req: http.IncomingMessage, cb: (b: any) => void) {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { cb(JSON.parse(b || '{}')); } catch { cb({}); } });
}

export function getMessages(): Record<string, any> { return store.messages; }

export function startPlazaServer(): string {
  const url = `http://127.0.0.1:${PORT}`;
  if (server) return url;
  server = http.createServer((req, res) => {
    const path = (req.url || '').split('?')[0];
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

    const isMsg = /\/plaza\/rooms\/[^/]+\/messages\.json$/.test(path);
    const isPresAll = /\/plaza\/rooms\/[^/]+\/presence\.json$/.test(path);
    const presOne = path.match(/\/plaza\/rooms\/[^/]+\/presence\/([^/]+)\.json$/);

    if (isMsg) {
      if (req.method === 'GET' && /text\/event-stream/.test(req.headers.accept || '')) {
        res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: store.messages })}\n\n`);
        sseClients.push(res);
        req.on('close', () => { const i = sseClients.indexOf(res); if (i >= 0) sseClients.splice(i, 1); });
        return;
      }
      if (req.method === 'GET') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(store.messages)); return; }
      if (req.method === 'POST') { readBody(req, (body) => { const id = `m${Date.now()}_${seq++}`; store.messages[id] = body; broadcast('/' + id, body); res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ name: id })); }); return; }
    }
    if (isPresAll && req.method === 'GET') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(store.presence)); return; }
    if (presOne) {
      const uid = decodeURIComponent(presOne[1]);
      if (req.method === 'PUT') { readBody(req, (body) => { store.presence[uid] = body; res.writeHead(200, cors); res.end('{}'); }); return; }
      if (req.method === 'DELETE') { delete store.presence[uid]; res.writeHead(200, cors); res.end('{}'); return; }
    }
    res.writeHead(404, cors); res.end('null');
  });
  server.listen(PORT, '0.0.0.0');
  return url;
}
