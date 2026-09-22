#!/usr/bin/env node
/*
 * Abre o NA Team Builder:
 *   1. sobe o servidor local (server.js) em http://127.0.0.1:8765/ (ou a próxima porta livre)
 *   2. abre a página no navegador padrão
 *   3. em segundo plano, verifica se o jogo mudou (catálogo/build) e, se sim, atualiza os dados;
 *      se houver credenciais (NA_USER/NA_PASS no ambiente ou no .env), atualiza também a conta.
 *      A página mostra o andamento na aba "Ferramentas" e avisa quando for preciso recarregar.
 *   Todas as funções dos scripts ficam disponíveis na aba "Ferramentas", sem terminal.
 *
 * Uso:  node start.js [--no-update] [--force] [--check-only] [--no-browser] [--forum] [--port N]
 *   --check-only : só verifica/atualiza no terminal e sai (não sobe o servidor)
 *   --no-browser : sobe o servidor sem abrir o navegador (abra a URL mostrada)
 *   (as flags antigas em português seguem funcionando: --sem-atualizar, --forcar, --nao-abrir, --sem-navegador, --porta)
 *   --forum     : rebaixa também o fórum na verificação inicial (exige credenciais; demora)
 * data/config.json (pela aba Ferramentas): observarAoAbrir = liga o observador de partidas ao abrir (precisa de senha salva)
 * .env (opcional, na pasta do projeto):   NA_USER=usuario   /   NA_PASS=senha
 *   -> fica em texto puro no seu disco; use só se isso for aceitável para você. Está no .gitignore.
 * Para abrir sem terminal: duplo clique em "NA Team Builder.desktop" na pasta (crie com Ferramentas > "Criar lançador
 *   na pasta" ou node scripts/create-launcher.js). Nada é instalado fora da pasta.
 */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const srv = require('./server.js');

const args = process.argv.slice(2);
const skip = args.includes('--no-update') || args.includes('--sem-atualizar');
const force = args.includes('--force') || args.includes('--forcar');
const noOpen = args.includes('--check-only') || args.includes('--nao-abrir');
const porta = +(args[(args.includes('--port') ? args.indexOf('--port') : args.indexOf('--porta')) + 1] || 0) || null;

function abrirNavegador(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { const p = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }); p.on('error', () => {}); p.unref(); return true; } catch (e) { return false; }
}
function esperar(run) { return new Promise(res => { const t = setInterval(() => { if (run.status !== 'rodando') { clearInterval(t); res(run); } }, 200); }); }

(async () => {
  srv.loadEnv();
  const creds = process.env.NA_USER && process.env.NA_PASS ? { user: process.env.NA_USER, pass: process.env.NA_PASS } : null;

  if (noOpen) {   // modo antigo: só atualiza, no terminal
    const { runs, iniciarTarefa } = srv;
    srv.setEcho(true);
    const r = iniciarTarefa('inicio', { forcar: force }, creds);
    if (r.erro) { console.error('Erro:', r.erro); process.exit(1); }
    await esperar(runs.inicio);
    if (args.includes('--forum') && creds) { iniciarTarefa('forum', {}, creds); await esperar(runs.forum); }
    process.exit(runs.inicio.status === 'ok' ? 0 : 1);
  }

  // já tem uma instância aberta? só abre o navegador nela
  for (const p of porta ? [porta] : [8765, 8766, 8767, 8768]) {
    if (await srv.instanciaAtiva(p)) { const url = `http://127.0.0.1:${p}/`; console.log('O programa já está aberto em ' + url); abrirNavegador(url); process.exit(0); }
  }

  const s = await srv.start({ porta, echo: !!process.stdout.isTTY });
  console.log(`NA Team Builder em ${s.url}  (Ctrl+C ou o botão "Encerrar" na aba Ferramentas para fechar)`);
  if (!args.includes('--no-browser') && !args.includes('--sem-navegador') && !abrirNavegador(s.url)) console.log('Não consegui abrir o navegador automaticamente; abra ' + s.url);

  const cfg = srv.readConfig();
  const ligarObservador = () => {
    if (!cfg.observarAoAbrir || !creds) return;
    const r = s.iniciarTarefa('observar', { intervalo: cfg.intervaloObservador }, creds);
    console.log(r.ok ? 'Observador de partidas iniciado (configurado para abrir junto).' : 'Observador não iniciado: ' + r.erro);
  };
  if (!skip) {
    const r = s.iniciarTarefa('inicio', { forcar: force }, creds);
    if (r.ok) esperar(s.runs.inicio).then(() => { if (args.includes('--forum') && creds) s.iniciarTarefa('forum', {}, creds); ligarObservador(); });
    else ligarObservador();
  } else { console.log('Verificação de atualização pulada (--sem-atualizar).'); ligarObservador(); }

  const sair = () => { s.pararTudo(); process.exit(0); };
  process.on('SIGINT', sair); process.on('SIGTERM', sair);
})().catch(err => { console.error('Erro:', err.message); process.exit(1); });
