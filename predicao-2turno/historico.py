"""Calibra erro e curva de apuração com a série real do 1º turno (eleição de 04/10/2026).

Lê votacao_brasil.json (votos por candidato a cada 5 min) e resumo_geral.json (eleitorado
totalizado no mesmo instante). O último ponto é o resultado final publicado (05/10 03:00),
que bate com o BR do painel do TSE.
"""
import argparse
import json
import pathlib
import statistics

DEFAULT_DIR = pathlib.Path(__file__).resolve().parent.parent / "dados" / "tse_apuracao_2026"
BINS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001]


def number(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return float(str(value or "0").replace(".", "").replace(",", "."))


def load_columns(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["data"]


def serie_1turno(tse_dir: pathlib.Path) -> list[dict]:
    votos = load_columns(tse_dir / "votacao_brasil.json")
    geral = load_columns(tse_dir / "resumo_geral.json")

    candidatos = {}
    for i, t in enumerate(votos["dt_data"]):
        if votos["nm_cargo_pergunta"][i] != "Presidente":
            continue
        nome = votos["nm_votavel"][i]
        if nome in ("LULA", "FLAVIO BOLSONARO"):
            candidatos.setdefault(t, {})[nome] = number(votos["qt_votos_totalizados"][i])

    serie = []
    for i, t in enumerate(geral["dt_data"]):
        if t not in candidatos:
            continue
        valid = number(geral["qt_votos_validos"][i])
        lula = candidatos[t]["LULA"] / valid * 100
        flavio = candidatos[t]["FLAVIO BOLSONARO"] / valid * 100
        serie.append({
            "t": t,
            "completude": number(geral["pct_aptos_totalizados"][i]) / 100,
            "valid": valid,
            "lula": lula,
            "flavio": flavio,
            "margem": lula - flavio,
        })
    return sorted(serie, key=lambda p: p["completude"])


def erro_por_faixa(serie: list[dict]) -> list[dict]:
    final = serie[-1]
    linhas = []
    for inicio, fim in zip(BINS, BINS[1:]):
        pontos = [p for p in serie if inicio <= p["completude"] < fim]
        if not pontos:
            continue
        linha = {"faixa": f"{inicio:.0%}–{min(fim, 1.0):.0%}", "n": len(pontos)}
        for chave in ("lula", "flavio", "margem"):
            erros = sorted(abs(p[chave] - final[chave]) for p in pontos)
            linha[f"mediana_{chave}_pp"] = round(statistics.median(erros), 3)
            linha[f"p90_{chave}_pp"] = round(erros[min(len(erros) - 1, int(0.9 * len(erros)))], 3)
        linhas.append(linha)
    return linhas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tse-dir", default=str(DEFAULT_DIR), help="pasta com os JSONs baixados do painel")
    parser.add_argument("--out", default="calibracao_1turno.json")
    args = parser.parse_args()

    serie = serie_1turno(pathlib.Path(args.tse_dir))
    final = serie[-1]
    print(f"Pontos: {len(serie)} | final ({final['t']}): Lula {final['lula']:.2f}% | Flávio {final['flavio']:.2f}% | margem {final['margem']:+.2f} pp")
    print()
    print(f"{'apuração':>10} {'n':>4}  {'Lula med/p90':>14}  {'Flávio med/p90':>15}  {'margem med/p90':>15}   (erro absoluto vs final, em pp)")
    for linha in erro_por_faixa(serie):
        print(f"{linha['faixa']:>10} {linha['n']:>4}  "
              f"{linha['mediana_lula_pp']:>6.2f}/{linha['p90_lula_pp']:<6.2f}  "
              f"{linha['mediana_flavio_pp']:>6.2f}/{linha['p90_flavio_pp']:<7.2f}  "
              f"{linha['mediana_margem_pp']:>6.2f}/{linha['p90_margem_pp']:<6.2f}")

    pathlib.Path(args.out).write_text(json.dumps({"final": final, "serie": serie, "faixas": erro_por_faixa(serie)}, ensure_ascii=False, indent=1))
    print(f"\nGravado em {args.out}")


if __name__ == "__main__":
    main()
