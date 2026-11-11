// Cupons de sites agregadores (Cuponomia, Promobit) e promoções da comunidade (Promobit, Pelando).
import { fetchHTTP, fetchPage } from './http.js';
import { loadHTML } from './stores/generic.js';
import { cleanText, parseBRL, shortHash } from './util.js';
import { STORES, storeFromName } from './stores/catalog.js';

/** Cuponomia: /desconto/<slug> */
export async function cuponomia(storeId) {
  const slug = STORES[storeId]?.cuponomia;
  if (!slug) return { ok: true, items: [] };
  const url = `https://www.cuponomia.com.br/desconto/${slug}`;
  const r = await fetchHTTP(url, { retries: 1 });
  if (!r.ok) return { ok: false, blocked: r.blocked, items: [] };
  const $ = loadHTML(r.html);
  const items = [];
  $('ul.valid-coupons > li.item, li.item[data-store-slug]').each((_, el) => {
    if ($(el).attr('data-store-slug') && $(el).attr('data-store-slug') !== slug) return;
    const title = cleanText($(el).find('.js-itemTitle, .item-title h3').first().text());
    if (!title) return;
    const code = cleanText($(el).find('.js-itemCode').first().text()) || null;
    const discount = cleanText($(el).find('.js-couponSmallText').first().text()) || null;
    const desc = cleanText($(el).find('.item-desc').first().text()) || null;
    const id = $(el).attr('data-id') || shortHash(title + code);
    items.push({ id: `cuponomia:${id}`, store: storeId, source: 'Cuponomia', title, code, discount, desc, url });
  });
  return { ok: true, items: dedupe(items).slice(0, 25) };
}

/** Promobit: __NEXT_DATA__ da página /cupons/loja/<slug>/ */
export async function promobitCoupons(storeId) {
  const slug = STORES[storeId]?.promobit;
  if (!slug) return { ok: true, items: [] };
  const url = `https://www.promobit.com.br/cupons/loja/${slug}/`;
  const r = await fetchHTTP(url, { retries: 1 });
  if (!r.ok) return { ok: false, blocked: r.blocked, items: [] };
  const m = r.html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { ok: false, items: [] };
  let list = [];
  try { list = JSON.parse(m[1]).props.pageProps.serverCoupons.coupons || []; } catch {}
  const items = list
    .filter((c) => !c.storeSlug || c.storeSlug === slug)
    .filter((c) => !c.couponUntil || new Date(c.couponUntil) > new Date())
    .map((c) => ({
      id: `promobit:${c.couponId}`,
      store: storeId,
      source: 'Promobit',
      title: cleanText(c.couponTitle),
      code: c.couponCode || null,
      discount: c.couponDiscountShort || c.couponDiscount || null,
      desc: (c.couponTag || []).join(' · ') || null,
      until: c.couponUntil || null,
      url: c.couponUrl ? `https://www.promobit.com.br${c.couponUrl}` : url,
    }));
  return { ok: true, items: items.slice(0, 25) };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => {
    const k = (i.code || '') + '|' + i.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Promoções postadas pela comunidade no Promobit (API pública da busca). */
export async function promobitDeals(query) {
  const r = await fetchHTTP(`https://api.promobit.com.br/search?q=${encodeURIComponent(query)}`, {
    json: true, retries: 1, headers: { Origin: 'https://www.promobit.com.br', Referer: 'https://www.promobit.com.br/' },
  });
  if (!r.ok) return { ok: false, blocked: r.blocked, items: [] };
  let d;
  try { d = JSON.parse(r.html); } catch { return { ok: false, items: [] }; }
  const items = (d.active_offers || []).map((o) => ({
    id: `promobit:${o.offer_id}`,
    source: 'Promobit',
    title: cleanText(o.offer_title),
    price: parseBRL(o.offer_price),
    oldPrice: parseBRL(o.offer_old_price),
    storeName: o.store_name,
    store: storeFromName(o.store_name) || o.store_param || null,
    coupon: o.offer_coupon || null,
    published: o.offer_published,
    url: `https://www.promobit.com.br/oferta/${o.offer_slug}/`,
    tags: (o.offer_tags || []).map((t) => t.name),
  }));
  return { ok: true, items };
}

/** Pelando (protegido por Cloudflare — melhor esforço com navegador). */
export async function pelandoDeals(query) {
  const url = `https://www.pelando.com.br/busca/${encodeURIComponent(query.trim().toLowerCase().replace(/\s+/g, '-'))}`;
  const r = await fetchPage(url, { retries: 0 });
  if (!r.ok) return { ok: false, blocked: true, items: [] };
  const $ = loadHTML(r.html);
  const items = [];
  $('a[href*="/d/"]').each((_, a) => {
    const href = $(a).attr('href');
    const card = $(a).closest('li, article, div');
    const text = cleanText(card.text());
    const title = cleanText($(a).text()) || cleanText($(a).attr('title'));
    const price = parseBRL((text.match(/R\$\s?[\d.]+(?:,\d{2})?/) || [])[0]);
    if (!title || title.length < 10) return;
    const full = href.startsWith('http') ? href : `https://www.pelando.com.br${href}`;
    const id = (full.match(/\/d\/([^/?#]+)/) || [])[1] || shortHash(full);
    if (items.some((i) => i.id === `pelando:${id}`)) return;
    items.push({ id: `pelando:${id}`, source: 'Pelando', title, price, url: full, storeName: null, store: null, coupon: null, published: null });
  });
  return { ok: true, items: items.slice(0, 20) };
}
