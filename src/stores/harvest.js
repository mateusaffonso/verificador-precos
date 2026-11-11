// Coletor genérico de "cards" de produto em páginas de busca: acha links de produto e o preço próximo.
import { parseBRL, cleanText, decodeEntities } from '../util.js';

const PRICE_RE = /R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g;

/** Escolhe o preço "à vista/por" de um texto de card. */
export function pickPrice(text) {
  let t = ' ' + cleanText(text) + ' ';
  t = t.replace(/\d+\s*x\s*(de\s*)?R\$\s?[\d.,]+(\s*sem juros)?/gi, ' ');
  t = t.replace(/(economize|economia de|desconto de|cashback de|ganhe)\s*R\$\s?[\d.,]+/gi, ' ');
  t = t.replace(/R\$\s?[\d.,]+\s*(off|de desconto|de cashback)/gi, ' ');
  const por = t.match(/\bpor\s*:?\s*(R\$\s?[\d.,]+)/i);
  if (por) return parseBRL(por[1]);
  const pix = t.match(/(R\$\s?[\d.,]+)\s*(no pix|à vista|a vista|no boleto)/i);
  if (pix) return parseBRL(pix[1]);
  const all = (t.match(PRICE_RE) || []).map(parseBRL).filter(Boolean);
  if (!all.length) return null;
  const max = Math.max(...all);
  const plausible = all.filter((v) => v >= max * 0.3);
  return Math.min(...plausible);
}

/**
 * $: cheerio; linkRe: regex de URL de produto; base: origem para links relativos.
 * Retorna [{ url, title, price, text, image }].
 */
export function harvestCards($, { linkRe, base, max = 40, canonical = (u) => u.split('?')[0].split('#')[0] }) {
  const seen = new Map();
  $('a[href]').each((_, a) => {
    let href = decodeEntities($(a).attr('href') || '');
    if (!href) return;
    if (href.startsWith('//')) href = 'https:' + href;
    else if (href.startsWith('/')) href = base + href;
    if (!linkRe.test(href)) return;
    const url = canonical(href);
    if (seen.has(url) && seen.get(url).price) return;
    let node = $(a);
    let container = node;
    for (let i = 0; i < 6; i++) {
      const txt = container.text();
      if (/R\$\s?\d/.test(txt) && txt.length < 1500) break;
      const p = container.parent();
      if (!p.length) break;
      container = p;
    }
    const text = cleanText(container.text());
    if (text.length > 1500) return;
    const title = cleanText($(a).attr('title') || $(a).find('img').attr('alt') || $(a).find('h2,h3').first().text() || $(a).text() || container.find('h2,h3').first().text());
    const price = pickPrice(text);
    const image = container.find('img').first().attr('src') || null;
    if (!title || title.length < 8) return;
    seen.set(url, { url, title, price, text, image });
  });
  return [...seen.values()].filter((x) => x.price).slice(0, max);
}
