// KaBuM!: dados estruturados no __NEXT_DATA__ (busca e produto).
import { fetchPage } from '../http.js';
import { loadHTML, ldProduct, detectCoupon } from './generic.js';
import { parseBRL, cleanText } from '../util.js';

const BASE = 'https://www.kabum.com.br';

function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
const maybeJSON = (v) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

export function codeFrom(url) {
  return (String(url).match(/\/produto\/(\d+)/) || [])[1] || null;
}

function kabumOfficial(p) {
  const f = p.flags || {};
  if (f.isMarketplace || f.isMarketPlaceProduct || f.isMarketplaceProduct) return false;
  return /kabum/i.test(p.sellerName || 'KaBuM!');
}

export function parseProduct(html, url) {
  const nd = nextData(html);
  const p = maybeJSON(nd?.props?.pageProps?.product);
  if (p && (p.title || p.name)) {
    const prices = p.prices || {};
    const pix = parseBRL(prices.priceWithDiscount) || parseBRL(p.priceWithDiscount);
    const card = parseBRL(prices.price) || parseBRL(p.price);
    const offerTxt = p.offer?.campaignName ? `Oferta ${p.offer.campaignName} (-${p.offer.discount || '?'}%)` : null;
    const code = p.id || p.code || codeFrom(url);
    return {
      url: `${BASE}/produto/${code}`,
      title: cleanText(p.title || p.name),
      price: pix || card,
      listPrice: parseBRL(prices.oldPrice) || null,
      cardPrice: card,
      priceNote: pix ? 'no PIX' : null,
      seller: p.sellerName || 'KaBuM!',
      official: kabumOfficial(p),
      available: p.available !== false && (p.flags?.isAvailable ?? true),
      condition: p.flags?.isOpenbox ? 'used' : 'new',
      brand: p.manufacturer?.name || null,
      image: p.thumbnail || p.medias?.[0]?.url || null,
      coupon: detectCoupon(JSON.stringify(p.promotionBanner || '') + ' ' + JSON.stringify(p.campaignBanners || ''), pix || card),
      promoInfo: offerTxt,
    };
  }
  // Fallback: JSON-LD
  const ld = ldProduct(loadHTML(html));
  if (!ld) return null;
  return { url: url.split('?')[0], title: ld.title, price: ld.price, available: ld.available, seller: 'KaBuM!', official: null, brand: ld.brand, image: ld.image, condition: ld.condition, gtin: ld.gtin };
}

export async function fetchOffer(url) {
  const code = codeFrom(url);
  const u = code ? `${BASE}/produto/${code}` : url;
  const r = await fetchPage(u, { retries: 2 });
  if (!r.ok) return { ok: false, blocked: r.blocked, status: r.status };
  const offer = parseProduct(r.html, u);
  if (!offer?.title) return { ok: false };
  return { ok: true, offer };
}

export async function search(query) {
  const slug = query.trim().toLowerCase().replace(/\s+/g, '-');
  const r = await fetchPage(`${BASE}/busca/${encodeURIComponent(slug)}`, { retries: 2 });
  if (!r.ok) return { ok: false, blocked: r.blocked, items: [] };
  const nd = nextData(r.html);
  const data = maybeJSON(nd?.props?.pageProps?.data);
  const list = data?.catalogServer?.data || [];
  const items = list.map((p) => ({
    url: `${BASE}/produto/${p.code}`,
    title: cleanText(p.name),
    price: parseBRL(p.priceWithDiscount) || parseBRL(p.price),
    listPrice: parseBRL(p.oldPrice),
    seller: p.sellerName,
    official: kabumOfficial(p),
    available: p.available !== false,
    condition: p.flags?.isOpenbox ? 'used' : 'new',
    brand: p.manufacturer?.name || null,
    image: p.image || null,
  })).filter((x) => x.price && x.title);
  return { ok: true, items: items.slice(0, 30) };
}
