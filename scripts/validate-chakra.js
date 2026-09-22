#!/usr/bin/env node
/*
 * O formato do custo de chakra atrapalha o personagem? Mede cada característica do custo (custo duplo do mesmo
 * tipo, número de tipos diferentes, proporção de Random, custo médio) contra o winrate medido, descontando o
 * efeito do tier de desbloqueio (winrate - esperado do tier). Serve para decidir, com dado, se vale penalizar
 * algum formato de custo na nota. Medido em 2026-09-22: tudo ~0 -> nada foi penalizado.
 *
 * Uso: node scripts/validate-chakra.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'js/core/engine.js'));
const CHARS = require(path.join(ROOT, 'data/characters.js'));
const W = require(path.join(ROOT, 'data/winrate.js'));
try { E.setOverrides(require(path.join(ROOT, 'data/curated/skill-overrides.js'))); } catch (e) { /* sem correções */ }
const TYPES = ['Taijutsu', 'Bloodline', 'Ninjutsu', 'Genjutsu', 'Tai', 'Blood', 'Nin', 'Gen'];
const norm = t => ({ Taijutsu: 'Tai', Bloodline: 'Blood', Ninjutsu: 'Nin', Genjutsu: 'Gen' }[t] || t);

const rows = [];
for (const c of CHARS) {
  const w = W[c.name];
  if (!w || !(w.matches >= 800) || w.expected == null) continue;   // só quem tem medição decente
  const skills = (c.skills || []).filter((s, i) => i < 4);          // as 4 visíveis
  let maxSame = 0, totalSpec = 0, totalRandom = 0, n = 0, double = 0;
  const types = new Set();
  for (const s of skills) {
    const counts = {};
    for (const e of s.energy || []) {
      const t = norm(e);
      if (t === 'Random') { totalRandom++; continue; }
      counts[t] = (counts[t] || 0) + 1; types.add(t); totalSpec++;
    }
    const m = Math.max(0, ...Object.values(counts));
    if (m >= 2) double++;
    maxSame = Math.max(maxSame, m);
    n++;
  }
  rows.push({
    name: c.name, y: w.winrate - w.expected,        // winrate acima/abaixo do esperado para o tier
    maxSame, double, distinctTypes: types.size,
    specPerSkill: totalSpec / Math.max(1, n), randomRatio: totalRandom / Math.max(1, totalSpec + totalRandom),
    custoMedio: (totalSpec + totalRandom) / Math.max(1, n),
  });
}
const sp = (xs, ys) => { const rk = a => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); s.forEach(([v, i], k) => { r[i] = k; }); return r; }; const rx = rk(xs), ry = rk(ys), n = xs.length, m = (n - 1) / 2; let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (rx[i] - m) * (ry[i] - m); dx += (rx[i] - m) ** 2; dy += (ry[i] - m) ** 2; } return num / Math.sqrt(dx * dy); };
console.log(`${rows.length} personagens com medição (800+ partidas). Correlação com o winrate ACIMA do esperado do tier:\n`);
for (const f of ['maxSame', 'double', 'distinctTypes', 'specPerSkill', 'randomRatio', 'custoMedio']) {
  console.log('  ' + f.padEnd(16), sp(rows.map(r => r[f]), rows.map(r => r.y)).toFixed(3));
}
// médias por grupo: tem skill com custo duplo do mesmo tipo?
const g = (pred, label) => { const a = rows.filter(pred), b = rows.filter(r => !pred(r)); const avg = x => x.reduce((s, r) => s + r.y, 0) / (x.length || 1); console.log(`  ${label}: ${a.length} personagens, winrate ${avg(a) >= 0 ? '+' : ''}${avg(a).toFixed(2)} vs ${b.length} com ${avg(b) >= 0 ? '+' : ''}${avg(b).toFixed(2)}`); };
console.log('\nGrupos:');
g(r => r.maxSame >= 2, 'tem skill com 2+ do MESMO tipo');
g(r => r.distinctTypes >= 3, 'precisa de 3+ tipos diferentes');
g(r => r.distinctTypes <= 1, 'usa 0 ou 1 tipo específico  ');
g(r => r.randomRatio >= 0.6, 'custo majoritariamente Random');

console.log('\nLeitura: correlações perto de 0 significam que o formato do custo NÃO explica a força do personagem;');
console.log('por isso a nota não penaliza custo duplo nem muitos tipos. O efeito no TIME (alinhar tipos entre os três)');
console.log('continua sem dado para validar — só o seu diário de partidas pode responder isso.');
