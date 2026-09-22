/*
 * Servidor local do NA Team Builder (usado por start.js).
 *   - serve a página em http://127.0.0.1:<porta>/  (só aceita conexões da própria máquina)
 *   - executa os scripts da pasta scripts/ a pedido da aba "Ferramentas", com log ao vivo
 *   - sem dependências; Node 18+
 *
 * API (JSON):  GET  /api/estado                      estado geral, tarefas, contas baixadas, login salvo
 *              POST /api/tarefas/<id>/iniciar        { params, user, pass, salvar }
 *              POST /api/tarefas/<id>/parar
 *              GET  /api/tarefas/<id>/log?desde=N    texto do log a partir do caractere N
 *              POST /api/login/salvar | /api/login/esquecer
 *              POST /api/config                      { observarAoAbrir, intervaloObservador } -> data/config.json
 *              POST /api/overrides                   { char, skill, override|null } -> data/skill-overrides.js
 *              POST /api/encerrar
 * Segurança: escuta só em 127.0.0.1; confere o cabeçalho Host; POSTs exigem Content-Type JSON (um site
 * qualquer aberto no navegador não consegue disparar as tarefas); nunca serve arquivos ocultos (.env).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = __dirname;
const SITE = 'https://www.naruto-arena.site';
const APP = 'na-team-builder';
const ENV_FILE = path.join(ROOT, '.env');
const MAX_LOG = 1024 * 1024;

// ---------------------------------------------------------------- .env (NA_USER / NA_PASS)
function readEnvFile() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
function loadEnv() { const e = readEnvFile(); for (const k of Object.keys(e)) if (!process.env[k]) process.env[k] = e[k]; }
function saveEnv(user, pass) {
  const keep = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split('\n').filter(l => !/^\s*NA_(USER|PASS)\s*=/.test(l) && l.trim()) : [];
  fs.writeFileSync(ENV_FILE, [...keep, `NA_USER=${user}`, `NA_PASS=${pass}`].join('\n') + '\n', { mode: 0o600 });
  process.env.NA_USER = user; process.env.NA_PASS = pass;
}
function forgetEnv() {
  if (fs.existsSync(ENV_FILE)) {
    const keep = fs.readFileSync(ENV_FILE, 'utf8').split('\n').filter(l => !/^\s*NA_(USER|PASS)\s*=/.test(l) && l.trim());
    if (keep.length) fs.writeFileSync(ENV_FILE, keep.join('\n') + '\n'); else fs.unlinkSync(ENV_FILE);
  }
  delete process.env.NA_USER; delete process.env.NA_PASS;
}
const savedLogin = () => ({ user: process.env.NA_USER || '', senhaSalva: !!(process.env.NA_USER && process.env.NA_PASS) });

// ---------------------------------------------------------------- config do programa (data/config.json)
const CONFIG_FILE = path.join(ROOT, 'data', 'config.json');
const CONFIG_DEFAULT = { observarAoAbrir: false, intervaloObservador: 45, capturarAdversario: false };
function readConfig() { try { return { ...CONFIG_DEFAULT, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch (e) { return { ...CONFIG_DEFAULT }; } }
function writeConfig(patch) {
  const cfg = readConfig();
  if (typeof patch.observarAoAbrir === 'boolean') cfg.observarAoAbrir = patch.observarAoAbrir;
  if (Number.isFinite(+patch.intervaloObservador)) cfg.intervaloObservador = Math.max(20, Math.round(+patch.intervaloObservador));
  if (typeof patch.capturarAdversario === 'boolean') cfg.capturarAdversario = patch.capturarAdversario;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 1) + '\n');
  return cfg;
}
// resumo do observador para o cabeçalho da página: partidas registradas hoje / no total
function observerStats() {
  const acc = contaAtiva(); if (!acc) return null;
  let results = []; try { results = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'accounts', acc.username.toLowerCase() + '.results.json'), 'utf8')); } catch (e) { /* sem resultados */ }
  const today = new Date().toISOString().slice(0, 10);
  const hoje = results.filter(r => String(r.at).slice(0, 10) === today);
  const n = r => Math.max(1, (r.win || 0) + (r.lose || 0));   // um registro pode cobrir várias partidas (salto no objetivo)
  return { total: results.reduce((s, r) => s + n(r), 0), hoje: hoje.reduce((s, r) => s + n(r), 0), vitoriasHoje: hoje.reduce((s, r) => s + (r.win || 0), 0), ultima: results.length ? results[results.length - 1] : null };
}
const mtimeOf = file => { try { return Math.round(fs.statSync(file).mtimeMs); } catch (e) { return 0; } };

