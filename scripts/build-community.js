#!/usr/bin/env node
/*
 * Pré-computa o sinal de comunidade/meta para a interface (data/community.js), a partir de
 * data/balance-history.js (patch notes) e data/forum.js (fórum): por personagem, contagem de nerfs/buffs,
 * linha do tempo compacta e menções; e os trios mais recomendados no fórum.
 * Uso: node scripts/build-community.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const M = require('../js/core/meta.js');
const CHARS = require(path.join(DATA, 'characters.js'));
let B = []; try { B = require(path.join(DATA, 'balance-history.js')); } catch (e) { /* sem patch notes */ }
let F = null; try { F = require(path.join(DATA, 'forum.js')); } catch (e) { /* sem fórum */ }

const meta = M.build(B, F, CHARS, {});
const chars = {};
for (const [name, s] of meta.stats) {
  chars[name] = {
    nerfs: s.nerfs, buffs: s.buffs, neutral: s.neutral, pressure: Math.round(s.pressure * 100) / 100, metaScore: s.metaScore,
    mentions: s.mentions, mentionsStrength: s.mentionsStrength, mentionsRecent: s.mentionsRecent, teamCount: s.teamCount, staffMentions: s.staffMentions || 0,
    timeline: s.timeline.slice(0, 12).map(t => ({ date: t.date, title: t.title, type: t.type, dir: t.dir, skills: t.skills.map(k => ({ name: k.name, text: (k.text || []).slice(0, 4) })) })),
  };
}
const teams = meta.teams.slice(0, 400).map(t => ({ members: t.members, count: t.count, weighted: t.weighted, recent: t.recent, stale: t.stale, staff: t.staff, contexts: t.contexts, lastDate: t.lastDate, topics: t.topics.slice(0, 3) }));
const combos = meta.combos.slice(0, 300);

// times reais salvos por jogadores da ladder (scripts/collect-ladder-teams.js): quem usa o quê, com a taxa do JOGADOR
// (a taxa é do jogador, não do time — cada um salva ~8 times; serve como catálogo, não como medida de força)
let ladderTeams = [], ladderInfo = null;
try {
  const L = require(path.join(DATA, 'ladder-teams.js'));
  const INICIAL = ['Haruno Sakura', 'Uchiha Sasuke', 'Uzumaki Naruto'].join(' + ');
  const nomes = new Set(CHARS.map(c => c.name));
  const mapa = new Map();
  let jogadores = 0;
  for (const p of L.players || []) {
    const games = (p.win || 0) + (p.lose || 0);
    if (games < 30 || !Array.isArray(p.teams)) continue;
    const wr = Math.round(1000 * p.win / games) / 10;
    jogadores++;
    for (const t of p.teams) {
      if (!Array.isArray(t) || t.length !== 3 || t.some(n => !nomes.has(n))) continue;
      const k = t.slice().sort().join(' + ');
      if (k === INICIAL) continue;
      const e = mapa.get(k) || { members: t.slice().sort(), players: [] };
      e.players.push({ username: p.username, wr, games, level: p.level, rank: p.rank });
      mapa.set(k, e);
    }
  }
  ladderTeams = [...mapa.values()]
    .map(e => ({ members: e.members, count: e.players.length, bestWr: Math.max(...e.players.map(x => x.wr)), avgWr: Math.round(10 * e.players.reduce((s, x) => s + x.wr, 0) / e.players.length) / 10, players: e.players.sort((a, b) => b.wr - a.wr).slice(0, 3) }))
    .filter(e => e.bestWr >= 55 || e.count >= 2)                    // time de alguém que ganha mais que a média, ou repetido
    .sort((a, b) => b.count - a.count || b.bestWr - a.bestWr)
    .slice(0, 400);
  ladderInfo = { fetchedAt: L.fetchedAt, players: jogadores, teams: mapa.size };
  console.log(`times da ladder: ${mapa.size} trios de ${jogadores} jogadores -> ${ladderTeams.length} no resumo`);
} catch (e) { /* sem data/ladder-teams.js: rode scripts/collect-ladder-teams.js */ }
const data = { ladderTeams, ladderInfo, generatedAt: new Date().toISOString(), hasForum: meta.hasForum, hasBalance: meta.hasBalance, forumFetchedAt: F ? F.fetchedAt : null, forumTopics: F ? F.topics.length : 0, forumPosts: F ? F.topics.reduce((n, t) => n + (t.posts || []).length, 0) : 0, balancePosts: B.length, chars, teams, combos };
fs.writeFileSync(path.join(DATA, 'community.js'), `// Sinal de comunidade/meta pré-computado (${data.generatedAt.slice(0, 10)}) por scripts/build-community.js a partir de balance-history.js e forum.js\n` +
  `(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_COMMUNITY = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(data)});\n`);
console.log(`OK: ${Object.keys(chars).length} personagens, ${teams.length} trios, ${combos.length} combos citados pelo staff -> data/community.js (${(fs.statSync(path.join(DATA, 'community.js')).size / 1024).toFixed(0)} KB)`);
