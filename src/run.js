// Orquestrador: identifica produtos, busca em todas as lojas, atualiza preços, cupons, alertas e e-mail.
import { ADAPTERS, zoom, storeFromURL, storeLabel, STORES } from './stores/index.js';
import { MARKETPLACES } from './stores/catalog.js';
import { applyCoupon } from './stores/generic.js';
import { compare, analyze, buildQuery, guessBrand, AUTO_THRESHOLD, PENDING_THRESHOLD } from './match.js';
import { cuponomia, promobitCoupons, promobitDeals, pelandoDeals } from './coupons.js';
import { loadProducts, loadState, saveState, loadHistory, saveHistory, appendHistory, removeHistory } from './storage.js';
import { buildDigest, sendDigest } from './email.js';
import { closeBrowser, stats } from './http.js';
import { log, shortHash, mapLimit, minutesSince, nowISO, round2, cleanText } from './util.js';

const DISCOVERY_MINUTES = Number(process.env.DISCOVERY_MINUTES || 30);
const FORCE_DISCOVERY = /^(1|true|yes)$/i.test(process.env.FORCE_DISCOVERY || '');
const MAX_RUN_MS = Number(process.env.MAX_RUN_SECONDS || 260) * 1000;
const DRY_RUN = /^(1|true)$/i.test(process.env.DRY_RUN || '');
const DEFAULT_RULES = { target: true, lowest: true, dropPct: 5, anyDrop: false };
const START = Date.now();
const timeLeft = () => MAX_RUN_MS - (Date.now() - START);
const errors = [];

const offerKey = (url) => shortHash(String(url).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
const ACTIVE = new Set(['origin', 'auto', 'approved']);

// ---------------- Saúde das lojas (evita insistir em loja bloqueada) ----------------
function health(state, store, ok, blocked) {
  const h = (state.storeHealth[store] ||= { ok: 0, blocked: 0 });
  if (ok) { h.lastOk = nowISO(); h.streak = 0; h.ok++; h.status = 'ok'; }
  else if (blocked) { h.lastBlocked = nowISO(); h.streak = (h.streak || 0) + 1; h.blocked++; h.status = 'bloqueado'; }
}
function coolingDown(state, store) {
  const h = state.storeHealth[store];
  // após 3 bloqueios seguidos, espera 1h antes de tentar de novo a busca nessa loja
  return h && h.streak >= 3 && minutesSince(h.lastBlocked) < 60 && minutesSince(h.lastTry) < 60;
}

// ---------------- Identidade do produto ----------------
function titleFromURL(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean).filter((s) => /[a-z].*-.*[a-z]/i.test(s) && !/^(dp|p|produto|item)$/i.test(s));
    const best = segs.sort((a, b) => b.length - a.length)[0] || '';
    return decodeURIComponent(best).replace(/-MLB-?\d+.*$/i, '').replace(/-i\.\d+\.\d+.*$/i, '').replace(/[-_]+/g, ' ').trim();
  } catch { return ''; }
}

async function resolveIdentity(product, ps) {
  const id = { title: product.name || '', query: product.query || null, brand: null, gtin: null, image: null, refPrice: null };
  if (product.url) {
    const store = storeFromURL(product.url);
    const adapter = store && ADAPTERS[store];
    let r = null;
    if (adapter?.fetchOffer) {
      r = await adapter.fetchOffer(product.url).catch((e) => ({ ok: false, error: e.message }));
      health(ps.__state, store, r.ok, r.blocked);
    }
    if (r?.ok && r.offer?.title) {
      const o = r.offer;
      Object.assign(id, {
        title: product.name || o.title, brand: o.brand || null, gtin: o.gtin || null, image: o.image || null,
        refPrice: o.price || null, store, url: product.url, mpn: o.mpn || null,
      });
      // a própria oferta do link do usuário é sempre monitorada
      const offer = normalizeOffer({ ...o, store, storeName: storeLabel(store), via: store }, 'origin', 1, ['link informado por você']);
      upsertOffer(ps, offer, product, true);
    } else {
      // não consegui ler a página: uso o nome informado ou o texto da URL
      if (!id.title) id.title = titleFromURL(product.url);
      id.store = store;
      id.url = product.url;
      ps.identityNote = `Não consegui ler a página da loja (${r?.blocked ? 'bloqueio anti-robô' : 'erro'}); usando ${product.name ? 'o nome informado' : 'o texto do link'} para buscar.`;
      if (store) {
        const placeholder = normalizeOffer({
          url: product.url, title: id.title, store, storeName: storeLabel(store), price: null, available: null, via: store,
        }, 'origin', 1, ['link informado por você']);
        placeholder.status = 'bloqueado';
        upsertOffer(ps, placeholder, product, true);
      }
    }
  }
  if (!id.title) throw new Error('Produto sem link nem nome');
  id.brand = id.brand || guessBrand(id.title);
  ps.identity = id;
  ps.identityAt = nowISO();
}

