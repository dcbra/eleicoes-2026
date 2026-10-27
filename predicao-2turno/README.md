# Predição do 2º turno (2026)

Modelo que projeta o resultado nacional de Lula x Flávio Bolsonaro durante a apuração do 2º turno, com intervalo de confiança, calibrado com o 1º turno. O app `../apuracao-2026` já usa este modelo (`src/model.ts` é a porta de `modelo.py`).

Códigos do TSE: 1º turno `6257`, 2º turno `6258`.

## Modelo (`modelo.py`)

1. **Votos válidos finais por UF** = válidos ÷ fração do eleitorado totalizado. Antes de 0,2% apurado, usa os válidos do 1º turno escalados pelo que as outras UFs mostram.
2. **Deriva do 1º turno:** a participação de Lula entre os dois (p) em cada UF subiu, em média, até o final da apuração (~+1,3 pp nas fases do meio, 0 no fim). O modelo soma essa correção (`deriva_p`) ao p observado. Supõe que o 2º turno repete a curva; `escala_deriva=0` mostra o resultado sem essa premissa.
3. **Participação por UF:** combina o p corrigido com um a priori = 1º turno + oscilação nacional medida ao vivo. O peso do observado cresce com a fração apurada da UF, usando o erro por UF medido no 1º turno (`sigma_obs_p`). Abaixo de 0,2% apurado, o dado da UF é ignorado.
4. **Nacional** = média das UFs ponderada pelos válidos finais estimados.
5. **Intervalo (IC95):** variância independente por UF × fator de correlação (1 até 75% apurado, 1,5 perto do fim) + incerteza da oscilação nacional + incerteza de o 2º turno não repetir a deriva (desvio de 50% da correção). A chance de Lula à frente é a normal da margem sobre o desvio. O σ do a priori é medido ao vivo com 6+ UFs bem apuradas (limites 2 a 6 pp).

## Dados e estudos

Os arquivos por UF (`votacao_uf.json`, 28 UFs, conferidos com o resultado oficial final) estão em `../dados/tse_apuracao_2026/uf/`.

- `estudo_uf.py` (principal): com os votos de Lula e Flávio em cada UF, mede o erro de p por grau de apuração, valida a correção deixando cada UF de fora e mede o erro nacional. Resultados:
  - o erro de p por UF vai de ~9 pp com <1% apurado a 4,7 pp com 10–20%, ~3 pp com 20–70%, ~1 pp com 70–90% e 0,2 pp com >90%;
  - o viés por UF é pequeno e só é consistente entre UFs nas fases finais (t=2,5 em 70–90%, 3,9 acima), mas ponderado pelos votos explica quase todo o erro nacional: o erro da margem com 50–75% apurado cai de 2,00 para 0,24 pp, e de 3,09 para 0,86 pp com 25–50% (validação fora da amostra por UF);
  - a inclinação (viés dependente de p) não se sustenta fora da amostra e não é usada;
  - um indicador ao vivo para checar se o 2º turno repete a curva foi testado no 1º turno e é só ruído, então a premissa entra como incerteza.
- `estudo.py`: estudos anteriores com o líder de cada UF e a curva nacional (referência, e gera a base de `parametros_modelo.json`).
- `simulacao.py`: usa os caminhos reais de erro de cada UF e cenários em que o 2º turno repete 100%, 50% ou 0% da deriva. Com 40–70% apurado, o erro da margem é de 0,46 pp (modelo) contra 2,28 pp (método antigo) se a curva se repete; se não houver deriva, 1,62 pp contra 0,28 pp. O IC95 cobre ≥94% nos três cenários.
  Também mede o mesmo modelo com `escala_deriva=0` (chaves `rmse_semderiva_*`, `erro95_semderiva_*`, `faixa_exibida_semderiva_*`, `cobertura_semderiva_*` e `faixa_por_c_semderiva`), que é o que o app usa como projeção principal desde 25/10/2026: a apuração do 2º turno não seguiu a ordem do 1º. Na fase de 3–15%, o erro típico sem deriva é ±2,5 pp se o 2º turno não tiver deriva e ±3,1 pp se repetir a do 1º.
- O descarte do começo é gradual (pelo erro por UF), mais o corte em 0,2% apurado. Cortes maiores pioram o erro.

`parametros_modelo.json` guarda também `faixa_por_c`, a meia-faixa de 95% da margem que o modelo exibe em cada grau de apuração (medida em `simulacao.py`). O gráfico "Curva da apuração" a usa para encolher a sombra ao longo da apuração, escalada pelo erro calculado ao vivo.

## Como usar

O servidor do app grava um instantâneo a cada 2 min em `snapshots/` enquanto estiver rodando (mesmo sem a página aberta) e a tela monta o histórico a partir deles. Sem o app: `python3 coleta.py --ele 6258`.

```sh
python3 modelo.py          # projeta com o instantâneo mais recente do 2º turno
python3 avaliar.py         # depois da apuração: erro e cobertura contra o resultado final (inclui "sem deriva")
# recalibrar, nesta ordem:
python3 estudo.py && python3 estudo_uf.py && python3 simulacao.py
cp parametros_modelo.json ../apuracao-2026/src/parametros.json
```

Se `modelo.py` e `src/model.ts` forem alterados, mantenha os dois iguais.

## O que é medido e o que é suposto

- **Medido no 1º turno (28 UFs):** erro da participação por UF por fase de apuração (`sigma_obs_p`), deriva por fase (`deriva_p`, encolhida pela consistência entre UFs) e o fator de correlação entre UFs (`fator_comum`, medido e arredondado, com piso em 1).
- **Suposto, não medido:** 50% de incerteza sobre repetir a deriva (`kappa_sd`), σ do a priori de 3,5 pp até haver 6 UFs bem apuradas, e, na simulação, a verdade do 2º turno (oscilação nacional de 2,5 pp e 3 pp por UF). Só o 2º turno permite medir esses itens; `avaliar.py` mostra o erro real depois.
- A chance de vitória e a faixa de 95% do painel vêm da conta ao vivo de `modelo.py`/`model.ts`. A tabela "margem de erro por fase" vem de `simulacao.py` (o mesmo código sobre os caminhos reais de erro) e não entra na conta ao vivo.

## Limites

- A deriva, o erro por UF e as faixas vêm de uma única eleição. Se o 2º turno não repetir a deriva, o modelo erra mais que o método antigo nas fases do meio (ver `simulacao.py`). O painel mostra as duas projeções.
- O a priori supõe que o 2º turno se parece com o 1º por UF, a menos de uma oscilação nacional. Esse trecho não pôde ser testado com dados do 1º turno.
- A simulação reaproveita os caminhos que calibraram o modelo, então o cenário "curva se repete" é otimista. A medida fora da amostra por UF é a de `estudo_uf.py`. A validação real é `avaliar.py` no 2º turno.
- A chance de Lula à frente descreve o modelo, não o resultado oficial.
- `projecao.py` e `historico.py` são a primeira versão (método "curva nacional") e ficam como referência.
