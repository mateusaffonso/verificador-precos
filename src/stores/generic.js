// Extração genérica: JSON-LD (schema.org Product), meta tags e detecção de cupom no texto.
import * as cheerio from 'cheerio';
import { parseBRL, cleanText, round2 } from '../util.js';

export function loadHTML(html) {
  return cheerio.load(html || '');
}

function flattenLD(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => flattenLD(n, out)); return out; }
  if (typeof node !== 'object') return out;
  out.push(node);
  if (node['@graph']) flattenLD(node['@graph'], out);
  if (node.mainEntity) flattenLD(node.mainEntity, out);
  if (node.hasVariant) flattenLD(node.hasVariant, out);
  return out;
}

export function jsonLD($) {
  const items = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try { flattenLD(JSON.parse(raw), items); } catch {
      try { flattenLD(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')), items); } catch {}
    }
  });
  return items;
}

const isType = (n, t) => {
  const ty = n['@type'];
  return Array.isArray(ty) ? ty.includes(t) : ty === t;
};

/** Primeiro Product do JSON-LD normalizado. */
export function ldProduct($) {
  const prods = jsonLD($).filter((n) => isType(n, 'Product') || isType(n, 'ProductGroup'));
  if (!prods.length) return null;
  const p = prods.find((x) => x.offers) || prods[0];
  let offers = p.offers;
  if (Array.isArray(offers)) offers = offers;
  else if (offers && isType(offers, 'AggregateOffer') && Array.isArray(offers.offers)) offers = offers.offers;
  else if (offers) offers = [offers];
  else offers = [];
  const first = offers.find((o) => o && (o.price || o.lowPrice)) || offers[0] || {};
  const agg = p.offers && !Array.isArray(p.offers) ? p.offers : {};
  const price = parseBRL(first.price ?? first.lowPrice ?? agg.lowPrice ?? agg.price);
  const avail = String(first.availability || agg.availability || '');
  const cond = String(first.itemCondition || p.itemCondition || '');
  const brand = typeof p.brand === 'string' ? p.brand : p.brand?.name;
  const image = Array.isArray(p.image) ? (typeof p.image[0] === 'string' ? p.image[0] : p.image[0]?.url) : (typeof p.image === 'string' ? p.image : p.image?.url);
  const seller = first.seller?.name || (typeof first.seller === 'string' ? first.seller : null) || first.offeredBy?.name || first.offeredBy || null;
  return {
    title: cleanText(p.name),
    price,
    listPrice: parseBRL(first.highPrice) || null,
    available: avail ? !/OutOfStock|SoldOut|Discontinued/i.test(avail) : true,
    condition: /Used|Refurbished|Damaged/i.test(cond) ? 'used' : (cond ? 'new' : null),
    brand: brand ? cleanText(brand) : null,
    gtin: p.gtin13 || p.gtin || p.gtin14 || p.gtin12 || p.gtin8 || first.gtin13 || null,
    mpn: p.mpn || p.model || null,
    image: image || null,
    seller: typeof seller === 'string' ? cleanText(seller) : null,
    rawOffers: offers,
  };
}

export function metaProduct($) {
  const m = (sel) => $(sel).attr('content') || null;
  return {
    title: cleanText(m('meta[property="og:title"]') || $('title').first().text()),
    price: parseBRL(m('meta[property="product:price:amount"]') || m('meta[itemprop="price"]') || $('[itemprop="price"]').first().attr('content')),
    image: m('meta[property="og:image"]'),
  };
}

/**
 * Detecta cupons/descontos exibidos na página do produto.
 * Retorna { text, pct, value, code } ou null.
 */
export function detectCoupon(text, price) {
  const t = cleanText(text);
  const pats = [
    /(?:aplicar|resgatar|ativar|use o)?\s*cupom(?: de desconto)?(?: de)?\s*(\d{1,2})\s*%/i,
    /(\d{1,2})\s*%\s*(?:off|de desconto)?\s*(?:com|no|usando o)\s*cupom/i,
    /(?:aplicar|resgatar|ativar)?\s*cupom(?: de desconto)?(?: de)?\s*R\$\s*([\d.,]+)/i,
    /R\$\s*([\d.,]+)\s*(?:off|de desconto)\s*(?:com|no|usando o)?\s*cupom/i,
    /economize\s*(\d{1,2})\s*%\s*com\s*cupom/i,
    /economize\s*R\$\s*([\d.,]+)\s*com\s*cupom/i,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (!m) continue;
    const isPct = /%/.test(m[0]);
    const n = isPct ? parseInt(m[1], 10) : parseBRL(m[1]);
    if (!n) continue;
    const codeM = t.slice(Math.max(0, m.index - 200), m.index + 300).match(/(?:c[óo]digo|cupom)\s*:?\s*([A-Z0-9]{4,20})\b/);
    const code = codeM && /[A-Z]/.test(codeM[1]) && /[A-Z0-9]{4,}/.test(codeM[1]) && codeM[1] !== 'CUPOM' ? codeM[1] : null;
    const value = isPct ? (price ? round2((price * n) / 100) : null) : n;
    if (price && value && value >= price * 0.9) continue; // absurdo
    return { text: m[0].trim().slice(0, 120), pct: isPct ? n : null, value, code };
  }
  return null;
}

export function applyCoupon(offer) {
  if (offer.price && offer.coupon?.value) offer.finalPrice = round2(offer.price - offer.coupon.value);
  else offer.finalPrice = offer.price ?? null;
  return offer;
}

/** Extração genérica completa de uma página de produto. */
export function genericExtract(html, url) {
  const $ = loadHTML(html);
  const ld = ldProduct($) || {};
  const meta = metaProduct($);
  const offer = {
    url,
    title: ld.title || meta.title,
    price: ld.price || meta.price,
    listPrice: ld.listPrice || null,
    available: ld.available ?? true,
    condition: ld.condition || null,
    brand: ld.brand || null,
    gtin: ld.gtin || null,
    mpn: ld.mpn || null,
    image: ld.image || meta.image || null,
    seller: ld.seller || null,
  };
  const bodyText = $('body').text().slice(0, 300000);
  offer.coupon = detectCoupon(bodyText, offer.price);
  return { $, offer, bodyText };
}
