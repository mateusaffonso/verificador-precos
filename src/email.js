// E-mail resumo (no máximo 1 por execução) via Gmail SMTP + senha de app.
import nodemailer from 'nodemailer';
import { fmtBRL, log } from './util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const REASON_LABEL = {
  target: 'Atingiu seu preço-alvo',
  lowest: 'Menor preço já visto',
  dropPct: 'Queda acima do limite',
  anyDrop: 'Caiu de preço',
};

export function panelURL() {
  if (process.env.PANEL_URL) return process.env.PANEL_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return null;
  const [owner, name] = repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
}

export function buildDigest({ alerts, coupons, deals }) {
  const n = alerts.length;
  const parts = [];
  if (n) parts.push(`${n} alerta${n > 1 ? 's' : ''} de preço`);
  if (deals.length) parts.push(`${deals.length} promo${deals.length > 1 ? 's' : ''} da comunidade`);
  if (coupons.length) parts.push(`${coupons.length} cupo${coupons.length > 1 ? 'ns' : 'm'} novo${coupons.length > 1 ? 's' : ''}`);
  let subject = `[Verificador de Preços] ${parts.join(' · ')}`;
  if (n) {
    const a = alerts[0];
    subject = `[Preço] ${a.productTitle.slice(0, 50)} por ${fmtBRL(a.finalPrice)} (${a.storeName})` + (n > 1 ? ` +${n - 1}` : '');
  }

  const panel = panelURL();
  const row = (a) => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">
        ${a.image ? `<img src="${esc(a.image)}" width="56" height="56" style="object-fit:contain;border-radius:6px;background:#fff">` : ''}
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee">
        <div style="font-weight:600;color:#111">${esc(a.productTitle)}</div>
        <div style="color:#555;font-size:13px">${esc(a.storeName)}${a.seller ? ' · ' + esc(a.seller) : ''}</div>
        <div style="margin-top:4px;font-size:13px">${a.reasons.map((r) => `<span style="display:inline-block;background:#e8f5ee;color:#0a7a3f;border-radius:10px;padding:1px 8px;margin:2px 4px 0 0">${esc(REASON_LABEL[r] || r)}</span>`).join('')}</div>
        ${a.coupon ? `<div style="font-size:13px;color:#7a4b00;margin-top:4px">Cupom na página: ${esc(a.coupon.text)}${a.coupon.code ? ` — código <b>${esc(a.coupon.code)}</b>` : ''}</div>` : ''}
        ${a.warning ? `<div style="font-size:13px;color:#b42318;margin-top:4px">${esc(a.warning)}</div>` : ''}
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">
        <div style="font-size:18px;font-weight:700;color:#0a7a3f">${fmtBRL(a.finalPrice)}</div>
        ${a.prevFinal ? `<div style="font-size:12px;color:#888;text-decoration:line-through">${fmtBRL(a.prevFinal)}</div>` : ''}
        ${a.targetPrice ? `<div style="font-size:12px;color:#555">alvo ${fmtBRL(a.targetPrice)}</div>` : ''}
        <a href="${esc(a.url)}" style="display:inline-block;margin-top:6px;background:#111;color:#fff;text-decoration:none;padding:6px 12px;border-radius:6px;font-size:13px">Ver oferta</a>
      </td>
    </tr>`;

  const dealRow = (d) => `<li style="margin:6px 0"><a href="${esc(d.url)}">${esc(d.title)}</a> — <b>${fmtBRL(d.price)}</b>${d.storeName ? ` em ${esc(d.storeName)}` : ''}${d.coupon ? ` · cupom <b>${esc(d.coupon)}</b>` : ''} <span style="color:#888">(${esc(d.source)} · para "${esc(d.productTitle.slice(0, 40))}")</span></li>`;
  const couponRow = (c) => `<li style="margin:6px 0"><b>${esc(c.storeName)}</b>: ${esc(c.title)}${c.code ? ` — código <code style="background:#f3f3f3;padding:1px 6px;border-radius:4px">${esc(c.code)}</code>` : ''} <span style="color:#888">(${esc(c.source)})</span></li>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:20px">
    <h2 style="margin:0 0 4px;font-size:20px;color:#111">Verificador de Preços</h2>
    <div style="color:#666;font-size:13px;margin-bottom:16px">${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div>
    ${n ? `<div style="background:#fff;border-radius:10px;padding:6px 10px;margin-bottom:16px"><table style="width:100%;border-collapse:collapse">${alerts.map(row).join('')}</table></div>` : ''}
    ${deals.length ? `<div style="background:#fff;border-radius:10px;padding:12px 16px;margin-bottom:16px"><h3 style="margin:0 0 6px;font-size:15px">Promoções postadas pela comunidade</h3><ul style="padding-left:18px;margin:0;font-size:14px">${deals.map(dealRow).join('')}</ul></div>` : ''}
    ${coupons.length ? `<div style="background:#fff;border-radius:10px;padding:12px 16px;margin-bottom:16px"><h3 style="margin:0 0 6px;font-size:15px">Cupons novos nas lojas dos seus produtos</h3><ul style="padding-left:18px;margin:0;font-size:14px">${coupons.map(couponRow).join('')}</ul></div>` : ''}
    ${panel ? `<p style="font-size:13px;color:#555">Abra o painel: <a href="${panel}">${panel}</a></p>` : ''}
    <p style="font-size:12px;color:#999">Preços e cupons podem mudar a qualquer momento; confirme na loja antes de comprar.</p>
  </div></body></html>`;

  const text = [
    ...alerts.map((a) => `• ${a.productTitle} — ${fmtBRL(a.finalPrice)} em ${a.storeName} (${a.reasons.map((r) => REASON_LABEL[r] || r).join(', ')})\n  ${a.url}`),
    ...deals.map((d) => `• [${d.source}] ${d.title} — ${fmtBRL(d.price)} ${d.url}`),
    ...coupons.map((c) => `• Cupom ${c.storeName}: ${c.title}${c.code ? ' — ' + c.code : ''}`),
    panel ? `\nPainel: ${panel}` : '',
  ].join('\n');

  return { subject, html, text };
}

export async function sendDigest(digest) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.ALERT_TO || user;
  if (!user || !pass) {
    log('E-mail não configurado (GMAIL_USER / GMAIL_APP_PASSWORD). Assunto seria:', digest.subject);
    return { sent: false, reason: 'not-configured' };
  }
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass: pass.replace(/\s+/g, '') },
  });
  await transport.sendMail({ from: `Verificador de Preços <${user}>`, to, subject: digest.subject, html: digest.html, text: digest.text });
  log('E-mail enviado:', digest.subject);
  return { sent: true };
}
