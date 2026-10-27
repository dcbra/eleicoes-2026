"""Estudos sobre o 1º turno para escolher e calibrar o modelo do 2º turno.

1. Decomposição do erro nacional em composição (quais UFs já foram apuradas) e deriva dentro da UF.
2. Erro da estimativa de votos válidos por UF (válidos / fração do eleitorado) por grau de apuração.
3. Erro da participação do líder da UF por grau de apuração e por minutos desde a abertura.

Entrada: JSONs do painel de totalização (dados/tse_apuracao_2026) e o último instantâneo do 1º turno.
Saída: tabelas no terminal e parametros_modelo.json (usado por modelo.py e pelo app).
"""
import json
import pathlib
import statistics

from historico import DEFAULT_DIR, erro_por_faixa, number, load_columns, serie_1turno
from projecao import votos

HERE = pathlib.Path(__file__).resolve().parent
FAIXAS_C = [(0, .0005), (.0005, .002), (.002, .01), (.01, .02), (.02, .05), (.05, .1), (.1, .2), (.2, .3), (.3, .5), (.5, .7), (.7, .9), (.9, 1.01)]


def serie_por_uf(tse_dir: pathlib.Path):
    """Séries por UF alinhadas aos instantes nacionais, repetindo o último valor conhecido."""
    r = load_columns(tse_dir / "resumo_uf.json")
    tempos = list(load_columns(tse_dir / "resumo_geral.json")["dt_data"])
    por_uf = {}
    for i, uf in enumerate(r["sg_ue_uf"]):
        por_uf.setdefault(uf, {})[r["dt_data"][i]] = {
            "valid": number(r["qt_votos_validos"][i]),
            "c": number(r["pct_aptos_totalizados"][i]) / 100,
            "lider": r["nm_votavel_lider"][i],
            "lider_votos": number(r["qt_votos_lider"][i]),
        }
    saida = {}
    for uf, pontos in por_uf.items():
        ultimo = {"valid": 0.0, "c": 0.0, "lider": None, "lider_votos": 0.0}
        linhas = []
        for t in tempos:
            ultimo = pontos.get(t, ultimo)
            linhas.append(dict(ultimo, t=t))
        saida[uf] = linhas
    return saida, tempos


def finais_por_uf() -> dict:
    snap = json.loads(sorted((HERE / "snapshots").glob("*ele6257.json"))[-1].read_text(encoding="utf-8"))["resultados"]
    return {uf.upper(): dict(votos(d), te=number(d["e"]["te"])) for uf, d in snap.items() if uf != "br"}


def pctl(valores, q):
    valores = sorted(valores)
    return valores[min(len(valores) - 1, int(q * len(valores)))]


def estudo_composicao(uf_series, tempos, finais, nacional_t):
    print("== 1. Composição x deriva dentro da UF (margem Lula − Flávio, pp) ==")
    print(f"{'hora':>6} {'apur.':>6} {'real':>8} {'só composição':>14} {'deriva intra-UF':>16}")
    por_t = {p["t"]: p for p in nacional_t}
    deriva = []
    for k, t in enumerate(tempos):
        tot = lula = flavio = 0.0
        for uf, linhas in uf_series.items():
            v, f = linhas[k]["valid"], finais.get(uf)
            if f and v > 0:
                tot += v
                lula += v * f["lula"] / f["valid"]
                flavio += v * f["flavio"] / f["valid"]
        resid = por_t[t]["margem"] - (lula - flavio) / tot * 100
        if por_t[t]["completude"] >= 0.04:
            deriva.append([round(por_t[t]["completude"], 4), round(resid, 3)])
        if k % 6 == 0 and por_t[t]["completude"] < 0.9999:
            print(f"{t[11:16]:>6} {por_t[t]['completude']:>6.1%} {por_t[t]['margem']:>+8.2f} "
                  f"{(lula - flavio) / tot * 100:>+14.2f} {resid:>+16.2f}")
    print()
    return deriva


def estudo_validos(uf_series, finais):
    print("== 2. Erro relativo de (válidos / completude) contra os válidos finais da UF ==")
    print(f"{'c da UF':>10} {'n':>5} {'mediana':>9} {'p90':>8}")
    for lo, hi in FAIXAS_C:
        erros = [abs(p["valid"] / p["c"] - finais[uf]["valid"]) / finais[uf]["valid"] * 100
                 for uf, linhas in uf_series.items() if uf in finais
                 for p in linhas if lo <= p["c"] < hi and p["c"] > 0]
        if erros:
            print(f"{lo:>4.0%}–{min(hi, 1):<4.0%} {len(erros):>5} {statistics.median(erros):>8.1f}% {pctl(erros, .9):>7.1f}%")
    print()


