# NA Team Builder — documentação completa (PT)

> Resumo em inglês no [README.md](README.md). Este arquivo tem o detalhe de tudo: como funciona, de onde vem cada dado e o que já foi testado e não funcionou.

Sugestões de times para **Naruto-Arena** (naruto-arena.site) baseadas em análise automática das
habilidades dos 216 personagens: ranking individual, busca combinatória de trios com sinergia,
cobertura de papéis e economia de chakra.

Roda 100% local — sem instalação, sem dependências, nada é enviado a lugar nenhum (o único "servidor" é
um processo Node na sua máquina, que só aceita conexões dela mesma).

## Passo a passo para rodar

1. **Instale o [Node.js](https://nodejs.org)** (instalador LTS, opções padrão). Para conferir, abra um
   terminal e rode `node --version` — qualquer coisa a partir de `v18` serve.
2. **Baixe o projeto**: `git clone https://github.com/Brunkx1/naruto-arena-team-builder.git` ou o botão verde
   **Code › Download ZIP** no GitHub, descompactando onde quiser.
3. **Abra o programa**: no terminal, dentro da pasta, rode

   ```bash
   node start.js
   ```

   Na primeira vez ele baixa os dados do jogo (personagens, missões, patch notes, imagens — cerca de um
   minuto) e abre `http://127.0.0.1:8765/` no navegador. Depois disso, só baixa o que mudou.
4. **Opcional — conectar sua conta**, para ele saber quais personagens você tem e em quais missões está:
   na aba **Ferramentas**, digite usuário e senha do Naruto-Arena e clique em *Baixar / atualizar minha
   conta*. A senha vai só para o endereço de login do jogo; ela só é guardada (num arquivo `.env` local) se
   você marcar a caixinha.
5. **Opcional — sem terminal**: Ferramentas › *Criar lançador na pasta* gera um arquivo para duplo clique
   (`NA Team Builder.desktop` no Linux, `.vbs` no Windows, `.command` no macOS).
6. **Para fechar**: `Ctrl+C` no terminal ou o botão *Encerrar programa* na aba Ferramentas.

## Como usar

### Jeito recomendado: `node start.js` (ou o atalho no menu)

Sobe o servidor local em `http://127.0.0.1:8765/`, abre a página no navegador e, em segundo plano, verifica
se o jogo mudou (versão do catálogo/build do site); se mudou, atualiza os dados, e atualiza a conta quando há
`NA_USER`/`NA_PASS` no ambiente ou num arquivo `.env` na pasta (opcional; fica em texto puro no seu disco).
A página mostra uma faixa "Verificando atualizações…" e depois "Dados atualizados — Recarregar".
Flags: `--sem-atualizar`, `--forcar`, `--sem-navegador`, `--porta N`, `--forum`; `--nao-abrir` só
atualiza no terminal e sai. Rodar de novo com o programa já aberto apenas abre outra aba nele.

Para abrir sem terminal, direto pelos arquivos do projeto: duplo clique em **`NA Team Builder.desktop`**
na pasta (Linux/GNOME; no Windows é `NA Team Builder.vbs`, no macOS `NA Team Builder.command`). O arquivo é
gerado por **Ferramentas › Criar lançador na pasta** (ou `node scripts/create-launcher.js`) com caminhos
absolutos — se mover a pasta, gere de novo. Nada é instalado fora da pasta. Se o GNOME mostrar o
lançador como "não confiável", botão direito › **Permitir execução**. O botão **Encerrar programa** na
aba Ferramentas fecha o servidor.

### Aba Ferramentas (todas as funções sem terminal)

Com o programa aberto pelo `start.js`, a aba **Ferramentas** tem um botão para cada script, com parâmetros,
status da última execução e o log ao vivo:

| Grupo | Função | Script |
|---|---|---|
| Dados do jogo | Verificar atualização (com "forçar") · Atualizar personagens/missões/notícias · Baixar patch notes · Regenerar winrate · Regenerar comunidade · Regenerar banco de skills · **Baixar imagens** · Baixar fórum (login) | `atualizar-dados`, `baixar-balanceamentos`, `gerar-winrate-oficial`, `gerar-comunidade`, `gerar-skills-db`, `baixar-imagens`, `baixar-forum` |
| Conta | Baixar/atualizar minha conta (login) · Trocar conta ativa · Observar partidas (login, contínuo: Iniciar/Parar) · Diário de resultados · Registrar resultado manual | `baixar-conta`, `trocar-conta`, `observar`, `diario` |
| Análise | Treinar regra de sinergia (modo, aplicar) · Calibrar heurística · Rodar testes | `treinar-sinergia`, `calibrar`, `test.js` |
| Experimentos | Simulador de batalhas · Winrate da página (restrita) | `simular`, `baixar-winrate` |
| Sistema | Criar lançador na pasta | `criar-atalho` |

O login (usuário/senha do jogo) só é pedido para as funções marcadas; a senha vai para o servidor local
e para o site do jogo, e só é gravada (no `.env`) se você marcar "salvar". A opção **Iniciar o observador
de partidas ao abrir o programa** (gravada em `data/config.json`) liga o observador sozinho a cada abertura,
desde que haja senha salva; enquanto ele roda, o cabeçalho mostra *observando · N partidas hoje*. As funções que mexem nos dados
que a página carrega mostram a faixa **Recarregar** ao terminar. Uma função por vez (o observador pode
ficar rodando em paralelo). Aberto direto pelo arquivo (`index.html`, `file://`), a aba lista apenas os
comandos equivalentes do terminal.

### Interface (navegador)

Também dá para abrir `index.html` direto (duplo clique). Funciona do disco, sem servidor — só a aba
Ferramentas fica sem botões.

As imagens (retratos, ícones de skill, missões) ficam em `data/img/` depois de **Ferramentas › Baixar
imagens** (`node scripts/download-images.js`; ≈20 MB, entra também na atualização automática). Sem elas a
página usa o imgur, sem enviar Referer — o imgur devolve 403 para hotlink de localhost.
O botão **EN/PT** no cabeçalho troca o idioma da interface; descrições de habilidades e textos de missão
usam a tradução oficial do jogo em português ou o original em inglês.

- **Sugestões** — clique nos slots para travar 0, 1 ou 2 personagens e peça os melhores complementos.
  A linha *Demoram a sair* lista as skills do time que pedem dois chakras específicos (ex.: Blood + Blood):
  é informação para jogar, **não** entra na nota — medido em `scripts/validate-chakra.js`, o formato do custo
  tem correlação ~0 com o winrate do personagem.
  Cada time mostra: nota explicada ("força dos 3: 55 · combinação: +20 · missões: +3"), demanda de chakra
  por tipo (a linha branca é a oferta esperada de 0,75/turno), contenção/choque, cobertura de papéis, a
  combinação em palavras (forte/boa/fraca) e as sinergias agrupadas por motivo ("Stun + dano contínuo:
  A + B · A + C"). Filtros rápidos acima dos times: *Avançam missões*, *Mensuráveis* (com objetivo de
  vitória pendente — os únicos que o observador registra em quick match), *Já joguei*, *Ainda não joguei*.
  O controle **Missões** é um seletor: ignorar / peso normal / priorizar. Um guia de 3 passos aparece no
  topo até você fechá-lo.
- **Ranking** — nota 0-100 de cada personagem com os componentes (dano, controle, defesa, suporte,
  economia). Clique para ver as habilidades e exatamente o que o programa extraiu de cada uma (as tags têm
  explicação ao passar o mouse). No topo, **Novidades do jogo**: os últimos balanceamentos com os personagens
  afetados; no detalhe do personagem aparecem as mudanças recentes das skills dele.
- **Personagens** — marque os que você **tem** desbloqueados, **exclua** os que não quer ver nas sugestões
  e defina **tiers manuais** (S/A/B/C/D/F) para corrigir avaliações de que você discorda.
- **Configurações** — pesos de cada componente da nota. Tudo fica salvo no `localStorage`.

### Linha de comando (Node 18+)

```bash
node cli.js ranking --top 30
node cli.js ranking --busca kakashi
node cli.js sugerir --n 10                              # melhores trios
node cli.js sugerir --trava "Tsunade" --trava "Kimimaro"  # melhores complementos
node cli.js sugerir --choque --variantes --pool 216     # sem restrições, busca completa
node cli.js time "Tsunade" "Uzumaki Naruto" "Uchiha Sasuke"   # avalia um trio
node cli.js detalhe "Rock Lee"                          # o que foi extraído das skills
node cli.js missoes --status andamento                  # missões com progresso (precisa de data/account.js)
node cli.js missoes --busca kimimaro                    # missões que envolvem um personagem
node cli.js sugerir --missoes 5 --meus                  # prioriza missões, só personagens liberados
```

### Dados da sua conta (opcional, mas é o que destrava as missões)

```bash
node scripts/download-account.js        # pede usuário e senha, gera data/account.js
```

Com esse arquivo o programa passa a saber:

- **quais personagens você tem liberados** — a opção "Só personagens que eu tenho" é preenchida
  automaticamente (botão "Usar personagens da conta" na aba Personagens refaz a importação);
- **quais missões estão disponíveis, concluídas ou faltando rank**, e o **progresso** de cada objetivo
  ("Vencer 15 partidas com X (7/15)");
- nível, rank e último time usado (aparece no topo da página).

Aí entram as duas funções de missão:

- **Aba Missões** — lista com filtros (disponíveis / com progresso / concluídas / por categoria), busca por
  personagem, e o botão **Montar time**, que trava nos slots os personagens que a missão pede (e liga o peso
  de missões, se estiver em 0). Cada missão mostra de quem ela é **pré-requisito** e quantas ainda destrava
  na cadeia (132 das 200 têm pré-requisito; há cadeias de até 25 missões).
- **Times de jogadores da ladder** — card na aba Sugestões com os trios que jogadores do topo salvaram de
  verdade (`scripts/collect-ladder-teams.js` percorre o ranking e lê `teamSaved` de cada perfil; 299 jogadores /
  2.107 trios na primeira coleta). A porcentagem mostrada é a taxa de vitória do **jogador**, não do time —
  cada um salva ~8 times, então isto é catálogo do que se monta, não medida de força (testado: escolha por
  jogadores fortes × winrate oficial = 0,18; popularidade × winrate = −0,39, porque o popular é o acessível).
- **Prioridade (valor ÷ esforço)** — filtro que ordena as missões disponíveis pelo que valem: nota (acima
  de 40) do personagem que liberam **+** os personagens das missões que elas destravam (cada nível da cadeia
  vale metade), dividido pelo esforço esperado em partidas do objetivo mais caro (55% de vitória; "N seguidas"
  usa a fórmula de corrida de N vitórias e custa muito mais que "N ao todo"). Uma missão-portal como
  *The Ruthless Interrogater* (abre caminho para 70 missões) sobe mesmo liberando um personagem mediano.
  Quando você já tem 5+ partidas decididas com um time que avança o objetivo, a taxa usada é a sua (limitada
  a 35–85%) em vez dos 55% — a linha mostra "a 85% (seu time …)". No CLI: `node cli.js missoes --prioridade`.
- **Contador de objetivos** — cada time sugerido mostra *"Missões: N objetivos em M missões · K em sequência"*
  com a lista do que ele avança. Os objetivos têm **peso por tipo**: *vencer N seguidas* com um personagem
  é o que exige um time bom (peso 3; 4 se for "no mesmo time"); *vencer N partidas* (0,6) e *usar a skill X
  N vezes* (0,3) cumprem-se sozinhos com o tempo, então pesam pouco. O controle **Missões (pts/sequência)**
  nas opções define quantos pontos cada objetivo em sequência soma à nota do time (os outros entram na
  proporção do peso): 0 ignora missões, 3 (padrão com conta) equilibra, 8-10 prioriza missões.
  Na aba Missões, o filtro **Sequência (precisam de time)** lista só as que ainda têm objetivo desse tipo, e
  **Montar time** trava primeiro os personagens dos objetivos em sequência pendentes. (O antigo controle
  deslizante de pontos virou o seletor ignorar / normal = 3 / priorizar = 8.)

A senha é usada só para o login naquele momento e não é gravada. Rode de novo para atualizar o progresso.
Para não digitar: `NA_USER=usuario NA_PASS=senha node scripts/download-account.js`.

### Mudar de conta

Cada `download-account.js` guarda uma cópia em `data/accounts/<usuario>.js`. Para alternar entre contas já
baixadas sem novo login:

```bash
node scripts/switch-account.js            # lista as contas (* = ativa)
node scripts/switch-account.js outraconta  # ativa essa conta; recarregue a página
```

Ao recarregar, o programa detecta a conta nova e reimporta os personagens liberados sozinho. Bans, tiers
manuais, pesos e idioma são do navegador (não da conta) e continuam iguais. Se a conta estiver **em partida**
no momento da coleta, o servidor não envia personagens/nível; o script avisa, deduz os personagens pelas
missões concluídas e o rank pelas missões liberadas — rode de novo depois para os dados exatos.

### Quando o jogo atualizar (personagens novos, balanceamento, missões)

```bash
node scripts/update-game-data.js     # sem login: catálogo oficial de personagens + missões do site
node scripts/download-account.js        # depois, se usa dados da conta (novos personagens liberados etc.)
```

O primeiro script mostra o que mudou (personagens novos/removidos, quem teve habilidade alterada, missões
novas) e regenera `data/characters.js`, `data/characters.json` e `data/missions.js`. Os personagens vêm de
`/api/selection-catalog` (a mesma fonte que o jogo usa; o na-helper estava desatualizado em 69 personagens
em 2026-09-16). As missões são lidas do bundle JavaScript do site como texto — nada baixado é executado.
Se o site mudar a estrutura interna, o script avisa e os dados antigos continuam valendo.

### Atualizar as fontes de força

```bash
node scripts/download-patch-notes.js    # patch notes do site (público): 113 posts com winrate oficial
node scripts/build-winrate.js    # -> data/winrate.js (estimativa + série por personagem)
NA_USER=... NA_PASS=... node scripts/download-forum.js   # fórum (login): tópicos de estratégia/balanceamento
node scripts/build-community.js         # -> data/community.js (nerfs/buffs, menções, trios recomendados)
```

`node start.js` faz os três primeiros sozinho quando detecta uma versão nova do jogo (`--forum` inclui o
fórum, se houver credenciais); todos também estão na aba Ferramentas. `scripts/download-winrate-page.js` tenta a
página de winrate do site, que é restrita para contas comuns — grava em `data/winrate-pagina.js`, separado
do winrate oficial dos patch notes (que é o que o programa usa).

### Seus resultados por time (diário)

O jogo não expõe histórico de partidas para contas comuns, então o programa registra enquanto você joga:

- **Observar partidas** (aba Ferramentas › Iniciar, ou `NA_USER=... NA_PASS=... node scripts/watch-matches.js
  [--intervalo 45]`): a fonte do resultado é o **histórico do perfil** (`/profile/<usuario>` →
  `ladderGames` + `quickGames`, 24 h), que traz data, adversário e vencedor de **toda** partida, inclusive
  quick match. Ao subir, ele preenche o que faltava das últimas 24 h; depois sincroniza a cada partida.
  Os contadores do `connect-selection` dizem quando algo mudou e servem de reserva (com a dedução pelo
  progresso das missões) se o perfil não responder. As missões continuam sendo lidas a cada partida para
  atualizar o progresso na conta. Os contadores ficam salvos em `data/accounts/<usuario>.observer-state.json`, então partidas
  de ladder jogadas com o observador desligado entram como *acumulado* na próxima vez que ele subir. O time é o último selecionado visto depois da partida; para não errar se você trocar de
  time logo em seguida, nos 10 min após cada início/fim de partida ele consulta a cada 15 s (45 s no resto). Os contadores de ladder só são
  comparados com o último estado que os tinha (em partida o servidor não os manda). A cada mudança ele
  grava o progresso das missões (e o perfil) em `data/account.js`, e a página avisa para recarregar; se o
  site fizer deploy no meio da sessão, o build do Next é renovado sozinho. Resultados em
  `data/accounts/<usuario>.results.json`.
- **Capturar o time do adversário** (Ferramentas, **desligado por padrão**): ao começar cada partida, o
  observador pede o estado da batalha (`connectBattle`, a mesma ação que o cliente do jogo usa para entrar
  nela) e guarda o time inimigo junto do resultado — vira `meu time × time dele × quem venceu`, que é o dado
  que falta para medir combinação de verdade. **Risco**: é a ação do próprio cliente, então em tese pode
  atrapalhar a sua sessão; teste numa partida que não importa e desligue se notar qualquer estranheza. A
  leitura dos times não depende do nome dos campos (procura trios de personagens conhecidos na resposta) e
  a captura se desliga sozinha ao primeiro erro.
- **Diário** (`node scripts/diary.js` ou aba Ferramentas): vitórias, derrotas, quantas foram quick match,
  partidas sem resultado e a **sequência máxima** de cada time (partida sem resultado quebra a sequência,
  por segurança). Se a leitura ficar muito atrasada (máquina suspensa, site fora do ar), o registro sai
  marcado como *acumulado*: conta as vitórias e derrotas do período, mas não vira sequência — a ordem das
  partidas é desconhecida e o time pode ter mudado. Registro manual: `node scripts/diary.js registrar "A" "B" "C" vitorias derrotas`.
- **Na página**: o card **Meus resultados** (aba Sugestões) mostra os mesmos números por time ao lado da nota
  que o programa dá ao trio, com "Usar"; cada time sugerido que você já jogou traz o badge *seu histórico:
  7V/0D · seq. 3*. Os dados vêm de `data/results.js`, regenerado pelo observador a cada partida, pelo diário
  e por `download-account.js` (a consolidação é `js/results.js`, a mesma do diário).
- Snapshots de `download-account.js` também contam quando o time não mudou entre duas coletas.

### Treinar a regra de combinação (`scripts/train-synergy.js`)

Com `--aplicar`, os pesos de time sugeridos vão para `data/trained-weights.js` e **passam a ser o padrão**
da página e do CLI (a aba Configurações mostra data, modo, AUC e os valores, com opção de desligar;
`node cli.js ... --sem-treinados` ignora). Enquanto não houver treino aplicado o arquivo fica `null`.

Ajusta os pesos de time (cobertura, sinergia, choque, preparação) por regressão logística: trios rotulados
como bons contra trios aleatórios com os mesmos personagens. Resultado do primeiro treino (2026-09-17), que
vale registrar: os trios do fórum são separados dos aleatórios por **evitar choque e distribuir chakra**
(AUC 0,84) — as regras de sinergia não explicam nada — e têm personagens *mais fracos* que a média, porque
o fórum recomenda times acessíveis, não fortes. Por isso esses pesos não foram aplicados. O modo
`--modo=diario` usa os seus resultados (≥8 partidas por time) como rótulos: é o ciclo previsto —
o programa sugere, você joga com o observador ligado, o treino aprende, as sugestões melhoram.

### Simulador de batalha (experimento encerrado, 2026-09-17)

`js/sim/` + `scripts/simulate.js`: motor 3v3 com chakra, cooldowns, durações, Instant/Action/Control, redução,
defesa destrutível, aflição, stun/invulnerabilidade por classe, contadores e IA gulosa (40 mil partidas
em ~16 s). O teste de validade — correlação entre winrate simulado e oficial — deu **−0,13** (meta > 0,4),
e um time do topo oficial perde 79% para um time do fundo. Causas: a extração automática de mecânicas erra
1–2 skills por personagem (auto-dano lido como dano, transformações viradas em dano recorrente, durações), e
a IA joga "corrida de dano" num jogo decidido por controle. O caminho viável seria curar à mão a mecânica de
cada skill numa linguagem de efeitos (ver exemplo do Chouji na conversa de projeto) e uma IA com busca —
semanas de trabalho. Fica no repositório para eventual retomada; não alimenta nenhuma nota.

### Testes

```bash
node test.js      # 96 testes: parser, notas, busca, missões (pesos, cadeia, prioridade), observador, servidor local
```

Rode depois de atualizar os dados: se o site mudar o formato de alguma descrição, os testes apontam.

## De onde vem a noção de "forte" (leia isto)

A heurística de habilidades **não prevê força**: medida contra o winrate oficial de 189 personagens, a
correlação é ~0 (`node scripts/calibrate.js` mostra). O que prevê força são dados reais, e eles existem
publicamente:

1. **Winrate oficial por personagem** — a cada balanceamento, o staff publica nos patch notes do site
   (e nos posts "History of Balance" do fórum) vitórias, partidas e uso de cada personagem alterado.
   São 781 medições de 200 personagens desde dez/2023 (`scripts/download-patch-notes.js` +
   `scripts/build-winrate.js` → `data/winrate.js`). As estatísticas são medidas **antes** da
   mudança que as acompanha, então o programa aplica o **efeito médio da mudança, medido nos próprios
   dados** (pares medição → medição seguinte do mesmo personagem: após nerf ≈ −7,8 pontos, caindo em 82%
   dos casos; após buff ≈ +6,7, mas 23% pioram mesmo assim; modelado como delta ≈ a + b × winrate_antes,
   recalculado a cada atualização), encolhe medições antigas em direção à média do tier, pondera por
   partidas e recência e usa isso como **até 75% da nota**. O resto da nota **não** é a heurística: contra o
   winrate medido ela dá correlação ~0 (e −0,23 em quem tem pouca amostra), enquanto o tier de desbloqueio dá
   0,71 — então o complemento é 70% expectativa do tier + 30% heurística encolhida. Quem tem medição fraca
   (200-1500 partidas) aparece com a marca *pouca medição* no ranking. Personagens sem medição utilizável (20, com
   menos de 200 partidas medidas) recebem como nota-base a **expectativa do tier de desbloqueio**
   (winrate ≈ 45 + 0,47 × nível; correlação 0,71 com o nível), 70%, mais a heurística encolhida, 30% — e
   aparecem como "≈57% (tier)".
   *Qualidade do número*: `node scripts/validate-winrate.js` (ou Ferramentas › Validar estimativa de winrate)
   prevê cada medição publicada usando só o que se sabia antes dela — a estimativa erra **8,4 pontos em
   média** (90% dos casos abaixo de 16). Testado, somar o histórico bate usar só a medição mais recente
   (8,4 contra 8,8), porque amostras pequenas oscilam muito; por isso a fórmula continua como está. No
   ranking, ▲/▼ marca os 50 personagens cuja estimativa está a 10+ pontos da última medição, e o detalhe
   explica de onde vem a diferença.
   *Ressalva*: é a winrate dos times em que o personagem aparece; personagens iniciais são jogados por
   iniciantes e ficam subestimados (Tenten, Gaara, Sakura ~35-42%).
2. **Linha do tempo de balanceamento** — 113 patch notes, 764 mudanças classificadas em nerf/buff:
   aparece no detalhe de cada personagem.
3. **Fórum oficial** (`scripts/download-forum.js`, exige login) — 667 tópicos / 4.010 posts das seções de
   estratégia, balanceamento e Brazil: menções (posts de staff pesam 3×) e **trios recomendados**
   extraídos dos textos, que aparecem em "Times recomendados no fórum" na aba Sugestões e em
   `node cli.js comunidade`. `scripts/build-community.js` pré-computa tudo em `data/community.js`.

   *Ajuste por tier*: o rank de desbloqueio explica 71% da ordem dos winrates (Academy Student ≈ 44%,
   Sannin ≈ 65%), misturando poder real com quem joga. A opção **"Ajustar winrate pelo tier de desbloqueio"**
   (Ranking; `--ajustado` no CLI) compara cada personagem com a média do seu tier — a coluna "vs. tier" mostra
   a diferença. Bruto = o que vence no ladder; ajustado = quem joga acima do esperado (útil para escolher
   entre os personagens que você já tem).
4. **Combos citados pelo staff** — quando um patch note ou post de staff cita dois personagens como combo
   ("the Dosu/Shiore/Kabuto (S) combo"), o par vira uma sinergia confirmada (`data/community.js › combos`).
   O sinal é pequeno e cresce com os patch notes.

Sobre o fórum ser antigo: os trios são ordenados por recência (posts do último ano pesam 1, de 1-2 anos 0,5,
mais antigos 0,25) e ganham a marca "rework depois do post" quando algum membro foi reformulado depois.

O que continua sendo heurística: sinergia entre os três, contenção de chakra, cobertura de papéis, e a
nota dos 15 personagens sem dados (nunca alterados desde que o staff publica estatísticas, ou lançados na
última semana). O que ainda não existe: winrate **por time** — a API de replays responde 403 para contas
comuns; só o staff pode liberar.

## Como funciona

1. **Parser** (`js/engine.js › parseSkill`) lê a descrição em inglês de cada habilidade e extrai:
   dano (com piercing/aflição/área/multi-turno/percentual), stun (com escopo por classe), roubo de chakra,
   redução de dano, defesa destrutível, cura, invulnerabilidade (total ou por classe), contra-ataque/reflexo,
   debuffs, manipulação de cooldown, stacks, reviver, quebra de defesa, cópia de skill, custo menor para o
   time, "não pode morrer". Skills Action/Control multi-turno valem menos que Instant (são interrompíveis).
   Efeitos condicionais ("during X", "if ...") valem 50%. O dano que o próprio personagem sofre é ignorado.
2. **Perfil** agrega por personagem: ofensa (dano por chakra, penalizando cooldown), controle, defesa,
   suporte, economia (custo médio, custos Random, ganho de chakra), tempo (skills baratas sem setup),
   e a participação de cada tipo de chakra nas 4 skills base.
3. **Nota individual**: componentes normalizados (percentil 95, raiz quadrada) e combinados pelos pesos.
4. **Nota do time** = média das notas + cobertura de papéis + sinergias − **contenção de chakra**
   − dependência de preparação. Contenção: a cada turno chegam 3 chakras aleatórios (25% cada tipo),
   ou seja ~0,75 de cada tipo; se a soma das demandas de um tipo passa disso, dois personagens
   competem pelo mesmo chakra. "Choque" (definição da comunidade): dois personagens compartilham
   qualquer tipo específico.
5. **Busca**: avalia todas as combinações do pool (Top N por nota, ou todos os 216 = 1,6 milhão de trios
   em ~1-2 s), mantendo os melhores e diversificando para não repetir os mesmos 3 personagens.
6. **Missões** (`js/missions.js`): as 200 missões e os 31 grupos (Team 7, Leaf Village...) foram extraídos
   do bundle do site — a regra de cada objetivo é a mesma do jogo: basta *um* dos personagens listados
   (ou do grupo) no time; `sameTeam` exige todos; objetivos de "usar a skill X" exigem o dono da skill.
   A contagem por time usa bitmasks, então entra na busca combinatória sem custo perceptível.

### Margem de erro (leia antes de confiar na ordem)

A nota não é exata e o programa passou a dizer isso na tela: cada personagem aparece como `68 ±16` e cada
time como `76 ±9`. A margem vem do backtest de `scripts/validate-winrate.js` (a estimativa de winrate erra
±8 pontos, e 1 ponto de winrate vale 2 de nota), menor para quem tem medição farta, maior para quem depende
do tier; no time ela cai porque é média de três. **Consequência honesta**: os 20 times sugeridos costumam
caber dentro da margem do primeiro — a lista serve para separar bom de ruim, não para dizer qual é *o*
melhor. Por isso a barra de filtros mostra "*N empatados dentro da margem*"; escolha pelo que avança
missões, pelo que você tem ou pelo que gosta de jogar.

A parte **combinação** da nota (papéis, sinergias, chakra) está marcada com **?**: é regra minha, sem
validação por dados — não existe winrate por time em lugar nenhum. A força individual, essa sim, vem do
winrate oficial.

### Verificação de saúde

`node scripts/health-check.js` (ou Ferramentas › Verificar saúde dos dados, e automaticamente a cada
abertura) confere todas as fontes de uma vez: personagens, leitura das habilidades, missões, winrate,
patch notes, imagens, conta, seus resultados, o build do site, o catálogo oficial, o login e o histórico
do perfil. Diz `✔`, `!` (aviso) ou `✖` (a fonte parou de ser lida) — é o alarme para quando o site mudar.

### Conferir a leitura das 961 habilidades

`node scripts/skill-coverage.js` (ou Ferramentas › Conferir leitura das habilidades) compara o **texto**
de cada skill com o que o parser extraiu e lista o que ficou de fora, agrupado por mecânica — é o mapa do
que ainda falta ensinar ao leitor. Na primeira rodada (2026-09-22) apontou 324 pendências; depois de
apertar as verificações e corrigir três bugs reais, ficaram 81:

- **dreno de chakra**: o padrão exigia "remove" e não pegava "removing/removed" — 10 habilidades
  (Neji, Hinata (S), Orochimaru, Kushina…) tinham o roubo de chakra ignorado;
- **efeito em área sem dano**: "stunning all enemies", "all enemies' skills cost 1 additional chakra" não
  marcavam área — 12 habilidades, e a regra de sinergia "stun em área + dano em área" dependia disso;
- **cura**: "heals an ally for 25 points" (sem a palavra *health*) não era lida.

O que resta são mecânicas sem campo no modelo (acúmulos, cópia de skills, transformações que liberam outras
habilidades) e menções em cláusulas condicionais. As 11 habilidades sem nada extraído estão listadas no
relatório e podem ser corrigidas à mão pelo editor ✎.

### Corrigir a leitura de uma skill pela interface

No detalhe do personagem, cada habilidade tem **✎ Corrigir leitura**: os números lidos (dano, stun, cura,
reduções…) aparecem como sugestão e você preenche só o que está errado; as tags (área, perfurante,
invulnerável, counter…) são marcadas/desmarcadas. Salvar grava em `data/skill-overrides.js` pelo servidor
local (o arquivo é reescrito com as correções ordenadas; a nota explica o porquê) e recalcula tudo na hora.
Aberto pelo `file://`, o editor mostra o trecho JSON para colar no arquivo.

### Base de skills, correções e calibração

- `node scripts/build-skills-db.js` gera `data/skills-db.json` (um registro estruturado por skill) e
  `data/skills-db.md` (planilha de revisão: descrição + o que foi extraído). Ele lista as skills que o parser
  não entendeu.
- `data/skill-overrides.js` — correções manuais por skill; têm a palavra final sobre o parser (ex.: mecânicas
  de cooldown, cópia, "ignora todo o dano"). Editar uma linha ali corrige o personagem em todo o programa.
- `data/calibration.json` + `node scripts/calibrate.js` — times e personagens conhecidos como fortes/fracos;
  o script mostra onde a heurística os coloca. É o instrumento para ajustar pesos com evidência em vez de
  intuição: quanto mais casos, melhor.

### De onde vêm os pesos da heurística

A heurística de habilidades foi desenhada a partir do manual (terminologia de dano, stun, redução, aflição
etc.) e calibrada manualmente. Ela vale para a parte de time e para quem não tem dados; a força individual
vem do winrate oficial (seção acima). O "tier" do programa é o **seu**: um ajuste manual por personagem.
Pesos em `js/engine.js › DEFAULT_WEIGHTS` e na aba Configurações.

## Limitações honestas

- É uma **heurística** sobre texto: habilidades muito complexas (cópias, contadores condicionais, mecânicas
  de stacks) podem ser sub ou superavaliadas. Use a aba **Personagens** para colocar tiers manuais e
  o ranking se ajusta.
- Não considera o time inimigo nem o meta atual. O winrate real (opcional) ajuda nisso.
- Detecção de "mesmo personagem" (Tsunade vs Tsunade (S)) é por nome. O servidor do jogo de fato
  bloqueia versões alternativas no mesmo time (o cliente tem `alternativeVersionConflicts`), mas a lista
  exata fica no servidor; se algo passar ou for barrado indevidamente, use a opção "Permitir versões".
- O peso por tipo de objetivo (sequência 3-4 / vencer N 0,6 / usar skill 0,3) é uma regra fixa em
  `js/missions.js` (`goalWeight`), não vem de dados.
- O script da conta depende de detalhes internos do site (endpoints do Next.js, cabeçalhos `Origin`/`Referer`
  exigidos pelo `connect-selection`). Se o site mudar, rode com `--debug` (gera `data/account.raw.json`).
- A página de winrate (`/characters-winrate`) é restrita: numa conta de nível baixo o site redireciona para a
  home mesmo logado. O script avisa e o programa segue só com a heurística.

## Estrutura

```
index.html                  interface
start.js                    lançador: sobe o servidor local, abre o navegador e verifica atualizações em segundo plano
server.js                 servidor local (127.0.0.1): serve a página e executa os scripts para a aba Ferramentas
test.js                     testes de regressão
css/style.css
js/engine.js                parser + notas + busca (funciona no navegador e no Node)
js/i18n.js                  textos da interface em PT e EN
js/app.js                   UI
js/tools.js                 aba Ferramentas (fala com server.js)
js/results.js            consolidação dos seus resultados por time (página, diário e observador)
scripts/lib-results.js   gera data/results.js (fontes cruas) para a página
cli.js                      linha de comando
data/characters.json        dados brutos (fonte: naruto-arena.site/api/selection-catalog)
data/characters.js          mesmos dados embutidos como JS (para abrir via file://)
data/missions.js            200 missões + 31 grupos (extraídos do bundle do site)
data/account.js             conta ativa (gerado por scripts/download-account.js)
data/accounts/<user>.js     cópia por conta (troque com scripts/switch-account.js)
data/news.js                últimos balanceamentos (gerado por scripts/update-game-data.js)
data/version.json           versão do catálogo/build usada pelo start.js para detectar atualizações
data/config.json            opções do programa (observador ao abrir, intervalo)
data/img/                   imagens locais + index.js (URL -> arquivo), por scripts/download-images.js
data/skills-db.json / .md   base estruturada por skill + planilha de revisão (scripts/build-skills-db.js)
data/skill-overrides.js     correções manuais por skill (palavra final sobre o parser)
data/calibration.json        casos conhecidos (times/personagens fortes ou fracos) para scripts/calibrate.js
data/trained-weights.js     pesos de time treinados (scripts/train-synergy.js --aplicar); null até treinar
data/winrate.js             winrate oficial por personagem (scripts/build-winrate.js)
data/balance-history.js     113 patch notes com mudanças e winrate por personagem (scripts/download-patch-notes.js)
data/forum.js               tópicos/posts do fórum (scripts/download-forum.js, login)
data/community.js           nerfs/buffs, menções e trios recomendados pré-computados (scripts/build-community.js)
js/meta.js                  classificação nerf/buff, resolução de apelidos, extração de trios do fórum
js/missions.js              casamento missão x time, pesos por objetivo, cadeia de pré-requisitos, prioridade
js/sim/effects.js, battle.js  simulador de batalha (experimento; não alimenta as notas)
scripts/simulate.js          torneio IA×IA e correlação com o winrate oficial
scripts/watch-matches.js         observador: ladder pelos contadores, quick match deduzido pelo progresso das missões
scripts/diary.js           resumo dos seus resultados por time (vitórias, derrotas, sequência máxima)
scripts/train-synergy.js treina os pesos de time com trios rotulados (fórum / seus resultados)
scripts/create-launcher.js     gera o lançador "NA Team Builder.desktop/.vbs/.command" dentro da pasta (abrir sem terminal)
NA Team Builder.desktop     lançador (Linux): duplo clique abre o programa sem terminal
scripts/update-game-data.js  atualiza personagens e missões a partir do site (sem login)
scripts/download-images.js   baixa retratos, ícones de skill e imagens de missão para data/img/
scripts/validate-winrate.js  mede o erro típico da estimativa de winrate e compara fórmulas alternativas
scripts/validate-chakra.js   testa se o formato do custo de chakra explica força (deu ~0: nada é penalizado)
scripts/skill-coverage.js compara o texto de cada habilidade com o que o parser extraiu
scripts/health-check.js  confere todas as fontes de dados de uma vez (roda ao abrir o programa)
scripts/map-site.js      lista todas as páginas do site e o que cada uma devolve (acha fontes de dados novas)
scripts/collect-ladder-teams.js    times salvos + resultados de jogadores da ladder -> data/ladder-teams.js
data/site-map.json          resultado do mapeamento do site (22 páginas com dados, 35 restritas)
scripts/download-account.js     baixa personagens liberados, perfil, status e progresso das missões (login)
scripts/switch-account.js     alterna entre contas já baixadas
scripts/download-patch-notes.js  baixa os patch notes com winrate oficial (público)
scripts/build-winrate.js  consolida as medições em data/winrate.js
scripts/download-forum.js     baixa o fórum oficial (login)
scripts/build-community.js pré-computa o sinal de comunidade para a interface
scripts/calibrate.js         mede a heurística contra o winrate oficial e a base de calibração
scripts/download-winrate-page.js   tenta a página de winrate do site (restrita para contas comuns)
```

## Fontes

- Manual do jogo: naruto-arena.site/the-basics, /the-ninja-ladder (tabela de ranks), /affliction-class-changes, /road-to-hokage
- Personagens e habilidades: naruto-arena.site/api/selection-catalog (fallback: na-helper.vercel.app)
- Definição de choque de chakra: na-helper.vercel.app
- Missões, grupos e endpoints da conta: bundle JavaScript de naruto-arena.site
- Winrate oficial e balanceamentos: patch notes de naruto-arena.site/news-archive; fórum naruto-boards.site

## Créditos e licença

Feito por **[Brunkx1](https://github.com/Brunkx1)**. Licença MIT (veja [LICENSE](LICENSE)) **com uma
condição**: uso pessoal é livre, mas qualquer coisa além disso — publicar, distribuir, hospedar ou criar
algo derivado — **deve dar crédito visível ao trabalho original e ao autor**, com link para este
repositório. Se você fizer um fork, diga isso no seu README; se hospedar, ponha no rodapé.

Sem afiliação com o Naruto-Arena. Todo o conteúdo do jogo (personagens, habilidades, arte) pertence aos
donos dele, não é redistribuído aqui, e os números de winrate publicados — que tornam este projeto possível
— são trabalho da staff do jogo.
