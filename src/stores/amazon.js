// Amazon Brasil: página do produto (/dp/ASIN) + busca.
import { fetchPage } from '../http.js';
import { loadHTML, ldProduct, detectCoupon } from './generic.js';
import { harvestCards } from './harvest.js';
import { parseBRL, cleanText } from '../util.js';

const BASE = 'https://www.amazon.com.br';

export function asinFrom(url) {
  const m = String(url).match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})/i) || String(url).match(/[?&]asin=([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

export function canonical(url) {
  const a = asinFrom(url);
  return a ? `${BASE}/dp/${a}` : url.split('?')[0];
}

export function parseProduct(html, url) {
  const $ = loadHTML(html);
  const txt = (sel) => cleanText($(sel).first().text());
  const title = txt('#productTitle') || ldProduct($)?.title || cleanText($('title').text()).replace(/\s*\|\s*Amazon.*$/i, '');
  const priceSel = [
    '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#corePrice_feature_div .a-price .a-offscreen',
    '#apex_desktop .apexPriceToPay .a-offscreen',
    '#apex_offerDisplay_desktop .a-price .a-offscreen',
    '#tp_price_block_total_price_ww .a-offscreen',
    '#price_inside_buybox', '#priceblock_ourprice', '#priceblock_dealprice',
    '#corePrice_mobile_feature_div .a-offscreen',
  ];
  let price = null;
  for (const s of priceSel) { price = parseBRL($(s).first().text()); if (price) break; }
  const listPrice = parseBRL($('#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen, .a-price.a-text-price .a-offscreen').first().text());
  const sellerTxt = cleanText(
    $('[offer-display-feature-name="desktop-merchant-info"] .offer-display-feature-text').first().text() ||
    $('#merchantInfoFeature_feature_div .offer-display-feature-text').first().text() ||
    $('#sellerProfileTriggerId').first().text() ||
    $('#merchant-info').first().text() ||
    $('.offer-display-features').first().text(),
  );
  const seller = sellerTxt.replace(/^(Enviado \/ Vendido|Vendido por|Vendedor)\s*/i, '').slice(0, 80) || null;
  const official = seller ? /amazon/i.test(seller) : null;
  const availTxt = txt('#availability') + ' ' + txt('#outOfStock');
  const available = !/não disponível|indisponível|currently unavailable/i.test(availTxt) && !!price;
  const couponArea = [
    '#promoPriceBlockMessage_feature_div', '#couponBadgeRegularVpc', '#vpcButton', '[id^="couponText"]',
    '#applicablePromotionList_feature_div', '#instantCouponBadge_feature_div', '.couponLabelText',
  ].map((s) => $(s).text()).join(' ');
  let coupon = detectCoupon(couponArea, price);
  const promoInfo = cleanText(couponArea).replace(/Termos.*$/i, '').slice(0, 160) || null;
  const byline = txt('#bylineInfo');
  const brand = (byline.match(/Marca:\s*(.+)$/i) || byline.match(/Visite a loja (.+)$/i) || [])[1] || ldProduct($)?.brand || null;
  // Detalhes técnicos (modelo / EAN)
  let gtin = null, mpn = null;
  $('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #detailBullets_feature_div li').each((_, el) => {
    const t = cleanText($(el).text());
    if (!gtin) gtin = (t.match(/\b(?:EAN|GTIN)\b\D{0,5}(\d{8,14})/i) || [])[1] || null;
    if (!mpn) mpn = (t.match(/N[úu]mero do modelo\D{0,3}([\w-]{3,30})/i) || [])[1] || null;
  });
  const condition = /usado|recondicionado|renovado/i.test(title) ? 'used' : 'new';
  const image = $('#landingImage').attr('data-old-hires') || $('#landingImage').attr('src') || $('#imgTagWrapperId img').attr('src') || null;
  return {
    url: canonical(url), title, price, listPrice: listPrice && listPrice > (price || 0) ? listPrice : null,
    seller, official, available, coupon, promoInfo: coupon ? null : promoInfo, brand: brand ? cleanText(brand) : null,
    gtin, mpn, condition, image,
  };
}

export async function fetchOffer(url) {
  const u = canonical(url);
  const r = await fetchPage(u, { retries: 3 });
  if (!r.ok) return { ok: false, blocked: r.blocked, status: r.status };
  const offer = parseProduct(r.html, u);
  if (!offer.title) return { ok: false, blocked: true };
  return { ok: true, offer, via: r.via || 'http' };
}

export async function search(query) {
  const url = `${BASE}/s?k=${encodeURIComponent(query)}`;
  const r = await fetchPage(url, { retries: 2 });
  if (!r.ok) return { ok: false, blocked: r.blocked, items: [] };
  const $ = loadHTML(r.html);
  const items = [];
  $('div[data-component-type="s-search-result"][data-asin]').each((_, el) => {
    const asin = $(el).attr('data-asin');
    if (!asin) return;
    if ($(el).find('.puis-sponsored-label-text, .s-sponsored-label-info-icon').length) return; // patrocinado
    const title = cleanText($(el).find('h2').first().text()) || cleanText($(el).find('[data-cy="title-recipe"]').text());
    const price = parseBRL($(el).find('.a-price:not(.a-text-price) .a-offscreen').first().text());
    if (!title || !price) return;
    items.push({ url: `${BASE}/dp/${asin}`, title, price, image: $(el).find('img.s-image').attr('src') || null });
  });
  if (!items.length) {
    items.push(...harvestCards($, { linkRe: /amazon\.com\.br\/.*\/dp\/[A-Z0-9]{10}/i, base: BASE, canonical }));
  }
  return { ok: true, items: items.slice(0, 20).map((x) => ({ ...x, official: null, needsDetail: true })) };
}
