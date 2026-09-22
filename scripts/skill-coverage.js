#!/usr/bin/env node
/*
 * Cobertura do leitor de habilidades: compara o que o TEXTO de cada skill diz com o que o parser extraiu.
 * Lista o que ficou de fora (números e mecânicas), agrupado por padrão, para guiar a correção do parser.
 * Uso: node scripts/skill-coverage.js [--detalhe] [--padrao stacks] [--personagem "Nome"]
 */
'use strict';
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'core', 'engine.js'));
const CHARS = require(path.join(__dirname, '..', 'data', 'characters.js'));
try { E.setOverrides(require(path.join(__dirname, '..', 'data', 'curated', 'skill-overrides.js'))); } catch (e) { /* sem correções */ }
const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DETALHE = args.includes('--detalhe');
const SO_PADRAO = argv('--padrao', null);
const SO_CHAR = argv('--personagem', null);

// o que o texto promete -> que campo do parser deveria refletir
const REGRAS = [
  { id: 'dano', re: /\b(\d+)\s+(?:piercing\s+|affliction\s+)?damage\b/i, ok: p => p.dmg > 0 || p.dmgCond > 0 || p.pctDmg > 0 },
  { id: 'dano-%', re: /(\d+)%\s+of\s+(?:their|the target's|one enemy's|an enemy's)/i, ok: p => p.dmg > 0 || p.pctDmg > 0 },
  { id: 'cura', re: /\bheal(?:s|ing)?\b[^.]*?\b(\d+)\b|\bregains?\b[^.]*?\b(\d+)\s+health/i, ok: p => p.heal > 0 || p.healAlly > 0 },
  { id: 'defesa-destrutivel', re: /(\d+)\s+points? of destructible defense/i, ok: p => p.dd > 0 || p.ddAlly > 0 },
  { id: 'reducao-dano', re: /\b(?:gain|gains|gaining|grant|grants|granting|receives?)\b[^.]{0,40}?(\d+)(?:%| points?) (?:of )?(?:unpierceable )?damage reduction/i, ok: p => p.dr > 0 || p.drAlly > 0 },
  { id: 'stun', re: /\bstun(s|ned|ning)?\b/i, ok: p => p.stun > 0 || p.tags.has('ignoreStun') },
  { id: 'chakra-removido', re: /\bremov\w+[^.]*?chakra|\bsteals?\b[^.]*?chakra/i, ok: p => p.drain > 0 },
  { id: 'chakra-ganho', re: /\bgains?\b[^.]*?\bchakra\b/i, ok: p => p.chakraGain > 0 || p.drain > 0 },
  { id: 'invulneravel', re: /\binvulnerab\w+|\binvulnerable\b/i, ok: p => p.invulnSelf || p.invulnAlly || p.invulnTeam || p.tags.has('invuln') || p.tags.has('ignoreInvuln') || p.ignoreInvuln || p.noDefense || p.tags.has('noDefense') || p.tags.has('uncounterable') },
  { id: 'counter', re: /\bcounter(s|ed|ing)?\b/i, ok: p => p.counter || p.counterEnemy || p.tags.has('counter') || p.tags.has('uncounterable') },
  { id: 'reflect', re: /\breflect(s|ed|ing)?\b/i, ok: p => p.reflect || p.tags.has('reflect') || p.tags.has('uncounterable') },
  { id: 'perfurante', re: /\bpiercing\b/i, ok: p => p.pierce || p.tags.has('pierce') },
  { id: 'aflicao', re: /(?<!non-)\baffliction damage\b/i, ok: p => p.affliction || p.tags.has('affliction') || p.tags.has('amplifyAffl') || p.tags.has('cleanse') || p.dmg > 0 || p.dmgCond > 0 },
  { id: 'area', re: /\ball enemies\b|\benemy team\b/i, ok: p => p.aoe || p.tags.has('aoe') || p.aoeEffect || p.tags.has('noDefenseAoe') || p.invulnTeam || p.drAlly > 0 || p.healAlly > 0 },
  { id: 'custo-inimigo', re: /\b(cost|costs)\b[^.]*?\b1 (?:additional|more)\b|requires? 1 additional/i, ok: p => p.costUp || p.debuff > 0 },
  { id: 'anti-cura', re: /cannot be healed|healing (?:is|will be) (?:reduced|prevented)/i, ok: p => p.antiHeal || p.tags.has('antiHeal') },
  // mecânicas que o parser hoje NÃO tem campo: aparecem como "não lido" de propósito
  { id: 'cooldown-mexido', re: /cooldown[^.]*?(?:increas|decreas|reduc|up |down )|\b(?:increase|reduce)s?\b[^.]*?cooldown/i, ok: p => p.cdDown > 0 || p.cdUp > 0 },
  { id: 'acumulos', re: /\b(?:gains?|gaining|granting|receives?|adds?)\b[^.]{0,30}?\b(?:\d+|one|a)\s+[a-z' ]{0,20}stacks?\b/i, ok: p => p.stacks || p.tags.has('stacks') },
  { id: 'copia', re: /\bcopy\b|\bcopies\b|\bcast(?:s)? a random skill\b|\bsteals? a skill\b/i, ok: p => p.tags.has('copy') },
  { id: 'revive', re: /\brevive|\bresurrect|\bbrought back to life/i, ok: p => p.revive },
  { id: 'permanente', re: /\bpermanent(ly)?\b/i, ok: p => p.dmg > 0 || p.dmgCond > 0 || p.dr > 0 || p.drAlly > 0 || p.dd > 0 || p.ddAlly > 0 || p.heal > 0 || p.stun > 0 || p.drain > 0 || p.tags.size > 0 },
];

const faltas = new Map();   // padrão -> lista de skills
let total = 0, vazias = 0;
for (const c of CHARS) {
  if (SO_CHAR && c.name !== SO_CHAR) continue;
  (c.skills || []).forEach((s, i) => {
    const p = E.parseSkill(s, i);
    E.applyOverride && E.applyOverride(c.name, p);   // correções manuais valem como leitura correta
    if (p.isPassive && !s.description) return;
    total++;
    const txt = String(s.description || '');
    const nada = !p.dmg && !p.dmgCond && !p.stun && !p.drain && !p.heal && !p.healAlly && !p.dr && !p.drAlly && !p.dd && !p.ddAlly && !p.tags.size && !p.chakraGain;
    if (nada && !p.genericDodge) { vazias++; const e = faltas.get('NADA-EXTRAIDO') || []; e.push({ c: c.name, s: s.name, txt }); faltas.set('NADA-EXTRAIDO', e); }
    for (const r of REGRAS) {
      if (!r.re.test(txt)) continue;
      if (r.ok(p)) continue;
      const e = faltas.get(r.id) || []; e.push({ c: c.name, s: s.name, txt, trecho: (txt.match(r.re) || [''])[0] });
      faltas.set(r.id, e);
    }
  });
}

const ord = [...faltas.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`${total} habilidades lidas · ${vazias} sem nada extraído\n`);
console.log('O que o texto diz e o parser não registrou:');
for (const [id, lista] of ord) console.log(`  ${String(lista.length).padStart(4)} × ${id}`);
const soma = ord.reduce((s, [, l]) => s + l.length, 0);
console.log(`\n  total de pendências: ${soma} em ${total} habilidades`);
if (DETALHE || SO_PADRAO) {
  for (const [id, lista] of ord) {
    if (SO_PADRAO && id !== SO_PADRAO) continue;
    if (SO_PADRAO) { console.log(`\n=== ${id} (${lista.length}) — todos ===`); for (const x of lista) console.log(`  ${x.c} / ${x.s}: ${(x.trecho || '').trim() || '(nada extraído)'}\n      ${x.txt.replace(/\s+/g, ' ').slice(0, 200)}`); continue; }
    console.log(`\n=== ${id} (${lista.length}) ===`);
    for (const x of lista.slice(0, DETALHE ? 12 : 40)) console.log(`  ${x.c} / ${x.s}: ${(x.trecho || '').trim() || '(nada extraído)'}\n      ${x.txt.replace(/\s+/g, ' ').slice(0, 170)}`);
  }
}
