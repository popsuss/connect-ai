// 📧 이메일 채널 — SMTP(nodemailer)로 발송. 에이전트가 승인 후 메일을 보낼 수 있게.
import nodemailer from 'nodemailer';

export interface SmtpCfg { host?: string; port?: string; user?: string; pass?: string; from?: string; }

export async function sendEmail(s: SmtpCfg, to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!s.host || !s.user || !s.pass) return { ok: false, error: '이메일(SMTP) 미설정 — 🗂️ 연동에서 먼저 연결하세요.' };
  if (!to) return { ok: false, error: '받는 사람(to)이 없어요.' };
  const port = Number(s.port) || 587;
  try {
    const t = nodemailer.createTransport({ host: s.host, port, secure: port === 465, auth: { user: s.user, pass: s.pass } });
    await t.sendMail({ from: s.from || s.user, to, subject: subject || '(제목 없음)', text: body || '' });
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}