// ---------------- Ofertas ----------------
function normalizeOffer(o, status, score, reasons) {
  const offer = {
    key: offerKey(o.url),
    store: o.store || 'outra',
    storeName: o.storeName || storeLabel(o.store),
    url: o.url,
    title: o.title,
    price: o.price ?? null,
    listPrice: o.listPrice ?? null,
    cardPrice: o.cardPrice ?? null,
    priceNote: o.priceNote ?? null,
    coupon: o.coupon || null,
    promoInfo: o.promoInfo || null,
    seller: o.seller || null,
    official: o.official ?? null,
    international: o.international ?? (o.store === 'aliexpress' ? true : null),
    condition: o.condition || null,
    available: o.available ?? true,
    image: o.image || null,
    via: o.via || o.store,
    source: o.source || null,
    match: { status, score, reasons: reasons || [] },
  };
  applyCoupon(offer);
  return offer;
}

function upsertOffer(ps, offer, product, fresh) {
  const prev = ps.offers[offer.key];
  const overrideStatus = product.approve?.includes(offer.key) ? 'approved' : product.reject?.includes(offer.key) ? 'rejected' : null;
  if (prev) {
    const keepStatus = ['approved', 'rejected', 'origin'].includes(prev.match.status) ? prev.match.status : offer.match.status;
    const prevMatch = prev.match;
    // Só sobrescreve campos que vieram preenchidos (resultados de busca trazem menos detalhes)
    for (const [k, v] of Object.entries(offer)) {
      if (k === 'match' || v == null) continue;
      if (!fresh && ['price', 'finalPrice', 'coupon', 'available'].includes(k)) continue;
      prev[k] = v;
    }
    if (fresh) { prev.coupon = offer.coupon || null; prev.finalPrice = offer.finalPrice; }
    prev.match = prevMatch.status === 'origin' ? prevMatch : { ...offer.match, status: overrideStatus || keepStatus };
    if (fresh) markChecked(prev, offer);
    return prev;
  }
  offer.firstSeen = nowISO();
  if (overrideStatus) offer.match.status = overrideStatus;
  if (fresh) markChecked(offer, offer);
  ps.offers[offer.key] = offer;
  return offer;
}

function markChecked(target, fresh) {
  target.lastChecked = nowISO();
  if (fresh.price != null) {
    target.status = fresh.available === false ? 'indisponível' : 'ok';
    target.lastOk = nowISO();
  }
  target.checkedThisRun = true;
}

/** Classifica um candidato encontrado numa busca. */
function classify(identity, cand) {
  const cmp = compare(identity, cand);
  if (cmp.reject || cmp.score < PENDING_THRESHOLD) return null;
  if (cand.condition === 'used') return null;
  if (cand.official === false) return null; // vendedor terceiro: fora da regra "só lojas oficiais/confiáveis"
  let status = cmp.score >= AUTO_THRESHOLD ? 'auto' : 'pending';
  const reasons = [...cmp.reasons];
  if (status === 'auto' && cand.official == null) {
    status = 'pending';
    reasons.push(MARKETPLACES.has(cand.store) ? 'confirme se o vendedor é oficial' : 'vendedor não identificado');
  }
  return { status, score: cmp.score, reasons };
}

