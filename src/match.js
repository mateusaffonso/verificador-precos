// Correspondência "mesmo modelo exato" entre anúncios de lojas diferentes.
import { stripAccents } from './util.js';

const STOP = new Set(`de da do das dos e com para por em a o as os no na nos nas um uma ate até sem
  novo nova original lacrado oficial garantia nf nota fiscal envio imediato pronta entrega promocao
  oferta frete gratis brasil versao global global br smartphone celular kit modelo cor tela
  pol polegadas memoria interna ram armazenamento - + | / , . x`.split(/\s+/).map((w) => stripAccents(w)));

// Palavras que definem variantes do mesmo produto e PRECISAM coincidir
const VARIANT_WORDS = new Set(['pro', 'plus', 'max', 'ultra', 'mini', 'lite', 'ti', 'super', 'fe', 'se', 'xl', 'neo',
  'air', 'edge', 'prime', 'turbo', 'oc', 'slim', 'fold', 'flip', 'note', 'power', 'play', 'go', 'xt', 'xtx', 'gre',
  'dual', 'duo', 'wifi', 'wi-fi', 'lte', 'cellular', '5g', '4g', 'digital', 'mobile', 'laptop', 'notebook']);

const COLORS = new Map(Object.entries({
  preto: 'preto', black: 'preto', grafite: 'grafite', graphite: 'grafite', branco: 'branco', white: 'branco',
  azul: 'azul', blue: 'azul', verde: 'verde', green: 'verde', rosa: 'rosa', pink: 'rosa', roxo: 'roxo', purple: 'roxo',
  lilas: 'lilas', vermelho: 'vermelho', red: 'vermelho', amarelo: 'amarelo', yellow: 'amarelo', cinza: 'cinza',
  gray: 'cinza', grey: 'cinza', prata: 'prata', silver: 'prata', dourado: 'dourado', gold: 'dourado', titanio: 'titanio',
  titanium: 'titanio', bege: 'bege', laranja: 'laranja', orange: 'laranja', marrom: 'marrom', creme: 'creme',
  meianoite: 'meianoite', midnight: 'meianoite', estelar: 'estelar', starlight: 'estelar', natural: 'natural',
  grafeno: 'grafite', 'ultramarino': 'azul', 'violeta': 'roxo',
}));

const ACCESSORY = ['capa', 'capinha', 'case', 'pelicula', 'película', 'protetor', 'carregador', 'cabo', 'suporte',
  'adaptador', 'fone', 'compativel', 'compatível', 'bolsa', 'skin', 'adesivo', 'controle remoto', 'refil', 'peca',
  'peça', 'reposicao', 'reposição', 'tampa', 'bateria para', 'cooler para', 'backplate', 'bracket', 'kit capa',
  'pulseira', 'lente', 'vidro', 'dock', 'base para', 'bag', 'mochila', 'estojo', 'controle', 'jogo', 'game para',
  'headset para', 'volante', 'hd externo para', 'cartao de memoria'];
const ACCESSORY_N = ACCESSORY.map((a) => stripAccents(a));

export const KNOWN_BRANDS = ['apple', 'samsung', 'xiaomi', 'motorola', 'lg', 'sony', 'philips', 'dell', 'lenovo', 'acer', 'asus', 'hp',
  'positivo', 'nintendo', 'microsoft', 'jbl', 'logitech', 'redragon', 'hyperx', 'razer', 'corsair', 'gigabyte', 'msi', 'zotac',
  'galax', 'pny', 'pcyes', 'palit', 'asrock', 'sapphire', 'powercolor', 'xfx', 'kingston', 'crucial', 'western digital',
  'seagate', 'electrolux', 'brastemp', 'consul', 'midea', 'tcl', 'philco', 'britania', 'mondial', 'arno', 'oster',
  'dji', 'gopro', 'canon', 'nikon', 'fujifilm', 'garmin', 'amazfit', 'huawei', 'realme', 'oneplus', 'honor', 'edifier',
  'anker', 'baseus', 'multilaser', 'aoc', 'benq', 'epson', 'brother', 'tp-link', 'mercusys', 'intelbras', 'dyson', 'wap', 'karcher',
  'bosch', 'makita', 'dewalt', 'tramontina', 'nespresso', 'peladn', 'inno3d', 'colorful', 'maxsun', 'afox', 'biostar', 'evga',
  'mancer', 'pichau', 'aorus', 'hisense', 'semp', 'toshiba', 'aiwa', 'jvc', 'infinix', 'tecno', 'nokia', 'oppo', 'vivo', 'google',
  'meta', 'valve', 'mondial', 'cadence', 'walita', 'panasonic', 'sharp', 'hayom', 'ugreen', 'qcy', 'haylou', 'soundcore', 'beats',
  'bose', 'sennheiser', 'audio-technica', 'steelseries', 'havit', 'fortrek', 'husky', 'thermaltake', 'cooler master', 'nzxt', 'deepcool',
  'lian li', 'rise mode', 'gamemax', 'superframe', 'xpg', 'adata', 'netac', 'patriot', 'teamgroup', 'sandisk', 'lexar'];

