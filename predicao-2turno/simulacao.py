"""Simulação do modelo com os caminhos reais de erro de cada UF no 1º turno.

Verdade sintética do 2º turno: participação de Lula por UF = 1º turno (entre os dois) + oscilação nacional + ruído.
Observação a cada instante: verdade + erro real daquela UF no 1º turno (ruído, viés e correlação entre UFs reais),
no mesmo ritmo real de apuração. Cenários de deriva do 2º turno em relação ao 1º: 100% (a curva se repete),
50% e 0% (nenhuma deriva), para mostrar quanto custa a premissa de repetir a curva se ela falhar.

Parte da calibração (deriva e erro por UF) saiu desses mesmos caminhos, então o cenário 100% é otimista.
A medida fora da amostra por UF é a de estudo_uf.py (S3). A validação real é avaliar.py no 2º turno.
"""
import bisect
import json
import math
import pathlib
import random
import statistics

from modelo import carregar_parametros, interpola, projetar
from uf_hist import carregar_ufs

N_RUNS = 150
PASSO = 4
CENARIOS = [1.0, 0.5, 0.0]
FAIXAS = [(0.03, 0.15), (0.15, 0.4), (0.4, 0.7), (0.7, 0.9), (0.9, 1.01)]


def snapshot_sintetico(estado: dict) -> dict:
    saida = {}
    for uf, e in estado.items():
        saida[uf.lower()] = {
            "carg": [{"agr": [{"par": [{"cand": [
                {"nmu": "LULA", "vap": str(round(e["lula"]))},
                {"nmu": "FLAVIO BOLSONARO", "vap": str(round(e["flavio"]))}]}]}]}],
            "v": {"vv": str(round(e["valid"]))},
            "e": {"est": str(round(e["c"] * e["te"])), "te": str(round(e["te"]))},
        }
    return saida


def metodo_app(estado: dict) -> float:
    tot = lula = flavio = 0.0
    for e in estado.values():
        if e["valid"] <= 0 or e["c"] <= 0:
            continue
        est = e["valid"] / e["c"]
        tot += est
        lula += e["lula"] / e["valid"] * est
        flavio += e["flavio"] / e["valid"] * est
    return (lula - flavio) / tot * 100 if tot else 0.0


