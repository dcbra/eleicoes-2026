"""Modelo de projeção do 2º turno (Lula x Flávio), versão de referência.

Para cada UF corrige a participação observada pela deriva medida no 1º turno (nas 28 UFs) e a combina
com uma estimativa a priori vinda do 1º turno mais a oscilação nacional medida ao vivo. O peso da
observação cresce com a fração apurada da UF (descarte gradual do começo) e dados de UFs com menos
de c_min_obs apurado são ignorados. Os pesos nacionais usam os votos válidos finais estimados por UF
(válidos / completude). O intervalo inclui a incerteza de o 2º turno não repetir a deriva do 1º.
"""
import argparse
import json
import math
import pathlib

from projecao import votos

HERE = pathlib.Path(__file__).resolve().parent


def carregar_parametros(caminho=None) -> dict:
    return json.loads(pathlib.Path(caminho or HERE / "parametros_modelo.json").read_text(encoding="utf-8"))


def interpola(nos: list, x: float) -> float:
    nos = sorted(nos)
    if x <= nos[0][0]:
        return nos[0][1]
    for (x0, y0), (x1, y1) in zip(nos, nos[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0) if x1 > x0 else y1
    return nos[-1][1]


def phi(z: float) -> float:
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def projetar(resultados: dict, params: dict, c_min_obs: float | None = None, escala_deriva: float = 1.0) -> dict:
    """escala_deriva: 1 supõe que o 2º turno repete a deriva do 1º; 0 supõe que não há deriva."""
    c_min_obs = params["c_min_obs"] if c_min_obs is None else c_min_obs
    anterior = params["primeiro_turno"]
    ufs = []
    for uf, dados in resultados.items():
        if uf == "br":
            continue
        base = anterior.get(uf.upper())
        if not base:
            continue
        v = votos(dados)
        duas = v["lula"] + v["flavio"]
        p1 = base["lula"] / (base["lula"] + base["flavio"])
        p_obs = v["lula"] / duas if duas > 0 else None
        # deriva do 1º turno: quanto a participação de Lula ainda subiu entre este grau de apuração e o final
        deriva = escala_deriva * interpola(params["deriva_p"], v["completude"])
        ufs.append({"uf": uf, "valid": v["valid"], "c": v["completude"], "duas": duas, "deriva": deriva,
                    "p_obs": min(0.98, max(0.02, p_obs + deriva)) if p_obs is not None else None, "p1": p1, "valid1": base["valid"]})

    # votos válidos finais esperados por UF
    contadas = [u for u in ufs if u["valid"] > 0 and u["c"] >= params["c_min_validos"]]
    razao = (sum(u["valid"] / u["c"] for u in contadas) / sum(u["valid1"] for u in contadas)) if contadas else 1.0
    for u in ufs:
        u["V"] = u["valid"] / u["c"] if u in contadas else u["valid1"] * razao

    # oscilação nacional em relação ao 1º turno, só com UFs que já têm dado confiável
    sigma_p = params["sigma_prior_padrao"]
    usaveis = [u for u in ufs if u["c"] >= max(c_min_obs, params["c_min_oscilacao"]) and u["p_obs"] is not None]
    se_osc, oscilacao = None, 0.0
    if usaveis:
        pesos = []
        for u in usaveis:
            so = interpola(params["sigma_obs_p"], u["c"])
            pesos.append(u["V"] / (so ** 2 + sigma_p ** 2))
        total = sum(pesos)
        oscilacao = sum(w * (u["p_obs"] - u["p1"]) for w, u in zip(pesos, usaveis)) / total * 100
        # sigma do a priori medido ao vivo nas UFs bem apuradas
        bem = [u for u in usaveis if u["c"] >= 0.3]
        if len(bem) >= params["min_ufs_sigma_prior"]:
            res2 = [((u["p_obs"] - u["p1"]) * 100 - oscilacao) ** 2 - interpola(params["sigma_obs_p"], u["c"]) ** 2 for u in bem]
            vivo = math.sqrt(max(0.0, sum(res2) / len(res2)))
            sigma_p = min(params["sigma_prior_max"], max(params["sigma_prior_min"], vivo))
        pesos = [u["V"] / (interpola(params["sigma_obs_p"], u["c"]) ** 2 + sigma_p ** 2) for u in usaveis]
        total = sum(pesos)
        se_osc = math.sqrt(sum(w * w * (interpola(params["sigma_obs_p"], u["c"]) ** 2 + sigma_p ** 2) for w, u in zip(pesos, usaveis))) / total
        se_osc = max(se_osc, 0.3)
    else:
        se_osc = sigma_p

    # participação estimada por UF (pp, parte de Lula entre os dois candidatos)
    soma_V = sum(u["V"] for u in ufs)
    p_nac = var_indep = peso_prior = deriva_comum = 0.0
    for u in ufs:
        prior = min(98.0, max(2.0, u["p1"] * 100 + oscilacao))
        if u["c"] >= c_min_obs and u["p_obs"] is not None and u["duas"] > 0:
            so = interpola(params["sigma_obs_p"], u["c"])
            omega = sigma_p ** 2 / (sigma_p ** 2 + so ** 2)
            est = omega * u["p_obs"] * 100 + (1 - omega) * prior
            var = sigma_p ** 2 * so ** 2 / (sigma_p ** 2 + so ** 2)
        else:
            omega, est, var = 0.0, prior, sigma_p ** 2
        w = u["V"] / soma_V
        u.update(omega=omega, est=est)
        p_nac += w * est
        var_indep += (w ** 2) * var
        peso_prior += w * (1 - omega)
        u["prior"] = prior
        deriva_comum += w * omega * u["deriva"] * 100

    c_nac = sum(u["c"] * u["V"] for u in ufs) / soma_V
    fator = interpola(params["fator_comum"], c_nac)  # erros das UFs não são independentes perto do fim
    sd_p = math.sqrt(var_indep * fator ** 2 + (peso_prior * se_osc) ** 2 + (deriva_comum * params["kappa_sd"]) ** 2)

    desvios = []
    for u in ufs:
        if u["omega"] > 0 and u["p_obs"] is not None:
            dev = u["p_obs"] * 100 - u["prior"]
            so = interpola(params["sigma_obs_p"], u["c"])
            desvios.append({"uf": u["uf"], "desvio_pp": dev, "z": dev / math.sqrt(so ** 2 + sigma_p ** 2),
                            "impacto_margem_pp": 2 * (u["V"] / soma_V) * u["omega"] * dev})
    duas_obs = sum(u["duas"] for u in ufs)
    q = duas_obs / sum(u["valid"] for u in ufs) if duas_obs > 0 else 1.0
    margem = (2 * p_nac - 100) * q
    sd_margem = 2 * sd_p * q
    return {
        "lula_pct": p_nac * q, "flavio_pct": (100 - p_nac) * q, "margem_pp": margem,
        "ic95_margem_pp": [margem - 1.96 * sd_margem, margem + 1.96 * sd_margem],
        "sd_margem_pp": sd_margem, "prob_lula_a_frente": phi(margem / sd_margem) if sd_margem > 0 else float(margem > 0),
        "completude": c_nac, "oscilacao_pp": oscilacao, "sigma_prior_pp": sigma_p,
        "ufs_usadas": sum(1 for u in ufs if u["omega"] > 0), "ufs_total": len(ufs), "ufs_desvio": desvios,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", help="instantâneo do 2º turno (padrão: o mais recente com ele6258)")
    args = parser.parse_args()
    arquivo = pathlib.Path(args.snapshot) if args.snapshot else sorted((HERE / "snapshots").glob("*ele6258.json"))[-1]
    resultados = json.loads(arquivo.read_text(encoding="utf-8"))["resultados"]
    r = projetar(resultados, carregar_parametros())
    lo, hi = r["ic95_margem_pp"]
    print(f"{arquivo.name} | apurado {r['completude']:.1%} | UFs com dado útil {r['ufs_usadas']}/{r['ufs_total']}")
    print(f"Lula {r['lula_pct']:.2f}% | Flávio {r['flavio_pct']:.2f}% | margem {r['margem_pp']:+.2f} pp (IC95 {lo:+.2f} a {hi:+.2f})")
    print(f"chance de Lula à frente: {r['prob_lula_a_frente']:.1%} | oscilação vs 1º turno {r['oscilacao_pp']:+.2f} pp | sigma a priori {r['sigma_prior_pp']:.1f} pp")


if __name__ == "__main__":
    main()
