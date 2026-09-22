#!/usr/bin/env node
/*
 * Cria, DENTRO da pasta do projeto, um lançador para abrir o NA Team Builder sem terminal
 * (ele roda `node start.js`: sobe o servidor local e abre o navegador). Nada é instalado fora da pasta;
 * entradas antigas no menu de aplicativos / área de trabalho, se existirem, são removidas.
 *   Linux  : "NA Team Builder.desktop" (marcado como confiável para o GNOME; duplo clique no Arquivos)
 *   Windows: "NA Team Builder.vbs"     (duplo clique; abre sem janela de console)
 *   macOS  : "NA Team Builder.command" (duplo clique)
 * Os caminhos ficam absolutos: se mover a pasta, rode de novo (aba Ferramentas > Criar lançador na pasta).
 * Uso: node scripts/create-launcher.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ABRIR = path.join(ROOT, 'start.js');
// prefere o "node" genérico do sistema quando é o mesmo binário (sobrevive a atualizações do Node)
const NODE = (() => { for (const c of ['/usr/bin/node', '/usr/local/bin/node']) { try { if (fs.realpathSync(c) === fs.realpathSync(process.execPath)) return c; } catch (e) { /* não existe */ } } return process.execPath; })();
const q = s => '"' + s.replace(/"/g, '\\"') + '"';   // aspas do campo Exec do .desktop

// limpa o que a versão anterior deste script instalava fora da pasta
function limparAntigos() {
  const candidatos = [path.join(os.homedir(), '.local', 'share', 'applications', 'na-team-builder.desktop')];
  try { const d = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' }).trim(); if (d) candidatos.push(path.join(d, 'NA Team Builder.desktop')); } catch (e) { /* sem xdg */ }
  for (const n of ['Desktop', 'Área de trabalho', 'Área de Trabalho']) candidatos.push(path.join(os.homedir(), n, 'NA Team Builder.desktop'));
  for (const f of new Set(candidatos)) if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('Removido atalho antigo fora da pasta: ' + f); }
}

if (process.platform === 'linux') {
  limparAntigos();
  const f = path.join(ROOT, 'NA Team Builder.desktop');
  fs.writeFileSync(f, ['[Desktop Entry]', 'Type=Application', 'Version=1.0', 'Name=NA Team Builder', 'Comment=Sugestões de times para Naruto-Arena',
    `Exec=${q(NODE)} ${q(ABRIR)}`, `Path=${ROOT}`, 'Icon=applications-games', 'Terminal=false', 'StartupNotify=false', ''].join('\n'), { mode: 0o755 });
  fs.chmodSync(f, 0o755);
  // o mesmo que "Permitir execução" no menu do botão direito do GNOME Arquivos
  try { execFileSync('gio', ['set', f, 'metadata::trusted', 'true'], { stdio: 'ignore' }); } catch (e) { /* sem gio: o GNOME pergunta na primeira vez */ }
  console.log('Lançador criado na pasta do projeto: ' + f);
  console.log('Duplo clique nele no Arquivos abre o programa sem terminal (se o GNOME mostrar "não confiável", botão direito > "Permitir execução").');
} else if (process.platform === 'win32') {
  const f = path.join(ROOT, 'NA Team Builder.vbs');
  fs.writeFileSync(f, `CreateObject("WScript.Shell").Run """${NODE}"" ""${ABRIR}""", 0, False\n`);
  console.log('Lançador criado na pasta do projeto: ' + f + ' (duplo clique; abre sem janela de console)');
} else if (process.platform === 'darwin') {
  const f = path.join(ROOT, 'NA Team Builder.command');
  fs.writeFileSync(f, `#!/bin/bash\ncd "${ROOT}"\n"${NODE}" "${ABRIR}"\n`, { mode: 0o755 });
  console.log('Lançador criado na pasta do projeto: ' + f + ' (duplo clique)');
} else {
  console.log(`Sistema não reconhecido. Crie um atalho que execute: "${NODE}" "${ABRIR}"`);
}
