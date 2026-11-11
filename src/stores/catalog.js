// Catálogo das lojas suportadas: identificação por domínio/nome e regras de "loja oficial/confiável".
import { stripAccents } from '../util.js';

export const STORES = {
  amazon: { name: 'Amazon', hosts: /(^|\.)amazon\.com\.br$/, cuponomia: 'amazon', promobit: 'amazon' },
  mercadolivre: { name: 'Mercado Livre', hosts: /(^|\.)mercadoli(vre|bre)\.com(\.br)?$/, cuponomia: 'mercado-livre', promobit: 'mercado-livre' },
  magalu: { name: 'Magalu', hosts: /(^|\.)(magazineluiza|magalu)\.com(\.br)?$/, cuponomia: 'magazine-luiza', promobit: 'magazine-luiza' },
  casasbahia: { name: 'Casas Bahia', hosts: /(^|\.)casasbahia\.com\.br$/, cuponomia: 'casas-bahia', promobit: 'casas-bahia' },
  kabum: { name: 'KaBuM!', hosts: /(^|\.)kabum\.com\.br$/, cuponomia: 'kabum', promobit: 'kabum' },
  terabyte: { name: 'Terabyte', hosts: /(^|\.)terabyteshop\.com\.br$/, cuponomia: null, promobit: 'terabyteshop' },
  pichau: { name: 'Pichau', hosts: /(^|\.)pichau\.com\.br$/, cuponomia: 'pichau', promobit: 'pichau' },
  shopee: { name: 'Shopee', hosts: /(^|\.)shopee\.com\.br$/, cuponomia: 'shopee', promobit: 'shopee', international: 'maybe' },
  aliexpress: { name: 'AliExpress', hosts: /(^|\.)aliexpress\.(com|us)$/, cuponomia: 'aliexpress', promobit: 'aliexpress', international: true },
};

const NAME_MAP = [
  [/amazon/, 'amazon'],
  [/mercado ?livre|mercadolivre/, 'mercadolivre'],
  [/magazine ?luiza|magalu/, 'magalu'],
  [/casas ?bahia/, 'casasbahia'],
  [/kabum/, 'kabum'],
  [/terabyte/, 'terabyte'],
  [/pichau/, 'pichau'],
  [/shopee/, 'shopee'],
  [/aliexpress/, 'aliexpress'],
];

export function storeFromName(name) {
  const n = stripAccents(String(name || '').toLowerCase());
  for (const [re, id] of NAME_MAP) if (re.test(n)) return id;
  return null;
}

export function storeFromURL(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    for (const [id, s] of Object.entries(STORES)) if (s.hosts.test(h)) return id;
  } catch {}
  return null;
}

export function storeLabel(id, fallback) {
  return STORES[id]?.name || fallback || id;
}

// Marketplaces onde o vendedor pode ser terceiro — exigem prova de loja oficial
export const MARKETPLACES = new Set(['mercadolivre', 'shopee', 'aliexpress']);