export function guessBrand(title) {
  const t = normalize(title);
  return KNOWN_BRANDS.find((b) => new RegExp(`(^|\\s)${b.replace(/[+]/g, '\\+')}(\\s|$)`).test(t)) || null;
}

const USED = /\b(usad[oa]s?|seminov[oa]s?|recondicionad[oa]s?|refurbished|vitrine|open ?box|mostruario|reembalad[oa])\b/;

export function normalize(title) {
  let s = stripAccents(String(title || '').toLowerCase());
  s = s.replace(/[“”"″]/g, ' pol ');
  s = s.replace(/(\d+)\s*(gb|tb|mb|mah|w|hz|mp|pol)\b/g, '$1$2');
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  s = s.replace(/wi-fi/g, 'wifi');
  s = s.replace(/[()\[\]{}|,;:!?*/\\+–—_]+/g, ' ');
  s = s.replace(/\s-\s|\s-|-\s/g, ' ');
  s = s.replace(/meia noite/g, 'meianoite');
  return s.replace(/\s+/g, ' ').trim();
}

export function tokens(title) {
  return normalize(title).split(' ').filter((t) => t && !STOP.has(t));
}

export function isUsed(title) {
  return USED.test(normalize(title));
}

function isAccessory(normTitle) {
  // Acessório quando o título COMEÇA com a palavra (ex.: "Capa para iPhone") ou diz "compatível com"
  const head = normTitle.split(' ').slice(0, 3).join(' ');
  if (/(^|\s)(compativel|compatível|acessorios?)(\s|$)/.test(normTitle)) return true;
  return ACCESSORY_N.some((a) => new RegExp(`(^|\\s)${a}s?(\\s|$)`).test(head));
}

function isBundle(normTitle) {
  const rest = normTitle.split(' ').slice(3).join(' ');
  return /\b(kit|combo|bundle|\d+ jogos?)\b/.test(normTitle) || ACCESSORY_N.some((a) => new RegExp(`(^|\\s)${a}s?(\\s|$)`).test(rest));
}
const SOFT_VARIANTS = new Set(['dual', 'wifi', '5g', '4g', 'lte', 'oc']);
const SPEC_CODE = /^\d+(bits?|mhz|ghz|nm|v|cm|mm|kg|g|ml|l|rpm|btus?)$/;

/** Analisa um título → características usadas no matching. */
export function analyze(title, extra = {}) {
  const norm = normalize(title);
  const toks = tokens(title);
  const caps = new Set(toks.filter((t) => /^\d+(gb|tb)$/.test(t)));
  const colors = new Set(toks.map((t) => COLORS.get(t)).filter(Boolean));
  const variants = new Set(toks.filter((t) => VARIANT_WORDS.has(t)));
  // Códigos de modelo: tokens com letras+dígitos (rtx4060? a2337, sm-s921b) ou números relevantes
  const codes = new Set(
    toks.filter((t) => {
      if (caps.has(t)) return false;
      if (/^\d+(mah|w|hz|mp|pol)$/.test(t) || SPEC_CODE.test(t)) return false;
      if (t.length > 9) return false; // SKUs longos tratados à parte
      if (/^\d+(\.\d+)?$/.test(t)) return t.length >= 1 && t.length <= 5 && !t.includes('.');
      return /\d/.test(t) && /[a-z]/.test(t) && t.length >= 2;
    }),
  );
  return {
    norm, toks: new Set(toks), caps, colors, variants, codes,
    accessory: isAccessory(norm),
    bundle: isBundle(norm),
    skus: new Set(toks.filter((t) => t.length > 9 && /\d/.test(t) && /[a-z]/.test(t))),
    used: USED.test(norm),
    brand: extra.brand ? stripAccents(String(extra.brand).toLowerCase()).trim() : null,
    gtin: extra.gtin ? String(extra.gtin).replace(/\D/g, '').replace(/^0+/, '') : null,
  };
}

function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

/**
 * Compara a identidade do produto com um candidato.
 * Retorna { score: 0..1, reasons: [], reject: bool }.
 */
export function compare(identity, cand) {
  const A = identity.analysis || analyze(identity.title, identity);
  const B = analyze(cand.title, cand);
  const reasons = [];

  if (B.used || cand.condition === 'used') return { score: 0, reject: true, reasons: ['usado/recondicionado'] };
  if (B.accessory && !A.accessory) return { score: 0, reject: true, reasons: ['acessório'] };

  if (A.gtin && B.gtin) {
    if (A.gtin === B.gtin) return { score: 1, reject: false, reasons: ['EAN idêntico'] };
  }

  const skuHit = [...A.skus].some((k) => B.norm.includes(k));

  // Marca
  let brandOk = 0.5;
  if (A.brand) {
    const bToks = A.brand.split(/\s+/);
    brandOk = bToks.every((b) => B.toks.has(b) || B.norm.includes(b) || (B.brand && B.brand.includes(b))) ? 1 : 0;
    if (!brandOk) {
      const other = KNOWN_BRANDS.find((b) => !A.brand.includes(b) && !bToks.includes(b) && new RegExp(`(^|\\s)${b}(\\s|$)`).test(B.norm));
      if (other) return { score: 0.1, reject: true, reasons: [`outra marca (${other})`] };
      reasons.push('marca não informada no anúncio');
    }
  }

  // Capacidades (ex.: 128gb) — devem ser idênticas
  if (A.caps.size) {
    const missing = [...A.caps].filter((c) => !B.caps.has(c));
    const extra = [...B.caps].filter((c) => !A.caps.has(c));
    if (extra.length && missing.length) return { score: 0.1, reject: true, reasons: [`capacidade diferente (${extra.join(',')})`] };
    if (missing.length) reasons.push(`sem capacidade ${missing.join(',')}`);
    if (extra.length > 1) reasons.push('várias capacidades no título');
  }

  // Cor — se ambos informam e são diferentes, é outra variação
  if (A.colors.size && B.colors.size) {
    const common = [...A.colors].some((c) => B.colors.has(c));
    if (!common) return { score: 0.2, reject: true, reasons: ['cor diferente'] };
  }

  // Palavras de variante (pro/plus/max/ti…) precisam coincidir
  const vMissing = [...A.variants].filter((v) => !B.variants.has(v) && !SOFT_VARIANTS.has(v));
  const vExtra = [...B.variants].filter((v) => !A.variants.has(v) && !SOFT_VARIANTS.has(v));
  if (vExtra.length) return { score: 0.2, reject: true, reasons: [`outra versão (${vExtra.join(',')})`] };
  if (vMissing.length) reasons.push(`sem "${vMissing.join(',')}"`);

  // Códigos de modelo / números
  const codeHit = [...A.codes].filter((c) => B.codes.has(c) || B.norm.includes(c));
  const codeCov = A.codes.size ? codeHit.length / A.codes.size : 0.6;
  const extraNums = [...B.codes].filter((c) => /^\d+$/.test(c) && !A.codes.has(c) && c.length >= 2);
  if (A.codes.size && codeHit.length === 0) return { score: 0.15, reject: true, reasons: ['modelo diferente'] };
  // Números do modelo (ex.: "15" do iPhone 15, "4060" da RTX 4060) precisam estar todos presentes
  const numMissing = [...A.codes].filter((c) => /^\d+$/.test(c) && !B.codes.has(c) && !B.toks.has(c));
  if (numMissing.length && !skuHit) return { score: 0.15, reject: true, reasons: [`modelo diferente (sem ${numMissing.join(',')})`] };
  if (codeCov < 1) reasons.push('código de modelo incompleto');

  const jac = jaccard(A.toks, B.toks);
  let score = 0.45 * codeCov + 0.25 * Math.min(1, jac * 1.8) + 0.2 * brandOk + 0.1 * (vMissing.length ? 0 : 1);
  score -= 0.08 * vMissing.length;
  score -= 0.06 * Math.min(4, extraNums.length);
  if (A.caps.size && [...A.caps].some((c) => !B.caps.has(c))) score -= 0.12;
  if (extraNums.length >= 3) reasons.push('título lista vários modelos');
  if (skuHit) { score = Math.max(score, 0.92); reasons.push('código do fabricante idêntico'); }
  if (B.bundle && !A.bundle) { score -= 0.25; reasons.push('kit/combo com acessório'); }

  // Sanidade de preço
  if (identity.refPrice && cand.price) {
    const r = cand.price / identity.refPrice;
    if (r < 0.45) { score -= 0.25; reasons.push('preço muito abaixo do esperado'); }
    else if (r > 2.2) { score -= 0.15; reasons.push('preço muito acima do esperado'); }
  }
  score = Math.max(0, Math.min(1, score));
  return { score: Math.round(score * 100) / 100, reject: false, reasons };
}

export const AUTO_THRESHOLD = 0.8;
export const PENDING_THRESHOLD = 0.55;

/** Termo de busca enxuto a partir da identidade. */
export function buildQuery(identity) {
  if (identity.query) return identity.query;
  const A = analyze(identity.title, identity);
  const words = normalize(identity.title).split(' ').filter((t) => t && !STOP.has(t) && !COLORS.has(t));
  const keep = [];
  const push = (w) => { if (w && !keep.includes(w)) keep.push(w); };
  if (A.brand) A.brand.split(/\s+/).forEach(push);
  for (const w of words) {
    if (keep.length >= 7) break;
    if (/^\d+(mah|w|hz|mp|pol)$/.test(w)) continue;
    if (w.length > 14) continue; // códigos de SKU muito longos atrapalham a busca
    push(w);
  }
  for (const c of A.caps) if (!keep.includes(c)) keep.push(c);
  return keep.join(' ');
}
