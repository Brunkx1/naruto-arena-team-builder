#!/usr/bin/env node
/*
 * Baixa a taxa de vitória de cada personagem da página /characters-winrate (exige login e, na prática,
 * é restrita a contas especiais) e grava em data/winrate-pagina.js — NÃO substitui o data/winrate.js
 * oficial (gerado dos patch notes por build-winrate.js), que é o que o programa usa.
 *
 * Uso:  node scripts/download-winrate-page.js
 *       (pede usuário e senha; ou use NA_USER=... NA_PASS=... node scripts/... para não digitar)
 *       A senha não é exibida nem gravada em lugar nenhum.
 *
 * Requer Node 18+ (usa fetch nativo).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SITE = 'https://www.naruto-arena.site';
const OUT = path.join(__dirname, '..', 'data', 'winrate-pagina.js');   // separado do winrate oficial (data/winrate.js, gerado dos patch notes)

function ask(question, hidden) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // esconde a senha enquanto digita
      const onData = () => { readline.cursorTo(process.stdout, question.length); readline.clearLine(process.stdout, 1); };
      process.stdin.on('data', onData);
      rl.question(question, ans => { process.stdin.off('data', onData); rl.close(); process.stdout.write('\n'); resolve(ans); });
    } else {
      rl.question(question, ans => { rl.close(); resolve(ans); });
    }
  });
}

function cookiesFrom(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  return raw.map(c => c.split(';')[0]).join('; ');
}

function findWinrateArray(obj, depth = 0) {
  if (!obj || depth > 6) return null;
  if (Array.isArray(obj) && obj.length && obj[0] && typeof obj[0] === 'object' && 'character' in obj[0] && 'matchesPlayed' in obj[0]) return obj;
  if (typeof obj === 'object') for (const v of Object.values(obj)) { const r = findWinrateArray(v, depth + 1); if (r) return r; }
  return null;
}

(async () => {
  // credenciais: variáveis de ambiente NA_USER / NA_PASS ou perguntadas no terminal
  const username = process.env.NA_USER || await ask('Usuário Naruto-Arena: ');
  const password = process.env.NA_PASS || await ask('Senha: ', true);

  console.log('Fazendo login...');
  const login = await fetch(SITE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const loginBody = await login.json().catch(() => ({}));
  const cookie = cookiesFrom(login);
  if (!login.ok || !cookie || (loginBody && loginBody.message && loginBody.message !== 'loginSucess' && loginBody.status !== 'loginSucess')) {
    console.error('Falha no login:', login.status, JSON.stringify(loginBody).slice(0, 200));
    process.exit(1);
  }

  console.log('Descobrindo build do site...');
  const home = await fetch(SITE + '/', { headers: { cookie } });
  const html = await home.text();
  const build = (html.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/) || [])[1];
  if (!build) { console.error('Não achei o buildId do Next.js na página inicial.'); process.exit(1); }

  console.log('Baixando winrate...');
  let data = null;
  const res = await fetch(`${SITE}/_next/data/${build}/characters-winrate.json`, { headers: { cookie } });
  if (res.ok) data = findWinrateArray(await res.json().catch(() => null));
  if (!data) {
    // fallback: a página HTML com __NEXT_DATA__
    const page = await fetch(SITE + '/characters-winrate', { headers: { cookie } });
    const txt = await page.text();
    const m = txt.match(/<script id="__NEXT_DATA__"[^>]*>([^<]*)<\/script>/);
    if (m) data = findWinrateArray(JSON.parse(m[1]));
  }
  if (!data) {
    console.error('A página de winrate não retornou dados para esta conta. Logado, o site redireciona /characters-winrate para a home,');
    console.error('o que indica que ela é restrita (nível/rank mínimo ou tipo de membro). O programa continua funcionando só com a heurística.');
    process.exit(1);
  }

  const out = {};
  for (const r of data) {
    out[String(r.character).trim()] = {
      wins: +r.wins || 0,
      matches: +r.matchesPlayed || 0,
      winrate: +r.winsWinrate || 0,        // % de vitórias
      usage: +r.matchesWinrate || 0,       // % de participação nas partidas
    };
  }
  const js = `// Gerado por scripts/download-winrate-page.js em ${new Date().toISOString()}\n` +
    `(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_WINRATE = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(out)});\n`;
  fs.writeFileSync(OUT, js);
  console.log(`OK: ${Object.keys(out).length} personagens gravados em ${path.relative(process.cwd(), OUT)}`);
  process.exit(0);
})().catch(err => { console.error('Erro:', err.message); process.exit(1); });
