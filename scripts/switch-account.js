#!/usr/bin/env node
/*
 * Troca a conta ativa do programa entre as já baixadas (data/accounts/*.js).
 *   node scripts/switch-account.js            -> lista as contas disponíveis
 *   node scripts/switch-account.js <usuario>  -> ativa essa conta (copia para data/account.js)
 * Para atualizar os dados de uma conta, use scripts/download-account.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'data', 'accounts');
const OUT = path.join(__dirname, '..', 'data', 'account.js');
const who = (process.argv[2] || '').toLowerCase();
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.js')) : [];
if (!who) {
  if (!files.length) { console.log('Nenhuma conta baixada ainda. Rode: node scripts/download-account.js'); process.exit(0); }
  let active = null; try { active = require(OUT).username; } catch (e) { /* placeholder */ }
  console.log('Contas disponíveis:');
  for (const f of files) {
    const a = require(path.join(DIR, f));
    const done = Object.values(a.missions || {}).filter(m => m.isCompleted).length;
    console.log(`  ${a.username.toLowerCase() === (active || '').toLowerCase() ? '*' : ' '} ${a.username.padEnd(16)} nível ${a.profile.level ?? '?'} · ${a.profile.rank || '?'} · ${done} missões concluídas · baixada em ${a.fetchedAt.slice(0, 10)}`);
  }
  console.log('(* = ativa) Use: node scripts/switch-account.js <usuario>');
  process.exit(0);
}
const f = path.join(DIR, who + '.js');
if (!fs.existsSync(f)) { console.error(`Conta "${who}" não encontrada em data/accounts/. Baixe com scripts/download-account.js.`); process.exit(1); }
fs.copyFileSync(f, OUT);
console.log(`Conta ativa agora: ${require(OUT).username}. Recarregue o index.html.`);
