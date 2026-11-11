// Busca de páginas: HTTP simples primeiro; se a loja bloquear, tenta navegador headless (Playwright).
import { sleep, log } from './util.js';

const UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
];
const pickUA = () => UAS[Math.floor(Math.random() * UAS.length)];

const BLOCK_MARKERS = [
  /<title>\s*(Just a moment|Um momento|Attention Required)/i,
  /cf-chl-|challenges\.cloudflare\.com/i,
  /account-verification/i,
  /captcha/i,
  /Não é possível acessar a página/i,
  /window\.location\.replace\("https:\/\/www\.amazon\.com\.br\/error/i,
  /Access Denied/i,
  /sec-if-cpt-container|scf-akamai|_abck|bm-verify/i,
  /Pardon Our Interruption|Request unsuccessful\. Incapsula/i,
];

export function looksBlocked(status, html, finalUrl = '') {
  if ([401, 403, 429, 503].includes(status)) return true;
  if (/account-verification|\/captcha|validateCaptcha/i.test(finalUrl)) return true;
  if (!html || html.length < 6000) return true;
  return BLOCK_MARKERS.some((re) => re.test(html.slice(0, 20000)));
}

// Estatísticas de execução (para o painel)
export const stats = { http: 0, httpBlocked: 0, browser: 0, browserBlocked: 0 };

/**
 * Busca HTML via HTTP. Retorna { ok, status, html, url, blocked }.
 * opts: { retries, headers, cookie, json, timeoutMs, blockCheck }
 */
export async function fetchHTTP(url, opts = {}) {
  const retries = opts.retries ?? 2;
  let last = { ok: false, status: 0, html: '', url, blocked: false };
  for (let attempt = 0; attempt <= retries; attempt++) {
    stats.http++;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
      const res = await fetch(url, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': pickUA(),
          'Accept': opts.json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6',
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
          ...(opts.headers || {}),
        },
      });
      clearTimeout(to);
      const body = await res.text();
      const blocked = opts.json
        ? [401, 403, 429, 503].includes(res.status)
        : (opts.blockCheck ? opts.blockCheck(res.status, body, res.url) : looksBlocked(res.status, body, res.url));
      last = { ok: res.ok && !blocked, status: res.status, html: body, url: res.url, blocked };
      if (last.ok) return last;
      if (res.status === 404) return last;
    } catch (e) {
      last = { ok: false, status: 0, html: '', url, blocked: false, error: e.message };
    }
    if (attempt < retries) await sleep(1500 + Math.random() * 2500);
  }
  if (last.blocked) stats.httpBlocked++;
  return last;
}

// ---------- Navegador headless (carregado sob demanda) ----------
let browserPromise = null;
let browserBudget = Number(process.env.BROWSER_BUDGET || 14); // máx. de páginas headless por execução

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright-core');
      const tries = [];
      if (process.env.PW_EXECUTABLE_PATH) tries.push({ executablePath: process.env.PW_EXECUTABLE_PATH });
      tries.push({ channel: 'chrome' }, { channel: 'chromium' }, {});
      for (const t of tries) {
        try {
          return await chromium.launch({
            headless: true,
            ...t,
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
          });
        } catch (e) {
          log('Não consegui abrir navegador com', JSON.stringify(t), '-', e.message.split('\n')[0]);
        }
      }
      throw new Error('Nenhum navegador disponível para o Playwright');
    })();
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    try { (await browserPromise).close(); } catch {}
    browserPromise = null;
  }
}

/** Renderiza a página num Chrome headless. Retorna o mesmo formato de fetchHTTP. */
export async function fetchBrowser(url, opts = {}) {
  if (browserBudget <= 0) return { ok: false, status: 0, html: '', url, blocked: true, skipped: true };
  browserBudget--;
  stats.browser++;
  let ctx;
  try {
    const browser = await getBrowser();
    ctx = await browser.newContext({
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      userAgent: UAS[0],
      viewport: { width: 1366, height: 900 },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    if (opts.cookies) await ctx.addCookies(opts.cookies);
    const page = await ctx.newPage();
    await page.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (['image', 'media', 'font'].includes(t)) return route.abort();
      return route.continue();
    });
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    // Dá tempo para desafios JS (Cloudflare) e renderização
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(2500);
      const title = await page.title().catch(() => '');
      if (!/Just a moment|Um momento|Attention/i.test(title)) break;
    }
    if (opts.waitFor) await page.waitForSelector(opts.waitFor, { timeout: 8000 }).catch(() => {});
    const html = await page.content();
    const status = resp ? resp.status() : 0;
    const finalUrl = page.url();
    const blocked = looksBlocked(status === 403 && html.length > 50000 ? 200 : status, html, finalUrl);
    if (blocked) stats.browserBlocked++;
    return { ok: !blocked, status, html, url: finalUrl, blocked, via: 'browser' };
  } catch (e) {
    return { ok: false, status: 0, html: '', url, blocked: false, error: e.message, via: 'browser' };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

/** HTTP → se bloqueado → navegador. */
export async function fetchPage(url, opts = {}) {
  const r = opts.browserOnly ? { ok: false, blocked: true } : await fetchHTTP(url, opts);
  if (r.ok || r.status === 404 || opts.noBrowser) return r;
  const b = await fetchBrowser(url, opts);
  if (b.ok) return b;
  return { ...r, blocked: r.blocked || b.blocked, browserTried: !b.skipped };
}