// ---------------------------------------------------------------- correções manuais de skill (data/skill-overrides.js), editadas pela página
const OV_FILE = path.join(ROOT, 'data', 'skill-overrides.js');
const OV_NUM = ['dmg', 'dmgCond', 'stun', 'drain', 'debuff', 'heal', 'healAlly', 'dr', 'drAlly', 'dd', 'ddAlly', 'amplify', 'extendTurns', 'multiTurn', 'chakraGain'];
const OV_BOOL = ['aoe', 'pierce', 'affliction', 'invulnSelf', 'invulnAlly', 'invulnTeam', 'counter', 'counterEnemy', 'reflect', 'uncounterable', 'ignoreInvuln', 'ignoreStun', 'cleanse', 'noDefense', 'noDefenseAoe', 'antiHeal', 'costUp', 'setup', 'free', 'invisible'];
const OV_HEADER = `// Correções manuais do que o programa extraiu de cada skill. Têm a palavra final sobre o parser.
// Formato: { "Nome do personagem": { "Nome da skill": { campo: valor, tags: ["+tag", "-tag"], nota: "por quê" } } }
// Campos numéricos: ${OV_NUM.join(', ')}
// Campos lógicos: ${OV_BOOL.join(', ')}
// Editável pela interface (detalhe do personagem › ✎ Corrigir leitura), que grava aqui pelo servidor local; ou à mão.
// Veja data/skills-db.md para o que foi extraído de cada skill (gere com: node scripts/build-skills-db.js).
`;
function readOverrides() { try { return readModule(OV_FILE) || {}; } catch (e) { return {}; } }
function writeOverrides(map) {
  const sorted = {}; for (const k of Object.keys(map).sort()) sorted[k] = map[k];
  fs.writeFileSync(OV_FILE, OV_HEADER + `(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_SKILL_OVERRIDES = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(sorted, null, 2)});\n`);
}
function sanitizeOverride(ov) {
  if (!ov || typeof ov !== 'object') return null;
  const out = {};
  for (const k of OV_NUM) if (ov[k] != null && ov[k] !== '' && Number.isFinite(+ov[k])) out[k] = Math.round(+ov[k] * 100) / 100;
  for (const k of OV_BOOL) if (typeof ov[k] === 'boolean') out[k] = ov[k];
  if (Array.isArray(ov.tags)) { const tags = ov.tags.filter(t => typeof t === 'string' && /^[+-]?[A-Za-z]{1,30}$/.test(t)).slice(0, 40); if (tags.length) out.tags = tags; }
  if (typeof ov.nota === 'string' && ov.nota.trim()) out.nota = ov.nota.trim().slice(0, 300);
  return Object.keys(out).filter(k => k !== 'nota').length ? out : null;   // só nota não é correção
}
function setOverride(char, skill, ov) {
  const chars = readModule(path.join(ROOT, 'data', 'characters.js'));
  const c = chars.find(x => x.name === char);
  if (!c) return { erro: 'personagem desconhecido' };
  if (skill !== '*' && !(c.skills || []).some(s => s.name === skill)) return { erro: 'skill desconhecida' };
  const map = readOverrides();
  const clean = sanitizeOverride(ov);
  if (clean) { map[char] = map[char] || {}; map[char][skill] = clean; }
  else if (map[char]) { delete map[char][skill]; if (!Object.keys(map[char]).length) delete map[char]; }
  writeOverrides(map);
  return { ok: true, overrides: map, override: clean };
}

