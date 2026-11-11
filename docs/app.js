/* Verificador de Preços — painel (GitHub Pages). Lê os dados do branch "data" e salva a lista de produtos via API do GitHub. */
(() => {
  'use strict';

  // ---------- Configuração ----------
  const LS_KEY = 'verificador-precos:settings';
  const settings = loadSettings();
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch {}
    const host = location.hostname;
    if (!s.owner && host.endsWith('.github.io')) s.owner = host.split('.')[0];
    if (!s.repo && host.endsWith('.github.io')) s.repo = location.pathname.split('/').filter(Boolean)[0] || '';
    return s;
  }
  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch {}
  }

  // ---------- Utilidades ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const brl = (n) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const parseMoney = (s) => {
    if (s == null || s === '') return null;
    let t = String(s).replace(/[^\d.,]/g, '');
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = parseFloat(t);
    return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };
  const ago = (iso) => {
    if (!iso) return 'nunca';
    const m = (Date.now() - new Date(iso).getTime()) / 60000;
    if (m < 1) return 'agora há pouco';
    if (m < 60) return `há ${Math.round(m)} min`;
    if (m < 1440) return `há ${Math.round(m / 60)} h`;
    return `há ${Math.round(m / 1440)} d`;
  };
  const dt = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const b64encode = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); };
  const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

  function toast(msg, ms = 3200) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), ms);
  }
  function notice(html, kind = '') {
    const n = $('#notice');
    if (!html) { n.hidden = true; return; }
    n.className = 'notice ' + kind;
    n.innerHTML = html;
    n.hidden = false;
  }

  // ---------- API do GitHub ----------
  const hasRepo = () => settings.owner && settings.repo;
  async function gh(path, opts = {}) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) };
    if (settings.token) headers.Authorization = `Bearer ${settings.token}`;
    const res = await fetch(`https://api.github.com${path}`, { ...opts, headers });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg += ' ' + (await res.json()).message; } catch {}
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const repoPath = () => `/repos/${settings.owner}/${settings.repo}`;

  const DATA_BASE = new URLSearchParams(location.search).get('data'); // pré-visualização local
  async function readDataFile(file) {
    if (DATA_BASE) {
      const r = await fetch(`${DATA_BASE}/${file}`, { cache: 'no-store' });
      return r.ok ? r.json() : null;
    }
    if (settings.token) {
      try {
        const res = await fetch(`https://api.github.com${repoPath()}/contents/${file}?ref=data&t=${Date.now()}`, {
          headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${settings.token}` },
          cache: 'no-store',
        });
        if (res.ok) return res.json();
        if (res.status === 404) return null;
      } catch {}
    }
    const res = await fetch(`https://raw.githubusercontent.com/${settings.owner}/${settings.repo}/data/${file}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Falha ao ler ${file} (${res.status})`);
    return res.json();
  }

  /** Lê products.json + sha; se o branch "data" não existir, cria. */
  async function getProductsFile() {
    try {
      const f = await gh(`${repoPath()}/contents/products.json?ref=data`);
      return { sha: f.sha, list: JSON.parse(b64decode(f.content)) };
    } catch (e) {
      if (e.status !== 404) throw e;
      await createDataBranch();
      const f = await gh(`${repoPath()}/contents/products.json?ref=data`);
      return { sha: f.sha, list: JSON.parse(b64decode(f.content)) };
    }
  }

  async function createDataBranch() {
    try { await gh(`${repoPath()}/git/ref/heads/data`); return; } catch (e) { if (e.status !== 404) throw e; }
    const tree = await gh(`${repoPath()}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ tree: [{ path: 'products.json', mode: '100644', type: 'blob', content: '[]\n' }] }),
    });
    const commit = await gh(`${repoPath()}/git/commits`, { method: 'POST', body: JSON.stringify({ message: 'Cria branch de dados', tree: tree.sha, parents: [] }) });
    await gh(`${repoPath()}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/data', sha: commit.sha }) });
  }

  /** Altera a lista de produtos e grava (com nova tentativa em caso de conflito). */
  async function updateProducts(mutate, message) {
    if (!settings.token) { openSettings('Configure o token do GitHub para salvar alterações.'); throw new Error('sem token'); }
    for (let i = 0; i < 4; i++) {
      const { sha, list } = await getProductsFile();
      const next = mutate(structuredClone(list)) || list;
      try {
        await gh(`${repoPath()}/contents/products.json`, {
          method: 'PUT',
          body: JSON.stringify({ message, content: b64encode(JSON.stringify(next, null, 1) + '\n'), sha, branch: 'data' }),
        });
        data.products = next;
        return next;
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    throw new Error('Não consegui salvar (conflito). Tente de novo.');
  }

  async function dispatchCheck(discover = true) {
    if (!settings.token) { openSettings('Configure o token do GitHub para disparar verificações.'); return false; }
    await gh(`${repoPath()}/actions/workflows/monitor.yml/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: 'main', inputs: { discover: discover ? 'true' : 'false' } }),
    });
    return true;
  }

  async function latestRun() {
    if (!settings.token) return null;
    try {
      const r = await gh(`${repoPath()}/actions/workflows/monitor.yml/runs?per_page=1`);
      return r.workflow_runs?.[0] || null;
    } catch { return null; }
  }

  // ---------- Estado ----------
  const data = { products: [], state: null, history: {}, loaded: false };
  const open = new Set(JSON.parse(sessionStorage.getItem('vp-open') || '[]'));

  async function load() {
    if (!hasRepo()) {
      notice('Abra as <b>Configurações</b> e informe o usuário e o repositório do GitHub.', 'warn');
      return;
    }
    try {
      const [products, state] = await Promise.all([readDataFile('products.json'), readDataFile('state.json')]);
      data.products = Array.isArray(products) ? products : [];
      data.state = state;
      data.loaded = true;
      if (!products && !state) {
        notice('Ainda não há dados. Adicione um produto (ou clique em <b>Verificar agora</b>) para criar a base.', '');
      } else if (!settings.token) {
        notice('Modo leitura. Para adicionar produtos, aprovar ofertas ou disparar verificações, configure seu <a href="#" data-act="settings">token do GitHub</a>.', '');
      } else notice('');
      render();
    } catch (e) {
      notice(`Erro ao carregar dados: ${esc(e.message)}`, 'err');
    }
    updateRunStatus();
  }

  async function updateRunStatus() {
    const st = data.state;
    const el = $('#run-status');
    let txt = st?.lastRun ? `Última verificação ${ago(st.lastRun.finishedAt)} · levou ${st.lastRun.durationS}s` : 'Aguardando a primeira verificação';
    const run = await latestRun();
    if (run && (run.status === 'in_progress' || run.status === 'queued')) txt = `Verificando agora… · ${txt}`;
    el.textContent = txt;
    const late = st?.lastRun && (Date.now() - new Date(st.lastRun.finishedAt).getTime()) > 30 * 60000;
    el.style.color = late ? 'var(--warn)' : '';
    if (late) el.title = 'O agendamento do GitHub pode estar atrasado ou desativado (veja a aba Actions do repositório).';
  }

  // ---------- Renderização ----------
  const ACTIVE = new Set(['origin', 'auto', 'approved']);
  const STATUS_CHIP = {
    ok: '', 'indisponível': '<span class="chip">indisponível</span>', bloqueado: '<span class="chip red">bloqueado</span>',
    erro: '<span class="chip red">erro</span>', 'não encontrado nesta checagem': '<span class="chip">não listado agora</span>',
  };

  function render() {
    renderProducts();
    renderAlerts();
    renderCoupons();
    renderStores();
  }

  function rulesText(p) {
    const r = { target: true, lowest: true, dropPct: 5, anyDrop: false, ...(p.rules || {}) };
    const out = [];
    if (r.target && p.targetPrice) out.push('alvo');
    if (r.lowest) out.push('recorde');
    if (r.dropPct) out.push(`queda ≥${r.dropPct}%`);
    if (r.anyDrop) out.push('qualquer queda');
    return out.join(' · ') || 'sem alertas';
  }

  function renderProducts() {
    const root = $('#products');
    const list = data.products || [];
    if (!list.length) {
      root.innerHTML = `<div class="empty card"><h3>Nenhum produto ainda</h3><p>Cole o link de um produto (ou digite o nome) em <b>Adicionar produto</b>. O app busca o mesmo modelo nas outras lojas.</p></div>`;
      $('#add-box').open = true;
      return;
    }
    root.innerHTML = list.slice().reverse().map(productHTML).join('');
    for (const id of open) if (list.some((p) => p.id === id)) drawChart(id);
  }

  function productHTML(p) {
    const ps = data.state?.products?.[p.id];
    const id = ps?.identity || {};
    const offers = Object.values(ps?.offers || {});
    const active = offers.filter((o) => ACTIVE.has(o.match.status)).sort((a, b) => (a.status === 'ok' ? 0 : 1) - (b.status === 'ok' ? 0 : 1) || (a.finalPrice ?? 1e12) - (b.finalPrice ?? 1e12));
    const pending = offers.filter((o) => o.match.status === 'pending').sort((a, b) => (a.finalPrice ?? 1e12) - (b.finalPrice ?? 1e12));
    const rejected = offers.filter((o) => o.match.status === 'rejected').length;
    const best = ps?.best;
    const img = id.image || active.find((o) => o.image)?.image;
    const title = id.displayTitle || id.title || p.name || p.url;
    const hit = best && p.targetPrice && best.price <= p.targetPrice;
    const isOpen = open.has(p.id);
    const deals = Object.values(ps?.deals || {}).sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12)).slice(0, 6);

    const chips = [];
    if (p.paused) chips.push('<span class="chip warn">pausado</span>');
    if (!ps) chips.push('<span class="chip blue">aguardando 1ª verificação</span>');
    if (p.targetPrice) chips.push(`<span class="chip ${hit ? 'green' : ''}">alvo ${brl(p.targetPrice)}</span>`);
    if (ps?.lowest) chips.push(`<span class="chip" title="${esc(ps.lowest.store)} em ${dt(ps.lowest.at)}">menor visto ${brl(ps.lowest.price)}</span>`);
    if (pending.length) chips.push(`<span class="chip warn">${pending.length} para revisar</span>`);
    if (ps?.error) chips.push(`<span class="chip red" title="${esc(ps.error)}">erro</span>`);
    chips.push(`<span class="chip">${esc(rulesText(p))}</span>`);

    const row = (o, isBest, isPending) => `
      <tr class="${isBest ? 'best' : ''} ${o.status && o.status !== 'ok' && !isPending ? 'dim' : ''}">
        <td>
          <div class="store">${esc(o.storeName)} ${o.match.status === 'origin' ? '<span class="chip blue">seu link</span>' : ''} ${o.international ? '<span class="chip">internacional</span>' : ''}</div>
          <div class="t" title="${esc(o.title)}">${esc(o.title)}</div>
          ${o.seller ? `<div class="small muted">${esc(o.seller)}${o.official ? ' <span class="chip green">oficial</span>' : ''}${o.via === 'zoom' ? ' · via Zoom' : ''}</div>` : (o.via === 'zoom' ? '<div class="small muted">via Zoom</div>' : '')}
          ${isPending && o.match.reasons?.length ? `<div class="small muted">Por que revisar: ${esc(o.match.reasons.join('; '))}</div>` : ''}
        </td>
        <td class="num">
          <div class="price">${brl(o.finalPrice ?? o.price)}${o.priceNote ? ` <span class="small muted">${esc(o.priceNote)}</span>` : ''}</div>
          ${o.coupon ? `<div class="coupon">${o.price ? brl(o.price) + ' − ' : ''}cupom: ${esc(o.coupon.text)}${o.coupon.code ? ` <span class="code" data-copy="${esc(o.coupon.code)}">${esc(o.coupon.code)}</span>` : ''}</div>` : ''}
          ${o.listPrice && o.listPrice > (o.price || 0) ? `<div class="old">${brl(o.listPrice)}</div>` : ''}
          ${o.promoInfo ? `<div class="small muted" title="${esc(o.promoInfo)}">${esc(o.promoInfo.slice(0, 60))}${o.promoInfo.length > 60 ? '…' : ''}</div>` : ''}
          ${STATUS_CHIP[o.status] ?? ''}
        </td>
        <td>
          ${isPending
            ? `<div class="row-end"><button class="btn sm ok" data-act="approve" data-p="${p.id}" data-k="${o.key}">Monitorar</button><button class="btn sm no" data-act="reject" data-p="${p.id}" data-k="${o.key}">Descartar</button></div>`
            : o.match.status !== 'origin' ? `<button class="linkbtn" data-act="reject" data-p="${p.id}" data-k="${o.key}" title="Não é o mesmo produto">remover</button>` : ''}
          <div><a class="btn sm" href="${esc(o.url)}" target="_blank" rel="noopener">Abrir</a></div>
          ${o.lastChecked ? `<div class="small muted">${ago(o.lastChecked)}</div>` : ''}
        </td>
      </tr>`;

    return `
    <article class="card product" id="prod-${p.id}">
      <div class="p-head">
        ${img ? `<img class="p-img" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;p-img ph&quot;>sem foto</div>'">` : '<div class="p-img ph">sem foto</div>'}
        <div>
          <h2 class="p-title">${esc(title)}</h2>
          <div class="p-meta">${chips.join('')}</div>
          ${ps?.identityNote ? `<p class="small muted" style="margin:6px 0 0">${esc(ps.identityNote)}</p>` : ''}
        </div>
        <div class="p-price">
          <div class="big num ${hit ? 'hit' : ''}">${best ? brl(best.price) : '—'}</div>
          <div class="where">${best ? `melhor preço · ${esc(best.store)}` : ps ? 'sem preço ainda' : ''}</div>
        </div>
      </div>
      <div class="p-actions">
        <button class="linkbtn" data-act="toggle" data-p="${p.id}">${isOpen ? 'Ocultar detalhes' : `Ver ${active.length} oferta${active.length === 1 ? '' : 's'}${pending.length ? ` + ${pending.length} para revisar` : ''}`}</button>
        <button class="linkbtn" data-act="edit" data-p="${p.id}">Editar alertas</button>
        <button class="linkbtn" data-act="rediscover" data-p="${p.id}">Buscar de novo</button>
        <button class="linkbtn" data-act="pause" data-p="${p.id}">${p.paused ? 'Retomar' : 'Pausar'}</button>
        <button class="linkbtn" data-act="remove" data-p="${p.id}">Remover</button>
      </div>
      ${isOpen ? `
      <div class="p-body">
        <div class="chart" id="chart-${p.id}"><p class="small muted">Carregando histórico…</p></div>
        <div class="legend" id="legend-${p.id}"></div>
        ${active.length ? `<table class="offers"><thead><tr><th>Loja / anúncio</th><th>Preço</th><th></th></tr></thead><tbody>${active.map((o) => row(o, best && o.key === best.key, false)).join('')}</tbody></table>` : '<p class="small muted" style="padding:0 18px">Nenhuma oferta monitorada ainda.</p>'}
        ${pending.length ? `<div class="sub"><span>Ofertas para revisar — confirme se é o mesmo produto e vendedor confiável</span></div><table class="offers"><tbody>${pending.map((o) => row(o, false, true)).join('')}</tbody></table>` : ''}
        ${deals.length ? `<div class="sub"><span>Promoções da comunidade (Promobit / Pelando)</span><span class="muted small">${Object.entries(ps.dealSources || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span></div>
          <ul class="deals">${deals.map((d) => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a><span class="num"><b>${brl(d.price)}</b>${d.storeName ? ` <span class="muted small">${esc(d.storeName)}</span>` : ''}${d.coupon ? ` <span class="code" data-copy="${esc(d.coupon)}">${esc(d.coupon)}</span>` : ''}</span></li>`).join('')}</ul>` : ''}
        <div class="p-foot">
          ${ps?.lastQuery ? `Termo de busca: “${esc(ps.lastQuery)}” · ` : ''}busca ampla ${ago(ps?.lastDiscovery)}${rejected ? ` · ${rejected} oferta(s) descartada(s)` : ''}
          ${ps?.searchReport ? `<br>Lojas: ${Object.entries(ps.searchReport).map(([k, v]) => `${k} ${v}`).join(' · ')}` : ''}
          ${p.url ? `<br>Link original: <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.slice(0, 80))}${p.url.length > 80 ? '…' : ''}</a>` : ''}
        </div>
      </div>` : ''}
    </article>`;
  }

  // ---------- Gráfico de histórico ----------
  const COLORS = ['#1f9d55', '#2b6cd8', '#d9822b', '#b4387a', '#6b4fd1', '#0f8f8f', '#a0522d', '#5f6b7a'];

  async function ensureHistory(id) {
    if (data.history[id]) return data.history[id];
    try { data.history[id] = (await readDataFile(`history/${id}.json`)) || { offers: {} }; } catch { data.history[id] = { offers: {} }; }
    return data.history[id];
  }

  async function drawChart(id) {
    const box = document.getElementById(`chart-${id}`);
    if (!box) return;
    const h = await ensureHistory(id);
    const ps = data.state?.products?.[id];
    const p = data.products.find((x) => x.id === id);
    const offers = Object.values(ps?.offers || {}).filter((o) => ACTIVE.has(o.match.status));
    const series = offers
      .map((o) => ({ o, pts: (h.offers?.[o.key] || []).map(([t, v]) => [t * 60000, v]) }))
      .filter((s) => s.pts.length)
      .sort((a, b) => Math.min(...a.pts.map((x) => x[1])) - Math.min(...b.pts.map((x) => x[1])))
      .slice(0, 6);
    if (!series.length) { box.innerHTML = '<p class="small muted">O histórico aparece após algumas verificações.</p>'; return; }
    const now = Date.now();
    series.forEach((s) => s.pts.push([now, s.pts[s.pts.length - 1][1]])); // estende até agora (degrau)
    const all = series.flatMap((s) => s.pts);
    let minT = Math.min(...all.map((x) => x[0])), maxT = now;
    if (maxT - minT < 3600e3) minT = maxT - 3600e3;
    let minV = Math.min(...all.map((x) => x[1])), maxV = Math.max(...all.map((x) => x[1]));
    if (p?.targetPrice) { minV = Math.min(minV, p.targetPrice); maxV = Math.max(maxV, p.targetPrice); }
    const pad = (maxV - minV) * 0.12 || maxV * 0.05 || 1;
    minV -= pad; maxV += pad;
    const W = Math.max(300, box.clientWidth - 36), H = 160, L = 76, R = 8, T = 8, B = 22;
    const x = (t) => L + ((t - minT) / (maxT - minT)) * (W - L - R);
    const y = (v) => T + (1 - (v - minV) / (maxV - minV)) * (H - T - B);
    const step = (pts) => pts.map(([t, v], i) => (i === 0 ? `M${x(t).toFixed(1)},${y(v).toFixed(1)}` : `H${x(t).toFixed(1)}V${y(v).toFixed(1)}`)).join('');
    const ticks = [0, 0.5, 1].map((f) => minV + pad + f * (maxV - minV - 2 * pad));
    const fmtT = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Histórico de preços">
      ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" vector-effect="non-scaling-stroke"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${brl(Math.round(v)).replace(/,00$/, '')}</text>`).join('')}
      ${p?.targetPrice ? `<line x1="${L}" x2="${W - R}" y1="${y(p.targetPrice)}" y2="${y(p.targetPrice)}" stroke="var(--accent)" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>` : ''}
      ${series.map((s, i) => `<path d="${step(s.pts)}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join('')}
      <text x="${L}" y="${H - 4}" font-size="11" fill="var(--muted)">${fmtT(minT)}</text>
      <text x="${W - R}" y="${H - 4}" font-size="11" fill="var(--muted)" text-anchor="end">agora</text>
    </svg>`;
    document.getElementById(`legend-${id}`).innerHTML =
      series.map((s, i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(s.o.storeName)} ${brl(s.o.finalPrice)}</span>`).join('') +
      (p?.targetPrice ? `<span><i style="background:transparent;border:1px dashed var(--accent)"></i>alvo</span>` : '');
  }

  // ---------- Outras abas ----------
  function renderAlerts() {
    const list = data.state?.recentAlerts || [];
    const lbl = { target: 'preço-alvo', lowest: 'menor preço já visto', dropPct: 'queda acima do limite', anyDrop: 'caiu de preço' };
    const tab = document.querySelector('.tab[data-tab="alertas"]');
    const recent = list.filter((a) => Date.now() - new Date(a.at).getTime() < 24 * 3600e3).length;
    tab.innerHTML = `Alertas${recent ? `<span class="count">${recent}</span>` : ''}`;
    $('#alerts').innerHTML = list.length
      ? list.map((a) => `<div class="card list-card">
          ${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
          <div class="grow"><b>${esc(a.productTitle)}</b><div class="small muted">${esc(a.storeName)} · ${dt(a.at)} · ${a.reasons.map((r) => lbl[r] || r).join(', ')}</div>${a.warning ? `<div class="small" style="color:var(--danger)">${esc(a.warning)}</div>` : ''}</div>
          <div class="num" style="text-align:right"><b>${brl(a.finalPrice)}</b>${a.prevFinal ? `<div class="old small">${brl(a.prevFinal)}</div>` : ''}<a class="btn sm" href="${esc(a.url)}" target="_blank" rel="noopener">Abrir</a></div>
        </div>`).join('')
      : '<div class="empty card"><h3>Sem alertas ainda</h3><p>Quando um preço bater suas regras, ele aparece aqui e no seu e-mail.</p></div>';
  }

  function renderCoupons() {
    const c = data.state?.coupons || {};
    const names = { amazon: 'Amazon', mercadolivre: 'Mercado Livre', magalu: 'Magalu', casasbahia: 'Casas Bahia', kabum: 'KaBuM!', terabyte: 'Terabyte', pichau: 'Pichau', shopee: 'Shopee', aliexpress: 'AliExpress' };
    const stores = Object.keys(c).filter((k) => c[k].items?.length);
    $('#coupons').innerHTML = stores.length
      ? stores.map((s) => `<div class="card store-group"><h3><span>${esc(names[s] || s)}</span><span class="muted small">atualizado ${ago(c[s].updatedAt)}</span></h3>
          ${c[s].items.map((i) => `<div class="cp"><div><div>${esc(i.title)}</div><div class="small muted">${esc(i.source)}${i.discount ? ' · ' + esc(i.discount) : ''}${i.desc ? ' · ' + esc(i.desc) : ''}${i.until ? ' · até ' + dt(i.until) : ''}</div></div>
            <div>${i.code ? `<span class="code" data-copy="${esc(i.code)}" title="Copiar">${esc(i.code)}</span>` : `<a class="btn sm" href="${esc(i.url)}" target="_blank" rel="noopener">Ver</a>`}</div></div>`).join('')}
        </div>`).join('')
      : '<div class="empty card"><h3>Nenhum cupom ainda</h3><p>Os cupons aparecem depois que o app encontra ofertas dos seus produtos.</p></div>';
  }

  function renderStores() {
    const h = data.state?.storeHealth || {};
    const lr = data.state?.lastRun;
    const names = { zoom: 'Zoom (comparador)', amazon: 'Amazon', mercadolivre: 'Mercado Livre', magalu: 'Magalu', casasbahia: 'Casas Bahia', kabum: 'KaBuM!', terabyte: 'Terabyte', pichau: 'Pichau', shopee: 'Shopee', aliexpress: 'AliExpress' };
    $('#stores').innerHTML = `
      <p class="muted small">Algumas lojas bloqueiam os servidores do GitHub. Quando isso acontece, o app tenta um navegador headless e, mesmo bloqueado, os preços dessas lojas costumam chegar pelo comparador Zoom.</p>
      <div class="stores-grid">${Object.keys(names).map((k) => {
        const s = h[k] || {};
        const chip = !s.status ? '<span class="chip">sem dados</span>' : s.status === 'ok' ? '<span class="chip green">acessível</span>' : '<span class="chip red">bloqueando</span>';
        return `<div class="card"><b>${names[k]}</b> ${chip}<div class="small muted" style="margin-top:6px">último sucesso: ${ago(s.lastOk)}<br>último bloqueio: ${ago(s.lastBlocked)}</div></div>`;
      }).join('')}</div>
      ${lr ? `<div class="card" style="margin-top:16px;padding:14px 16px"><b>Última execução</b>
        <div class="small muted" style="margin-top:6px">${dt(lr.finishedAt)} · ${lr.durationS}s · ${lr.discovery} busca(s) ampla(s) · ${lr.alerts} alerta(s) · ${lr.newCoupons} cupom(ns) novo(s) · ${lr.newDeals} promo(s) nova(s)<br>
        Requisições: ${lr.stats?.http ?? 0} HTTP (${lr.stats?.httpBlocked ?? 0} bloqueadas) · ${lr.stats?.browser ?? 0} navegador (${lr.stats?.browserBlocked ?? 0} bloqueadas)
        ${lr.email ? `<br>E-mail: ${lr.email.sent ? 'enviado' : 'não enviado (' + esc(lr.email.reason || '') + ')'} — ${esc(lr.email.subject || '')}` : ''}
        ${lr.errors?.length ? `<br><span style="color:var(--danger)">Erros: ${lr.errors.map(esc).join(' | ')}</span>` : ''}</div></div>` : ''}`;
  }

  // ---------- Ações ----------
  function readRules(form) {
    return {
      target: form.r_target.checked,
      lowest: form.r_lowest.checked,
      dropPct: form.r_drop.checked ? Math.max(1, parseInt(form.dropPct.value || '5', 10)) : null,
      anyDrop: form.r_any.checked,
    };
  }

  $('#add-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const url = f.url.value.trim();
    const name = f.name.value.trim();
    if (!url && !name) { toast('Informe um link ou um nome de produto.'); return; }
    if (url && !/^https?:\/\//i.test(url)) { toast('O link precisa começar com http(s)://'); return; }
    const product = {
      id: 'p' + Date.now().toString(36),
      url: url || null,
      name: name || null,
      targetPrice: parseMoney(f.targetPrice.value),
      rules: readRules(f),
      createdAt: new Date().toISOString(),
    };
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await updateProducts((list) => { list.push(product); return list; }, `Adiciona produto: ${name || url}`.slice(0, 120));
      f.reset();
      f.dropPct.value = 5;
      render();
      await dispatchCheck(true).catch(() => {});
      toast('Produto adicionado. A primeira busca leva de 1 a 3 minutos.');
      pollSoon();
    } catch (e) {
      if (e.message !== 'sem token') toast('Erro: ' + e.message, 6000);
    } finally { btn.disabled = false; }
  });

  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act], [data-copy], .tab');
    if (!el) return;
    if (el.classList.contains('tab')) {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === el));
      document.querySelectorAll('.tabpanel').forEach((p) => (p.hidden = p.id !== `tab-${el.dataset.tab}`));
      return;
    }
    if (el.dataset.copy) {
      try { await navigator.clipboard.writeText(el.dataset.copy); toast(`Cupom ${el.dataset.copy} copiado`); } catch { toast(el.dataset.copy); }
      return;
    }
    ev.preventDefault();
    const act = el.dataset.act;
    const pid = el.dataset.p;
    try {
      if (act === 'settings') return openSettings();
      if (act === 'toggle') {
        open.has(pid) ? open.delete(pid) : open.add(pid);
        sessionStorage.setItem('vp-open', JSON.stringify([...open]));
        renderProducts();
        if (open.has(pid)) drawChart(pid);
        return;
      }
      if (act === 'approve' || act === 'reject') {
        const key = el.dataset.k;
        const o = data.state?.products?.[pid]?.offers?.[key];
        el.disabled = true;
        await updateProducts((list) => {
          const p = list.find((x) => x.id === pid);
          if (!p) return list;
          p.approve = (p.approve || []).filter((k) => k !== key);
          p.reject = (p.reject || []).filter((k) => k !== key);
          (act === 'approve' ? p.approve : p.reject).push(key);
          return list;
        }, `${act === 'approve' ? 'Aprova' : 'Descarta'} oferta ${o?.storeName || ''}`);
        if (o) o.match.status = act === 'approve' ? 'approved' : 'rejected';
        renderProducts();
        toast(act === 'approve' ? 'Oferta passa a ser monitorada.' : 'Oferta descartada.');
        return;
      }
      if (act === 'pause') {
        await updateProducts((list) => { const p = list.find((x) => x.id === pid); if (p) p.paused = !p.paused; return list; }, 'Pausa/retoma produto');
        renderProducts();
        return;
      }
      if (act === 'remove') {
        const p = data.products.find((x) => x.id === pid);
        if (!confirm(`Remover "${p?.name || data.state?.products?.[pid]?.identity?.title || p?.url}"?`)) return;
        await updateProducts((list) => list.filter((x) => x.id !== pid), 'Remove produto');
        renderProducts();
        toast('Produto removido.');
        return;
      }
      if (act === 'rediscover') {
        await updateProducts((list) => { const p = list.find((x) => x.id === pid); if (p) p.forceDiscovery = Date.now(); return list; }, 'Pede nova busca ampla');
        await dispatchCheck(true);
        toast('Nova busca disparada. Resultados em 1–3 minutos.');
        pollSoon();
        return;
      }
      if (act === 'edit') return openEdit(pid);
    } catch (e) {
      if (e.message !== 'sem token') toast('Erro: ' + e.message, 6000);
    }
  });

  // Editar
  function openEdit(pid) {
    const p = data.products.find((x) => x.id === pid);
    if (!p) return;
    const d = $('#edit');
    const f = $('#edit-form');
    const r = { target: true, lowest: true, dropPct: 5, anyDrop: false, ...(p.rules || {}) };
    f.name.value = p.name || '';
    f.targetPrice.value = p.targetPrice ? p.targetPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
    f.r_target.checked = !!r.target;
    f.r_lowest.checked = !!r.lowest;
    f.r_drop.checked = !!r.dropPct;
    f.dropPct.value = r.dropPct || 5;
    f.r_any.checked = !!r.anyDrop;
    d.dataset.pid = pid;
    d.showModal();
  }
  $('#edit').addEventListener('close', async () => {
    const d = $('#edit');
    if (d.returnValue !== 'save') return;
    const f = $('#edit-form');
    const pid = d.dataset.pid;
    try {
      await updateProducts((list) => {
        const p = list.find((x) => x.id === pid);
        if (!p) return list;
        p.name = f.name.value.trim() || null;
        p.targetPrice = parseMoney(f.targetPrice.value);
        p.rules = readRules(f);
        return list;
      }, 'Edita alertas do produto');
      renderProducts();
      toast('Alterações salvas.');
    } catch (e) { if (e.message !== 'sem token') toast('Erro: ' + e.message, 6000); }
  });

  // Configurações
  function openSettings(msg) {
    const f = $('#settings-form');
    f.owner.value = settings.owner || '';
    f.repo.value = settings.repo || '';
    f.token.value = settings.token || '';
    $('#settings-msg').textContent = msg || '';
    $('#settings').showModal();
  }
  $('#btn-settings').addEventListener('click', () => openSettings());
  $('#settings').addEventListener('close', () => {
    if ($('#settings').returnValue !== 'save') return;
    const f = $('#settings-form');
    settings.owner = f.owner.value.trim();
    settings.repo = f.repo.value.trim();
    settings.token = f.token.value.trim() || undefined;
    saveSettings();
    toast('Configurações salvas.');
    load();
  });
  $('#btn-test').addEventListener('click', async () => {
    const f = $('#settings-form');
    const prev = { ...settings };
    Object.assign(settings, { owner: f.owner.value.trim(), repo: f.repo.value.trim(), token: f.token.value.trim() || undefined });
    const msg = $('#settings-msg');
    msg.textContent = 'Testando…';
    try {
      const r = await gh(repoPath());
      const perms = r.permissions || {};
      msg.innerHTML = `✓ Repositório encontrado${settings.token ? (perms.push ? ' · token com permissão de escrita' : ' · <b>token sem permissão de escrita</b>') : ' (sem token: só leitura)'}.`;
    } catch (e) {
      msg.textContent = '✗ ' + e.message;
    } finally { Object.assign(settings, prev); }
  });

  $('#btn-check').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      if (await dispatchCheck(true)) { toast('Verificação disparada. Leva de 1 a 3 minutos.'); pollSoon(); }
    } catch (e) { toast('Erro: ' + e.message, 6000); }
    finally { setTimeout(() => (b.disabled = false), 5000); }
  });

  // Atualização automática
  let pollTimer = null;
  function pollSoon() {
    clearInterval(pollTimer);
    let n = 0;
    pollTimer = setInterval(() => { load(); if (++n > 12) clearInterval(pollTimer); }, 20000);
  }
  setInterval(() => { if (document.visibilityState === 'visible') load(); }, 90000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

  load();
})();
