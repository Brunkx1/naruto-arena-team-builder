#!/usr/bin/env node
/*
 * ============================================================================
 *  EXPERIMENTO ENCERRADO — leia antes de mexer aqui / CLOSED EXPERIMENT
 * ============================================================================
 *
 *  Este simulador NÃO alimenta as notas do programa. Foi medido em 2026-09-17
 *  contra o winrate oficial (o único gabarito disponível) e deu correlação de
 *  -0,13 — pior que sortear. Fica no repositório como registro do que foi
 *  tentado, não como ferramenta.
 *
 *  POR QUE FALHOU
 *  As mecânicas aqui são aproximadas a partir do TEXTO das habilidades, e o
 *  texto não descreve as regras com a precisão que uma simulação exige. O
 *  leitor (js/core/engine.js) erra ou ignora: acúmulos ("stacks"), cópia de skills,
 *  manipulação de cooldown, condições de gatilho, ordem da fila de efeitos e
 *  transformações que substituem habilidades. Num ranking essas falhas se
 *  diluem; numa simulação turno a turno elas se multiplicam.
 *
 *  O QUE SERIA PRECISO PARA FUNCIONAR
 *  1. Mecânicas curadas à mão, skill por skill (961 delas), num formato que a
 *     máquina execute — não extraídas de texto.
 *  2. Um motor fiel: ordem de fila, invulnerabilidade/counter/reflect,
 *     defesa destrutível, aflição que ignora redução, economia de chakra.
 *  3. Uma IA decente: a atual é gulosa (usa a skill de maior dano possível).
 *     Um jogador ruim faz time bom parecer ruim, o que contamina tudo.
 *  4. Validação partida a partida contra resultados reais. Isso hoje é
 *     possível: o histórico do perfil dá "time A x time B -> vencedor"
 *     (veja scripts/watch-matches.js). Era o que faltava em 2026-09-17.
 *
 *  Com (1) a (3) feitos e (4) mostrando que o simulador acerta o vencedor
 *  acima do acaso, aí sim ele poderia voltar a alimentar as sugestões.
 *
 *  EN: this battle simulator is a closed experiment. Measured against the
 *  official win rate it scored -0.13 (worse than chance), because its
 *  mechanics are approximated from skill *text* and the text is not precise
 *  enough for turn-by-turn simulation. Making it work would require
 *  hand-curated mechanics for all 961 skills, a faithful engine, a decent AI,
 *  and validation against real match outcomes (now collectable from the
 *  profile match history).
 * ============================================================================
 */

/*
 * Experimento do simulador: torneio IA×IA com times aleatórios -> winrate simulado por personagem ->
 * correlação com o winrate oficial (data/winrate.js). Critério: Spearman > 0,4 para valer a pena.
 * Uso: node scripts/simulate.js [--partidas 40000] [--seed 7]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const SB = require('../js/sim/battle.js');
const E = require('../js/core/engine.js');
const CHARS = require(path.join(DATA, 'characters.js'));
let W = {}; try { W = require(path.join(DATA, 'winrate.js')); } catch (e) { /* sem */ }
const args = process.argv.slice(2);
const N = +(args[args.indexOf('--partidas') + 1] || 40000);
const seed0 = +(args[args.indexOf('--seed') + 1] || 7);
const rnd = (a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(seed0);

const built = CHARS.map(c => ({ data: SB.build(c), vkey: E.variantKey(c.name), name: c.name })).filter(x => x.data.base.length >= 3);
const stats = new Map(built.map(x => [x.name, { wins: 0, games: 0, unparsed: x.data.base.filter(s => s.unparsed).length }]));
function pickTeam(exclude) {
  const team = []; const keys = new Set(exclude || []);
  while (team.length < 3) { const x = built[Math.floor(rnd() * built.length)]; if (keys.has(x.vkey)) continue; keys.add(x.vkey); team.push(x); }
  return team;
}
const t0 = Date.now(); let turns = 0, draws = 0;
for (let i = 0; i < N; i++) {
  const A = pickTeam(), B = pickTeam(A.map(x => x.vkey));
  const r = SB.simulate(A.map(x => x.data), B.map(x => x.data), 1 + Math.floor(rnd() * 1e9));
  turns += r.turns; if (r.winner < 0) draws++;
  for (const x of A) { const s = stats.get(x.name); s.games++; if (r.winner === 0) s.wins++; else if (r.winner < 0) s.wins += 0.5; }
  for (const x of B) { const s = stats.get(x.name); s.games++; if (r.winner === 1) s.wins++; else if (r.winner < 0) s.wins += 0.5; }
}
console.log(`${N} partidas em ${((Date.now() - t0) / 1000).toFixed(1)} s · média ${(turns / N).toFixed(1)} turnos · empates ${draws}`);
const rows = [...stats.entries()].map(([name, s]) => ({ name, sim: 100 * s.wins / Math.max(1, s.games), games: s.games, unparsed: s.unparsed, off: W[name] && W[name].winrate != null ? W[name].winrate : null, adj: W[name] && W[name].adjusted != null ? W[name].adjusted : null }));
const spearman = (xs, ys) => { const rank = a => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); s.forEach(([v, i], k) => { r[i] = k; }); return r; }; const rx = rank(xs), ry = rank(ys), n = xs.length, m = (n - 1) / 2; let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (rx[i] - m) * (ry[i] - m); dx += (rx[i] - m) ** 2; dy += (ry[i] - m) ** 2; } return num / Math.sqrt(dx * dy); };
const withOff = rows.filter(r => r.off != null && W[r.name].matches >= 300);
console.log(`\nSpearman(simulado, oficial bruto):    ${spearman(withOff.map(r => r.sim), withOff.map(r => r.off)).toFixed(3)}  (${withOff.length} personagens)`);
console.log(`Spearman(simulado, oficial ajustado): ${spearman(withOff.map(r => r.sim), withOff.map(r => r.adj)).toFixed(3)}`);
const clean = withOff.filter(r => r.unparsed === 0);
console.log(`Spearman só com kits 100% interpretados: ${spearman(clean.map(r => r.sim), clean.map(r => r.off)).toFixed(3)}  (${clean.length} personagens)`);
const E2 = E.scoreChars(CHARS); const heur = new Map(E2.map(p => [p.name, p.heuristicScore]));
console.log(`(referência) Spearman(heurística de texto, oficial): ${spearman(withOff.map(r => heur.get(r.name)), withOff.map(r => r.off)).toFixed(3)}`);
rows.sort((a, b) => b.sim - a.sim);
console.log('\nTOP 12 simulado:'); rows.slice(0, 12).forEach(r => console.log(`  ${r.sim.toFixed(1).padStart(5)}%  ${r.name.padEnd(30)} oficial ${r.off != null ? r.off.toFixed(1) + '%' : '   -  '}  ${r.unparsed ? '(' + r.unparsed + ' skill s/ efeito)' : ''}`));
console.log('BOTTOM 8 simulado:'); rows.slice(-8).forEach(r => console.log(`  ${r.sim.toFixed(1).padStart(5)}%  ${r.name.padEnd(30)} oficial ${r.off != null ? r.off.toFixed(1) + '%' : '   -  '}  ${r.unparsed ? '(' + r.unparsed + ' skill s/ efeito)' : ''}`));
fs.writeFileSync(path.join(DATA, 'sim-winrate.json'), JSON.stringify(rows, null, 1));
