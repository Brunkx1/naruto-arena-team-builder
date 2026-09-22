#!/usr/bin/env node
/*
 * Gera data/winrate.js a partir das estatísticas OFICIAIS publicadas pelo staff nos patch notes
 * (data/balance-history.js, campo winrate de cada mudança) e nos posts "History of Balance" do fórum
 * (data/forum.js, linhas "Nome Wins: N (X%) Matches: M (Y%)").
 *
 * Para cada personagem: última medição (winrate, partidas, uso, data, tipo da mudança que veio junto)
 * e a série completa. O programa mistura isso à nota (js/core/engine.js › blendWinrate).
 * Uso: node scripts/build-winrate.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const B = require(path.join(DATA, 'balance-history.js'));
const CHARS = require(path.join(DATA, 'characters.js'));
let F = null; try { F = require(path.join(DATA, 'forum.js')); } catch (e) { /* opcional */ }

const canon = new Map(CHARS.map(c => [c.name.toLowerCase(), c.name]));
const parseDate = s => { const d = new Date(String(s || '').replace(/^[A-Za-z]+,\s*/, '').replace(/(\d+)(st|nd|rd|th)\b/, '$1').replace(' at ', ' ')); return isNaN(d) ? null : d; };
const series = new Map();
const add = (name, m) => { const n = canon.get(String(name).trim().toLowerCase()); if (!n || !m.winrate || !m.matches) return; const a = series.get(n) || []; a.push(m); series.set(n, a); };

for (const p of B) {
  const d = parseDate(p.date);
  for (const ch of p.changes) if (ch.winrate && ch.winrate.winrate) add(ch.name, { date: d ? d.toISOString().slice(0, 10) : null, ts: d ? d.getTime() : 0, winrate: ch.winrate.winrate, matches: ch.winrate.matches, usage: ch.winrate.usage, type: ch.type, source: 'patch notes: ' + p.title });
}
if (F) {
  // nome sem ponto (o ponto final da frase anterior não faz parte do nome): "Akatsuchi (S). Uchiha Itachi (S) Wins:"
  const re = /([A-Z][A-Za-z'\-]+(?: [A-Za-z\(\)'\-]+){0,5}?)\s*Wins:\s*([\d,\.]+)\s*\(([\d\.]+)%\)\s*Matches:\s*([\d,\.]+)\s*\(([\d\.]+)%\)/g;
  for (const t of F.topics) for (const p of t.posts) {
    if (/^member$/i.test(p.role || 'Member')) continue; // só staff
    const d = parseDate(p.date); const txt = p.text.replace(/\s+/g, ' '); let m;
    while ((m = re.exec(txt)) !== null) add(m[1], { date: d ? d.toISOString().slice(0, 10) : null, ts: d ? d.getTime() : 0, winrate: +m[3], matches: +m[4].replace(/[,\.]/g, ''), usage: +m[5], type: 'forum', source: 'fórum: ' + t.title });
  }
}

// -----------------------------------------------------------------------------------------------------
// A estatística é medida ANTES da mudança que a acompanha. Para estimar o winrate atual, medimos nos
// próprios dados o efeito médio de cada tipo de mudança: pares (medição -> medição seguinte do mesmo
// personagem) dão delta = depois - antes, modelado como delta ≈ a + b × winrate_antes, por direção.
// (Viés conhecido: só é remedido quem é alterado de novo; o efeito real de um nerf tende a ser maior.)
const now = Date.now();
const dirOf = type => (/nerf/i.test(type) ? -1 : /boost|buff/i.test(type) ? 1 : 0);
const pairs = { '-1': [], '1': [], '0': [] };
for (const arr of series.values()) {
  const s = arr.slice().sort((a, b) => a.ts - b.ts);
  for (let i = 0; i + 1 < s.length; i++) if (s[i].matches >= 300 && s[i + 1].matches >= 300 && s[i].ts && s[i + 1].ts) pairs[String(dirOf(s[i].type))].push({ before: s[i].winrate, delta: s[i + 1].winrate - s[i].winrate });
}
const FALLBACK = { '-1': { a: -2.0, b: -0.09 }, '1': { a: 15.2, b: -0.22 }, '0': { a: 12.0, b: -0.20 } };
const effect = {};
for (const d of ['-1', '1', '0']) {
  const arr = pairs[d];
  if (arr.length < 15) { effect[d] = { ...FALLBACK[d], n: arr.length, fallback: true }; continue; }
  const n = arr.length, mx = arr.reduce((s, p) => s + p.before, 0) / n, my = arr.reduce((s, p) => s + p.delta, 0) / n;
  const b = arr.reduce((s, p) => s + (p.before - mx) * (p.delta - my), 0) / arr.reduce((s, p) => s + (p.before - mx) ** 2, 0);
  effect[d] = { a: Math.round((my - b * mx) * 100) / 100, b: Math.round(b * 1000) / 1000, n, mean: Math.round(my * 10) / 10 };
}
console.log(`efeito medido das mudanças: nerf ${effect['-1'].mean ?? '?'} (n=${effect['-1'].n}) · buff +${effect['1'].mean ?? '?'} (n=${effect['1'].n}) · outros ${effect['0'].mean ?? '?'} (n=${effect['0'].n})`);
const applyEffect = x => { const e = effect[String(dirOf(x.type))]; return x.winrate + e.a + e.b * x.winrate; };
const recency = ts => { if (!ts) return 0.4; const m = (now - ts) / (30 * 864e5); return m < 6 ? 1 : m < 12 ? 0.8 : m < 24 ? 0.6 : 0.4; };