def estudo_lider(uf_series):
    print("== 3. Participação do líder da UF contra o final (pp) ==")
    pontos = []
    for uf, linhas in uf_series.items():
        fim = linhas[-1]
        if fim["lider"] not in ("LULA", "FLAVIO BOLSONARO") or fim["valid"] <= 0:
            continue
        final_pct = fim["lider_votos"] / fim["valid"] * 100
        for k, p in enumerate(linhas):
            if p["valid"] > 0 and p["lider"] == fim["lider"]:
                pontos.append((p["c"], k * 5, p["lider_votos"] / p["valid"] * 100 - final_pct))
    print(f"{'c da UF':>10} {'n':>5} {'viés':>7} {'|erro| med':>11} {'|erro| p90':>11} {'sd usado':>9}")
    nos = []
    for lo, hi in FAIXAS_C:
        sel = [p for p in pontos if lo <= p[0] < hi]
        if not sel:
            continue
        absr = [abs(p[2]) for p in sel]
        sd = (statistics.median(absr) / 0.6745 + pctl(absr, .9) / 1.645) / 2
        nos.append([round((lo + min(hi, 1.0)) / 2, 5), round(sd, 2)])
        print(f"{lo:>4.0%}–{min(hi, 1):<4.0%} {len(sel):>5} {statistics.mean(p[2] for p in sel):>+7.2f} "
              f"{statistics.median(absr):>11.2f} {pctl(absr, .9):>11.2f} {sd:>9.2f}")
    print("por minutos desde 17:10 (referência):")
    for lo, hi in [(0, 15), (15, 30), (30, 60), (60, 120), (120, 1000)]:
        sel = [abs(p[2]) for p in pontos if lo <= p[1] < hi]
        if sel:
            print(f"{lo:>5}–{hi:<5} n={len(sel):>5}  |erro| med {statistics.median(sel):>6.2f}  p90 {pctl(sel, .9):>6.2f}")
    print()
    nos = nos[:-1]
    for i in range(len(nos) - 2, -1, -1):  # o erro não pode crescer com a apuração: envelope monotônico
        nos[i][1] = max(nos[i][1], nos[i + 1][1])
    return [[0.0, nos[0][1]]] + nos + [[0.99, 0.1], [1.0, 0.05]]


def main() -> None:
    nacional_t = sorted(serie_1turno(DEFAULT_DIR), key=lambda p: p["t"])
    uf_series, tempos = serie_por_uf(DEFAULT_DIR)
    finais = finais_por_uf()
    deriva = estudo_composicao(uf_series, tempos, finais, nacional_t)
    estudo_validos(uf_series, finais)
    sigma_obs = estudo_lider(uf_series)

    por_c = sorted(nacional_t, key=lambda p: p["completude"])
    curva = [[round(p["completude"], 5), round((p["lula"] - p["flavio"]) / (p["lula"] + p["flavio"]) * 100, 3)] for p in por_c if p["completude"] >= 0.001]
    # ritmo da apuração: minutos desde as 17h (fechamento das urnas) até cada grau de apuração do eleitorado
    ritmo, ultimo_c = [], -1.0
    for p in sorted(nacional_t, key=lambda p: p["t"]):
        h, m = int(p["t"][11:13]), int(p["t"][14:16])
        minutos = (h * 60 + m - 17 * 60) + (1440 if p["t"][8:10] != "04" else 0)
        if p["completude"] > ultimo_c and p["completude"] >= 0.001:
            ritmo.append([round(p["completude"], 5), minutos])
            ultimo_c = p["completude"]
    parametros = {
        "descricao": "Gerado por estudo.py a partir do 1º turno de 2026 (eleição 6257).",
        "curva_1turno_margem_duas": curva,
        "ritmo_1turno": ritmo,
        "faixas_erro_1turno": [{"de": float(f["faixa"].split("–")[0].rstrip("%")) / 100, "ate": float(f["faixa"].split("–")[1].rstrip("%")) / 100,
                                "p90_margem_pp": f["p90_margem_pp"]} for f in erro_por_faixa(serie_1turno(DEFAULT_DIR))],
        "c_min_validos": 0.01,
        "c_min_obs": 0.002,
        "c_min_oscilacao": 0.005,
        "sigma_prior_padrao": 3.5,
        "sigma_prior_min": 2.0,
        "sigma_prior_max": 6.0,
        "min_ufs_sigma_prior": 6,
        "primeiro_turno": {uf: {"valid": f["valid"], "lula": f["lula"], "flavio": f["flavio"], "te": f["te"]}
                           for uf, f in sorted(finais.items())},
    }
    (HERE / "parametros_modelo.json").write_text(json.dumps(parametros, ensure_ascii=False, indent=1))
    print("Gravado parametros_modelo.json")


if __name__ == "__main__":
    main()
