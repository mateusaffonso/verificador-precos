import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, analyze, buildQuery } from '../src/match.js';
import { parseBRL } from '../src/util.js';
import { pickPrice } from '../src/stores/harvest.js';
import { detectCoupon } from '../src/stores/generic.js';

const iphone = { title: 'Apple iPhone 15 (128 GB) — Preto', brand: 'Apple', refPrice: 3800 };
iphone.analysis = analyze(iphone.title, iphone);
const ok = (t) => compare(iphone, { title: t, price: 3700 });

test('aceita o mesmo modelo', () => {
  assert.ok(ok('Apple iPhone 15 128GB Preto 6,1" 48MP iOS 5G').score >= 0.8);
  assert.ok(ok('iPhone 15 Apple 128GB Preto').score >= 0.8);
});

test('rejeita variações, acessórios e usados', () => {
  for (const t of ['Apple iPhone 15 Pro 128GB Preto', 'Apple iPhone 15 Plus 128GB Preto', 'Apple iPhone 15 256GB Preto',
    'Apple iPhone 15 128GB Azul', 'Capa para iPhone 15', 'iPhone 15 128GB Preto Usado', 'Apple iPhone 14 128GB Preto',
    'Película de vidro iPhone 15']) {
    assert.ok(ok(t).reject, t);
  }
});

test('kit com acessório fica pendente', () => {
  const r = ok('Smartphone Apple iPhone 15 128GB Preto - 5G + Carregador Apple USB-C');
  assert.ok(!r.reject && r.score < 0.8 && r.score >= 0.55);
});

test('rejeita outra marca de placa de vídeo', () => {
  const gpu = { title: 'Placa de Vídeo PcYes RTX 4060 8GB GDDR6 Dual Fan', brand: 'PCYES' };
  assert.ok(compare(gpu, { title: 'Placa de Video Gigabyte RTX 4060 Windforce 8GB' }).reject);
  assert.ok(compare(gpu, { title: 'Placa de Vídeo PCYes RTX 4060 Ti 8GB' }).reject);
  assert.ok(compare(gpu, { title: 'Placa de Vídeo PCYes NVIDIA GeForce RTX 4060 8GB GDDR6' }).score >= 0.8);
});

test('nome curto digitado casa com anúncio longo, mas não com outro modelo', () => {
  const cpu = { title: 'Ryzen 7 5700X', refPrice: 2685 };
  assert.ok(compare(cpu, { title: 'Processador AMD Ryzen 7 5700X, 3.4GHz, Cache 32MB, 8 Núcleos, Sem Cooler', price: 1219.99 }).score >= 0.8);
  assert.ok(compare(cpu, { title: 'Processador AMD Ryzen 7 5700X3D 8-Core AM4' }).reject);
  assert.ok(compare(cpu, { title: 'Processador AMD Ryzen 7 5800X' }).reject);
});

test('monta termo de busca enxuto', () => {
  assert.equal(buildQuery(iphone), 'apple iphone 15 128gb');
});

test('converte preços', () => {
  assert.equal(parseBRL('R$ 3.779,10'), 3779.1);
  assert.equal(parseBRL('R$1.234'), 1234);
  assert.equal(parseBRL('2599.99'), 2599.99);
  assert.equal(parseBRL(''), null);
  assert.equal(pickPrice('De R$ 5.000,00 por R$ 3.999,00 ou 10x de R$ 399,90 sem juros'), 3999);
  assert.equal(pickPrice('R$ 2.599,99 no PIX R$ 2.888,88 em até 10x de R$ 288,88'), 2599.99);
});

test('detecta cupom na página', () => {
  const c = detectCoupon('Aplicar cupom de 10% Termos', 1000);
  assert.equal(c.pct, 10);
  assert.equal(c.value, 100);
  const d = detectCoupon('Economize R$ 50,00 com cupom', 1000);
  assert.equal(d.value, 50);
  assert.equal(detectCoupon('Frete grátis', 1000), null);
});
