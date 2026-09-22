# Naruto-Arena Team Builder

A free, local tool that helps you pick teams for [Naruto-Arena](https://www.naruto-arena.site): it ranks the
213 characters, searches for the best trios, tracks your missions and records the results of the matches you
play — so the advice it gives can be checked against reality instead of taste.

Runs entirely on your own machine — no account, no cloud, no third-party libraries.
*(Documentação completa em português: [README.pt-BR.md](README.pt-BR.md).)*

```bash
git clone https://github.com/Brunkx1/naruto-arena-team-builder.git
cd naruto-arena-team-builder
node start.js          # downloads the game data on first run, then opens the UI
```

## Requirements

**[Node.js](https://nodejs.org) 18 or newer** (the LTS installer from nodejs.org is enough — nothing else to
install: this project has zero dependencies), a browser, and ~50 MB of disk for the downloaded game data.
Works on Windows, macOS and Linux. After the first run you can start it without a terminal: **Tools › Create
launcher in the folder** makes a double-clickable file next to the project.

**Why is Node needed at all?** The interesting half of the tool talks to the game: it logs into *your*
account to read your missions and your match history, and it writes the downloaded data to disk. A web page
cannot do either — a browser blocks a page on one domain from calling another site's API, and it cannot
write files. So the program runs a tiny local server (`server.js`, ~300 lines, listening only on
`127.0.0.1`) and the browser just draws the interface.

**If you don't want to install anything**: the part that doesn't need your account (character ranking, team
search, mission catalogue) can run as a plain static site, and that is on the [roadmap](#roadmap). The
personal part (your unlocked characters, your missions, your match results) will always need something
running on your machine, whether this program or a browser extension.

## Running it, step by step

1. **Install [Node.js](https://nodejs.org)** (LTS installer, default options). To check it worked, open a
   terminal and run `node --version` — anything from `v18` up is fine.
2. **Get the project**: either `git clone https://github.com/Brunkx1/naruto-arena-team-builder.git`, or click
   the green **Code › Download ZIP** button on GitHub and unzip it wherever you like.
3. **Start it**: open a terminal in that folder and run

   ```bash
   node start.js
   ```

   The first run downloads the game data (characters, missions, patch notes, images — about a minute) and
   then opens `http://127.0.0.1:8765/` in your browser. From then on it only downloads what changed.
4. **Optional — connect your account** so it knows which characters you have and which missions you are on:
   in the **Tools** tab, type your Naruto-Arena username and password and press *Download / update my
   account*. The password goes to the game's login endpoint and nowhere else; it is only stored (in a local
   `.env` file) if you tick the box.
5. **Optional — no more terminal**: Tools › *Create launcher in the folder* makes a file you can double-click
   (`NA Team Builder.desktop` on Linux, `.vbs` on Windows, `.command` on macOS).
6. **To stop**: press `Ctrl+C` in the terminal, or use *Quit program* in the Tools tab.

Useful flags: `node start.js --no-browser` (don't open the browser), `--no-update` (skip the update check),
`--port 9000`. Everything the UI does is also available from the command line — run `node cli.js` to see it.

---

## What makes this different: it says how much it knows

Most team advice — mine included, at first — is a person's opinion dressed up as a number. This project
tries to be honest about where each number comes from, and it publishes the failures too.

**What the character score is built on**

The staff publishes, in every balance update, the wins/matches of each character they touched. The tool
parses **114 patch notes into 794 measurements of 203 characters**, applies the average effect of a nerf or a
buff *measured on that same history* (after a nerf, −7.8 win-rate points on average, and the character gets
worse in 82% of the cases; after a buff, +6.7, but 23% still get worse), weights by sample size and recency,
and corrects for the fact that early-unlock characters are played by beginners.

**How wrong that is, measured**: `scripts/validate-winrate.js` predicts every published measurement using only
what was known *before* it. The estimate is off by **8.4 win-rate points on average** (90% of cases under
16). Scores in the UI carry that margin: a character shows as `68 ±16`, a team as `76 ±9`, and the suggestion
list says plainly when the top 20 teams are **tied inside the margin** — because they usually are.

**What did not work, and is documented instead of hidden**

| Idea | Measured result |
|---|---|
| Reading skill text to judge strength (the obvious approach) | correlation **0.02** with measured win rate — and **0.09** even with optimally fitted weights and cross-validation |
| Chakra cost shape (double same-type cost, number of types) | ~**0** — nothing is penalised for it |
| Popularity: characters chosen by many players | **−0.35** (popular = accessible, not strong) |
| Teams recommended in the forum | not a strength signal; they are the *accessible* teams |
| A battle simulator with mechanics parsed from text | correlation **−0.13**; the experiment was closed |
| Unlock level of the character | **0.71–0.75** — the one thing that does predict, and it is used |

So the tool leans on published win rates, uses the unlock tier where measurements are thin, and **marks the
team-combination part (roles, synergy, chakra) with a `?`**, because there is no public per-team data
anywhere to validate it. That is the honest state of the art here.

---

## What it does

- **Team suggestions** — lock 0, 1 or 2 characters and get the best complements, with chakra demand per type,
  role coverage, synergies grouped by reason, and the mission goals each team advances.
- **Ranking** of all characters with the official win-rate series, the balance timeline of each skill, and the
  parsed reading of every ability (with tooltips explaining each tag).
- **Missions** — which are available, their progress, what each unlocks, the prerequisite chain (132 of the
  200 missions depend on another) and a **priority view**: value (character unlocked + what it unlocks down
  the chain) divided by expected effort in matches, where "win 4 in a row" is correctly treated as far more
  expensive than "win 20".
- **Match tracking** — while you play, it records every match (ladder *and* quick match) from your own
  profile history: result, opponent and, optionally, the enemy team. Your teams then appear with real
  numbers next to the score the tool gave them.
- **PT/EN interface**, including the game's own Portuguese skill descriptions.
- **Tools tab** — every maintenance task as a button with a live log: update game data, download patch notes,
  regenerate the win-rate model, check the health of every data source, validate the estimate, check how well
  the tool reads the 961 skills, and fix a misread skill by hand.

## How it treats the game's site

- Everything it reads is either **public** (character catalog, patch notes, ladder pages) or **your own
  account** (missions, profile history) — read-only, never a write.
- Your password stays on your machine: it goes to `/api/login` and nowhere else. Saving it is opt-in.
- The site limits requests to **30 per 30 seconds**; every script respects it (and backs off on `429`).
- The game's content (characters, skills, images) is **not redistributed here** — the tool downloads it on
  first run into `data/`, which is git-ignored.
- **One feature is off by default and deserves a sentence of its own.** "Capture the opponent team" asks the
  server for the battle state using `connectBattle` — the same action the game client itself performs when it
  joins a match. It is the only way I found to record *my team × their team × who won*, which is the data the
  team-combination model is missing. I use it on my own account, it is disabled unless you turn it on, and I
  would not ship it enabled to other players without the staff's blessing. If you are on the staff and you
  would rather it did not exist, say so and it goes away.

## For the Naruto-Arena staff

The one thing this tool cannot do honestly is judge a **team**: there is no public data about which trios
win. If you would consider sharing aggregated team statistics (trios with N+ matches and their win rate, no
player names), the results would be published openly and credited to the game — and would probably be useful
for balancing too. If sharing is not possible, I would rather ask first than collect anything you dislike —
open an issue here or reply wherever I reached you.

## Development

```bash
node test.js                       # 97 regression tests, no network needed
node cli.js sugerir --n 10         # same engine from the command line
node scripts/health-check.js    # checks every data source still parses
```

No build step, no dependencies.

```
start.js              launcher: starts the local server, opens the browser, checks for game updates
server.js             local server (127.0.0.1): serves the page and runs the scripts behind the Tools tab
cli.js, test.js       command line and the 97 regression tests
js/core/              engine (skill parser, scoring, team search), missions, patch notes, results
js/ui/                browser only: interface, PT/EN strings, Tools tab
js/sim/               battle simulator — closed experiment, documented in its header comment
scripts/              one file per task: download-*, build-*, validate-*, watch-matches, health-check…
data/curated/         human knowledge that ships with the repo: skill corrections, calibration cases
data/                 everything else is downloaded on first run and never committed
```

`js/core/engine.js` runs both in the browser and in Node, which is why the CLI and the UI always agree.

## Roadmap

- **Hosted read-only site** — ranking, team search and missions with no install, refreshed daily by a
  scheduled job. Everything personal stays local.
- **Team-level data** — the honest gap: nothing public says which *trios* win. Either the staff shares
  aggregated team statistics, or players opt in to contributing their own match records (each match already
  carries a global id, so the same match reported by both sides can be de-duplicated and cross-checked).
- **A browser extension**, so players who don't want to install Node can still contribute and use the
  personal features.

## Credits and license

Built by **[Brunkx1](https://github.com/Brunkx1)**. MIT licence (see [LICENSE](LICENSE)) **plus one
condition**: personal use is unrestricted, but anything beyond that — publishing, distributing, hosting or
deriving from this project — **must credit the original work and its author visibly**, with a link back to
this repository. If you fork it, say so in your README; if you host it, put it in the footer.

Not affiliated with Naruto-Arena. All game content (characters, skills, art) belongs to its owners, is not
redistributed here, and the published win-rate numbers that make this tool possible are the staff's work.
