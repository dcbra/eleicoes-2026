"""Grava um instantâneo da apuração por UF (mesma fonte pública que o app apuracao-2026 usa)."""
import argparse
import json
import pathlib
import urllib.request
from datetime import datetime, timezone

BASE = "https://resultados.tse.jus.br/oficial/ele2026/{ele}/dados"
UFS = "ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to zz br".split()
USER_AGENT = "predicao-2turno/1.0 (projeto pessoal, uma consulta por ciclo)"


def url_uf(ele: str, uf: str) -> str:
    return f"{BASE.format(ele=ele)}/{uf}/{uf}-c0001-e{int(ele):06d}-u.json"


def fetch(ele: str, uf: str) -> dict:
    request = urllib.request.Request(url_uf(ele, uf), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ele", default="6257", help="código da eleição no TSE (1º turno: 6257)")
    parser.add_argument("--out", default="snapshots", help="pasta onde gravar os instantâneos")
    args = parser.parse_args()

    collected_at = datetime.now(timezone.utc)
    results = {uf: fetch(args.ele, uf) for uf in UFS}

    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{collected_at:%Y%m%dT%H%M%SZ}_ele{args.ele}.json"
    path.write_text(json.dumps({"coletado_em": collected_at.isoformat(), "ele": args.ele, "resultados": results}, ensure_ascii=False))
    print(f"{len(results)} arquivos gravados em {path}")


if __name__ == "__main__":
    main()
