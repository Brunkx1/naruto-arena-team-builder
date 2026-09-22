#!/usr/bin/env node
/*
 * Mede a heurística contra a base de calibração (data/curated/calibration.json): onde cada time/personagem
 * conhecido como forte/fraco fica no ranking. Use antes e depois de mexer nos pesos ou no parser.
 */
'use strict';
const E = require('../js/core/engine.js');
const CHARS = require('../data/characters.js');
let OV = {}; try { OV = require('../data/curated/skill-overrides.js'); } catch (e) { /* sem correções */ }
E.setOverrides(OV);
const CAL = require('../data/curated/calibration.json');

let W = null; try { W = require('../data/winrate.js'); if (!Object.keys(W).length) W = null; } catch (e) { /* sem winrate */ }
const profiles = E.scoreChars(CHARS);           // só heurística, para medir contra os dados oficiais
const spearman = (xs, ys) => { const rank = a => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); s.forEach(([v, i], k) => { r[i] = k; }); return r; }; const rx = rank(xs), ry = rank(ys), n = xs.length, m = (n - 1) / 2; let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (rx[i] - m) * (ry[i] - m); dx += (rx[i] - m) ** 2; dy += (ry[i] - m) ** 2; } return num / Math.sqrt(dx * dy); };
if (W) {
  const rows = profiles.filter(p => W[p.name] && W[p.name].matches >= 300);
  console.log(`# Heurística × winrate oficial (${rows.length} personagens com 300+ partidas) — quanto maior, melhor a heurística prevê força`);
  console.log(`  nota heurística: ${spearman(rows.map(p => p.heuristicScore), rows.map(p => W[p.name].winrate)).toFixed(3)}`);
  for (const k of ['offense', 'control', 'defense', 'support', 'economy', 'tempo']) console.log(`  componente ${k.padEnd(8)}: ${spearman(rows.map(p => p.norm[k]), rows.map(p => W[p.name].winrate)).toFixed(3)}`);
  console.log('');
}
const N = profiles.length;
const pct = r => (100 * r / N).toFixed(0) + '%';
console.log('# Personagens (posição no ranking de ' + N + ')');
let ok = 0, total = 0;
for (const c of CAL.personagens || []) {
  const p = profiles.find(x => x.name === c.nome);
  if (!p) { console.log(`  ? ${c.nome}: não encontrado`); continue; }
  const good = c.esperado === 'forte' ? p.rank <= N * 0.35 : c.esperado === 'fraco' ? p.rank >= N * 0.6 : true;
  total++; if (good) ok++;
  console.log(`  ${good ? '✓' : '✗'} ${c.nome.padEnd(28)} esperado ${c.esperado.padEnd(6)} -> #${p.rank} (top ${pct(p.rank)}), nota ${p.score}`);
}
console.log('\n# Times (posição entre todos os trios sem variantes repetidas, choque permitido)');
let all = null;
for (const tm of CAL.times || []) {
  const team = tm.membros.map(n => profiles.find(x => x.name === n));
  if (team.some(x => !x)) { console.log(`  ? ${tm.membros.join(' + ')}: personagem não encontrado`); continue; }
  const r = E.scoreTeam(team);
  if (!all) all = E.suggestTeams(profiles, { poolSize: 216, limit: 20000, allowClash: true });
  const pos = all.findIndex(x => tm.membros.every(n => x.members.some(m => m.name === n)));
  const totalTrios = 1655320;
  const share = pos >= 0 ? (100 * (pos + 1) / totalTrios).toFixed(2) + '%' : '> 1.2%';
  const good = tm.esperado === 'forte' ? (pos >= 0 && pos < 20000) : true;
  total++; if (good) ok++;
  console.log(`  ${good ? '✓' : '✗'} ${tm.membros.join(' + ')}: nota ${r.total} · posição ${pos >= 0 ? '#' + (pos + 1) : '> 20000'} (top ${share}) · esperado ${tm.esperado}`);
  for (const l of E.explainTeam(r)) console.log('      ' + l);
}
console.log(`\n${ok}/${total} casos coerentes com o esperado`);