// ---------------- Busca ampla ----------------
async function discover(product, ps, state) {
  delete ps.identity.analysis;
  const identity = { ...ps.identity, analysis: analyze(ps.identity.title, ps.identity) }; // cópia (analysis tem Sets, não vai pro JSON)
  const query = buildQuery(identity);
  ps.lastQuery = query;
  log(`  busca ampla: "${query}"`);
  const found = [];

  // 1) Zoom: comparador com várias lojas
  try {
    const z = await zoom.search(query);
    health(state, 'zoom', z.ok, z.blocked);
    if (z.ok) {
      found.push(...z.items);
      const pages = z.productPages
        .map((p) => ({ ...p, cmp: compare(identity, { title: p.name, price: p.price }) }))
        .filter((p) => !p.cmp.reject && p.cmp.score >= PENDING_THRESHOLD)
        .sort((a, b) => b.cmp.score - a.cmp.score)
        .slice(0, 2);
      for (const p of pages) {
        const r = await zoom.fetchProductOffers(p.url);
        if (r.ok) found.push(...r.offers);
      }
    }
  } catch (e) { errors.push(`zoom: ${e.message}`); }

  // 2) Busca direta em cada loja
  const storeIds = Object.keys(ADAPTERS).filter((s) => ADAPTERS[s].search);
  const results = await mapLimit(storeIds, 3, async (s) => {
    if (timeLeft() < 60000) return null;
    if (coolingDown(state, s)) return { store: s, skipped: true };
    (state.storeHealth[s] ||= {}).lastTry = nowISO();
    const r = await ADAPTERS[s].search(query).catch((e) => ({ ok: false, error: e.message, items: [] }));
    health(state, s, r.ok && r.items.length > 0, r.blocked);
    return { store: s, ...r };
  });
  const searchReport = {};
  for (const r of results) {
    if (!r || r.error instanceof Error) continue;
    searchReport[r.store] = r.skipped ? 'pulada (bloqueio recente)' : r.ok ? `${r.items.length} resultados` : r.blocked ? 'bloqueada' : 'erro';
    if (r.ok) found.push(...r.items.map((it) => ({ ...it, store: it.store || r.store, storeName: storeLabel(r.store), via: r.store })));
  }
  ps.searchReport = searchReport;

  // 3) Classifica; busca detalhes (vendedor/cupom) dos melhores candidatos sem essas informações
  if (!identity.refPrice) {
    // Sem preço de referência (link bloqueado): usa a mediana dos candidatos mais parecidos
    const good = found.map((c) => ({ c, s: compare(identity, c) })).filter((x) => !x.s.reject && x.s.score >= AUTO_THRESHOLD && x.c.price).map((x) => x.c.price).sort((a, b) => a - b);
    if (good.length >= 2) identity.refPrice = ps.identity.refPrice = good[Math.floor(good.length / 2)];
  }
  const classified = [];
  for (const c of found) {
    const cls = classify(identity, c);
    if (cls) classified.push({ c, cls });
  }
  classified.sort((a, b) => b.cls.score - a.cls.score || (a.c.price || 1e12) - (b.c.price || 1e12));
  const perStore = {};
  const final = [];
  for (const it of classified) {
    const k = it.c.store + (it.c.via === 'zoom' ? ':zoom' : '');
    perStore[k] = (perStore[k] || 0) + 1;
    if (perStore[k] > 3) continue;
    final.push(it);
  }
  await mapLimit(final.filter((x) => x.c.needsDetail).slice(0, 6), 3, async (it) => {
    if (timeLeft() < 50000) return;
    const ad = ADAPTERS[it.c.store];
    if (!ad?.fetchOffer) return;
    const r = await ad.fetchOffer(it.c.url).catch(() => null);
    if (r?.ok) {
      Object.assign(it.c, Object.fromEntries(Object.entries(r.offer).filter(([, v]) => v != null)));
      it.c.needsDetail = false;
      const cls = classify(identity, it.c);
      it.cls = cls || { status: 'drop' };
      it.fresh = true;
    }
  });
  let added = 0;
  for (const it of final) {
    if (it.cls.status === 'drop') continue;
    const offer = normalizeOffer(it.c, it.cls.status, it.cls.score, it.cls.reasons);
    const isNew = !ps.offers[offer.key];
    upsertOffer(ps, offer, product, it.fresh || it.c.via === 'zoom' || it.c.store === 'aliexpress');
    if (isNew) added++;
  }
  // Limita a lista: mantém ativas + 15 melhores pendentes
  const pend = Object.values(ps.offers).filter((o) => o.match.status === 'pending').sort((a, b) => b.match.score - a.match.score);
  for (const o of pend.slice(15)) delete ps.offers[o.key];
  // Link original ilegível: usa o anúncio mais parecido para nome/foto exibidos
  if (ps.identityNote && !product.name) {
    const top = Object.values(ps.offers).filter((o) => o.match.status === 'auto').sort((a, b) => b.match.score - a.match.score)[0];
    if (top) { ps.identity.displayTitle = top.title; ps.identity.image = ps.identity.image || top.image; }
  }
  ps.lastDiscovery = nowISO();
  log(`  ${found.length} candidatos → ${final.length} compatíveis (${added} novos)`);
}

