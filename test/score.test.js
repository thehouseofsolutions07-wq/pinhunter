import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataScore, finalScore } from '../src/hunt/score.js';
import { productKey, normalizeProduct } from '../src/product.js';

const approx = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);

test('productKey joins source and id', () => {
  assert.equal(productKey({ source: 'aliexpress', sourceId: '123' }), 'aliexpress:123');
});

test('normalizeProduct parses percentages and numbers from strings', () => {
  const p = normalizeProduct({ source: 's', sourceId: '1', title: ' Mug ', price: '12.50', commissionRate: '7.0%', rating: '96.5%' });
  assert.equal(p.title, 'Mug');
  assert.equal(p.price, 12.5);
  approx(p.commissionRate, 0.07);
  approx(p.rating, 4.825); // 96.5% positive -> 5-star scale
});

test('dataScore is 5 when nothing is known', () => {
  assert.equal(dataScore({}), 5);
});

test('dataScore averages sales, rating and commission parts', () => {
  // sales 9999 -> 2.5*log10(10000)=10 ; rating 5 with 999 reviews -> 10*1=10 ; commission 100*0.05=5 -> 5
  approx(dataScore({ salesVolume: 9999, rating: 5, reviewCount: 999, price: 100, commissionRate: 0.05 }), 25 / 3);
});

test('dataScore caps each part at 10', () => {
  approx(dataScore({ salesVolume: 1e9 }), 10);
  approx(dataScore({ price: 1000, commissionRate: 0.5 }), 10);
});

test('finalScore weights data 0.6 and AI fit 0.4', () => {
  approx(finalScore(10, 0), 6);
  approx(finalScore(0, 10), 4);
});
