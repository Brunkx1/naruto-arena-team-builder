/* NA Team Builder - consolidação dos seus resultados por time (usado pelo diário, pelo observador e pela página).
 * Fontes: snapshots de download-account.js (só quando o time não mudou entre duas coletas), registros manuais e o
 * observador (ladder pelos contadores; quick match deduzido pelo progresso das missões). Funciona no navegador e no Node. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.NAResultados = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const key = team => team.slice().sort().join(' + ');
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 3 && key(a) === key(b);

  // src = { history: [snapshots], manual: [{team, win, lose, at}], observed: [registros do observador] }
  function aggregate(src) {
    src = src || {};
    const byTeam = new Map();
    const rowOf = team => { const k = key(team); let r = byTeam.get(k); if (!r) { r = { key: k, team: team.slice().sort(), win: 0, lose: 0, ladder: 0, quick: 0, unknown: 0, gaps: 0, sessions: 0, maxStreak: 0, curStreak: 0, last: null, sources: new Set() }; byTeam.set(k, r); } return r; };
    const add = (team, w, l, source) => { if (!team || team.length !== 3) return; const r = rowOf(team); r.win += w; r.lose += l; r.sessions++; r.sources.add(source); };
    const unattributed = [];
    const hist = src.history || [];
    for (let i = 1; i < hist.length; i++) {
      const a = hist[i - 1], b = hist[i];
      const dw = (b.win || 0) - (a.win || 0), dl = (b.lose || 0) - (a.lose || 0);
      if (dw + dl <= 0) continue;
      if (same(a.team, b.team)) add(b.team, dw, dl, 'auto'); else unattributed.push({ from: a.at, to: b.at, win: dw, lose: dl });
    }
    for (const m of src.manual || []) add(m.team, m.win || 0, m.lose || 0, 'manual');
    const observed = (src.observed || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    for (const rec of observed) {
      if (!rec.team || rec.team.length !== 3) continue;
      const r = rowOf(rec.team);
      const result = rec.result || (rec.win > 0 ? 'win' : rec.lose > 0 ? 'lose' : null);   // registros antigos só têm win/lose
      let w = rec.win || 0, l = rec.lose || 0;
      if (!w && !l) { if (result === 'win') w = 1; else if (result === 'lose') l = 1; }
      const n = Math.max(1, w + l);
      if (rec.type === 'quick') r.quick += n; else r.ladder += n;
      if (w || l) {
        r.win += w; r.lose += l;
        // um registro pode cobrir várias partidas (intervalo longo entre leituras): só é sequência se não houve derrota nele
        if (!l && !rec.gap) { r.curStreak += w; r.maxStreak = Math.max(r.maxStreak, r.curStreak); }
        else { if (w) r.maxStreak = Math.max(r.maxStreak, 1); r.curStreak = 0; }   // ordem desconhecida
        if (rec.gap) { r.gaps = (r.gaps || 0) + 1; if (rec.offline) r.offline = (r.offline || 0) + 1; }
      } else { r.unknown++; r.curStreak = 0; }   // sem resultado conhecido: não conta e, por segurança, quebra a sequência
      r.last = rec.at; r.sources.add('observador');
    }
    const rows = [...byTeam.values()].map(r => ({ ...r, sources: [...r.sources], gaps: r.gaps || 0, games: r.win + r.lose, wr: r.win + r.lose ? Math.round(1000 * r.win / (r.win + r.lose)) / 10 : null }))
      .sort((a, b) => b.games - a.games || b.unknown - a.unknown || String(b.last || '').localeCompare(String(a.last || '')));
    const quick = observed.filter(r => r.type === 'quick').reduce((s, r) => s + Math.max(1, (r.win || 0) + (r.lose || 0)), 0);
    const total = observed.reduce((s, r) => s + Math.max(1, (r.win || 0) + (r.lose || 0)), 0);
    return { rows, unattributed, observedMatches: total, quickMatches: quick, ladderMatches: total - quick, manual: (src.manual || []).length, snapshots: hist.length };
  }

  return { aggregate, key };
});