def main() -> None:
    random.seed(2026)
    params = carregar_parametros()
    ufs = carregar_ufs()
    p1 = {uf: b["lula"] / (b["lula"] + b["flavio"]) for uf, b in params["primeiro_turno"].items()}
    tempos_uf = {uf: [q["t"] for q in pts] for uf, pts in ufs.items()}
    grade = sorted({q["t"] for pts in ufs.values() for q in pts})[1::PASSO]
    # caminho real de erro e de apuração por UF e instante
    caminho = {}
    for uf, pts in ufs.items():
        pf = pts[-1]["p"]
        linha = []
        for t in grade:
            i = bisect.bisect_right(tempos_uf[uf], t) - 1
            linha.append((pts[i]["c"], pts[i]["p"] - pf) if i >= 0 else (0.0, 0.0))
        caminho[uf] = linha

    res = {s: {"erro": [], "dentro": [], "c": [], "meia": []} for s in CENARIOS}
    # mesmo modelo sem corrigir deriva (escala_deriva=0): é o que o app usa se a curva do 1º turno não valer
    res0 = {s: {"erro": [], "dentro": [], "c": [], "meia": []} for s in CENARIOS}
    app = {s: {"erro": [], "c": []} for s in CENARIOS}
    for _ in range(N_RUNS):
        delta = random.gauss(0.01, 0.025)
        verdade = {uf: min(0.97, max(0.03, p1[uf] + delta + random.gauss(0, 0.03))) for uf in p1}
        v2 = {uf: params["primeiro_turno"][uf]["valid"] * 0.985 for uf in p1}
        margem_final = sum(v2[u] * (2 * verdade[u] - 1) for u in p1) / sum(v2.values()) * 100
        for k in range(len(grade)):
            for s in CENARIOS:
                estado, c_num = {}, 0.0
                for uf in p1:
                    c, erro = caminho[uf][k] if uf in caminho else (0.0, 0.0)
                    valid = v2[uf] * c
                    a = interpola(params["deriva_p"], c)
                    p = min(0.99, max(0.01, verdade[uf] + erro + (1 - s) * a)) if valid > 0 else 0.5
                    estado[uf] = {"valid": valid, "c": c, "te": params["primeiro_turno"][uf]["te"], "lula": valid * p, "flavio": valid * (1 - p)}
                    c_num += c * v2[uf]
                c_nac = c_num / sum(v2.values())
                if c_nac < 0.03:
                    continue
                app[s]["erro"].append(metodo_app(estado) - margem_final)
                app[s]["c"].append(c_nac)
                r = projetar(snapshot_sintetico(estado), params)
                lo, hi = r["ic95_margem_pp"]
                res[s]["erro"].append(r["margem_pp"] - margem_final)
                res[s]["dentro"].append(lo <= margem_final <= hi)
                res[s]["meia"].append((hi - lo) / 2)
                res[s]["c"].append(c_nac)
                r0 = projetar(snapshot_sintetico(estado), params, escala_deriva=0.0)
                lo0, hi0 = r0["ic95_margem_pp"]
                res0[s]["erro"].append(r0["margem_pp"] - margem_final)
                res0[s]["dentro"].append(lo0 <= margem_final <= hi0)
                res0[s]["meia"].append((hi0 - lo0) / 2)
                res0[s]["c"].append(c_nac)

    rmse = lambda xs: math.sqrt(statistics.mean(x * x for x in xs)) if xs else float("nan")
    rotulos = "  ".join(f"{format(s, '.0%'):>7}" for s in CENARIOS)
    print(f"{N_RUNS} execuções; erro da margem Lula − Flávio (pp). Colunas: deriva do 2º turno = {rotulos.replace('  ', ' / ')} da do 1º")
    print(f"{'apuração':>10} | {'método app':^25} | {'modelo':^25} | {'cobertura IC95':^25}")
    resumo = []
    for lo, hi in FAIXAS:
        linha = {"de": lo, "ate": min(hi, 1.0)}
        partes = []
        for nome, fonte in (("app", app), ("modelo", res)):
            vals = []
            for s in CENARIOS:
                sel = [e for e, c in zip(fonte[s]["erro"], fonte[s]["c"]) if lo <= c < hi]
                vals.append(rmse(sel))
                linha[f"rmse_{nome}_{int(s * 100)}"] = round(vals[-1], 3)
            partes.append("  ".join(f"{v:>7.2f}" for v in vals))
        cob = []
        for s in CENARIOS:
            dentro = [d for d, c in zip(res[s]["dentro"], res[s]["c"]) if lo <= c < hi]
            cob.append(statistics.mean(dentro) if dentro else float("nan"))
            linha[f"cobertura_{int(s * 100)}"] = round(cob[-1], 3)
            erros = sorted(abs(e) for e, c in zip(res[s]["erro"], res[s]["c"]) if lo <= c < hi)
            meias = [m for m, c in zip(res[s]["meia"], res[s]["c"]) if lo <= c < hi]
            linha[f"erro95_modelo_{int(s * 100)}"] = round(erros[int(0.95 * len(erros)) - 1], 3) if erros else None
            linha[f"faixa_exibida_{int(s * 100)}"] = round(statistics.mean(meias), 3) if meias else None
        print(f"{lo:>4.0%}–{min(hi, 1):<4.0%} | {partes[0]:^25} | {partes[1]:^25} | " + "  ".join(f"{c:>7.0%}" for c in cob))
        for s in CENARIOS:
            sel = [i for i, c in enumerate(res0[s]["c"]) if lo <= c < hi]
            k = int(s * 100)
            erros = sorted(abs(res0[s]["erro"][i]) for i in sel)
            linha[f"rmse_semderiva_{k}"] = round(rmse([res0[s]["erro"][i] for i in sel]), 3)
            linha[f"erro95_semderiva_{k}"] = round(erros[int(0.95 * len(erros)) - 1], 3) if erros else None
            linha[f"faixa_exibida_semderiva_{k}"] = round(statistics.mean(res0[s]["meia"][i] for i in sel), 3) if sel else None
            linha[f"cobertura_semderiva_{k}"] = round(statistics.mean(res0[s]["dentro"][i] for i in sel), 3) if sel else None
        print(" " * 12 + "sem deriva: rmse " + "  ".join(f"{linha[f'rmse_semderiva_{int(s * 100)}']:>5.2f}" for s in CENARIOS) + " | cobertura " + "  ".join(f"{linha[f'cobertura_semderiva_{int(s * 100)}']:>4.0%}" for s in CENARIOS))
        resumo.append(linha)

    # meia-faixa de 95% da margem (pp) que o modelo exibe em cada grau de apuração, em faixas finas (para o gráfico de curva projetada)
    bordas = [0.03, 0.06, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 1.01]
    faixa_por_c, faixa_por_c_semderiva = {}, {}
    for fonte, destino in ((res, faixa_por_c), (res0, faixa_por_c_semderiva)):
        for s in CENARIOS:
            nos = []
            for lo, hi in zip(bordas, bordas[1:]):
                idx = [i for i, c in enumerate(fonte[s]["c"]) if lo <= c < hi]
                if len(idx) >= 20:
                    nos.append([round(statistics.mean(fonte[s]["c"][i] for i in idx), 4), round(statistics.mean(fonte[s]["meia"][i] for i in idx), 3)])
            for i in range(1, len(nos)):  # o erro esperado não cresce com a apuração
                nos[i][1] = min(nos[i][1], nos[i - 1][1])
            destino[str(int(s * 100))] = nos
    caminho_json = pathlib.Path(__file__).resolve().parent / "parametros_modelo.json"
    parametros = json.loads(caminho_json.read_text(encoding="utf-8"))
    parametros["erro_simulado"] = resumo
    parametros["faixa_por_c"] = faixa_por_c
    parametros["faixa_por_c_semderiva"] = faixa_por_c_semderiva
    caminho_json.write_text(json.dumps(parametros, ensure_ascii=False, indent=1))
    print("\nerro_simulado gravado em parametros_modelo.json (rode estudo.py e estudo_uf.py antes, se alterar os parâmetros)")


if __name__ == "__main__":
    main()
