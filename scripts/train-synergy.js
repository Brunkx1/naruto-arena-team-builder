#!/usr/bin/env node
/*
 * Treina a regra de combinação de times (pesos de cobertura de papéis, sinergia, choque de chakra e
 * preparação) a partir de trios RECOMENDADOS no fórum (data/community.js, ponderados por recência/staff)
 * e dos times conhecidos em data/curated/calibration.json, contra trios aleatórios formados com os mesmos
 * personagens (assim a força individual não separa sozinha).
 *
 * Modelo: regressão logística  P(recomendado) = σ(w0 + w·features).  Os coeficientes viram os pesos do
 * motor (js/core/engine.js › setWeights) via data/synergy-model.json, carregado pela interface e pelo CLI.
 * Uso: node scripts/train-synergy.js [--modo=forca|todos|diario] [--dias=365] [--aplicar]
 *   forca  = trios de ladder do fórum + calibração  |  todos = todo o fórum  |  diario = só seus resultados (+ calibração)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const E = require('../js/core/engine.js');
const CHARS = require(path.join(DATA, 'characters.js'));
let W = null; try { W = require(path.join(DATA, 'winrate.js')); } catch (e) { /* sem */ }
let C = null; try { C = require(path.join(DATA, 'community.js')); } catch (e) { /* sem */ }
let CAL = { times: [] }; try { CAL = require(path.join(DATA, 'curated/calibration.json')); } catch (e) { /* sem */ }
try { E.setOverrides(require(path.join(DATA, 'skill-overrides.js'))); } catch (e) { /* sem */ }
E.setWeights({}); // pesos padrão: as features vêm dos componentes, não do total
if (C && C.combos) E.setKnownCombos(C.combos);
const profiles = E.scoreChars(CHARS, null, W);
const byName = new Map(profiles.map(p => [p.name, p]));

// features de um trio (todas em escala ~0..1)
function features(team) {
  const r = E.scoreTeam(team);
  const scores = team.map(m => m.score / 100);
  const types = new Set(); team.forEach(m => m.specificTypes.forEach(t => types.add(t)));
  return {
    base: scores.reduce((a, b) => a + b, 0) / 3, minScore: Math.min(...scores),
    coverage: r.coverage.value, synergy: r.synergy.value, clash: r.clash.penalty, setup: r.setupPen,
    types: types.size / 4, random: team.reduce((a, m) => a + m.randomRatio, 0) / 3,
  };
}
const FEATS = ['base', 'minScore', 'coverage', 'synergy', 'clash', 'setup', 'types', 'random'];

