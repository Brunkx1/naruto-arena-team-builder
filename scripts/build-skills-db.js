#!/usr/bin/env node
/*
 * Gera a base estruturada de skills a partir do catálogo oficial + parser + correções manuais:
 *   data/skills-db.json  -> um registro por skill (para o programa e para inspeção)
 *   data/skills-db.md    -> planilha de revisão legível (marque erros e passe para data/curated/skill-overrides.js)
 * Uso: node scripts/build-skills-db.js [--personagem "Nome"]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../js/core/engine.js');
const CHARS = require('../data/characters.js');
let OV = {}; try { OV = require('../data/curated/skill-overrides.js'); } catch (e) { /* sem correções */ }
E.setOverrides(OV);
const only = (() => { const i = process.argv.indexOf('--personagem'); return i > 0 ? process.argv[i + 1] : null; })();

const FIELDS = ['dmg', 'dmgCond', 'stun', 'drain', 'debuff', 'heal', 'healAlly', 'dr', 'drAlly', 'dd', 'ddAlly', 'amplify', 'extendTurns'];
const FLAGS = ['aoe', 'pierce', 'affliction', 'invulnSelf', 'invulnAlly', 'invulnTeam', 'counter', 'counterEnemy', 'reflect', 'uncounterable', 'ignoreInvuln', 'ignoreStun', 'cleanse', 'noDefense', 'noDefenseAoe', 'antiHeal', 'costUp', 'invisible', 'setup', 'free', 'endsEarly', 'genericDodge', 'isPassive', 'isHidden'];

const db = [];
const md = ['# Base de skills — o que o programa extraiu de cada uma', '', 'Campos numéricos são estimativas do parser (dano já multiplicado por área/turnos). Para corrigir, edite `data/curated/skill-overrides.js`.', ''];
for (const c of CHARS) {
  if (only && c.name !== only) continue;
  const prof = E.profileChar(c);
  md.push(`## ${c.name}`, '');
  c.skills.forEach((s, i) => {
    const p = prof.skills[i];
    const rec = { character: c.name, skill: s.name, index: i, energy: s.energy, cooldown: s.cooldown, classes: s.classes, description: E.cleanText(s.description), overridden: !!p.overridden };
    for (const f of FIELDS) if (p[f]) rec[f] = Math.round(p[f] * 100) / 100;
    for (const f of FLAGS) if (p[f]) rec[f] = true;
    rec.tags = [...p.tags];
    db.push(rec);
    const facts = [...FIELDS.filter(f => p[f]).map(f => `${f}=${Math.round(p[f] * 100) / 100}`), ...FLAGS.filter(f => p[f] && !['isPassive', 'isHidden', 'genericDodge'].includes(f))];
    md.push(`- **${s.name}** (${s.energy.join('+') || 'grátis'}, cd ${s.cooldown})${p.isPassive ? ' [passiva]' : ''}${p.isHidden ? ' [oculta]' : ''}${p.overridden ? ' [corrigida]' : ''}`);
    md.push(`  - ${rec.description}`);
    md.push(`  - extraído: ${facts.length ? facts.join(', ') : (p.genericDodge ? 'esquiva padrão' : '(nada)')}`);
  });
  md.push('');
}
fs.writeFileSync(path.join(__dirname, '..', 'data', 'skills-db.json'), JSON.stringify(db, null, 1));
fs.writeFileSync(path.join(__dirname, '..', 'data', 'skills-db.md'), md.join('\n'));
const empty = db.filter(r => !r.isPassive && !r.genericDodge && !FIELDS.some(f => r[f]) && !r.tags.length);
console.log(`${db.length} skills de ${only ? 1 : CHARS.length} personagens -> data/skills-db.json e data/skills-db.md`);
console.log(`skills ativas sem nada extraído (candidatas a revisão): ${empty.length}`);
for (const r of empty.slice(0, 40)) console.log(`  - ${r.character} / ${r.skill}: ${r.description.slice(0, 110)}`);
if (empty.length > 40) console.log(`  ... e mais ${empty.length - 40}`);
