#!/usr/bin/env node
/*
 * Baixa os dados da SUA conta no Naruto-Arena e grava em data/account.js:
 *   - personagens bloqueados (=> o programa sabe quais você tem liberados)
 *   - nível, rank, vitórias/derrotas, último time usado
 *   - status de cada missão (concluída / disponível / falta rank) e o progresso
 *     de cada objetivo das missões disponíveis ("Win 15 battles... (7/15)")
 *
 * Uso:  node scripts/download-account.js [--debug]
 *       (pede usuário e senha; ou use NA_USER=... NA_PASS=... node scripts/... para não digitar)
 *       A senha não é exibida nem gravada em lugar nenhum.
 *
 * Fontes (as mesmas que o site usa):
 *   POST /api/login
 *   GET  /_next/data/<build>/missions/<categoria>.json   -> animeMissions[] (isCompleted, isAvailable...)
 *   GET  /_next/data/<build>/mission/<id>.json           -> missionStatus.progress[]
 *   POST /api/handleingame/connect-selection             -> content.lockedChars, perfil
 *
 * Requer Node 18+ (fetch nativo).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SITE = 'https://www.naruto-arena.site';
const OUT = path.join(__dirname, '..', 'data', 'account.js');
const MISSIONS = require('../data/missions.js');
const DEBUG = process.argv.includes('--debug');

function ask(question, hidden) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const onData = () => { readline.cursorTo(process.stdout, question.length); readline.clearLine(process.stdout, 1); };
      process.stdin.on('data', onData);
      rl.question(question, ans => { process.stdin.off('data', onData); rl.close(); process.stdout.write('\n'); resolve(ans); });
    } else rl.question(question, ans => { rl.close(); resolve(ans); });
  });
}

function cookiesFrom(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  return raw.map(c => c.split(';')[0]).join('; ');
}

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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

(async () => {
  // credenciais: variáveis de ambiente NA_USER / NA_PASS ou perguntadas no terminal
  const username = process.env.NA_USER || await ask('Usuário Naruto-Arena: ');
  const password = process.env.NA_PASS || await ask('Senha: ', true);

  // ---- login ---------------------------------------------------------------
  process.stdout.write('Login... ');
  const login = await fetch(SITE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const loginBody = await login.json().catch(() => ({}));
  const cookie = cookiesFrom(login);
  const loginOk = login.ok && cookie && JSON.stringify(loginBody).includes('loginSucess');
  if (!loginOk) { console.error('\nFalha no login:', login.status, JSON.stringify(loginBody).slice(0, 200)); process.exit(1); }
  console.log('ok');

  // ---- build id do Next ----------------------------------------------------
  const home = await (await fetch(SITE + '/', { headers: { cookie } })).text();
  const build = (home.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/) || [])[1];
  if (!build) { console.error('Não achei o buildId do Next.js.'); process.exit(1); }
  const manifest = await (await fetch(`${SITE}/_next/static/${build}/_buildManifest.js`)).text();

  // ---- missões: status por categoria --------------------------------------
  const animeIds = [...new Set(MISSIONS.missions.map(m => m.animeId))];
  process.stdout.write(`Missões (${animeIds.length} categorias)... `);
  const missions = {};
  for (const animeId of animeIds) {
    const j = await getJson(`${SITE}/_next/data/${build}/missions/${animeId}.json`, cookie);
    const list = j && j.pageProps && j.pageProps.animeMissions;
    if (!Array.isArray(list)) { console.warn(`\n  aviso: categoria ${animeId} sem dados`); continue; }
    for (const m of list) {
      missions[m.name] = {
        isCompleted: !!m.isCompleted, isAvailable: !!m.isAvailable, isLevelAvailable: !!m.isLevelAvailable,
        rankRequirement: m.rankRequirement || null, linkTo: m.linkTo || m.name.toLowerCase().replace(/ /g, '-'), progress: [],
      };
    }
  }
  console.log(`${Object.keys(missions).length} missões`);

  // ---- progresso das missões disponíveis e não concluídas -----------------
  const pending = Object.entries(missions).filter(([, s]) => s.isAvailable && !s.isCompleted);
  process.stdout.write(`Progresso de ${pending.length} missões em andamento... `);
  await mapLimit(pending, 4, async ([name, s]) => {
    const j = await getJson(`${SITE}/_next/data/${build}/mission/${encodeURIComponent(s.linkTo)}.json`, cookie);
    const st = j && j.pageProps && j.pageProps.missionStatus;
    if (st && Array.isArray(st.progress)) s.progress = st.progress.map(p => ({ text: String(p.text || ''), isCompleted: !!p.isCompleted }));
  });
  console.log('ok');

  // ---- personagens bloqueados + perfil (connect-selection) ----------------
  process.stdout.write('Personagens liberados e perfil... ');
  let content = null;
  try {
    const ingameChunk = (manifest.match(/static\/chunks\/pages\/ingame-[a-z0-9]+\.js/) || [])[0];
    const ingame = ingameChunk ? await (await fetch(`${SITE}/_next/${ingameChunk}`)).text() : '';
    const varName = (ingame.match(/selectionCatalogVersion:([A-Za-z_$][A-Za-z0-9_$]*)/) || [])[1];
    const version = varName ? (ingame.match(new RegExp('\\b' + varName.replace(/\$/g, '\\$') + '="([0-9a-f]{20,})"')) || [])[1] : null;
    // o servidor só responde com Origin/Referer do próprio site (como o navegador manda)
    const res = await fetch(SITE + '/api/handleingame/connect-selection', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie, origin: SITE, referer: SITE + '/ingame', accept: 'application/json, text/plain, */*' },
      body: JSON.stringify({ action: 'connectSelection', languagePreference: 'English', selectionCatalogVersion: version || '', globalChatPreferredLocale: 'en', globalChatLastOpenedAt: null }),
    });
    const bodyText = await res.text();
    let j = null; try { j = JSON.parse(bodyText); } catch (e) { /* não é JSON */ }
    if (DEBUG) {
      console.log(`\n  [debug] versão do catálogo: ${version || '(não achei)'} · HTTP ${res.status} · content-type ${res.headers.get('content-type')}`);
      console.log(`  [debug] corpo: ${bodyText.slice(0, 300).replace(/\s+/g, ' ')}`);
      fs.writeFileSync(path.join(__dirname, '..', 'data', 'account.raw.json'), j ? JSON.stringify(j, null, 1) : bodyText);
    }
    content = j && (j.content || (j.data && j.data.content) || null);
  } catch (e) { console.warn('\n  aviso: connect-selection falhou:', e.message); }
  const lockedChars = content && Array.isArray(content.lockedChars) ? content.lockedChars : null;
  if (lockedChars) console.log(`${lockedChars.length} bloqueados`);
  else if (content && content.isInMatch) console.log('conta está EM PARTIDA agora: o servidor não envia personagens/perfil nesse estado; rode de novo quando a partida acabar.');
  else console.log('não obtido (usando missões concluídas como referência)');

  // rank deduzido pelas missões que o servidor marcou como liberadas por nível (tabela do manual "The Ninja Ladder")
  const RANKS = ['Academy Student', 'Genin', 'Chuunin', 'Missing-Nin', 'Anbu', 'Jounin', 'Sannin', 'Jinchuuriki', 'Akatsuki', 'Kage'];
  let rankIdx = 0;
  for (const s of Object.values(missions)) { const i = RANKS.indexOf(s.rankRequirement); if (s.isLevelAvailable && i > rankIdx) rankIdx = i; }
  const rankInferred = RANKS[rankIdx];

  // fallback: bloqueado = desbloqueável por missão não concluída
  const lockedFallback = MISSIONS.missions.filter(m => m.unlockedCharacter && !(missions[m.name] && missions[m.name].isCompleted)).map(m => m.unlockedCharacter);

  // em partida (ou sem resposta) o servidor não manda perfil/personagens: aproveita a última coleta boa desta conta
  let anterior = null;
  if (!lockedChars) {
    try { const prev = require(path.join(__dirname, '..', 'data', 'accounts', username.toLowerCase() + '.js')); if (prev && String(prev.lockedCharsSource || '').startsWith('servidor')) anterior = prev; } catch (e) { /* primeira coleta */ }
    if (anterior) console.log(`  aproveitando nível/personagens da coleta anterior (${anterior.fetchedAt.slice(0, 16).replace('T', ' ')}); missões e progresso são de agora.`);
  }
  const prevProfile = anterior ? anterior.profile : {};
  const account = {
    username: (content && (content.username || content.accountUsername)) || (anterior && anterior.username) || username,
    fetchedAt: new Date().toISOString(),
    profile: {
      level: content && content.level != null ? content.level : prevProfile.level, rank: (content && content.rank) || (anterior && !prevProfile.rankInferred && prevProfile.rank) || rankInferred, rankInferred: !(content && content.rank) && !(anterior && !prevProfile.rankInferred),
      xp: content && content.xp != null ? content.xp : prevProfile.xp, win: content && content.win != null ? content.win : prevProfile.win, lose: content && content.lose != null ? content.lose : prevProfile.lose, streak: content && content.streak != null ? content.streak : prevProfile.streak,
      ladderRank: content && content.userLadderrank != null ? content.userLadderrank : prevProfile.ladderRank, memberType: content ? content.memberType : prevProfile.memberType, inMatch: !!(content && content.isInMatch),
    },
    lockedChars: lockedChars || (anterior ? anterior.lockedChars : [...new Set(lockedFallback)]),
    lockedCharsSource: lockedChars ? 'servidor' : anterior ? 'servidor (coleta anterior)' : 'missões',
    lastTeam: content && Array.isArray(content.lastTeamUser) ? content.lastTeamUser : (anterior ? anterior.lastTeam : null),
    missions,
  };
  // histórico de snapshots (vitórias/derrotas/time) para o diário de resultados por time
  const histPath = path.join(__dirname, '..', 'data', 'accounts', account.username.toLowerCase() + '.history.json');
  let history = []; try { history = JSON.parse(fs.readFileSync(histPath, 'utf8')); } catch (e) { /* primeiro snapshot */ }
  if (content && content.win != null) {
    history.push({ at: account.fetchedAt, win: content.win, lose: content.lose, streak: content.streak, xp: content.xp, level: content.level, team: account.lastTeam });
    fs.mkdirSync(path.dirname(histPath), { recursive: true });
    fs.writeFileSync(histPath, JSON.stringify(history, null, 1));
  }
  account.history = history;
  const js = `// Gerado por scripts/download-account.js em ${account.fetchedAt} para a conta "${account.username}".\n` +
    `(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_ACCOUNT = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(account)});\n`;
  fs.writeFileSync(OUT, js);
  // cópia por conta, para trocar depois com: node scripts/switch-account.js <usuario>
  const accDir = path.join(__dirname, '..', 'data', 'accounts');
  fs.mkdirSync(accDir, { recursive: true });
  fs.writeFileSync(path.join(accDir, account.username.toLowerCase() + '.js'), js);
  try { require('./lib-results.js').gerar(account.username); } catch (e) { /* opcional */ }   // -> data/results.js
  const done = Object.values(missions).filter(s => s.isCompleted).length;
  console.log(`\nOK: gravado em ${path.relative(process.cwd(), OUT)} (cópia em data/accounts/${account.username.toLowerCase()}.js)`);
  console.log(`  nível ${account.profile.level ?? '?'} · rank ${account.profile.rank}${account.profile.rankInferred ? ' (deduzido)' : ''} · missões concluídas ${done}/${Object.keys(missions).length} · em andamento ${pending.length} · personagens bloqueados ${account.lockedChars.length}`);
  process.exit(0);
})().catch(err => { console.error('Erro:', err.message); process.exit(1); });
