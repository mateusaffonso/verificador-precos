// Lojas com proteção anti-robô forte (tentativa HTTP → navegador headless).
// Mercado Livre, Magalu, Casas Bahia, Terabyte, Pichau e Shopee.
import { fetchPage } from '../http.js';
import { genericExtract, loadHTML, detectCoupon } from './generic.js';
import { harvestCards, pickPrice } from './harvest.js';
import { parseBRL, cleanText } from '../util.js';

const slugify = (q) => q.trim().toLowerCase().replace(/\s+/g, '-');

const CONFIG = {
  mercadolivre: {
    base: 'https://www.mercadolivre.com.br',
    searchURL: (q) => `https://lista.mercadolivre.com.br/${encodeURIComponent(slugify(q))}_ITEM*CONDITION_2230284_NoIndex_True`,
    linkRe: /mercadolivre\.com\.br\/(.*\/p\/MLB\d+|MLB-\d+|.*MLB-?\d+)/i,
    canonical: (u) => u.split('#')[0].split('?')[0],
    official(text) {
      if (/loja oficial/i.test(text)) return true;
      if (/mercadol[íi]der/i.test(text)) return true;
      return null;
    },
    seller($) {
      return cleanText($('.ui-pdp-seller__header__title, .ui-seller-data-header__title, .ui-pdp-seller__link-trigger').first().text()) || null;
    },
    couponArea($) {
      return $('.ui-pdp-price__subtitles, .ui-pdp-promotions-pill-label, .ui-pdp-coupons, [class*="coupon"]').text();
    },
    cardOfficial: (text) => (/loja oficial|mercadol[íi]der/i.test(text) ? true : null),
  },
  magalu: {
    base: 'https://www.magazineluiza.com.br',
    searchURL: (q) => `https://www.magazineluiza.com.br/busca/${encodeURIComponent(q)}/`,
    linkRe: /magazineluiza\.com\.br\/.+\/p\/[a-z0-9]+\//i,
    official: (text, seller) => (/magazine ?luiza|magalu/i.test(seller || '') || /vendido (e entregue )?por:?\s*magalu/i.test(text) ? true : (seller ? false : null)),
    seller($) {
      return cleanText($('[data-testid="seller-info"] a, [data-testid="mod-sellerdetails"] label, [data-testid="seller-name"]').first().text()) || null;
    },
    couponArea($) { return $('[data-testid*="coupon"], [data-testid="price-value"], [data-testid*="promotion"]').text(); },
    cardOfficial: () => null,
  },
  casasbahia: {
    base: 'https://www.casasbahia.com.br',
    searchURL: (q) => `https://www.casasbahia.com.br/${encodeURIComponent(slugify(q))}/b`,
    linkRe: /casasbahia\.com\.br\/.+\/p\/\d+/i,
    official: (text, seller) => (/casas ?bahia/i.test(seller || '') || /vendido e entregue por\s*casas bahia/i.test(text) ? true : (seller ? false : null)),
    seller($) { return cleanText($('[data-testid="seller-name"], .seller-name, [class*="SellerName"]').first().text()) || null; },
    couponArea($) { return $('[class*="coupon"], [class*="Coupon"], [data-testid*="coupon"]').text(); },
    cardOfficial: () => null,
  },
  terabyte: {
    base: 'https://www.terabyteshop.com.br',
    searchURL: (q) => `https://www.terabyteshop.com.br/busca?str=${encodeURIComponent(q)}`,
    linkRe: /terabyteshop\.com\.br\/produto\/\d+/i,
    official: () => true, // a própria loja vende
    seller: () => 'Terabyte',
    couponArea($) { return $('[class*="cupom"], [class*="coupon"]').text(); },
    cardOfficial: () => true,
    priceSel: '#valVista, .val-prod.valVista, #prod-new-price',
  },
  pichau: {
    base: 'https://www.pichau.com.br',
    searchURL: (q) => `https://www.pichau.com.br/search?q=${encodeURIComponent(q)}`,
    linkRe: /pichau\.com\.br\/[a-z0-9-]{15,}$/i,
    official: () => true,
    seller: () => 'Pichau',
    couponArea($) { return $('[class*="cupom"], [class*="coupon"]').text(); },
    cardOfficial: () => true,
  },
  shopee: {
    base: 'https://shopee.com.br',
    searchURL: (q) => `https://shopee.com.br/search?keyword=${encodeURIComponent(q)}`,
    linkRe: /shopee\.com\.br\/.+-i\.\d+\.\d+/i,
    official: (text) => (/shopee mall|loja oficial|official store/i.test(text) ? true : null),
    seller($) { return cleanText($('[class*="shop-name"], .VlDReK, [class*="ShopName"]').first().text()) || null; },
    couponArea($) { return $('[class*="voucher"], [class*="Voucher"], [class*="cupom"]').text(); },
    cardOfficial: (text) => (/mall|oficial/i.test(text) ? true : null),
    browserOnly: true,
  },
};

export function makeStore(id) {
  const c = CONFIG[id];
  return {
    async fetchOffer(url) {
      const r = await fetchPage(url, { retries: 1, browserOnly: c.browserOnly });
      if (!r.ok) return { ok: false, blocked: r.blocked, status: r.status };
      const { $, offer, bodyText } = genericExtract(r.html, url);
      if (c.priceSel && !offer.price) offer.price = parseBRL($(c.priceSel).first().text());
      if (!offer.price) {
        // tenta meta / primeiro preço visível
        offer.price = parseBRL($('[itemprop="price"]').attr('content')) || parseBRL($('meta[property="product:price:amount"]').attr('content'));
      }
      if (!offer.price) {
        // Último recurso: preço exibido perto do título (h1) da página
        let box = $('h1').first();
        for (let i = 0; i < 5 && box.length && !/R\$\s?\d/.test(box.text()); i++) box = box.parent();
        if (box.length) offer.price = pickPrice(box.text().slice(0, 4000));
        if (!offer.title) offer.title = cleanText($('h1').first().text());
      }
      const seller = (c.seller && c.seller($)) || offer.seller || null;
      offer.seller = seller;
      offer.official = c.official(bodyText.slice(0, 60000), seller);
      const area = c.couponArea ? c.couponArea($) : '';
      offer.coupon = detectCoupon(area, offer.price) || null;
      if (/\b(usado|recondicionado|seminovo)\b/i.test(offer.title || '')) offer.condition = 'used';
      if (!offer.title || !offer.price) return { ok: false, blocked: !offer.title };
      return { ok: true, offer: { ...offer, url: c.canonical ? c.canonical(url) : url.split('?')[0] } };
    },
    async search(query) {
      const r = await fetchPage(c.searchURL(query), { retries: 1, browserOnly: c.browserOnly });
      if (!r.ok) return { ok: false, blocked: r.blocked, items: [] };
      const $ = loadHTML(r.html);
      const cards = harvestCards($, { linkRe: c.linkRe, base: c.base, canonical: c.canonical });
      // Shopee exige login para mostrar resultados a robôs
      if (!cards.length && /\/buyer\/login|login\?keyword=/.test(r.html)) return { ok: false, blocked: true, items: [], loginWall: true };
      return {
        ok: true,
        items: cards.map((x) => ({ ...x, official: c.cardOfficial(x.text), needsDetail: true })).slice(0, 20),
      };
    },
  };
}
