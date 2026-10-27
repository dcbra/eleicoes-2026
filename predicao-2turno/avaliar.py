"""Avalia o modelo e o método do app contra o resultado final do 2º turno, usando os instantâneos gravados.

Rode depois que a apuração do 2º turno terminar (o último instantâneo com ~100% apurado é a referência).
Mostra, por grau de apuração, o erro da margem Lula − Flávio de cada método (inclusive o modelo sem a deriva do 1º turno, que diz
se o 2º turno repetiu a curva) e se o IC95 do modelo cobriu o final.
Se o erro real for maior que o previsto, recalibre os parâmetros em parametros_modelo.json.
"""
import argparse
import json
import pathlib
import statistics

from modelo import carregar_parametros, projetar
from projecao import metodo_ufs, votos

HERE = pathlib.Path(__file__).resolve().parent
FAIXAS = [(0.0, 0.1), (0.1, 0.3), (0.3, 0.6), (0.6, 0.9), (0.9, 0.99), (0.99, 1.01)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ele", default="6258", help="código da eleição dos instantâneos (padrão: 2º turno)")
    args = parser.parse_args()

    arquivos = sorted((HERE / "snapshots").glob(f"*ele{args.ele}.json"))
    params = carregar_parametros()
    pontos = []
    for arquivo in arquivos:
        resultados = json.loads(arquivo.read_text(encoding="utf-8"))["resultados"]
        ufs = {uf: d for uf, d in resultados.items() if uf != "br"}
        total = sum(votos(d)["valid"] for d in ufs.values())
        if total <= 0:
            continue
        completude = sum(votos(d)["completude"] * votos(d)["valid"] for d in ufs.values()) / total
        lula_app, flavio_app = metodo_ufs(ufs)
        pontos.append({"arquivo": arquivo.name, "c": completude, "app": lula_app - flavio_app, "modelo": projetar(ufs, params), "sem_deriva": projetar(ufs, params, escala_deriva=0)})

    if not pontos:
        print("Nenhum instantâneo com votos ainda.")
        return
    final = pontos[-1]
    if final["c"] < 0.995:
        print(f"Atenção: o último instantâneo tem só {final['c']:.1%} apurado; a referência ainda não é o resultado final.")
    ref = final["modelo"]["margem_pp"]
    print(f"Referência: {final['arquivo']} | margem {ref:+.2f} pp | {len(pontos)} instantâneos com votos\n")
    print(f"{'apuração':>10} {'n':>4} {'RMSE app':>9} {'RMSE modelo':>12} {'RMSE sem deriva':>16} {'cobertura IC95':>15}")
    for lo, hi in FAIXAS:
        sel = [p for p in pontos if lo <= p["c"] < hi]
        if not sel:
            continue
        rmse = lambda xs: (statistics.mean(x * x for x in xs)) ** 0.5
        cobertura = statistics.mean(p["modelo"]["ic95_margem_pp"][0] <= ref <= p["modelo"]["ic95_margem_pp"][1] for p in sel)
        print(f"{lo:>4.0%}–{min(hi, 1):<4.0%} {len(sel):>4} {rmse([p['app'] - ref for p in sel]):>9.2f} "
              f"{rmse([p['modelo']['margem_pp'] - ref for p in sel]):>12.2f} {rmse([p['sem_deriva']['margem_pp'] - ref for p in sel]):>16.2f} {cobertura:>15.0%}")


if __name__ == "__main__":
    main()
