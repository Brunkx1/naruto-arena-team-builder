#!/usr/bin/env node
/*
 * Mede a qualidade da estimativa de winrate (data/winrate.js) contra as próprias medições do staff:
 * para cada medição com amostra decente, prevê o valor usando só o que era conhecido ANTES dela e
 * compara com o publicado. Serve para (a) saber o erro típico da nota e (b) comparar fórmulas
 * alternativas antes de trocar a de build-winrate.js.
 *
 * Uso: node scripts/validate-winrate.js [--json]
 */
'use strict';
const path = require('path');
const W = require(path.join(__dirname, '..', 'data', 'winrate.js'));
const MODEL = W._model || {};
const EFFECT = MODEL.effect || { '-1': { a: 0, b: 0 }, '0': { a: 0, b: 0 }, '1': { a: 0, b: 0 } };
const dirOf = t => { const s = String(t || '').toLowerCase(); if (/nerf/.test(s)) return -1; if (/boost|buff/.test(s)) return 1; return 0; };
const applyEffect = m => { const e = EFFECT[String(dirOf(m.type))] || { a: 0, b: 0 }; return m.winrate + e.a + e.b * m.winrate; };
const months = (a, b) => (b - a) / (30 * 864e5);

const series = [];
for (const [name, v] of Object.entries(W)) {
  if (name === '_model' || !v || !v.series) continue;
  const arr = v.series.map(s => ({ ...s, ts: new Date(s.date).getTime() })).sort((a, b) => a.ts - b.ts);
  if (arr.length >= 2) series.push({ name, arr, expected: v.expected != null ? v.expected : (MODEL.mean || 55) });
}

// estimadores (past = medições anteriores, da mais antiga para a mais nova)
const EST = {
  'programa (atual)': (past, at, exp) => {
    const rec = ts => { const m = months(ts, at); return m < 6 ? 1 : m < 12 ? 0.8 : m < 24 ? 0.6 : 0.4; };
    let ws = 0, vs = 0;
    for (const m of past) { const w = m.matches * rec(m.ts); ws += w; vs += applyEffect(m) * w; }
    const raw = vs / ws;
    const shrink = Math.min(0.5, Math.max(0, months(past[past.length - 1].ts, at)) / 24 * 0.5);
    return raw + (exp - raw) * shrink;
  },
  'só a última medição': past => applyEffect(past[past.length - 1]),
  'última + tier': (past, at, exp) => { const l = past[past.length - 1], c = l.matches / (l.matches + 400); return applyEffect(l) * c + exp * (1 - c); },
  'só o tier': (past, at, exp) => exp,
  'decaimento 12m, teto 1500': (past, at, exp) => {
    let ws = 0, vs = 0;
    for (const m of past) { const w = Math.min(m.matches, 1500) * Math.pow(0.5, months(m.ts, at) / 12); ws += w; vs += applyEffect(m) * w; }
    const raw = vs / ws, conf = ws / (ws + 400);
    return raw * conf + exp * (1 - conf);
  },
};

const names = Object.keys(EST);
const err = Object.fromEntries(names.map(n => [n, []]));
const errFresh = Object.fromEntries(names.map(n => [n, []]));
let cases = 0, fresh = 0;
for (const s of series) {
  for (let i = 1; i < s.arr.length; i++) {
    const target = s.arr[i];
    if (!(target.matches >= 300)) continue;
    const past = s.arr.slice(0, i);
    const isFresh = months(past[past.length - 1].ts, target.ts) <= 9;
    cases++; if (isFresh) fresh++;
    for (const n of names) { const e = EST[n](past, target.ts, s.expected) - target.winrate; err[n].push(e); if (isFresh) errFresh[n].push(e); }
  }
}
const mae = a => a.reduce((s, x) => s + Math.abs(x), 0) / a.length;
const bias = a => a.reduce((s, x) => s + x, 0) / a.length;
const rmse = a => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const p = (a, q) => { const b = a.map(Math.abs).sort((x, y) => x - y); return b[Math.floor(q * (b.length - 1))]; };
const best = names.slice().sort((a, b) => mae(err[a]) - mae(err[b]))[0];
const out = { cases, fresh, generatedAt: new Date().toISOString(), best, typicalError: Math.round(mae(err['programa (atual)']) * 10) / 10, p90: Math.round(p(err['programa (atual)'], 0.9) * 10) / 10, bias: Math.round(bias(err['programa (atual)']) * 10) / 10 };

if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
console.log(`Previsão da próxima medição publicada: ${cases} casos (medições com 300+ partidas que têm alguma anterior)\n`);
console.log('fórmula'.padEnd(26), 'erro médio'.padStart(11), 'viés'.padStart(7), 'RMSE'.padStart(7), '90% abaixo de'.padStart(14), 'medição < 9 meses'.padStart(18));
for (const n of names.sort((a, b) => mae(err[a]) - mae(err[b]))) {
  console.log(n.padEnd(26), mae(err[n]).toFixed(2).padStart(11), bias(err[n]).toFixed(2).padStart(7), rmse(err[n]).toFixed(2).padStart(7), p(err[n], 0.9).toFixed(1).padStart(14), mae(errFresh[n]).toFixed(2).padStart(18));
}
console.log(`\nA fórmula do programa erra em média ${out.typicalError} pontos de winrate (90% dos casos abaixo de ${out.p90}).`);
console.log(`Melhor fórmula testada: "${best}"${best === 'programa (atual)' ? ' — nada a trocar.' : ' — vale considerar a troca em scripts/build-winrate.js.'}`);
console.log('Leitura: usar só a medição mais recente é PIOR que somar o histórico, porque amostras pequenas oscilam muito.');
require('fs').writeFileSync(path.join(__dirname, '..', 'data', 'winrate-validation.json'), JSON.stringify(out, null, 1));