// ---------------- Atualização de preços ----------------
async function refreshOffer(o) {
  const src = o.source?.type;
  if (src === 'zoom' || src === 'zoomsearch') return zoom.refresh(o);
  if (o.store === 'aliexpress' && ADAPTERS.aliexpress.refresh) return ADAPTERS.aliexpress.refresh(o);
  const ad = ADAPTERS[o.store];
  if (!ad?.fetchOffer) return { ok: false };
  return ad.fetchOffer(o.url);
}

async function refreshProduct(ps, state) {
  const list = Object.values(ps.offers).filter((o) => ACTIVE.has(o.match.status) && !o.checkedThisRun);
  await mapLimit(list, 4, async (o) => {
    if (timeLeft() < 25000) return;
    const r = await refreshOffer(o).catch((e) => ({ ok: false, error: e.message }));
    if (!o.source) health(state, o.store, r.ok, r.blocked);
    o.lastChecked = nowISO();
    if (r.ok && r.offer) {
      const f = r.offer;
      if (f.price != null) o.price = f.price;
      if (f.listPrice !== undefined) o.listPrice = f.listPrice;
      if (f.cardPrice !== undefined) o.cardPrice = f.cardPrice;
      if (f.coupon !== undefined) o.coupon = f.coupon || null;
      if (f.promoInfo !== undefined) o.promoInfo = f.promoInfo || null;
      if (f.seller) o.seller = f.seller;
      if (f.official != null && o.match.status !== 'origin') o.official = f.official;
      if (f.image && !o.image) o.image = f.image;
      o.available = f.available !== false;
      applyCoupon(o);
      o.status = o.available ? 'ok' : 'indisponível';
      if (f.price != null) o.lastOk = nowISO();
    } else if (r.notFound) {
      o.status = 'não encontrado nesta checagem';
    } else {
      o.status = r.blocked ? 'bloqueado' : 'erro';
    }
  });
}

// ---------------- Alertas ----------------
function evaluateAlerts(product, ps, history) {
  const rules = { ...DEFAULT_RULES, ...(product.rules || {}) };
  const alerts = new Map();
  const add = (o, reason, extra = {}) => {
    const a = alerts.get(o.key) || {
      productId: product.id, productTitle: ps.identity.title, storeName: o.storeName, seller: o.seller, url: o.url,
      finalPrice: o.finalPrice, prevFinal: o.prevFinal ?? null, coupon: o.coupon, image: o.image || ps.identity.image,
      targetPrice: product.targetPrice || null, reasons: [],
    };
    if (!a.reasons.includes(reason)) a.reasons.push(reason);
    Object.assign(a, extra);
    alerts.set(o.key, a);
  };

  const live = Object.values(ps.offers).filter((o) => ACTIVE.has(o.match.status) && o.status === 'ok' && o.available !== false && o.finalPrice);
  for (const o of live) {
    const prev = o.prevFinal;
    if (prev && o.finalPrice < prev) {
      const pct = ((prev - o.finalPrice) / prev) * 100;
      const warning = pct >= 60 ? `Queda de ${pct.toFixed(0)}% — pode ser erro de preço; confira rápido.` : null;
      if (rules.anyDrop) add(o, 'anyDrop', warning ? { warning } : {});
      if (rules.dropPct && pct >= rules.dropPct) add(o, 'dropPct', warning ? { warning } : {});
    }
  }
  const best = live.sort((a, b) => a.finalPrice - b.finalPrice)[0];
  ps.best = best ? { price: best.finalPrice, key: best.key, store: best.storeName, at: nowISO() } : null;
  ps.notified ||= {};
  if (best) {
    // Preço-alvo
    if (rules.target && product.targetPrice) {
      if (best.finalPrice <= product.targetPrice) {
        if (ps.notified.target == null || best.finalPrice < ps.notified.target) {
          add(best, 'target');
          ps.notified.target = best.finalPrice;
        }
      } else if (ps.notified.target != null && best.finalPrice > product.targetPrice) {
        ps.notified.target = null; // voltou a subir: avisa de novo na próxima vez que atingir
      }
    }
    // Menor preço já visto
    if (ps.lowest?.price && best.finalPrice < ps.lowest.price - 0.009) {
      if (rules.lowest) add(best, 'lowest', { prevLowest: ps.lowest.price });
    }
    if (!ps.lowest || best.finalPrice < ps.lowest.price) {
      ps.lowest = { price: best.finalPrice, at: nowISO(), store: best.storeName, key: best.key };
    }
  }
  // Atualiza preço anterior para a próxima comparação + histórico
  for (const o of Object.values(ps.offers)) {
    if (o.finalPrice != null && o.status === 'ok') {
      appendHistory(history, o.key, o.finalPrice);
      o.prevFinal = o.finalPrice;
    }
    delete o.checkedThisRun;
  }
  return [...alerts.values()];
}