// ---------------------------------------------------------------- versão do jogo (mesma checagem do start.js antigo)
async function currentVersion() {
  const ctl = AbortSignal.timeout(20000);
  const home = await (await fetch(SITE + '/', { signal: ctl })).text();
  const build = (home.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/) || [])[1];
  const manifest = await (await fetch(`${SITE}/_next/static/${build}/_buildManifest.js`, { signal: ctl })).text();
  const ingameChunk = (manifest.match(/static\/chunks\/pages\/ingame-[a-z0-9]+\.js/) || [])[0];
  const ingame = await (await fetch(`${SITE}/_next/${ingameChunk}`, { signal: ctl })).text();
  const varName = (ingame.match(/selectionCatalogVersion:([A-Za-z_$][A-Za-z0-9_$]*)/) || [])[1];
  const catalogVersion = varName ? (ingame.match(new RegExp('\\b' + varName.replace(/\$/g, '\\$') + '="([0-9a-f]{20,})"')) || [])[1] : null;
  return { build, catalogVersion };
}
async function verificarVersao(ctx) {
  let local = null; try { local = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'version.json'), 'utf8')); } catch (e) { /* sem registro */ }
  ctx.log('Verificando atualizações do jogo... ');
  let remote = null;
  try { remote = await currentVersion(); } catch (e) { ctx.log('sem conexão (' + e.message + '); usando dados locais.\n'); ctx.mudou = false; return; }
  ctx.mudou = !local || local.catalogVersion !== remote.catalogVersion || local.build !== remote.build;
  if (ctx.params.forcar) ctx.log('atualização forçada.\n');
  else if (ctx.mudou) ctx.log(local ? 'há novidades! Atualizando...\n' : 'primeira verificação. Atualizando...\n');
  else ctx.log('dados em dia (catálogo ' + String(remote.catalogVersion).slice(0, 8) + ').\n');
}
function contasBaixadas() {
  const dir = path.join(ROOT, 'data', 'accounts');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    try { const a = readModule(path.join(dir, f)); out.push({ username: a.username, level: a.profile && a.profile.level, rank: a.profile && a.profile.rank, fetchedAt: a.fetchedAt }); } catch (e) { /* ignora */ }
  }
  return out;
}
function readModule(file) { delete require.cache[require.resolve(file)]; return require(file); }
function contaAtiva() { try { const a = readModule(path.join(ROOT, 'data', 'account.js')); return a && a.username ? { username: a.username, fetchedAt: a.fetchedAt } : null; } catch (e) { return null; } }

