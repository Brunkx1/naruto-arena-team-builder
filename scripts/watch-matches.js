#!/usr/bin/env node
/*
 * Observador de partidas: fica rodando enquanto você joga e registra cada partida com o time usado.
 *
 *   - HISTÓRICO DO PERFIL (fonte principal): /profile/<usuario> traz ladderGames e quickGames das últimas
 *     24 h, cada um com data, adversário e vencedor. É o resultado real, inclusive de quick match.
 *   - CONTADORES (vitórias/derrotas/sequência do connect-selection): usados para saber quando algo mudou
 *     e como reserva se o perfil não responder.
 *   - MISSÕES: lidas a cada partida para atualizar o progresso na conta (e, sem o perfil, deduzir o
 *     resultado de quick match pelo avanço dos objetivos de vitória).
 *
 * Uso: NA_USER=usuario NA_PASS=senha node scripts/watch-matches.js [--intervalo 45] [--capturar-adversario]
 *      (15 s nos 10 min após cada início/fim de partida; a captura do adversário é experimental e vem desligada)
 *      Ctrl+C (ou "Parar" na aba Ferramentas). Resultados em data/accounts/<usuario>.results.json,
 *      lidos por scripts/diary.js (vitórias, derrotas e sequência máxima por time).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const NM = require('../js/core/missions.js');
const CHARS = require('../data/characters.js');
const MISSIONS = require('../data/missions.js');

const SITE = 'https://www.naruto-arena.site';
const args = process.argv.slice(2);
const INTERVAL = Math.max(20, +(args[args.indexOf('--intervalo') + 1] || 45)) * 1000;
const FAST = Math.min(15000, INTERVAL);          // consulta rápida nos 10 min após início/fim de partida (o time é lido depois dela)
const FAST_WINDOW = 10 * 60 * 1000;
const RECHECK_MS = 5 * 60 * 1000;                // releitura das missões mesmo sem transição
// captura do time adversário (experimental, desligada por padrão): usa a mesma ação que o cliente do jogo
// usa para entrar na partida. Pode, em tese, atrapalhar a sua sessão — por isso só liga quando você mandar.
const CAPTURAR = (() => {
  if (args.includes('--capturar-adversario')) return true;
  if (args.includes('--sem-capturar')) return false;
  try { return !!JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8')).capturarAdversario; } catch (e) { return false; }
})();

function ask(q, hidden) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) { const h = () => { readline.cursorTo(process.stdout, q.length); readline.clearLine(process.stdout, 1); }; process.stdin.on('data', h); rl.question(q, a => { process.stdin.off('data', h); rl.close(); process.stdout.write('\n'); res(a); }); }
    else rl.question(q, a => { rl.close(); res(a); });
  });
}
const cookiesFrom = res => (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)).map(c => c.split(';')[0]).join('; ');
const hhmm = () => new Date().toTimeString().slice(0, 8);
const sameTeam = (a, b) => Array.isArray(a) && Array.isArray(b) && a.slice().sort().join('|') === b.slice().sort().join('|');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, cookie) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { cookie }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429) { const espera = (+r.headers.get('retry-after') || 30) + 1; console.warn(`  (limite do site: esperando ${espera}s)`); await new Promise(res => setTimeout(res, espera * 1000)); continue; }
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (attempt === 3) throw e; await new Promise(res => setTimeout(res, 1500 * (attempt + 1))); }
  }
  return null;
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

async function login(user, pass) {
  const r = await fetch(SITE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }), signal: AbortSignal.timeout(30000) });
  const c = cookiesFrom(r); if (!r.ok || !c) throw new Error('login falhou (' + r.status + ')'); return c;
}
async function siteInfo() {
  const home = await (await fetch(SITE + '/', { signal: AbortSignal.timeout(30000) })).text();
  const build = (home.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/) || [])[1];
  const manifest = await (await fetch(`${SITE}/_next/static/${build}/_buildManifest.js`, { signal: AbortSignal.timeout(30000) })).text();
  const chunk = (manifest.match(/static\/chunks\/pages\/ingame-[a-z0-9]+\.js/) || [])[0];
  const ingame = await (await fetch(`${SITE}/_next/${chunk}`, { signal: AbortSignal.timeout(30000) })).text();
  const v = (ingame.match(/selectionCatalogVersion:([A-Za-z_$][A-Za-z0-9_$]*)/) || [])[1];
  return { build, version: v ? (ingame.match(new RegExp('\\b' + v.replace(/\$/g, '\\$') + '="([0-9a-f]{20,})"')) || [])[1] : '' };
}
async function state(cookie, version) {
  const r = await fetch(SITE + '/api/handleingame/connect-selection', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie, origin: SITE, referer: SITE + '/ingame', accept: 'application/json, text/plain, */*' },
    body: JSON.stringify({ action: 'connectSelection', languagePreference: 'English', selectionCatalogVersion: version, globalChatPreferredLocale: 'en', globalChatLastOpenedAt: null }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => null);
  const c = j && j.content; if (!c) throw new Error('estado indisponível (HTTP ' + r.status + ')');
  return { win: c.win, lose: c.lose, streak: c.streak, xp: c.xp, level: c.level, inMatch: !!c.isInMatch, team: Array.isArray(c.lastTeamUser) ? c.lastTeamUser : null, user: c.username || c.accountUsername };
}