// positivos
const pos = [];
const MODE = (process.argv.find(a => a.startsWith('--modo=')) || '--modo=forca').slice(7); // forca | todos | diario
const RECENT_DAYS = +((process.argv.find(a => a.startsWith('--dias=')) || '--dias=365').slice(7));
const parseDate = s => new Date(String(s || '').replace(/^[A-Za-z]+,\s*/, '').replace(/(\d+)(st|nd|rd|th)\b/, '$1').replace(' at ', ' '));
if (C && C.teams) for (const t of C.teams) {
  const team = t.members.map(n => byName.get(n)); if (!team.every(Boolean)) continue;
  const strength = (t.contexts && t.contexts.strength) || 0, mission = (t.contexts && t.contexts.mission) || 0;
  const d = parseDate(t.lastDate); const recentOk = !isNaN(d) && (Date.now() - d.getTime()) < RECENT_DAYS * 864e5;
  if (MODE === 'forca' && !(strength > 0 && mission === 0 && recentOk && !t.stale)) continue; // só ladder/força, recente, sem rework depois
  pos.push({ team, w: Math.max(0.25, t.recent || 0.25) * (t.staff ? 2 : 1), src: 'forum' });
}
for (const t of CAL.times || []) { if (t.esperado !== 'forte') continue; const team = t.membros.map(n => byName.get(n)); if (team.every(Boolean)) pos.push({ team, w: 6, src: 'calibracao' }); }
// diário (scripts/diary.js / watch-matches.js): SEUS resultados por time — o rótulo mais confiável que existe
const negFromDiary = [];
try {
  const acc = require(path.join(DATA, 'account.js'));
  const files = fs.readdirSync(path.join(DATA, 'accounts')).filter(f => f.endsWith('.summary.json'));
  for (const f of files) for (const r of JSON.parse(fs.readFileSync(path.join(DATA, 'accounts', f), 'utf8'))) {
    if (r.games < 8) continue;
    const team = r.team.map(n => byName.get(n)); if (!team.every(Boolean)) continue;
    const wgt = Math.min(10, 2 + r.games / 4);
    if (r.wr >= 55) pos.push({ team, w: wgt, src: 'diario' }); else if (r.wr <= 45) negFromDiary.push({ team, w: wgt, src: 'diario' });
  }
  void acc;
} catch (e) { /* sem diário */ }
if (MODE === 'diario') { pos.splice(0, pos.length, ...pos.filter(p => p.src !== 'forum')); }
if (pos.length < (MODE === 'diario' ? 8 : 30)) { console.error('Poucos trios rotulados (' + pos.length + ') no modo ' + MODE + '. ' + (MODE === 'diario' ? 'Jogue mais times com o observador ligado.' : 'Tente --modo=todos.')); process.exit(1); }
console.log(`modo: ${MODE} (trios ${MODE === 'forca' ? 'de contexto ladder/força, últimos ' + RECENT_DAYS + ' dias, sem rework depois' : 'todos'})`);
// negativos: trios aleatórios com os mesmos personagens dos positivos (embaralhados), sem variantes repetidas
const poolNames = [...new Set(pos.flatMap(p => p.team.map(m => m.name)))];
let seed = 42; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const posKeys = new Set(pos.map(p => p.team.map(m => m.name).sort().join('|')));
const neg = [];
while (neg.length < pos.length * 3) {
  const pick = new Set(); while (pick.size < 3) pick.add(poolNames[Math.floor(rnd() * poolNames.length)]);
  const team = [...pick].map(n => byName.get(n));
  if (new Set(team.map(m => m.vkey)).size < 3) continue;
  if (posKeys.has(team.map(m => m.name).sort().join('|'))) continue;
  neg.push({ team, w: 1, src: 'random' });
}
for (const n of negFromDiary) neg.push(n);
const rows = [...pos.map(p => ({ ...p, y: 1 })), ...neg.map(n => ({ ...n, y: 0 }))].map(r => ({ ...r, x: features(r.team) }));
// normalização z-score por feature
const mean = {}, sd = {};
for (const f of FEATS) { const v = rows.map(r => r.x[f]); const m = v.reduce((a, b) => a + b, 0) / v.length; mean[f] = m; sd[f] = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1; }
const z = r => FEATS.map(f => (r.x[f] - mean[f]) / sd[f]);
// split treino/validação (80/20)
const idx = rows.map((_, i) => i).sort(() => rnd() - 0.5);
const cut = Math.floor(rows.length * 0.8);
const train = idx.slice(0, cut).map(i => rows[i]), valid = idx.slice(cut).map(i => rows[i]);
// regressão logística por gradiente
const sig = t => 1 / (1 + Math.exp(-t));
let w = new Array(FEATS.length).fill(0), b = 0; const lr = 0.05, l2 = 0.01;
for (let epoch = 0; epoch < 400; epoch++) {
  const gw = new Array(FEATS.length).fill(0); let gb = 0;
  for (const r of train) { const xz = z(r); const p = sig(b + w.reduce((s, wi, i) => s + wi * xz[i], 0)); const err = (p - r.y) * r.w; for (let i = 0; i < w.length; i++) gw[i] += err * xz[i]; gb += err; }
  const n = train.length;
  for (let i = 0; i < w.length; i++) w[i] -= lr * (gw[i] / n + l2 * w[i]); b -= lr * gb / n;
}
const auc = rs => { const ps = rs.filter(r => r.y === 1), ns = rs.filter(r => r.y === 0); let s = 0; const sc = r => sig(b + w.reduce((a, wi, i) => a + wi * z(r)[i], 0)); const pp = ps.map(sc), nn = ns.map(sc); for (const a of pp) for (const c of nn) s += a > c ? 1 : a === c ? 0.5 : 0; return s / (pp.length * nn.length); };
console.log(`positivos: ${pos.length} (fórum ${pos.filter(p => p.src === 'forum').length}, calibração ${pos.filter(p => p.src === 'calibracao').length}, diário ${pos.filter(p => p.src === 'diario').length}) · negativos: ${neg.length} (diário ${negFromDiary.length}) · personagens no pool: ${poolNames.length}`);
console.log(`AUC treino ${auc(train).toFixed(3)} · AUC validação ${auc(valid).toFixed(3)}  (0,5 = acaso; quanto maior, melhor a regra separa recomendados de aleatórios)`);
console.log('\ncoeficientes (padronizados; sinal = direção, tamanho = importância):');
FEATS.forEach((f, i) => console.log(`  ${f.padEnd(9)} ${w[i] >= 0 ? '+' : ''}${w[i].toFixed(3)}`));
// tradução para pesos do motor: total = base + cov*RC + syn*S - clash*CL - setup*SP (em pontos de nota).
// coeficiente por unidade da feature = w_i / sd_i; base tem escala 100 pontos -> fator k = 100 / (w_base/sd_base)
const per = f => w[FEATS.indexOf(f)] / sd[f];
const k = per('base') > 0 ? 100 / per('base') : null;
let suggested = null;
if (k) {
  suggested = {
    roleCoverage: Math.max(0, Math.round(per('coverage') * k)), synergy: Math.max(0, Math.round(per('synergy') * k)),
    clash: Math.max(0, Math.round(-per('clash') * k)), setupPenalty: Math.max(0, Math.round(-per('setup') * k)),
  };
  console.log('\npesos sugeridos para o motor (pontos de nota por unidade):', JSON.stringify(suggested), '· padrão:', JSON.stringify({ roleCoverage: E.DEFAULT_WEIGHTS.roleCoverage, synergy: E.DEFAULT_WEIGHTS.synergy, clash: E.DEFAULT_WEIGHTS.clash, setupPenalty: E.DEFAULT_WEIGHTS.setupPenalty }));
  console.log(`(tipos de chakra distintos: ${per('types') * k >= 0 ? '+' : ''}${(per('types') * k / 4).toFixed(1)} pontos por tipo · custos Random: ${(per('random') * k).toFixed(1)} pontos por 100%)`);
} else console.log('\nbase sem coeficiente positivo: não dá para traduzir em pesos.');
const model = { trainedAt: new Date().toISOString(), positives: pos.length, negatives: neg.length, aucTrain: auc(train), aucValid: auc(valid), features: FEATS, coef: Object.fromEntries(FEATS.map((f, i) => [f, w[i]])), mean, sd, intercept: b, suggestedWeights: suggested };
fs.writeFileSync(path.join(DATA, 'synergy-model.json'), JSON.stringify(model, null, 1));
console.log('\nmodelo salvo em data/synergy-model.json' + (process.argv.includes('--aplicar') && suggested ? ' e aplicado em data/trained-weights.js' : ' (use --aplicar para gerar data/trained-weights.js)'));
if (process.argv.includes('--aplicar') && suggested) fs.writeFileSync(path.join(DATA, 'trained-weights.js'), `// Pesos da regra de time treinados por scripts/train-synergy.js em ${model.trainedAt.slice(0, 10)} (AUC validação ${model.aucValid.toFixed(2)})\n(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_TRAINED_WEIGHTS = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify({ ...suggested, _meta: { trainedAt: model.trainedAt, mode: MODE, aucValid: Math.round(model.aucValid * 1000) / 1000, positives: pos.length, negatives: neg.length } })});\n`);
