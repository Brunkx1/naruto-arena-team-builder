#!/usr/bin/env node
/*
 * Coleta times reais de jogadores da ladder: percorre /ninja-ladder (20 por página) e, para cada jogador,
 * lê /profile/<nome> pegando o time salvo (teamSaved), vitórias/derrotas, nível/rank e as partidas das
 * últimas 24 h. É a única fonte de "time × resultado" que existe — o fórum só diz o que é popular.
 * Gera data/ladder-teams.js (usado por scripts/validar-times.js e pelo treino da regra de combinação).
 *
 * Uso: NA_USER=usuario NA_PASS=senha node scripts/collect-ladder-teams.js [--paginas 10] [--intervalo 150]
 *      Leitura pública, em ritmo lento; só páginas de perfil, nada de escrita.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SITE = 'https://www.naruto-arena.site';
const OUT = path.join(__dirname, '..', 'data', 'ladder-teams.js');
const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PAGINAS = Math.max(1, +argv('--paginas', 10));
const PAUSA = Math.max(80, +argv('--intervalo', 1100));   // o site limita a ~30 requisições por 30 s
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cookiesFrom = r => (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)).map(c => c.split(';')[0]).join('; ');
function ask(q, hidden) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) { const h = () => { readline.cursorTo(process.stdout, q.length); readline.clearLine(process.stdout, 1); }; process.stdin.on('data', h); rl.question(q, a => { process.stdin.off('data', h); rl.close(); process.stdout.write('\n'); res(a); }); }
    else rl.question(q, a => { rl.close(); res(a); });
  });
}
let esperas = 0;
async function getJson(url, cookie) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { cookie }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429) {   // limite do site: espera o tempo que ele pedir
        const espera = (+r.headers.get('retry-after') || 30) + 1;
        esperas++; process.stdout.write(`\r(limite do site: esperando ${espera}s)          `);
        await sleep(espera * 1000); continue;
      }
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { if (t === 3) return null; await sleep(1000 * (t + 1)); }
  }
  return null;
}

(async () => {
  const user = process.env.NA_USER || await ask('Usuário Naruto-Arena: ');
  const pass = process.env.NA_PASS || await ask('Senha: ', true);
  const login = await fetch(SITE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }), signal: AbortSignal.timeout(30000) });
  const cookie = cookiesFrom(login);
  if (!login.ok || !cookie) { console.error('login falhou'); process.exit(1); }
  const home = await (await fetch(SITE + '/', { headers: { cookie } })).text();
  const build = (home.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/) || [])[1];

  // anterior (para não perder o que já foi coletado)
  let anterior = {}; try { anterior = Object.fromEntries((require(OUT).players || []).map(p => [p.username.toLowerCase(), p])); } catch (e) { /* primeira vez */ }

  const jogadores = [];
  for (let page = 1; page <= PAGINAS; page++) {
    const j = await getJson(`${SITE}/_next/data/${build}/ninja-ladder.json?page=${page}`, cookie);
    const tops = j && j.pageProps && j.pageProps.topPlayers;
    if (!Array.isArray(tops) || !tops.length) { console.log(`página ${page}: sem dados, parando`); break; }
    for (const p of tops) jogadores.push({ username: p.staticUser || p.username, win: p.win, lose: p.lose, level: p.level, rank: p.rank, xp: p.xp, ladderPage: page });
    process.stdout.write(`\rladder: ${jogadores.length} jogadores (página ${page}/${PAGINAS})`);
    await sleep(PAUSA);
  }
  console.log();

  const players = [];
  let comTime = 0, semTime = 0;
  for (let i = 0; i < jogadores.length; i++) {
    const p = jogadores[i];
    const j = await getJson(`${SITE}/_next/data/${build}/profile/${encodeURIComponent(p.username)}.json`, cookie);
    const info = j && j.pageProps && j.pageProps.userInfor;
    const acc = info && info.target_account;
    if (acc) {
      const me = String(acc.username || p.username).toLowerCase();
      const games = [];
      for (const [k, type] of [['ladderGames', 'ladder'], ['quickGames', 'quick']]) {
        for (const g of info[k] || []) games.push({ at: g.date, type, opponent: String(g.player1).toLowerCase() === me ? g.player2 : g.player1, result: g.winner ? (String(g.winner).toLowerCase() === me ? 'win' : 'lose') : null });
      }
      const teams = (acc.teamSaved || []).filter(t => Array.isArray(t) && t.length === 3);
      if (teams.length) comTime++; else semTime++;
      players.push({ username: acc.username || p.username, win: acc.win, lose: acc.lose, level: acc.level, rank: acc.rank, highestStreak: acc.highestStreak, seasonStreak: acc.seasonStreak, ladderrank: acc.ladderrank, memberType: acc.memberType, teams, games, at: new Date().toISOString() });
    } else if (anterior[p.username.toLowerCase()]) players.push(anterior[p.username.toLowerCase()]);
    if ((i + 1) % 10 === 0 || i === jogadores.length - 1) process.stdout.write(`\rperfis: ${i + 1}/${jogadores.length} · ${comTime} com time salvo, ${semTime} sem`);
    await sleep(PAUSA);
  }
  console.log();

  // mantém quem já estava e não foi revisitado
  const byName = new Map(players.map(p => [p.username.toLowerCase(), p]));
  for (const [k, v] of Object.entries(anterior)) if (!byName.has(k)) byName.set(k, v);
  const data = { fetchedAt: new Date().toISOString(), paginas: PAGINAS, players: [...byName.values()] };
  const js = `// Times reais de jogadores da ladder (perfil público: teamSaved + vitórias/derrotas + partidas de 24 h).\n` +
    `// Gerado por scripts/collect-ladder-teams.js em ${data.fetchedAt.slice(0, 10)}. ${data.players.length} jogadores.\n` +
    `(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_TIMES_LADDER = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(data)});\n`;
  fs.writeFileSync(OUT, js);
  const comTimes = data.players.filter(p => p.teams && p.teams.length).length;
  console.log(`OK: ${data.players.length} jogadores (${comTimes} com time salvo) -> ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)${esperas ? ` · ${esperas} pausa(s) pelo limite do site` : ''}`);
  process.exit(0);
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