// ---- time do adversário: lê o estado da batalha e procura os dois trios, sem depender do nome dos campos ----
const NOMES_CHARS = new Set(CHARS.map(c => c.name));
function extrairTimes(obj, prof = 0, achados = []) {
  if (!obj || typeof obj !== 'object' || prof > 6) return achados;
  const valores = Array.isArray(obj) ? obj : Object.values(obj);
  // um time pode vir como lista OU como objeto { char0: {...}, char1: {...}, char2: {...} }
  const nomes = valores.map(x => (typeof x === 'string' ? x : x && (x.name || x.charName || x.character))).filter(n => typeof n === 'string' && NOMES_CHARS.has(n));
  if (nomes.length === 3 && valores.length === 3) { achados.push(nomes); return achados; }
  for (const v of valores) if (v && typeof v === 'object') extrairTimes(v, prof + 1, achados);
  return achados;
}
// leitura exata: players[] traz playerId e team { char0, char1, char2 }
function timesDaBatalha(state, uname) {
  const lista = Array.isArray(state && state.players) ? state.players : Object.values((state && state.players) || {});
  const eu = String(uname || '').toLowerCase();
  let meu = null, dele = null, adversario = null;
  for (const p of lista) {
    if (!p || typeof p !== 'object') continue;
    const nomes = Object.values(p.team || {}).map(c => c && c.name).filter(n => typeof n === 'string' && NOMES_CHARS.has(n));
    if (nomes.length !== 3) continue;
    if (String(p.playerId || '').toLowerCase() === eu) meu = nomes;
    else { dele = nomes; adversario = p.playerId || null; }
  }
  if (!dele) {   // formato diferente do esperado: volta para a busca tolerante
    const trios = extrairTimes(state);
    const chave = t => t.slice().sort().join('|');
    const meuK = meu ? chave(meu) : null;
    dele = trios.find(t => chave(t) !== meuK) || null;
  }
  return { meu, dele, adversario, matchType: state && state.matchType };
}
async function battleState(cookie) {
  const r = await fetch(SITE + '/api/handleingame', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie, origin: SITE, referer: SITE + '/ingame', accept: 'application/json, text/plain, */*' },
    body: JSON.stringify({ action: 'connectBattle', languagePreference: 'English' }), signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => null);
  const cont = j && (j.content || j);
  return { status: r.status, content: cont, state: cont && (cont.battleState || cont) };
}

