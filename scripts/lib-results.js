/*
 * Gera data/results.js (fontes cruas dos seus resultados: snapshots, registros manuais e observador) para a
 * página consolidar com js/core/results.js. Chamado por diary.js, watch-matches.js e download-account.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');

function gerar(username) {
  const user = String(username || '').toLowerCase();
  if (!user) return null;
  const read = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return dflt; } };
  let history = [];
  try { const f = path.join(DATA, 'accounts', user + '.js'); delete require.cache[require.resolve(f)]; history = require(f).history || []; } catch (e) { /* sem conta */ }
  const data = {
    username, updatedAt: new Date().toISOString(),
    history: history.map(h => ({ at: h.at, win: h.win, lose: h.lose, streak: h.streak, level: h.level, team: h.team })),
    manual: read(path.join(DATA, 'accounts', user + '.manual.json'), []),
    observed: read(path.join(DATA, 'accounts', user + '.results.json'), []),
  };
  const js = `// Seus resultados (fontes cruas) — gerado em ${data.updatedAt} para a conta "${username}" por scripts/lib-results.js.\n` +
    `// A página consolida com js/core/results.js (vitórias, derrotas, sequência máxima por time).\n` +
    `(function (root, data) {\n  if (typeof module !== 'undefined' && module.exports) module.exports = data;\n  else root.NA_RESULTADOS = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(data)});\n`;
  fs.writeFileSync(path.join(DATA, 'results.js'), js);
  return data;
}
module.exports = { gerar };
