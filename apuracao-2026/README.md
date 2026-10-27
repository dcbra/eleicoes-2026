# Apuração 2026

Painel independente para acompanhar os arquivos públicos de apuração do TSE e projetar a votação presidencial de Lula e Flávio Bolsonaro.

## Método

- **1º turno (código TSE `6257`)**: por UF, estima o total final de votos válidos dividindo os votos válidos apurados pela fração do eleitorado totalizado e aplica a proporção atual de cada candidato. Estimativa simples, sem intervalo.
- **2º turno (código `6258`)**: modelo calibrado no 1º turno, com margem Lula − Flávio, intervalo de 95% e chance estimada de Lula à frente. O modo é escolhido sozinho pelo campo `t` dos arquivos. Detalhes, estudos e limites em `../predicao-2turno/README.md`; o código está em `src/model.ts` (parâmetros em `src/parametros.json`).

## Interface (pensada primeiro para o celular)

- **Cabeçalho fixo** com o estado ao vivo, o resumo (Lula, Flávio, margem e faixa) e a escolha da eleição (1º/2º turno ou código).
- **Abas inferiores no celular** (Resumo, Evolução, Estados, Método). No desktop todas as seções aparecem empilhadas. Dá para abrir direto numa aba: `#ufs`, `#evolucao`.
- **Resumo**: margem final esperada com faixa de 95%, barra de incerteza, Lula e Flávio com faixa, chance de Lula, o erro típico da fase atual e o cenário "com a curva do 1º turno" (recolhível). Desde o 2º turno de 25/10, a projeção principal usa o modelo **sem deriva** (`MAIN_DRIFT = 0` em `src/insights.tsx`), porque a apuração não seguiu a ordem do 1º turno; a versão com deriva continua como alternativa (linha laranja). O erro por fase, a cobertura e a sombra da curva vêm das chaves `*_semderiva_*` e `faixa_por_c_semderiva` da simulação. Também mostra as UFs fora do esperado e a base da projeção.
- **Evolução**: a curva da apuração de Lula e Flávio (real até o "agora", tracejada até o fim, em % apurado ou em horário; a sombra é a margem de erro de 95% do modelo em cada fase, igual à de agora no "agora" e encolhendo conforme a apuração avança, e a barra da ponta direita é a faixa do resultado final hoje), a trajetória da projeção com faixa de 95%, 2º turno contra a curva do 1º turno e a tabela de confiança por fase. Os gráficos usam a largura real da tela.
- **Estados**: painel de UFs fora do esperado e lista por estado (cartões no celular, tabela no desktop) com ordenação por apuração, desvio, peso ou margem.

## Modo TV

`http://localhost:5173/#tv` abre uma página única, sem rolagem, pensada para TV (16:9): margem esperada com faixa e chance de Lula, a margem apurada agora, Lula e Flávio com o apurado agora (total nacional oficial, arquivo `br`) e o final projetado, a curva real e projetada com sombra de erro, a trajetória da projeção, a extrapolação simples por estado (sem curva do 1º turno), a tabela dos 28 estados (margem, % de urnas apuradas, anel âmbar = UF fora do esperado, ponto âmbar = arquivo do TSE parado há mais de 5 min) e relógio.

A **extrapolação por estado** (`extrapolate` em `src/model.ts`, igual a `metodo_app` em `predicao-2turno/simulacao.py`) estende os votos de cada estado com votos ao eleitorado inteiro dele e mantém a participação atual; não usa 1º turno nem deriva, e estados sem votos ficam de fora. Serve de segunda opinião caso o 2º turno não repita a curva do 1º. O erro típico mostrado é o `rmse_app` da simulação na fase atual (sem deriva / com a deriva do 1º turno). Ela é desenhada em 1920×1080 e se ajusta sozinha a qualquer tela, inclusive um iPhone deitado espelhado por HDMI; se o conteúdo crescer, a escala diminui para caber. Mantém a tela acesa (Wake Lock) e pede para girar o aparelho se estiver em pé. `Esc` ou o botão "Modo TV" das configurações voltam ao painel normal. No iPhone, "Adicionar à Tela de Início" abre em tela cheia, sem a barra do Safari.

## UFs fora do esperado

Para cada UF apurada, compara a participação de Lula entre os dois que a UF aponta com o esperado (1º turno + oscilação nacional medida ao vivo). O desvio vira um z usando o erro por UF medido no 1º turno e a dispersão ao vivo. O alerta é **atenção** com |z| ≥ 2,5 ou **forte** com |z| ≥ 3,5, e só dispara se persistir em 3 das últimas 4 atualizações (um desvio isolado fica como "observando"), porque no 1º turno 6 de 28 UFs passaram de |z| 2,5 em algum instante só por ruído de apuração. Cada alerta mostra o impacto da UF na margem nacional.

O histórico vem de `/api/history`, que lê os instantâneos gravados em disco. Um gravador em segundo plano, ligado enquanto o servidor roda, grava um instantâneo a cada 2 minutos mesmo sem a página aberta, e só quando os arquivos do TSE mudam. Para gravar outra eleição, ou desligar: `APURACAO_RECORD_ELE=6257 npm run dev`, ou `APURACAO_RECORD_ELE=off`.

Os dados são lidos dos arquivos JSON públicos oficiais do TSE (por UF, mais o exterior), a cada 30 segundos. O campo "TSE" no topo troca o código da eleição e fica salvo no navegador. O servidor local grava um instantâneo a cada 2 minutos em `../predicao-2turno/snapshots/`, para recalibrar o modelo depois com `avaliar.py`.

## Executar

```sh
npm install
npm run dev
```

Abra `http://localhost:5173`. Para acessar de outro aparelho da rede (celular, TV), use `npm run dev -- --host <ip-da-máquina>`. `npm run build` gera a versão estática em `dist/`.
