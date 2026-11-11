// Registro das lojas.
import * as amazon from './amazon.js';
import * as kabum from './kabum.js';
import * as aliexpress from './aliexpress.js';
import * as zoom from './zoom.js';
import { makeStore } from './others.js';
import { STORES, storeFromURL, storeFromName, storeLabel } from './catalog.js';

export const ADAPTERS = {
  amazon,
  kabum,
  aliexpress,
  mercadolivre: makeStore('mercadolivre'),
  magalu: makeStore('magalu'),
  casasbahia: makeStore('casasbahia'),
  terabyte: makeStore('terabyte'),
  pichau: makeStore('pichau'),
  shopee: makeStore('shopee'),
};

export { zoom, STORES, storeFromURL, storeFromName, storeLabel };