// ---------------- Promoções da comunidade ----------------
async function checkDeals(product, ps, includePelando) {
  const q = ps.lastQuery || buildQuery(ps.identity);
  const identity = { ...ps.identity, analysis: analyze(ps.identity.title, ps.identity) };
  const sources = [promobitDeals(q)];
  if (includePelando) sources.push(pelandoDeals(q));
  const res = await Promise.all(sources.map((p) => p.catch(() => ({ ok: false, items: [] }))));
  ps.dealSources = { promobit: res[0].ok ? 'ok' : 'bloqueado' };
  if (includePelando) ps.dealSources.pelando = res[1].ok ? 'ok' : 'bloqueado';
  const firstTime = !ps.dealsSeen;
  ps.dealsSeen ||= [];
  ps.deals ||= {};
  const fresh = [];
  for (const r of res) {
    for (const d of r.items || []) {
      const cmp = compare(identity, { title: d.title, price: d.price });
      if (cmp.reject || cmp.score < PENDING_THRESHOLD) continue;
      d.score = cmp.score;
      d.lastSeen = nowISO();
      ps.deals[d.id] = { ...(ps.deals[d.id] || {}), ...d };
      if (!ps.dealsSeen.includes(d.id)) {
        ps.dealsSeen.push(d.id);
        // na 1ª vez só registra (evita e-mail com promoções antigas), exceto as das últimas 6h
        const recent = d.published && (Date.now() - new Date(d.published).getTime()) < 6 * 3600e3;
        if (!firstTime || recent) fresh.push({ ...d, productTitle: ps.identity.title });
      }
    }
  }
  // remove promoções antigas (não vistas há 3 dias)
  for (const [id, d] of Object.entries(ps.deals)) if (minutesSince(d.lastSeen) > 3 * 1440) delete ps.deals[id];
  if (ps.dealsSeen.length > 500) ps.dealsSeen = ps.dealsSeen.slice(-500);
  return fresh;
}

// ---------------- Cupons das lojas ----------------
async function checkCoupons(state, storesInUse) {
  const fresh = [];
  for (const store of storesInUse) {
    if (!STORES[store]) continue;
    const entry = (state.coupons[store] ||= { items: [], seen: [] });
    if (minutesSince(entry.updatedAt) < DISCOVERY_MINUTES - 1 && !FORCE_DISCOVERY) continue;
    if (timeLeft() < 20000) break;
    const [a, b] = await Promise.all([cuponomia(store).catch(() => ({ ok: false, items: [] })), promobitCoupons(store).catch(() => ({ ok: false, items: [] }))]);
    const items = [...(a.items || []), ...(b.items || [])];
    if (!a.ok && !b.ok) continue;
    const firstTime = !entry.updatedAt;
    for (const c of items) {
      if (!entry.seen.includes(c.id)) {
        entry.seen.push(c.id);
        if (!firstTime) fresh.push({ ...c, storeName: storeLabel(store) });
      }
    }
    entry.items = items;
    entry.updatedAt = nowISO();
    entry.sources = { cuponomia: a.ok ? 'ok' : 'erro', promobit: b.ok ? 'ok' : 'erro' };
    if (entry.seen.length > 400) entry.seen = entry.seen.slice(-400);
  }
  return fresh;
}