// ---------------------------------------------------------------- tarefas
// passo = { script, args(params) } | { fn(ctx) }; `se(ctx)` decide se roda; `login` = recebe NA_USER/NA_PASS
const S = (script, args) => ({ script, args: args || (() => []) });
const seMudou = c => c.mudou || !!c.params.forcar;
const PIPELINE_JOGO = [
  { fn: verificarVersao },
  { ...S('scripts/update-game-data.js'), se: seMudou },
  { ...S('scripts/download-patch-notes.js'), se: seMudou },
  { ...S('scripts/validate-winrate.js'), se: seMudou },   // mede o erro típico...
  { ...S('scripts/build-winrate.js'), se: seMudou },      // ...e o gerador grava essa margem no modelo
  { ...S('scripts/build-community.js'), se: seMudou },
  { ...S('scripts/build-skills-db.js'), se: seMudou },
  { ...S('scripts/download-images.js'), se: seMudou },   // só baixa o que ainda não existe
];
const num = (v, d, min) => { const n = Number(v); return Math.max(min == null ? -Infinity : min, Number.isFinite(n) ? n : d); };
const TAREFAS = {
  // ---- inicial (roda sozinha ao abrir; não aparece como botão)
  'inicio': { grupo: null, recarregar: true, passos: [...PIPELINE_JOGO, { ...S('scripts/download-account.js'), login: true, se: c => !!c.creds }, { ...S('scripts/health-check.js'), loginOpcional: true }] },
  // ---- dados do jogo
  'atualizar-tudo': { grupo: 'jogo', recarregar: true, params: [{ id: 'forcar', tipo: 'bool', padrao: false }], passos: PIPELINE_JOGO },
  'atualizar-dados': { grupo: 'jogo', recarregar: true, passos: [S('scripts/update-game-data.js')] },
  'balanceamentos': { grupo: 'jogo', recarregar: true, passos: [S('scripts/download-patch-notes.js'), S('scripts/build-winrate.js')] },
  'winrate': { grupo: 'jogo', recarregar: true, passos: [S('scripts/build-winrate.js')] },
  'comunidade': { grupo: 'jogo', recarregar: true, passos: [S('scripts/build-community.js')] },
  'skills-db': { grupo: 'jogo', passos: [S('scripts/build-skills-db.js')] },
  'imagens': { grupo: 'jogo', recarregar: true, params: [{ id: 'forcar', tipo: 'bool', padrao: false }], passos: [S('scripts/download-images.js', p => (p.forcar ? ['--forcar'] : []))] },
  'coletar-times': { grupo: 'jogo', login: true, recarregar: true, demorada: true, params: [{ id: 'paginas', tipo: 'number', padrao: 15, min: 1 }], passos: [{ ...S('scripts/collect-ladder-teams.js', p => ['--paginas', String(num(p.paginas, 15, 1))]), login: true }, S('scripts/build-community.js')] },
  'mapear-site': { grupo: 'analise', login: true, passos: [{ ...S('scripts/map-site.js'), login: true }] },
  'forum': { grupo: 'jogo', login: true, recarregar: true, demorada: true, passos: [{ ...S('scripts/download-forum.js'), login: true }, S('scripts/build-winrate.js'), S('scripts/build-community.js')] },
  // ---- conta
  'conta': { grupo: 'conta', login: true, recarregar: true, passos: [{ ...S('scripts/download-account.js'), login: true }] },
  'trocar-conta': { grupo: 'conta', recarregar: true, params: [{ id: 'usuario', tipo: 'conta' }], passos: [S('scripts/switch-account.js', p => [String(p.usuario || '')])] },
  'observar': { grupo: 'conta', login: true, daemon: true, params: [{ id: 'intervalo', tipo: 'number', padrao: 45, min: 20 }], passos: [{ ...S('scripts/watch-matches.js', p => ['--intervalo', String(num(p.intervalo, 45, 20))]), login: true }] },
  'diario': { grupo: 'conta', passos: [S('scripts/diary.js')] },
  'diario-registrar': { grupo: 'conta', params: [{ id: 'a', tipo: 'char' }, { id: 'b', tipo: 'char' }, { id: 'c', tipo: 'char' }, { id: 'v', tipo: 'number', padrao: 0, min: 0 }, { id: 'd', tipo: 'number', padrao: 0, min: 0 }],
    passos: [S('scripts/diary.js', p => ['registrar', String(p.a || ''), String(p.b || ''), String(p.c || ''), String(num(p.v, 0, 0)), String(num(p.d, 0, 0))])] },
  // ---- análise
  'treinar': { grupo: 'analise', params: [{ id: 'modo', tipo: 'select', opcoes: ['forca', 'todos', 'diario'], padrao: 'forca' }, { id: 'aplicar', tipo: 'bool', padrao: false }],
    passos: [S('scripts/train-synergy.js', p => ['--modo=' + (['forca', 'todos', 'diario'].includes(p.modo) ? p.modo : 'forca'), ...(p.aplicar ? ['--aplicar'] : [])])] },
  'calibrar': { grupo: 'analise', passos: [S('scripts/calibrate.js')] },
  'validar-winrate': { grupo: 'analise', passos: [S('scripts/validate-winrate.js')] },
  'validar-chakra': { grupo: 'analise', passos: [S('scripts/validate-chakra.js')] },
  'saude': { grupo: 'analise', login: true, passos: [{ ...S('scripts/health-check.js'), login: true }] },
  'cobertura-skills': { grupo: 'analise', params: [{ id: 'detalhe', tipo: 'bool', padrao: false }], passos: [S('scripts/skill-coverage.js', p => (p.detalhe ? ['--detalhe'] : []))] },
  'testes': { grupo: 'analise', passos: [S('test.js')] },
  // ---- experimentos
  'simular': { grupo: 'experimentos', demorada: true, params: [{ id: 'partidas', tipo: 'number', padrao: 40000, min: 1000 }], passos: [S('scripts/simulate.js', p => ['--partidas', String(num(p.partidas, 40000, 1000))])] },
  'winrate-pagina': { grupo: 'experimentos', login: true, passos: [{ ...S('scripts/download-winrate-page.js'), login: true }] },
  // ---- sistema
  'atalho': { grupo: 'sistema', passos: [S('scripts/create-launcher.js')] },
};
const ORDEM = Object.keys(TAREFAS).filter(id => TAREFAS[id].grupo);

// estado de execução por tarefa
const runs = {};
for (const id of Object.keys(TAREFAS)) runs[id] = { status: 'ocioso', log: '', inicio: null, fim: null, codigo: null, alterou: false, child: null, mensagem: null };
let dadosAlterados = 0;   // epoch ms da última tarefa que mexeu nos dados carregados pela página
let echo = false;         // repete o log no terminal (quando aberto por um)

