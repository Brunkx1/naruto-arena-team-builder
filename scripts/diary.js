#!/usr/bin/env node
/*
 * Diário de resultados por time (o jogo não expõe histórico de partidas para contas comuns).
 *
 * Fontes: (1) scripts/watch-matches.js — rodando enquanto você joga, registra cada partida de ladder com o time;
 *         (2) snapshots de download-account.js (só quando o time não mudou entre duas coletas);
 *         (3) registros manuais.
 *
 * Manual:  node scripts/diary.js registrar "Jiraiya" "Hiruko Sasori (S)" "Aburame Shino" 7 2
 *          (7 vitórias e 2 derrotas com esse time)  |  node scripts/diary.js  (mostra o resumo)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
let ACCOUNT = null; try { ACCOUNT = require(path.join(DATA, 'account.js')); } catch (e) { /* sem conta */ }
if (!ACCOUNT || !ACCOUNT.username) { console.error('Sem conta ativa. Rode scripts/download-account.js primeiro.'); process.exit(1); }
const user = ACCOUNT.username.toLowerCase();
const manualPath = path.join(DATA, 'accounts', user + '.manual.json');
let manual = []; try { manual = JSON.parse(fs.readFileSync(manualPath, 'utf8')); } catch (e) { /* vazio */ }

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'registrar') {
  const [a, b, c, w, l] = rest;
  if (!a || !b || !c) { console.error('Uso: node scripts/diary.js registrar "A" "B" "C" vitorias derrotas'); process.exit(1); }
  manual.push({ at: new Date().toISOString(), team: [a, b, c], win: +w || 0, lose: +l || 0 });
  fs.mkdirSync(path.dirname(manualPath), { recursive: true });
  fs.writeFileSync(manualPath, JSON.stringify(manual, null, 1));
  console.log('Registrado.');
}

// consolida com o mesmo módulo que a página usa (js/core/results.js)
const R = require('../js/core/results.js');
let observed = []; try { observed = JSON.parse(fs.readFileSync(path.join(DATA, 'accounts', user + '.results.json'), 'utf8')); } catch (e) { /* sem observador */ }
const agg = R.aggregate({ history: ACCOUNT.history || [], manual, observed });
for (const u of agg.unattributed) console.log(`  (sessão ${String(u.from).slice(0, 16)} → ${String(u.to).slice(0, 16)}: ${u.win}V/${u.lose}D, mas o time mudou entre as coletas — não atribuída)`);
const rows = agg.rows;
console.log(`\nResultados por time — conta ${ACCOUNT.username} (${agg.observedMatches} partidas observadas: ${agg.ladderMatches} ladder, ${agg.quickMatches} quick match · ${agg.snapshots} snapshots · ${agg.manual} registros manuais)`);
if (!rows.length) console.log('  ainda sem sessões atribuídas: deixe "Observar partidas" ligado enquanto joga, ou use "registrar".');
for (const r of rows) console.log(`  ${(r.wr == null ? '  -' : r.wr.toFixed(0).padStart(3) + '%')} em ${String(r.games).padStart(3)} partidas (${r.win}V/${r.lose}D${r.unknown ? `, ${r.unknown} sem resultado` : ''}${r.quick ? `, ${r.quick} quick` : ''}) · sequência máx. ${r.maxStreak}${r.sessions ? ` · ${r.sessions} sessões` : ''} · ${r.sources.join('+')}  ${r.team.join(' + ')}`);
fs.writeFileSync(path.join(DATA, 'accounts', user + '.summary.json'), JSON.stringify(rows, null, 1));
require('./lib-results.js').gerar(ACCOUNT.username);   // -> data/results.js (card "Meus resultados" na página)