// ---------------- Principal ----------------
async function main() {
  const products = loadProducts().filter((p) => p && p.id);
  const state = loadState();
  state.storeHealth ||= {};
  log(`Produtos: ${products.length}`);

  // Remove do estado produtos apagados no painel
  for (const id of Object.keys(state.products)) {
    if (!products.some((p) => p.id === id)) { delete state.products[id]; removeHistory(id); }
  }

  const allAlerts = [];
  const allDeals = [];
  const discoveryRan = [];

  for (const product of products) {
    if (product.paused) continue;
    if (timeLeft() < 30000) { log('Tempo esgotado; restante fica para a próxima execução'); break; }
    const ps = (state.products[product.id] ||= { offers: {}, createdAt: nowISO() });
    Object.defineProperty(ps, '__state', { value: state, enumerable: false });
    ps.offers ||= {};
    log(`• ${product.name || product.url}`);
    try {
      // Reidentifica se o link/nome mudou
      const sig = `${product.url || ''}|${product.name || ''}|${product.query || ''}`;
      if (!ps.identity || ps.identitySig !== sig) {
        ps.offers = {}; ps.lowest = null; ps.notified = {}; ps.lastDiscovery = null;
        await resolveIdentity(product, ps);
        ps.identitySig = sig;
      }
      // Aplica aprovações/rejeições feitas no painel
      for (const o of Object.values(ps.offers)) {
        if (product.approve?.includes(o.key) && o.match.status !== 'origin') o.match.status = 'approved';
        if (product.reject?.includes(o.key) && o.match.status !== 'origin') o.match.status = 'rejected';
      }
      const forced = product.forceDiscovery && (!ps.lastDiscovery || product.forceDiscovery > new Date(ps.lastDiscovery).getTime());
      const due = FORCE_DISCOVERY || forced || minutesSince(ps.lastDiscovery) >= DISCOVERY_MINUTES || !Object.keys(ps.offers).length;
      if (due && timeLeft() > 90000) {
        await discover(product, ps, state);
        discoveryRan.push(product.id);
      }
      await refreshProduct(ps, state);
      const history = loadHistory(product.id);
      allAlerts.push(...evaluateAlerts(product, ps, history));
      saveHistory(product.id, history);
      if (timeLeft() > 20000) allDeals.push(...(await checkDeals(product, ps, due)));
      ps.updatedAt = nowISO();
      ps.error = null;
    } catch (e) {
      log('  erro:', e.message);
      ps.error = e.message;
      errors.push(`${product.name || product.url}: ${e.message}`);
    }
  }

  // Cupons das lojas onde há ofertas ativas
  const storesInUse = new Set();
  for (const ps of Object.values(state.products)) {
    for (const o of Object.values(ps.offers || {})) if (ACTIVE.has(o.match.status) && STORES[o.store]) storesInUse.add(o.store);
  }
  const newCoupons = await checkCoupons(state, [...storesInUse]);

  // E-mail resumo
  let email = null;
  if (allAlerts.length || newCoupons.length || allDeals.length) {
    const digest = buildDigest({ alerts: allAlerts, coupons: newCoupons, deals: allDeals });
    if (DRY_RUN) { log('[DRY_RUN] e-mail:', digest.subject); email = { sent: false, reason: 'dry-run', subject: digest.subject }; }
    else {
      try { email = { ...(await sendDigest(digest)), subject: digest.subject }; }
      catch (e) { errors.push(`e-mail: ${e.message}`); email = { sent: false, reason: e.message }; }
    }
  }

  // Registro da execução (últimos 30 alertas ficam no painel)
  state.recentAlerts = [...allAlerts.map((a) => ({ ...a, at: nowISO() })), ...(state.recentAlerts || [])].slice(0, 40);
  state.lastRun = {
    startedAt: new Date(START).toISOString(),
    finishedAt: nowISO(),
    durationS: Math.round((Date.now() - START) / 1000),
    discovery: discoveryRan.length,
    alerts: allAlerts.length,
    newCoupons: newCoupons.length,
    newDeals: allDeals.length,
    email,
    stats,
    errors: errors.slice(0, 20),
  };
  state.updatedAt = nowISO();
  state.version = 1;
  saveState(state);
  log(`Fim: ${allAlerts.length} alertas, ${newCoupons.length} cupons novos, ${allDeals.length} promoções novas em ${state.lastRun.durationS}s`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => closeBrowser());