// ---- histórico de partidas do perfil (24 h): fonte principal do resultado ----
async function profileGames(cookie, build, uname) {
  const j = await getJson(`${SITE}/_next/data/${build}/profile/${encodeURIComponent(uname)}.json`, cookie);
  const info = j && j.pageProps && j.pageProps.userInfor;
  if (!info) return null;
  // o nome vem com a capitalização real do perfil; o login pode estar em outra (ex.: .env em minúsculas)
  const me = ((info.target_account && info.target_account.username) || uname).toLowerCase();
  const eu = s => String(s || '').toLowerCase() === me;
  const out = [];
  for (const [key, type] of [['ladderGames', 'ladder'], ['quickGames', 'quick'], ['privateGames', 'private']]) {
    for (const g of info[key] || []) {
      if (!g || !g.historicId) continue;
      out.push({ historicId: g.historicId, at: g.date, type, opponent: eu(g.player1) ? g.player2 : g.player1, winner: g.winner, result: g.winner ? (eu(g.winner) ? 'win' : 'lose') : null });
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// ---- missões: status por categoria + progresso das pendentes (mesmo formato de download-account.js) ----
async function missionStatuses(cookie, build) {
  const missions = {};
  for (const animeId of [...new Set(MISSIONS.missions.map(m => m.animeId))]) {
    const j = await getJson(`${SITE}/_next/data/${build}/missions/${animeId}.json`, cookie);
    const list = j && j.pageProps && j.pageProps.animeMissions;
    if (!Array.isArray(list)) continue;
    for (const m of list) missions[m.name] = { isCompleted: !!m.isCompleted, isAvailable: !!m.isAvailable, isLevelAvailable: !!m.isLevelAvailable, rankRequirement: m.rankRequirement || null, linkTo: m.linkTo || m.name.toLowerCase().replace(/ /g, '-'), progress: [] };
  }
  return missions;
}
async function missionProgress(cookie, build, missions) {
  const pending = Object.entries(missions).filter(([, s]) => s.isAvailable && !s.isCompleted);
  let ok = 0;
  await mapLimit(pending, 4, async ([, s]) => {
    const j = await getJson(`${SITE}/_next/data/${build}/mission/${encodeURIComponent(s.linkTo)}.json`, cookie);
    const st = j && j.pageProps && j.pageProps.missionStatus;
    if (st && Array.isArray(st.progress)) { s.progress = st.progress.map(p => ({ text: String(p.text || ''), isCompleted: !!p.isCompleted })); ok++; }
  });
  return { pending: pending.length, ok };
}
// foto dos objetivos ativos: chave missão#índice -> {done,total,...}
function snapshot(missions, user) {
  const idx = NM.buildIndex(MISSIONS, CHARS, { username: user, missions }, {});
  const snap = new Map();
  for (const g of idx.goals) if (g.active || g.done) snap.set(g.mission.name + '#' + g.gi, { goal: g, hasProgress: !!g.progress, done: g.progress ? g.progress.done : (g.done ? 1 : 0), total: g.progress ? g.progress.total : 1, completed: g.done });
  return snap;
}
// compara duas fotos para o time: resultado deduzido + mudanças de progresso
function deduce(before, after, team) {
  const set = new Set(team || []);
  const involves = g => (g.anyOf ? g.anyOf.some(n => set.has(n)) : (g.allOf && g.allOf.length ? g.allOf.every(n => set.has(n)) : false));
  const changes = [];
  let wins = 0, losses = 0, couldWin = 0;
  for (const [k, cur] of after) {
    const prev = before.get(k);
    if (!prev) continue;
    const g = cur.goal;
    if (cur.done !== prev.done || cur.completed !== prev.completed) changes.push({ mission: g.mission.name, goal: g.text, goalEn: g.textEn, type: g.goal.type, from: prev.done, to: cur.done, total: cur.total, inRow: g.inRow, completed: cur.completed && !prev.completed });
    if (g.goal.type !== 'win' || !team || !involves(g)) continue;
    if (prev.completed || !prev.hasProgress) continue;   // só objetivos com contador legível servem de prova
    couldWin++;
    if (cur.done > prev.done) wins = Math.max(wins, cur.done - prev.done);   // salto de k = k vitórias desde a última leitura
    else if (cur.completed && !prev.completed) wins = Math.max(wins, 1);
    else if (g.inRow && prev.done > 0 && cur.done === 0) losses++;
  }
  let result = null;
  if (wins) result = 'win';
  else if (losses) result = 'lose';
  else if (couldWin) result = 'lose';   // havia objetivo "vencer com X" com espaço para subir e não subiu
  return { result, wins, changes };
}
const fmtChange = c => `${c.mission}: ${c.to}/${c.total}${c.inRow ? ' seguidas' : ''}${c.completed ? ' ✔' : ''}`;

// junta o histórico do perfil com o que já está gravado: completa registros sem resultado e acrescenta o que falta
function mergeHistory(results, games, teamFor) {
  const byId = new Set(results.map(r => r.historicId).filter(Boolean));
  const novos = [];
  for (const g of games) {
    if (byId.has(g.historicId)) continue;
    const ts = new Date(g.at).getTime();
    // registro nosso da mesma partida (mesmo tipo, até 5 min de diferença) ainda sem id: completa em vez de duplicar
    const alvo = results.find(r => !r.historicId && r.type === g.type && Math.abs(new Date(r.at).getTime() - ts) <= 5 * 60000);
    const win = g.result === 'win' ? 1 : 0, lose = g.result === 'lose' ? 1 : 0;
    if (alvo) {
      Object.assign(alvo, { historicId: g.historicId, opponent: g.opponent, result: g.result, win: Math.max(alvo.win || 0, win), lose: Math.max(alvo.lose || 0, lose), source: 'perfil' });
      novos.push({ ...alvo, atualizado: true });
    } else {
      const rec = { at: g.at, type: g.type, team: teamFor ? teamFor(ts) : null, result: g.result, win, lose, historicId: g.historicId, opponent: g.opponent, source: 'perfil' };
      results.push(rec); novos.push(rec);
    }
    byId.add(g.historicId);
  }
  results.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return novos;
}

module.exports = { snapshot, deduce, mergeHistory, extrairTimes, timesDaBatalha };   // testáveis sem rede (test.js)
if (require.main === module) (async () => {
  const user = process.env.NA_USER || await ask('Usuário Naruto-Arena: ');
  const pass = process.env.NA_PASS || await ask('Senha: ', true);
  let cookie = await login(user, pass);
  let site = await siteInfo();   // build do Next + versão do catálogo; renovados se o site fizer deploy no meio da sessão
  let prev = await state(cookie, site.version);
  const uname = String(prev.user || user);
  const out = path.join(__dirname, '..', 'data', 'accounts', uname.toLowerCase() + '.results.json');
  const statePath = path.join(__dirname, '..', 'data', 'accounts', uname.toLowerCase() + '.observer-state.json');
  let results = []; try { results = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { /* novo */ }
  let saved = null; try { saved = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) { /* primeira vez */ }
  const saveState = st => { try { fs.writeFileSync(statePath, JSON.stringify({ at: new Date().toISOString(), win: st.win, lose: st.lose, xp: st.xp, level: st.level, team: st.team }, null, 1)); } catch (e) { /* ignora */ } };
  const save = () => { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(results, null, 1)); try { require('./lib-results.js').gerar(uname); } catch (e) { /* opcional */ } };
  // progresso lido com build renovado quando as páginas param de responder (deploy do site)
  async function readProgress(missions) {
    let r = await missionProgress(cookie, site.build, missions);
    if (r.pending && !r.ok) { site = await siteInfo(); console.log(`[${hhmm()}] site atualizado (build ${site.build}); relendo...`); r = await missionProgress(cookie, site.build, missions); }
    return r;
  }
  // grava missões/progresso (e perfil, quando disponível) nos arquivos da conta, para a página mostrar sem rodar baixar-conta
  const ACC_FILES = [path.join(__dirname, '..', 'data', 'accounts', uname.toLowerCase() + '.js'), path.join(__dirname, '..', 'data', 'account.js')];
  function saveAccount(missions, st) {
    for (const file of ACC_FILES) {
      let acc = null;
      try { delete require.cache[require.resolve(file)]; acc = require(file); } catch (e) { continue; }
      if (!acc || !acc.username || acc.username.toLowerCase() !== uname.toLowerCase()) continue;
      acc.missions = acc.missions || {};
      for (const [name, s] of Object.entries(missions)) acc.missions[name] = { ...(acc.missions[name] || {}), ...s };
      if (st && !st.inMatch && st.level != null) Object.assign(acc.profile = acc.profile || {}, { level: st.level, xp: st.xp, win: st.win, lose: st.lose, streak: st.streak, inMatch: false });
      if (st && st.team) acc.lastTeam = st.team;
      acc.missionsUpdatedAt = new Date().toISOString();
      const js = `// Gerado por scripts/download-account.js em ${acc.fetchedAt} para a conta "${acc.username}"; missões atualizadas pelo observador em ${acc.missionsUpdatedAt}.\n` +
        `(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_ACCOUNT = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(acc)});\n`;
      try { fs.writeFileSync(file, js); } catch (e) { console.log(`[${hhmm()}] não consegui gravar ${path.relative(process.cwd(), file)}: ${e.message}`); }
    }
  }

  process.stdout.write(`[${hhmm()}] lendo missões pendentes... `);
  let missions = await missionStatuses(cookie, site.build);
  const { pending: pendentes } = await readProgress(missions);
  let snap = snapshot(missions, uname);
  console.log(`${pendentes} em andamento`);
  const v = x => (x == null ? '?' : x);   // em partida o servidor não devolve os contadores
  console.log(`[${hhmm()}] observando ${uname}: ${v(prev.win)}V/${v(prev.lose)}D (ladder), sequência ${v(prev.streak)}, nível ${v(prev.level)}${prev.inMatch ? ' · EM PARTIDA (contadores chegam quando a partida acabar)' : ''} · time: ${(prev.team || []).join(' + ') || '?'}`);
  console.log(`  consulta a cada ${INTERVAL / 1000}s (${FAST / 1000}s perto de início/fim de partida) · resultado pelo histórico do perfil (ladder e quick) · ${path.relative(process.cwd(), out)}`);
  if (CAPTURAR) console.log(`  captura do time adversário LIGADA (experimental): uma chamada a connectBattle por partida`);

  let teamInMatch = prev.inMatch ? prev.team : null;
  let known = prev.win != null ? prev : null;   // último estado COM contadores (em partida o servidor não os manda)
  // partidas jogadas com o observador desligado: o contador salvo em disco fecha o buraco entre sessões.
  // Se o programa abrir no meio de uma partida, o servidor não manda contadores — então isso roda na primeira leitura que tiver.
  function fecharBuraco(st) {
    if (!saved || saved.win == null || st.win == null) { saved = null; return; }
    const dw = st.win - saved.win, dl = st.lose - saved.lose;
    const minutos = (Date.now() - new Date(saved.at).getTime()) / 60000;
    if (dw > 0 || dl > 0) {
      const team = st.team || saved.team;
      const rec = { at: new Date().toISOString(), type: 'ladder', team, result: dw > 0 && dl > 0 ? 'mixed' : dw > 0 ? 'win' : 'lose', win: Math.max(0, dw), lose: Math.max(0, dl), streakAfter: st.streak, level: st.level, xpDelta: st.xp != null && saved.xp != null ? st.xp - saved.xp : null, missions: [], gap: true, gapMin: Math.round(minutos), offline: true };
      results.push(rec); fs.writeFileSync(out, JSON.stringify(results, null, 1));
      console.log(`[${hhmm()}] ${dw}V/${dl}D de ladder enquanto o observador estava desligado (${Math.round(minutos)} min) — registrado como acumulado para ${(team || []).join(' + ') || 'time desconhecido'}`);
    } else if (minutos > 1) console.log(`[${hhmm()}] nenhuma partida de ladder desde a última sessão (${Math.round(minutos)} min atrás)`);
    saved = null;
  }
  if (known) { fecharBuraco(known); saveState(known); }
  let lastTransition = Date.now(), lastRecheck = Date.now(), lastPoll = Date.now();
  // captura do time adversário (experimental): uma chamada por partida, e desliga sozinha ao primeiro problema
  let capturaAtiva = CAPTURAR, enemyTeam = null, enemyName = null;
  async function capturarAdversario() {
    enemyTeam = null;
    try {
      const b = await battleState(cookie);
      if (b.status !== 200 || !b.state) { console.log(`[${hhmm()}] captura do adversário: resposta inesperada (HTTP ${b.status}); desligando a captura nesta sessão`); capturaAtiva = false; return; }
      const t = timesDaBatalha(b.state, uname);
      enemyTeam = t.dele;
      enemyName = t.adversario;
      if (t.meu && (!teamInMatch || t.meu.slice().sort().join('|') !== teamInMatch.slice().sort().join('|'))) teamInMatch = t.meu;   // o estado da batalha é mais confiável que o último time salvo
      if (enemyTeam) console.log(`[${hhmm()}] adversário${enemyName ? ' (' + enemyName + ')' : ''}: ${enemyTeam.join(' + ')}${t.matchType ? ' · ' + t.matchType : ''}`);
      else console.log(`[${hhmm()}] captura do adversário: não achei o time na resposta (campos: ${Object.keys(b.state).join(', ').slice(0, 120)})`);
    } catch (e) { console.log(`[${hhmm()}] captura do adversário falhou (${e.message}); desligando nesta sessão`); capturaAtiva = false; }
  }

  if (CAPTURAR && prev.inMatch) await capturarAdversario();   // subiu no meio de uma partida: pega o adversário mesmo assim
  const backfill = await (async () => { try { const g = await profileGames(cookie, site.build, uname); if (!g) return null; const n = mergeHistory(results, g, () => null); if (n.length) save(); return n; } catch (e) { return null; } })();
  if (backfill) console.log(`[${hhmm()}] histórico do perfil: ${backfill.length} partida(s) das últimas 24 h que faltavam${backfill.length ? ' (' + backfill.filter(r => r.result === 'win').length + 'V/' + backfill.filter(r => r.result === 'lose').length + 'D)' : ''}`);
  else console.log(`[${hhmm()}] histórico do perfil indisponível agora; usando contadores e missões`);
  async function checkMissions(team, st) {
    let snapNew;
    try { await readProgress(missions); snapNew = snapshot(missions, uname); }
    catch (e) { console.log(`[${hhmm()}] não consegui ler as missões (${e.message})`); return null; }
    const d = deduce(snap, snapNew, team);
    snap = snapNew;
    if (d.changes.some(c => c.completed)) { try { missions = await missionStatuses(cookie, site.build); await readProgress(missions); snap = snapshot(missions, uname); } catch (e) { /* mantém */ } }
    if (d.changes.length) saveAccount(missions, st);
    return d;
  }
  // histórico do perfil: fonte principal do resultado (ladder e quick), inclusive do que foi jogado offline
  let historicoOk = true;
  const teamFor = ts => {
    if (teamInMatch && Math.abs(Date.now() - ts) < 15 * 60000) return teamInMatch;
    let melhor = null;
    for (const r of results) if (r.team && new Date(r.at).getTime() <= ts + 60000) melhor = r.team;   // time do registro mais próximo antes da partida
    return melhor || (prev && prev.team) || null;
  };
  async function syncHistory(motivo) {
    let games;
    try { games = await profileGames(cookie, site.build, uname); }
    catch (e) { games = null; }
    if (!games) {
      if (historicoOk) { console.log(`[${hhmm()}] histórico do perfil indisponível; usando contadores e missões como reserva`); historicoOk = false; }
      return null;
    }
    if (!historicoOk) { console.log(`[${hhmm()}] histórico do perfil voltou a responder`); historicoOk = true; }
    const novos = mergeHistory(results, games, teamFor);
    if (novos.length) {
      if (enemyTeam) for (const r of novos) {
        if (r.enemyTeam || Math.abs(Date.now() - new Date(r.at).getTime()) >= 30 * 60000) continue;
        if (r.opponent && enemyName && String(r.opponent).toLowerCase() !== String(enemyName).toLowerCase()) continue;   // só se for a mesma partida
        r.enemyTeam = enemyTeam;
      }
      save();
      for (const r of novos) {
        const res = r.result === 'win' ? 'VITÓRIA' : r.result === 'lose' ? 'DERROTA' : 'sem vencedor';
        console.log(`[${hhmm()}] ${res} (${r.type === 'quick' ? 'quick match' : r.type}${motivo ? ', ' + motivo : ''}) vs ${r.opponent || '?'} com ${(r.team || []).join(' + ') || 'time desconhecido'}${r.atualizado ? ' [completado pelo histórico]' : ''}`);
      }
    }
    return novos;
  }

  function record(rec, label) {
    results.push(rec); save();
    const res = rec.win && rec.lose ? `${rec.win}V/${rec.lose}D` : rec.win ? (rec.win > 1 ? `${rec.win} VITÓRIAS` : 'VITÓRIA') : rec.lose ? (rec.lose > 1 ? `${rec.lose} DERROTAS` : 'DERROTA') : 'partida sem resultado conhecido';
    console.log(`[${hhmm()}] ${res} (${label}) com ${(rec.team || []).join(' + ') || '?'}${rec.streakAfter != null ? ` · sequência ${rec.streakAfter}` : ''}${rec.xpDelta != null ? ` · xp ${rec.xpDelta >= 0 ? '+' : ''}${rec.xpDelta}` : ''}`);
    if (rec.type === 'quick' && rec.xpDelta != null) console.log(`    (xp ${rec.xpDelta >= 0 ? '+' : ''}${rec.xpDelta} nesta partida)`);
    if (rec.gap) console.log(`    (acumulado: ${Math.round(rec.gapMin)} min sem leitura — pode ser mais de uma partida e o time pode ter mudado; não conta como sequência)`);
    for (const c of rec.missions || []) console.log(`    ${fmtChange(c)}`);
  }

  for (;;) {
    await sleep(Date.now() - lastTransition < FAST_WINDOW ? FAST : INTERVAL);
    let cur;
    try { cur = await state(cookie, site.version); }
    catch (e) { try { cookie = await login(user, pass); site = await siteInfo(); cur = await state(cookie, site.version); } catch (e2) { console.log(`[${hhmm()}] sem resposta (${e2.message}); tentando de novo...`); continue; } }
    // leitura muito atrasada (máquina suspensa, site fora do ar): o que vier agora pode cobrir várias partidas
    const gapMin = (Date.now() - lastPoll) / 60000;
    const gap = gapMin > Math.max(5, 3 * INTERVAL / 60000);
    lastPoll = Date.now();
    if (gap) console.log(`[${hhmm()}] ${Math.round(gapMin)} min sem leitura (${gapMin > 60 ? 'máquina suspensa?' : 'sem resposta do site?'}); resultados desse período entram como acumulado`);
    if (cur.inMatch && !prev.inMatch) {
      teamInMatch = cur.team || prev.team;
      console.log(`[${hhmm()}] partida iniciada com ${(teamInMatch || []).join(' + ') || '?'}`);
      if (CAPTURAR && capturaAtiva) await capturarAdversario();
    }
    const hasCounters = cur.win != null && cur.lose != null;
    const dw = hasCounters && known ? cur.win - known.win : 0, dl = hasCounters && known ? cur.lose - known.lose : 0;
    const ended = !cur.inMatch && prev.inMatch;
    if (cur.inMatch !== prev.inMatch) lastTransition = Date.now();
    const team = (ended && cur.team) || teamInMatch || cur.team || prev.team;   // o time visto depois da partida é o mais confiável
    const algoMudou = dw > 0 || dl > 0 || ended;
    if (algoMudou || Date.now() - lastRecheck >= RECHECK_MS) {
      if (!cur.inMatch || algoMudou) {
        const d = await checkMissions(team, cur);   // atualiza o progresso das missões na conta (e serve de reserva)
        const novos = await syncHistory(gap ? 'atrasado' : null);
        if (!novos) {   // sem histórico: volta para contadores (ladder) e dedução por missão (quick)
          if (dw > 0 || dl > 0) record({ at: new Date().toISOString(), type: 'ladder', team, result: dw > 0 && dl > 0 ? 'mixed' : dw > 0 ? 'win' : 'lose', win: Math.max(0, dw), lose: Math.max(0, dl), streakAfter: cur.streak, level: cur.level, xpDelta: known && cur.xp != null && known.xp != null ? cur.xp - known.xp : null, missions: d ? d.changes : [], gap: gap || undefined, gapMin: gap ? Math.round(gapMin) : undefined }, 'ladder, pelos contadores');
          else if (ended && d) record({ at: new Date().toISOString(), type: 'quick', team, result: d.result, win: d.result === 'win' ? Math.max(1, d.wins) : 0, lose: d.result === 'lose' ? 1 : 0, level: cur.level, missions: d.changes, gap: gap || undefined, gapMin: gap ? Math.round(gapMin) : undefined }, 'quick match, deduzido pelas missões');
        }
        if (!algoMudou) lastRecheck = Date.now();
      }
      if (ended) { teamInMatch = null; enemyTeam = null; enemyName = null; }
      else if (dw > 0 || dl > 0) teamInMatch = cur.inMatch ? cur.team : null;
    }
    if (dw > 0 || dl > 0 || ended) lastRecheck = Date.now();
    if (hasCounters) { if (saved) fecharBuraco(cur); known = cur; saveState(cur); }
    if (cur.team && !sameTeam(cur.team, prev.team)) console.log(`[${hhmm()}] time selecionado: ${cur.team.join(' + ')}`);
    prev = cur;
  }
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