function estadoTarefas() {
  const out = {};
  for (const id of Object.keys(runs)) { const r = runs[id]; out[id] = { status: r.status, inicio: r.inicio, fim: r.fim, codigo: r.codigo, alterou: r.alterou, tamanho: r.log.length, mensagem: r.mensagem }; }
  return out;
}
function append(r, text) {
  r.log += text;
  if (r.log.length > MAX_LOG) r.log = '[... início do log descartado ...]\n' + r.log.slice(r.log.length - MAX_LOG / 2);
  if (echo) process.stdout.write(text);
}
function spawnStep(r, step, params, creds) {
  return new Promise(resolve => {
    const args = step.args(params);
    append(r, `\n$ node ${step.script}${args.length ? ' ' + args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ') : ''}\n`);
    const env = { ...process.env };
    delete env.NA_USER; delete env.NA_PASS;
    if ((step.login || step.loginOpcional) && creds) { env.NA_USER = creds.user; env.NA_PASS = creds.pass; }
    const child = spawn(process.execPath, [path.join(ROOT, step.script), ...args], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    r.child = child;
    child.stdout.on('data', d => append(r, d.toString()));
    child.stderr.on('data', d => append(r, d.toString()));
    child.on('error', e => { append(r, 'erro ao iniciar: ' + e.message + '\n'); r.child = null; resolve(1); });
    child.on('close', code => { r.child = null; resolve(code == null ? 1 : code); });
  });
}
function iniciarTarefa(id, params, creds) {
  const def = TAREFAS[id];
  if (!def) return { erro: 'tarefa desconhecida' };
  const r = runs[id];
  if (r.status === 'rodando') return { erro: 'ja-rodando' };
  const outra = Object.keys(runs).find(k => k !== id && runs[k].status === 'rodando' && !TAREFAS[k].daemon);
  if (outra && !def.daemon) return { erro: 'ocupado', tarefa: outra };
  const precisaLogin = def.login || def.passos.some(p => p.login && !p.se);
  if (precisaLogin && !(creds && creds.user && creds.pass)) return { erro: 'sem-login' };
  Object.assign(r, { status: 'rodando', log: '', inicio: Date.now(), fim: null, codigo: null, alterou: false, mensagem: null, parada: false });
  (async () => {
    const ctx = { params: params || {}, creds: creds && creds.user && creds.pass ? creds : null, mudou: false, log: t => append(r, t) };
    let codigo = 0;
    for (const step of def.passos) {
      if (r.parada) { codigo = 130; break; }
      if (step.se && !step.se(ctx)) continue;
      if (step.fn) { try { await step.fn(ctx); } catch (e) { append(r, 'Erro: ' + e.message + '\n'); codigo = 1; break; } continue; }
      codigo = await spawnStep(r, step, ctx.params, ctx.creds);
      if (codigo !== 0) { if (!r.parada) append(r, `(terminou com código ${codigo})\n`); break; }
      r.alterou = r.alterou || !!def.recarregar;
    }
    r.status = r.parada ? 'parada' : codigo === 0 ? 'ok' : 'erro';
    r.codigo = codigo; r.fim = Date.now();
    if (r.alterou && r.status !== 'erro') dadosAlterados = Date.now();
    append(r, r.status === 'ok' ? '\n✔ concluído\n' : r.status === 'parada' ? '\n■ parado\n' : '\n✖ falhou\n');
  })();
  return { ok: true };
}
function pararTarefa(id) {
  const r = runs[id];
  if (!r || r.status !== 'rodando') return { erro: 'nao-rodando' };
  r.parada = true;
  if (r.child) { try { r.child.kill('SIGTERM'); } catch (e) { /* já saiu */ } }
  return { ok: true };
}
function pararTudo() { for (const id of Object.keys(runs)) if (runs[id].child) { try { runs[id].child.kill('SIGTERM'); } catch (e) { /* ignora */ } } }

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };
function sendJson(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''; req.on('data', c => { data += c; if (data.length > 1e6) { reject(new Error('body grande demais')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}
function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  if (p.split('/').some(seg => seg.startsWith('.'))) { res.writeHead(403); return res.end('proibido'); }
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('proibido'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function start(opts) {
  opts = opts || {};
  loadEnv();
  echo = !!opts.echo;
  const portas = opts.porta != null ? [opts.porta] : Array.from({ length: 12 }, (_, i) => 8765 + i);   // porta 0 = qualquer livre (testes)
  let server = null, porta = null, encerrando = false;

  async function api(req, res, url) {
    const host = String(req.headers.host || '');
    if (host !== `127.0.0.1:${porta}` && host !== `localhost:${porta}`) return sendJson(res, 403, { erro: 'host inválido' });
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${porta}` && origin !== `http://localhost:${porta}`) return sendJson(res, 403, { erro: 'origem inválida' });
      if (!/^application\/json/i.test(String(req.headers['content-type'] || ''))) return sendJson(res, 415, { erro: 'esperado JSON' });
    }
    const [, , recurso, id, acao] = url.pathname.split('/'); // /api/<recurso>/<id>/<acao>
    if (req.method === 'GET' && recurso === 'estado') {
      const tarefas = {};
      for (const k of ORDEM) { const d = TAREFAS[k]; tarefas[k] = { grupo: d.grupo, login: !!d.login, daemon: !!d.daemon, demorada: !!d.demorada, recarregar: !!d.recarregar, params: (d.params || []).map(p => ({ ...p })) }; }
      return sendJson(res, 200, { app: APP, porta, agora: Date.now(), login: savedLogin(), conta: contaAtiva(), contas: contasBaixadas(), tarefas, execucoes: estadoTarefas(), dadosAlterados, config: readConfig(), observador: observerStats(), arquivos: { account: mtimeOf(path.join(ROOT, 'data', 'account.js')) } });
    }
    if (recurso === 'tarefas' && TAREFAS[id]) {
      if (req.method === 'GET' && acao === 'log') {
        const r = runs[id]; const desde = Math.max(0, +(url.searchParams.get('desde') || 0));
        return sendJson(res, 200, { status: r.status, tamanho: r.log.length, texto: desde <= r.log.length ? r.log.slice(desde) : r.log, reiniciou: desde > r.log.length });
      }
      if (req.method === 'POST' && acao === 'iniciar') {
        const body = await readBody(req);
        const user = String(body.user || '').trim(), pass = String(body.pass || '');
        const creds = user && pass ? { user, pass } : (process.env.NA_USER && process.env.NA_PASS ? { user: process.env.NA_USER, pass: process.env.NA_PASS } : null);
        if (body.salvar && user && pass) saveEnv(user, pass);
        const r = iniciarTarefa(id, body.params || {}, creds);
        return sendJson(res, r.ok ? 200 : 409, r);
      }
      if (req.method === 'POST' && acao === 'parar') { const r = pararTarefa(id); return sendJson(res, r.ok ? 200 : 409, r); }
    }
    if (req.method === 'POST' && recurso === 'login') {
      const body = await readBody(req);
      if (id === 'salvar') { const user = String(body.user || '').trim(), pass = String(body.pass || ''); if (!user || !pass) return sendJson(res, 400, { erro: 'sem-login' }); saveEnv(user, pass); return sendJson(res, 200, { ok: true, login: savedLogin() }); }
      if (id === 'esquecer') { forgetEnv(); return sendJson(res, 200, { ok: true, login: savedLogin() }); }
    }
    if (req.method === 'POST' && recurso === 'overrides') { const body = await readBody(req); const r = setOverride(String(body.char || ''), String(body.skill || ''), body.override); return sendJson(res, r.ok ? 200 : 400, r); }
    if (req.method === 'POST' && recurso === 'config') { const body = await readBody(req); return sendJson(res, 200, { ok: true, config: writeConfig(body || {}) }); }
    if (req.method === 'POST' && recurso === 'encerrar') {
      sendJson(res, 200, { ok: true });
      encerrando = true; pararTudo();
      setTimeout(() => { server.close(); process.exit(0); }, 300);
      return;
    }
    sendJson(res, 404, { erro: 'rota desconhecida' });
  }

  return new Promise((resolve, reject) => {
    let i = 0;
    const tentar = () => {
      if (i >= portas.length) return reject(new Error('nenhuma porta livre entre ' + portas[0] + ' e ' + portas[portas.length - 1]));
      porta = portas[i++];
      server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://127.0.0.1:${porta}`);
        if (url.pathname.startsWith('/api/')) return api(req, res, url).catch(e => sendJson(res, 500, { erro: e.message }));
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
        serveStatic(req, res, url.pathname);
      });
      server.on('error', e => { if (e.code === 'EADDRINUSE') tentar(); else reject(e); });
      server.listen(porta, '127.0.0.1', () => { porta = server.address().port; resolve({ porta, url: `http://127.0.0.1:${porta}/`, server, iniciarTarefa, pararTudo, runs, encerrando: () => encerrando }); });
    };
    tentar();
  });
}

// já existe uma instância nossa nessa porta?
async function instanciaAtiva(porta) {
  try { const r = await fetch(`http://127.0.0.1:${porta}/api/estado`, { signal: AbortSignal.timeout(1500) }); const j = await r.json(); return j && j.app === APP; } catch (e) { return false; }
}

module.exports = { start, instanciaAtiva, TAREFAS, ORDEM, iniciarTarefa, runs, loadEnv, readEnvFile, readConfig, currentVersion, setEcho: v => { echo = !!v; } };
