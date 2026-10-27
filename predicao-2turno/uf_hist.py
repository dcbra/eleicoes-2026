"""Histórico do 1º turno por UF e por candidato (arquivos votacao_uf.json + resumo_uf.json do painel do TSE)."""
import json
import pathlib

from historico import DEFAULT_DIR, load_columns, number

UF_DIR = DEFAULT_DIR / "uf"


def carregar_ufs(tse_dir: pathlib.Path = DEFAULT_DIR) -> dict:
    """UF -> lista de pontos {t, c, valid, lula, flavio} em ordem de tempo, com o último ponto = resultado final."""
    resumo = load_columns(tse_dir / "resumo_uf.json")
    completude = {}
    for i, uf in enumerate(resumo["sg_ue_uf"]):
        completude.setdefault(uf, {})[resumo["dt_data"][i]] = number(resumo["pct_aptos_totalizados"][i]) / 100

    saida = {}
    for pasta in sorted((tse_dir / "uf").glob("*")):
        arquivo = pasta / "votacao_uf.json"
        if not arquivo.exists():
            continue
        try:
            dados = load_columns(arquivo)
        except (ValueError, OSError):
            continue  # arquivo ainda sendo gravado
        uf = pasta.name
        por_t = {}
        for i, t in enumerate(dados["dt_data"]):
            nome = dados["nm_votavel"][i]
            ponto = por_t.setdefault(t, {"t": t, "valid": number(dados["qt_votos_validos"][i]), "lula": 0.0, "flavio": 0.0})
            if nome == "LULA":
                ponto["lula"] = number(dados["qt_votos_totalizados"][i])
            elif nome == "FLAVIO BOLSONARO":
                ponto["flavio"] = number(dados["qt_votos_totalizados"][i])
        c_uf = completude.get(uf, {})
        ultimo_c = 0.0
        pontos = []
        for t in sorted(por_t):
            ultimo_c = c_uf.get(t, ultimo_c)
            p = por_t[t]
            p["c"] = ultimo_c
            if p["lula"] + p["flavio"] > 0:
                p["p"] = p["lula"] / (p["lula"] + p["flavio"])
                pontos.append(p)
        if pontos:
            saida[uf] = pontos
    return saida
