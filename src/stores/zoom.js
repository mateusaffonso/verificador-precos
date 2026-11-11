// Zoom (comparador): busca o produto e traz ofertas de várias lojas de uma vez.
// É a fonte principal para lojas que bloqueiam servidores (Magalu, Casas Bahia, Mercado Livre…).
import { fetchHTTP } from '../http.js';
import { loadHTML, jsonLD } from './generic.js';
import { parseBRL, cleanText, decodeEntities } from '../util.js';
import { storeFromName, MARKETPLACES } from './catalog.js';

const BASE = 'https://www.zoom.com.br';
const pageCache = new Map(); // cache por execução

async function getPage(url) {
  if (pageCache.has(url)) return pageCache.get(url);
  const p = fetchHTTP(url, { retries: 2 });
  pageCache.set(url, p);
  return p;
}

function leadURL(oid) {
  return `${BASE}/lead?oid=${oid}`;
}

function offerFromZoom({ oid, store, title, price, page, image, viaSearch, query }) {
  const storeId = storeFromName(store);
  return {
    store: storeId || 'outra',
    storeName: store,
    url: leadURL(oid),
    title,
    price,
    image: image || null,
    // Ofertas listadas pelo Zoom vêm de lojas parceiras; em marketplaces o vendedor é incerto
    seller: store,
    official: storeId && MARKETPLACES.has(storeId) ? null : true,
    condition: null,
    available: true,
    via: 'zoom',
    source: viaSearch ? { type: 'zoomsearch', query, oid: String(oid) } : { type: 'zoom', page, oid: String(oid) },
  };
}

/** Lê as ofertas de uma página de produto do Zoom (JSON-LD AggregateOffer). */
export function parseProductPage(html, pageUrl) {
  const $ = loadHTML(html);
  const nodes = jsonLD($).filter((n) => n['@type'] === 'Product');
  const out = [];
  let meta = null;
  for (const p of nodes) {
    meta = {
      title: cleanText(p.name),
      brand: p.brand?.name || p.brand || null,
      gtin: p.gtin13 || p.gtin || null,
      model: p.model || null,
      image: Array.isArray(p.image) ? p.image[0] : p.image,
    };
    const offers = p.offers?.offers || (Array.isArray(p.offers) ? p.offers : []);
    for (const o of offers) {
      if (!o.id || !o.price) continue;
      out.push(offerFromZoom({
        oid: o.id, store: o.offeredBy?.name || o.offeredBy || 'Loja', title: cleanText(o.name) || meta.title,
        price: parseBRL(o.price), page: pageUrl, image: o.image,
      }));
    }
  }
  // Complementa com os cards de oferta do HTML (às vezes o JSON-LD traz só parte)
  $('[data-testid="offer-card-wrapper"]').each((_, el) => {
    const id = ($(el).attr('id') || '').replace('offer-card-', '');
    if (!id || out.some((o) => o.source.oid === id)) return;
    const store = $(el).find('[data-testid="offer-merchant"]').attr('title')?.replace(/^Ir para /, '');
    const priceTxt = $(el).find('[data-testid="offer-price"], [class*="OfferPrice"]').first().text() || $(el).text();
    const price = parseBRL((priceTxt.match(/R\$\s?[\d.]+,\d{2}/) || [])[0]);
    const title = $(el).find('[title]').filter((_, t) => ($(t).attr('title') || '').length > 15).first().attr('title');
    if (store && price) out.push(offerFromZoom({ oid: id, store, title: cleanText(title || meta?.title), price, page: pageUrl }));
  });
  return { meta, offers: out };
}

/** Busca no Zoom: retorna candidatos (ofertas) de várias lojas. */
export async function search(query, { maxPages = 3 } = {}) {
  const url = `${BASE}/search?q=${encodeURIComponent(query)}`;
  const r = await getPage(url);
  if (!r.ok) return { ok: false, blocked: r.blocked, items: [] };
  const $ = loadHTML(r.html);
  const items = [];
  const productPages = [];
  $('article[data-testid="product-card"]').each((_, el) => {
    const a = $(el).find('a[data-testid="product-card::card"]').first();
    const href = decodeEntities(a.attr('href') || '');
    const name = cleanText($(el).find('[data-testid="product-card::name"]').text());
    const price = parseBRL($(el).find('[data-testid="product-card::price"]').text());
    const merchant = cleanText($(el).find('[data-area="merchant"]').text());
    if (href.includes('/lead?')) {
      const oid = (href.match(/oid=(\d+)/) || [])[1];
      if (oid && price) items.push(offerFromZoom({ oid, store: merchant || 'Loja', title: name, price, viaSearch: true, query, image: $(el).find('img').attr('src') }));
    } else if (href.startsWith('/')) {
      productPages.push({ url: BASE + href.split('?')[0], name, price });
    }
  });
  return { ok: true, items, productPages: productPages.slice(0, maxPages) };
}

export async function fetchProductOffers(pageUrl) {
  const r = await getPage(pageUrl);
  if (!r.ok) return { ok: false, blocked: r.blocked, offers: [] };
  return { ok: true, ...parseProductPage(r.html, pageUrl) };
}

/** Atualiza uma oferta conhecida (relendo a página/busca do Zoom, com cache por execução). */
export async function refresh(offer) {
  const src = offer.source || {};
  if (src.type === 'zoom') {
    const r = await fetchProductOffers(src.page);
    if (!r.ok) return { ok: false, blocked: r.blocked };
    const o = r.offers.find((x) => x.source.oid === src.oid);
    if (!o) return { ok: true, offer: { available: false } };
    return { ok: true, offer: { price: o.price, title: o.title, available: true } };
  }
  if (src.type === 'zoomsearch') {
    const r = await search(src.query, { maxPages: 0 });
    if (!r.ok) return { ok: false, blocked: r.blocked };
    const o = r.items.find((x) => x.source.oid === src.oid);
    // Fora da 1ª página da busca não significa indisponível: mantém o último preço
    if (!o) return { ok: false, notFound: true };
    return { ok: true, offer: { price: o.price, title: o.title, available: true } };
  }
  return { ok: false };
}

export function resetCache() {
  pageCache.clear();
}
