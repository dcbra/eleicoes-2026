"""Projeta o resultado nacional de Lula x Flávio a partir de um instantâneo da apuração.

Dois métodos sobre a mesma entrada (instantâneo gravado por coleta.py):
- ufs:   o método do app apuracao-2026. Escala os votos válidos de cada UF pela fração
         do eleitorado já totalizado e aplica a participação atual dos candidatos.
- curva: supõe que o 2º turno segue a curva do 1º (calibracao_1turno.json). Parte da
         participação atual e soma quanto ela ainda mudou no 1º turno entre o mesmo grau
         de apuração e o final.

A faixa de erro é a dispersão real observada no 1º turno naquele grau de apuração.
"""
import argparse
import bisect
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent


def number(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return float(str(value or "0").replace(".", "").replace(",", "."))


def candidatos(node, out=None):
    """Coleta (nome, votos) de todo nó 'cand' do arquivo, como o app faz."""
    out = [] if out is None else out
    if isinstance(node, list):
        for item in node:
            candidatos(item, out)
    elif isinstance(node, dict):
        if isinstance(node.get("cand"), list):
            for cand in node["cand"]:
                out.append(((cand.get("nmu") or cand.get("nm") or "").upper(), number(cand.get("vap"))))
        for key, child in node.items():
            if key != "cand":
                candidatos(child, out)
    return out


def votos(dados: dict) -> dict:
    cands = candidatos(dados["carg"])
    valid = number(dados["v"]["vv"])
    return {
        "valid": valid,
        "lula": sum(v for nome, v in cands if "LULA" in nome),
        "flavio": sum(v for nome, v in cands if "FLAVIO" in nome),
        "completude": number(dados["e"]["est"]) / number(dados["e"]["te"]),
    }


def metodo_ufs(resultados: dict) -> tuple[float, float]:
    total = lula = flavio = 0.0
    for uf, dados in resultados.items():
        if uf == "br":
            continue
        v = votos(dados)
        if v["valid"] <= 0 or v["completude"] <= 0:
            continue
        estimado = v["valid"] / v["completude"]
        total += estimado
        lula += v["lula"] / v["valid"] * estimado
        flavio += v["flavio"] / v["valid"] * estimado
    return lula / total * 100, flavio / total * 100


def interpola(serie: list[dict], chave: str, c: float) -> float:
    xs = [p["completude"] for p in serie]
    i = bisect.bisect_left(xs, c)
    if i <= 0:
        return serie[0][chave]
    if i >= len(serie):
        return serie[-1][chave]
    a, b = serie[i - 1], serie[i]
    if b["completude"] == a["completude"]:
        return b[chave]
    w = (c - a["completude"]) / (b["completude"] - a["completude"])
    return a[chave] + w * (b[chave] - a[chave])


def metodo_curva(resultados: dict, calib: dict) -> tuple[float, float]:
    atual = votos(resultados["br"])
    c = atual["completude"]
    lula_atual = atual["lula"] / atual["valid"] * 100
    flavio_atual = atual["flavio"] / atual["valid"] * 100
    lula_1t = interpola(calib["serie"], "lula", c)
    flavio_1t = interpola(calib["serie"], "flavio", c)
    return (
        lula_atual + (calib["final"]["lula"] - lula_1t),
        flavio_atual + (calib["final"]["flavio"] - flavio_1t),
    )


def faixa_erro(calib: dict, c: float) -> float | None:
    for linha in calib["faixas"]:
        inicio, fim = (float(x.rstrip("%")) / 100 for x in linha["faixa"].replace("–", "-").split("-"))
        if inicio <= c <= fim + 1e-9:
            return linha["p90_margem_pp"]
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", help="instantâneo de coleta.py (padrão: o mais recente)")
    parser.add_argument("--calib", default=str(HERE / "calibracao_1turno.json"))
    args = parser.parse_args()

    pasta = HERE / "snapshots"
    snapshot = pathlib.Path(args.snapshot) if args.snapshot else sorted(pasta.glob("*.json"))[-1]
    resultados = json.loads(snapshot.read_text(encoding="utf-8"))["resultados"]
    calib = json.loads(pathlib.Path(args.calib).read_text(encoding="utf-8"))

    br = votos(resultados["br"])
    print(f"Instantâneo: {snapshot.name}")
    print(f"Eleitorado totalizado: {br['completude']:.2%} | votos válidos: {br['valid']:,.0f}".replace(",", "."))
    print(f"Atual: Lula {br['lula'] / br['valid']:.2%} | Flávio {br['flavio'] / br['valid']:.2%}")
    print()

    lula_ufs, flavio_ufs = metodo_ufs(resultados)
    lula_curva, flavio_curva = metodo_curva(resultados, calib)
    banda = faixa_erro(calib, br["completude"])

    print(f"{'método':<26}{'Lula':>10}{'Flávio':>10}{'margem':>10}")
    print(f"{'ufs (método do app)':<26}{lula_ufs:>9.2f}%{flavio_ufs:>9.2f}%{lula_ufs - flavio_ufs:>+9.2f}")
    print(f"{'curva do 1º turno':<26}{lula_curva:>9.2f}%{flavio_curva:>9.2f}%{lula_curva - flavio_curva:>+9.2f}")
    print()
    if banda is not None:
        print(f"Erro típico do 1º turno nesse grau de apuração (p90 da margem, sem correção): ±{banda:.2f} pp")
    print("Atenção: o 1º turno é uma única realização. Os métodos não foram validados fora da amostra.")


if __name__ == "__main__":
    main()
