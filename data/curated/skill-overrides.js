// Correções manuais do que o programa extraiu de cada skill. Têm a palavra final sobre o parser.
// Formato: { "Nome do personagem": { "Nome da skill": { campo: valor, tags: ["+tag", "-tag"], nota: "por quê" } } }
// Campos numéricos: dmg, dmgCond, stun, drain, debuff, heal, healAlly, dr, drAlly, dd, ddAlly, amplify, extendTurns, multiTurn, chakraGain
// Campos lógicos: aoe, pierce, affliction, invulnSelf, invulnAlly, invulnTeam, counter, counterEnemy, reflect, uncounterable, ignoreInvuln, ignoreStun, cleanse, noDefense, noDefenseAoe, antiHeal, costUp, setup, free, invisible
// Editável pela interface (detalhe do personagem › ✎ Corrigir leitura), que grava aqui pelo servidor local; ou à mão.
// Veja data/skills-db.md para o que foi extraído de cada skill (gere com: node scripts/build-skills-db.js).
(function (root, data) {
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.NA_SKILL_OVERRIDES = data;
})(typeof self !== 'undefined' ? self : this, {
  "Hatake Kakashi": {
    "Kakashi Sharingan": {
      "dmg": 25,
      "nota": "copia uma skill ofensiva aleatória por 5 turnos; valor médio conservador"
    }
  },
  "Hatake Kakashi (S)": {
    "Team Tactics": {
      "drAlly": 20,
      "nota": "cooldown -1 para o time por 3 turnos: mais usos de defesa/dano; contado como suporte"
    }
  },
  "Konan of the Rain (S)": {
    "Paper Ocean: Chasm Trap": {
      "debuff": 15,
      "aoe": true,
      "nota": "3 turnos: dano não-aflição de todos os inimigos reduzido"
    }
  },
  "Masked Man": {
    "Summoning: Kyuubi": {
      "dd": 40,
      "setup": true,
      "nota": "40 de defesa destrutível permanente, só com 50 de vida ou menos"
    }
  },
  "Nara Shikamaru": {
    "Shadow Imitation": {
      "extendTurns": 0,
      "nota": "o parser já dá 2.2 de stun em área (não-mental); com Meditate dura 2 turnos — deixado para a skill Meditate"
    }
  },
  "Sarutobi Asuma (S)": {
    "Ash Pile Burning": {
      "stun": 1.5,
      "tags": [
        "+stunAoe"
      ],
      "nota": "+1 de cooldown em todas as skills de todos os inimigos ≈ atraso de um turno em área"
    }
  },
  "Shimura Danzo (S)": {
    "Izanagi": {
      "dr": 60,
      "nota": "ignora todo o dano recebido enquanto tiver Sharingans (≈ redução total por vários turnos)"
    }
  },
  "Shinobi Alliance Shikamaru (S)": {
    "Tatical Range Increase": {
      "dr": 40,
      "aoe": true,
      "nota": "ignora todo o dano por 1 turno e mira todos os inimigos"
    }
  },
  "Uchiha Madara": {
    "Eternal Mangekyou": {
      "dr": 40,
      "reflect": true,
      "nota": "4 turnos: dano não-aflição contra ele é reduzido/refletido"
    }
  }
});
