"""Estudo por UF com a série real do 1º turno (votos de Lula e Flávio em cada UF a cada horário).

S1. Erro e viés da participação de Lula entre os dois (p) em cada UF, por grau de apuração da UF.
S2. A correção do viés (e da inclinação em p) se sustenta fora da amostra? Valida deixando cada UF de fora.
S3. Erro nacional da margem com dados reais: método antigo do app, ponderação com pesos, e com correção.
S4. Quanto os erros das UFs se somam (correlação comum), para calibrar o intervalo nacional.
Grava os parâmetros em parametros_uf.json.
"""
import bisect
import json
import math
import pathlib
import statistics

from estudo import FAIXAS_C, pctl
from uf_hist import carregar_ufs

HERE = pathlib.Path(__file__).resolve().parent
C_MIN = 0.002


def interp(nos, x):
    if x <= nos[0][0]:
        return nos[0][1:]
    for a, b in zip(nos, nos[1:]):
        if x <= b[0]:
            w = (x - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 1.0
            return [ya + (yb - ya) * w for ya, yb in zip(a[1:], b[1:])]
    return nos[-1][1:]


def ajustar_deriva(ufs: dict, excluir: str | None = None) -> list:
    """Viés médio por faixa de apuração (média entre UFs), encolhido pela consistência entre UFs.

    A unidade de inferência é a UF (os pontos de uma UF são correlacionados). O viés é multiplicado por
    max(0, 1 − 1/t²), com t = média / erro-padrão entre UFs: sem evidência, não corrige.
    Nós: [centro da faixa, correção (fração de p), 0, desvio dos pontos].
    """
    nos = []
    peso = {uf: pts[-1]["lula"] + pts[-1]["flavio"] for uf, pts in ufs.items()}
    for lo, hi in FAIXAS_C:
        medias, pesos, todos = [], [], []
        for uf, pts in ufs.items():
            if uf == excluir:
                continue
            pf = pts[-1]["p"]
            d = [pf - q["p"] for q in pts[:-1] if lo <= q["c"] < hi and q["c"] >= 0.0005]
            if d:
                medias.append(statistics.mean(d))
                pesos.append(peso[uf])
                todos += d
        if len(medias) < 8:
            continue
        sw = sum(pesos)
        m = sum(w * x for w, x in zip(pesos, medias)) / sw  # média ponderada pelos votos: é o que pesa no nacional
        ep = math.sqrt(sum((w * (x - m)) ** 2 for w, x in zip(pesos, medias)) / sw ** 2 * len(medias) / (len(medias) - 1))
        t = m / ep if ep > 0 else 0.0
        encolhe = max(0.0, 1 - 1 / (t * t)) if t else 0.0
        nos.append([round((lo + min(hi, 1.0)) / 2, 5), m * encolhe, 0.0, statistics.pstdev(todos)])
    nos.append([1.0, 0.0, 0.0, 0.0005])
    return nos


def corrigir(nos, c, p):
    a, _, _ = interp(nos, c)
    return min(0.98, max(0.02, p + a))


def s1_s2(ufs):
    print("== S1/S2. Participação de Lula entre os dois (p): erro de p observado contra o final, em pp ==")
    print(f"{'c da UF':>10} {'n':>5} {'viés':>7} {'sd':>6} {'RMSE obs':>9} {'RMSE corrigido':>15}   (validação deixando a UF de fora)")
    fits = {uf: ajustar_deriva(ufs, excluir=uf) for uf in ufs}
    linhas = []
    for lo, hi in FAIXAS_C:
        e0, e1, ds = [], [], []
        for uf, pts in ufs.items():
            pf = pts[-1]["p"]
            for q in pts[:-1]:
                if lo <= q["c"] < hi and q["c"] >= 0.0005:
                    e0.append(q["p"] - pf)
                    e1.append(corrigir(fits[uf], q["c"], q["p"]) - pf)
                    ds.append(pf - q["p"])
        if len(e0) < 6:
            continue
        r = lambda e: 100 * math.sqrt(statistics.mean(x * x for x in e))
        print(f"{lo:>4.0%}–{min(hi, 1):<4.0%} {len(e0):>5} {100 * statistics.mean(ds):>+7.2f} {100 * statistics.pstdev(ds):>6.2f} {r(e0):>9.2f} {r(e1):>15.2f}")
        linhas.append((lo, hi, r(e0), r(e1)))
    print()
    return fits


def estado_em(ufs, tempos_uf, t):
    saida = {}
    for uf, pts in ufs.items():
        i = bisect.bisect_right(tempos_uf[uf], t) - 1
        if i >= 0:
            saida[uf] = pts[i]
    return saida


def s3_s4(ufs, fits):
    final = {uf: pts[-1] for uf, pts in ufs.items()}
    dois = {uf: f["lula"] + f["flavio"] for uf, f in final.items()}
    tot = sum(dois.values())
    p_ver = sum(f["lula"] for f in final.values()) / tot
    tempos_uf = {uf: [q["t"] for q in pts] for uf, pts in ufs.items()}
    grade = sorted({q["t"] for pts in ufs.values() for q in pts})
    ordem = ("A", "B", "C", "E")
    registros = []
    residuos = {}
    for t in grade:
        est = estado_em(ufs, tempos_uf, t)
        cn = sum(est[u]["c"] * dois[u] for u in est) / tot
        obs = [u for u in est if est[u]["c"] >= C_MIN]
        if cn < 0.02 or len(obs) < 3:
            continue
        res = {}
        # A: método antigo do app (só UFs com dado, p observado)
        VA = {u: (est[u]["lula"] + est[u]["flavio"]) / est[u]["c"] for u in obs}
        res["A"] = sum(VA[u] * est[u]["p"] for u in obs) / sum(VA.values())
        # B: UFs sem dado entram com o peso final e a média nacional observada
        # C: B com correção do viés e da inclinação (deriva aprendida nas outras UFs)
        # E: como C, mas UFs sem dado com o p verdadeiro (isola o erro das UFs observadas)
        pc = {u: corrigir(fits[u], est[u]["c"], est[u]["p"]) if est[u]["c"] < 0.9999 else est[u]["p"] for u in obs}
        for nome, pobs in (("B", {u: est[u]["p"] for u in obs}), ("C", pc), ("E", pc)):
            pm = sum(VA[u] * pobs[u] for u in obs) / sum(VA.values())
            V, P = dict(VA), dict(pobs)
            for u in ufs:
                if u not in obs:
                    V[u] = dois[u]
                    P[u] = final[u]["p"] if nome == "E" else pm
            res[nome] = sum(V[u] * P[u] for u in V) / sum(V.values())
        erro = {k: (2 * res[k] - 1 - (2 * p_ver - 1)) * 100 for k in ordem}
        soma_V = sum(VA.values())
        # soma independente dos erros das UFs observadas em E (pp da margem)
        for u in obs:
            if est[u]["c"] < 0.9999:
                residuos.setdefault(u, []).append((est[u]["c"], pc[u] - final[u]["p"]))
        registros.append((cn, erro, [(est[u]["c"], VA[u] / soma_V) for u in obs]))

    print("== S3. Erro da margem nacional entre os dois (pp), dados reais do 1º turno ==")
    print("A = método do app | B = + UFs sem dado com peso final e média nacional | C = B + correção do viés (encolhida) | E = C com prior perfeito (só erro das UFs apuradas)")
    print(f"{'apuração':>10} {'n':>4} {'A':>7} {'B':>7} {'C':>7} {'E':>7} {'viés A':>8} {'viés C':>8}")
    faixas = [(0.02, 0.1), (0.1, 0.25), (0.25, 0.5), (0.5, 0.75), (0.75, 0.9), (0.9, 0.99), (0.99, 1.01)]
    rmse = lambda xs: math.sqrt(statistics.mean(x * x for x in xs))
    saida = []
    for lo, hi in faixas:
        sel = [r for r in registros if lo <= r[0] < hi]
        if not sel:
            continue
        print(f"{lo:>4.0%}–{min(hi, 1):<4.0%} {len(sel):>4} " + " ".join(f"{rmse([r[1][k] for r in sel]):>7.2f}" for k in ordem[:3]) + f" {rmse([r[1]['E'] for r in sel]):>7.2f} {statistics.mean(r[1]['A'] for r in sel):>+8.2f} {statistics.mean(r[1]['C'] for r in sel):>+8.2f}")
        saida.append((lo, hi, sel))
    print()

    # S4: sigma residual por UF (de C, fora da amostra) e fator de correlação comum no nacional (de E)
    nos_sigma = []
    for lo, hi in FAIXAS_C:
        vals = [e for pts in residuos.values() for c, e in pts if lo <= c < hi]
        if len(vals) >= 8:
            nos_sigma.append([round((lo + min(hi, 1.0)) / 2, 5), round(100 * math.sqrt(statistics.mean(v * v for v in vals)), 3)])
    nos_sigma.append([1.0, 0.05])
    print("== S4. Soma dos erros das UFs: independente x real (E) ==")
    print(f"{'apuração':>10} {'RMSE E real':>12} {'indep. prevista':>16} {'fator':>7}")
    fatores = []
    for lo, hi, sel in saida:
        previsto = []
        for _, _, parts in sel:
            var = sum((200 * w * interp([[c0] + [s] for c0, s in nos_sigma], c)[0] / 100) ** 2 for c, w in parts)
            previsto.append(math.sqrt(var))
        real = rmse([r[1]["E"] for r in sel])
        fator = real / statistics.mean(previsto) if statistics.mean(previsto) > 0 else float("nan")
        fatores.append([round((lo + min(hi, 1.0)) / 2, 3), round(fator, 2)])
        print(f"{lo:>4.0%}–{min(hi, 1):<4.0%} {real:>12.2f} {statistics.mean(previsto):>16.2f} {fator:>7.2f}")
    print()
    return nos_sigma, fatores


def main() -> None:
    ufs = carregar_ufs()
    print(f"{len(ufs)} UFs carregadas: {', '.join(sorted(ufs))}\n")
    fits = s1_s2(ufs)
    nos_sigma, fatores = s3_s4(ufs, fits)
    deriva = ajustar_deriva(ufs)
    # correção suavizada (média de 3 nós): as faixas iniciais têm pouca evidência
    suave = [[n[0], n[1]] for n in deriva]
    for i in range(1, len(deriva) - 1):
        suave[i][1] = (deriva[i - 1][1] + deriva[i][1] + deriva[i + 1][1]) / 3
    deriva_p = [[0.0, 0.0], [0.002, 0.0]] + [[n[0], round(n[1], 5)] for n in suave]
    # erro por UF (pp de p) por grau de apuração, nunca crescendo com a apuração
    sigma = [[0.0, 9.1], [0.002, 9.1]] + [list(n) for n in nos_sigma]
    for i in range(len(sigma) - 2, -1, -1):
        sigma[i][1] = max(sigma[i][1], sigma[i + 1][1])
    (HERE / "parametros_uf.json").write_text(json.dumps({
        "descricao": "Gerado por estudo_uf.py (1º turno, 28 UFs). deriva: [c, a, b, sd]; sigma_res: [c, pp]; fator_comum: [c, fator].",
        "ufs": len(ufs), "deriva": [[n[0], round(n[1], 5), round(n[2], 4), round(n[3], 5)] for n in deriva],
        "sigma_res": nos_sigma, "fator_comum": fatores,
    }, indent=1))
    caminho = HERE / "parametros_modelo.json"
    modelo = json.loads(caminho.read_text(encoding="utf-8"))
    for velha in ("sigma_obs", "deriva_margem"):
        modelo.pop(velha, None)
    modelo.update({
        "deriva_p": deriva_p,
        "sigma_obs_p": sigma,
        "fator_comum": [[0.0, 1.0], [0.75, 1.0], [0.95, 1.5], [1.0, 1.5]],
        "kappa_sd": 0.5,
    })
    caminho.write_text(json.dumps(modelo, ensure_ascii=False, indent=1))
    print("Gravado em parametros_modelo.json: deriva_p, sigma_obs_p, fator_comum, kappa_sd")
    print("Gravado parametros_uf.json")


if __name__ == "__main__":
    main()
