// AliExpress: a busca vem com JSON embutido (preço em BRL via cookie de região).
import { fetchHTTP, fetchBrowser } from '../http.js';
import { loadHTML, metaProduct } from './generic.js';
import { parseBRL, cleanText, extractBalancedJSON } from '../util.js';

const BASE = 'https://pt.aliexpress.com';
const COOKIE = 'aep_usuc_f=site=bra&c_tp=BRL&region=BR&b_locale=pt_BR; intl_locale=pt_BR; xman_us_f=x_locale=pt_BR&x_l=0';
const searchCache = new Map();

export function idFrom(url) {
  return (String(url).match(/\/item\/(\d+)\.html/) || String(url).match(/productId=(\d+)/) || [])[1] || null;
}

function parseItems(html) {
  const key = '"itemList":{"content":';
  const i = html.indexOf(key);
  if (i < 0) return [];
  const arr = extractBalancedJSON(html, i + key.length) || [];
  return arr.map((it) => {
    const sp = (it.sellingPoints || []).map((s) => s.source || '');
    const prices = it.prices || {};
    const sale = prices.salePrice || {};
    const price = sale.currencyCode === 'BRL' || /R\$/.test(sale.formattedPrice || '') ? parseBRL(sale.minPrice ?? sale.formattedPrice) : null;
    let shipFrom = null;
    try { shipFrom = JSON.parse(decodeURIComponent(it.trace?.pdpParams?.pdp_cdi || '')).shipFrom || null; } catch {}
    const choice = sp.some((s) => /choice/i.test(s));
    const brandPlus = sp.some((s) => /brand_plus|official/i.test(s));
    return {
      url: `${BASE}/item/${it.productId}.html`,
      id: String(it.productId),
      title: cleanText(it.title?.displayTitle),
      price,
      listPrice: parseBRL(prices.originalPrice?.minPrice),
      official: choice || brandPlus,
      seller: choice ? 'AliExpress Choice' : brandPlus ? 'Loja oficial da marca' : 'Vendedor AliExpress',
      international: shipFrom ? shipFrom !== 'BR' : true,
      shipFrom,
      image: it.image?.imgUrl ? 'https:' + it.image.imgUrl : null,
      condition: 'new',
      available: true,
      promoInfo: sp.includes('lowest_price_90_atm') ? 'Menor preço em 90 dias' : null,
    };
  }).filter((x) => x.title && x.price);
}

export async function search(query) {
  if (searchCache.has(query)) return searchCache.get(query);
  const slug = query.trim().replace(/\s+/g, '-');
  const p = (async () => {
    const r = await fetchHTTP(`${BASE}/w/wholesale-${encodeURIComponent(slug)}.html?SearchText=${encodeURIComponent(query)}`, { retries: 2, cookie: COOKIE });
    if (!r.ok) return { ok: false, blocked: r.blocked, items: [] };
    const items = parseItems(r.html).map((x) => ({ ...x, source: { type: 'alisearch', query, id: x.id } }));
    return { ok: true, items: items.slice(0, 30) };
  })();
  searchCache.set(query, p);
  return p;
}

/** Atualiza via mesma busca (1 requisição serve vários produtos). */
export async function refresh(offer) {
  const src = offer.source || {};
  if (src.type === 'alisearch') {
    const r = await search(src.query);
    if (!r.ok) return { ok: false, blocked: r.blocked };
    const it = r.items.find((x) => x.id === src.id);
    if (it) return { ok: true, offer: { price: it.price, listPrice: it.listPrice, available: true } };
  }
  return fetchOffer(offer.url);
}

/** Página do item (renderizada em JS → precisa do navegador). */
export async function fetchOffer(url) {
  const id = idFrom(url);
  const u = id ? `${BASE}/item/${id}.html` : url;
  const r = await fetchBrowser(u, {
    cookies: [
      { name: 'aep_usuc_f', value: 'site=bra&c_tp=BRL&region=BR&b_locale=pt_BR', domain: '.aliexpress.com', path: '/' },
    ],
    waitFor: '[class*="price"]',
  });
  if (!r.ok) return { ok: false, blocked: r.blocked };
  const $ = loadHTML(r.html);
  const meta = metaProduct($);
  const priceTxt = $('[class*="price-default--current"], [class*="price--current"], [class*="product-price-current"]').first().text();
  const price = parseBRL(priceTxt) || parseBRL((r.html.match(/R\$\s?\d{1,3}(?:\.\d{3})*,\d{2}/) || [])[0]);
  const title = cleanText($('h1').first().text()) || meta.title?.replace(/\s*-\s*AliExpress.*$/i, '');
  const choice = /choice/i.test($('[class*="choice"], [class*="Choice"]').first().text() || '');
  return {
    ok: !!title,
    offer: { url: u, title, price, image: meta.image, official: choice || null, international: true, condition: 'new', available: !!price },
  };
}

export function resetCache() { searchCache.clear(); }