const out = {};
for (const [name, arr] of series) {
  arr.sort((a, b) => b.ts - a.ts);
  let wsum = 0, vsum = 0, usum = 0, msum = 0;
  for (const x of arr) { const w = x.matches * recency(x.ts); wsum += w; vsum += applyEffect(x) * w; usum += (x.usage || 0) * w; msum += x.matches; }
  // "última medição" de referência: a mais recente com amostra decente (>= 300 partidas), senão a mais recente
  const last = arr.find(x => x.matches >= 300) || arr[0];
  out[name] = {
    winrate: Math.round(vsum / wsum * 100) / 100, matches: msum, usage: Math.round(usum / wsum * 100) / 100,
    date: last.date, type: last.type, dir: dirOf(last.type), source: last.source, lastWinrate: last.winrate, lastMatches: last.matches,
    postChange: Math.round(applyEffect(last) * 100) / 100,
    series: arr.map(x => ({ date: x.date, winrate: x.winrate, matches: x.matches, usage: x.usage, type: x.type })),
  };
}
// Ajuste pelo tier de desbloqueio: o winrate por personagem carrega quem o joga (iniciantes usam os iniciais).
// Regressão winrate ~ nível de desbloqueio; "adjusted" = winrate - esperado + média geral (força relativa ao tier).
try {
  const MISSIONS = require(path.join(DATA, 'missions.js'));
  const unlock = new Map(CHARS.map(c => [c.name, 1]));
  for (const m of MISSIONS.missions) if (m.unlockedCharacter && unlock.has(m.unlockedCharacter)) unlock.set(m.unlockedCharacter, Math.max(unlock.get(m.unlockedCharacter) === 1 ? 0 : unlock.get(m.unlockedCharacter), m.levelRequirement || 1));
  const rows = Object.entries(out).filter(([n, v]) => v.matches >= 300).map(([n, v]) => ({ x: unlock.get(n) || 1, y: v.winrate }));
  const n = rows.length, mx = rows.reduce((s, r) => s + r.x, 0) / n, my = rows.reduce((s, r) => s + r.y, 0) / n;
  const b = rows.reduce((s, r) => s + (r.x - mx) * (r.y - my), 0) / rows.reduce((s, r) => s + (r.x - mx) ** 2, 0), a = my - b * mx;
  for (const [name, v] of Object.entries(out)) {
    const lvl = unlock.get(name) || 1; v.unlockLevel = lvl; v.expected = Math.round((a + b * lvl) * 100) / 100;
    // medição antiga: o meta andou; encolhe a estimativa em direção ao esperado do tier (até 50% após 2 anos)
    const months = v.date ? (now - new Date(v.date).getTime()) / (30 * 864e5) : 24;
    const shrink = Math.min(0.5, Math.max(0, months) / 24 * 0.5);
    v.winrateNoShrink = v.winrate;
    v.winrate = Math.round((v.winrate + (v.expected - v.winrate) * shrink) * 100) / 100;
    v.shrink = Math.round(shrink * 100) / 100;
    v.adjusted = Math.round((v.winrate - v.expected + my) * 100) / 100;
  }
  // sem medição utilizável (< 200 partidas): a expectativa do tier de desbloqueio vira a nota-base (o motor mistura com a heurística)
  const expectedNoData = {};
  for (const c of CHARS) { const v = out[c.name]; if (!v || !(v.matches >= 200)) { const lvl = unlock.get(c.name) || 1; expectedNoData[c.name] = { unlockLevel: lvl, expected: Math.round((a + b * lvl) * 100) / 100 }; } }
  let typicalError = null;
  try { typicalError = require(path.join(DATA, 'winrate-validation.json')).typicalError; } catch (e) { /* rode scripts/validate-winrate.js */ }
  out._model = { intercept: Math.round(a * 100) / 100, slope: Math.round(b * 1000) / 1000, mean: Math.round(my * 100) / 100, n, effect, expectedNoData, typicalError };
  console.log(`sem medição utilizável: ${Object.keys(expectedNoData).length} personagens recebem a expectativa do tier (${Object.entries(expectedNoData).slice(0, 4).map(([k, v]) => `${k} ${v.expected}%`).join(', ')}...)`);
  console.log(`ajuste por tier: winrate ≈ ${a.toFixed(1)} + ${b.toFixed(2)} × nível de desbloqueio (n=${n}, média ${my.toFixed(1)}%)`);
} catch (e) { console.warn('ajuste por tier não calculado:', e.message); }

const js = `// Winrate OFICIAL por personagem, extraído dos patch notes do site e dos posts de balanceamento do staff no fórum.\n// Gerado em ${new Date().toISOString().slice(0, 10)} por scripts/build-winrate.js. Última medição + série histórica.\n` +
  `(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_WINRATE = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(out)});\n`;
fs.writeFileSync(path.join(DATA, 'winrate.js'), js);
const n = Object.keys(out).filter(k => k !== '_model').length, meas = [...series.values()].reduce((s, a) => s + a.length, 0);
const missing = CHARS.filter(c => !out[c.name]).map(c => c.name);
console.log(`OK: ${n} personagens com winrate oficial (${meas} medições) -> data/winrate.js`);
console.log(`sem dados oficiais (${missing.length}): ${missing.join(', ')}`);
