import { useMemo, useState } from "react";
import { BellRing, ChevronDown, CircleCheck, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from "./components";
import { UF_NAMES, fmt, num, pct, sign } from "./format";
import type { SeriesPoint } from "./insights";
import type { Projection, UfDiagnostic } from "./model";
import type { StateResult } from "./tse";

// ---- UFs com desvio acima do esperado ----
export const Z_WARN = 2.5, Z_STRONG = 3.5, PERSIST_OF = 4, PERSIST_MIN = 3;
export type AlertLevel = "forte" | "atencao" | "observando" | "normal";
export type UfAlert = { diag: UfDiagnostic; level: AlertLevel; persist: number };

// Um desvio isolado pode ser só ruído de apuração (no 1º turno, 6 de 28 UFs passaram de |z| 2,5 em algum instante sem desvio real).
// Por isso só vira alerta se persistir em PERSIST_MIN das últimas PERSIST_OF atualizações, com o mesmo sinal.
export function computeAlerts(series: SeriesPoint[]): UfAlert[] {
  const recent = series.slice(-PERSIST_OF);
  const last = series[series.length - 1];
  return last.proj.ufs.map(diag => {
    const persist = recent.filter(p => { const d = p.proj.ufs.find(x => x.uf === diag.uf); return d && Math.abs(d.z) >= Z_WARN && Math.sign(d.z) === Math.sign(diag.z); }).length;
    const high = Math.abs(diag.z) >= Z_WARN;
    const level: AlertLevel = !high ? "normal" : persist >= PERSIST_MIN ? (Math.abs(diag.z) >= Z_STRONG ? "forte" : "atencao") : "observando";
    return { diag, level, persist };
  }).sort((a, b) => Math.abs(b.diag.z) - Math.abs(a.diag.z));
}

export const alertCount = (alerts: UfAlert[]) => alerts.filter(a => a.level === "forte" || a.level === "atencao").length;

const LEVEL_STYLE: Record<AlertLevel, { label: string; cls: string }> = {
  forte: { label: "Forte", cls: "border-amber-500/70 bg-amber-500/20 text-amber-200" },
  atencao: { label: "Atenção", cls: "border-amber-700/70 bg-amber-950/50 text-amber-300" },
  observando: { label: "Observando", cls: "border-zinc-700 bg-zinc-900 text-zinc-300" },
  normal: { label: "Dentro do esperado", cls: "border-zinc-800 bg-transparent text-zinc-500" },
};

function UfChip({ uf }: { uf: string }) { return <span className="inline-flex h-7 w-9 shrink-0 items-center justify-center rounded bg-zinc-800 text-[11px] font-semibold uppercase">{uf}</span>; }

function ZBar({ z }: { z: number }) {
  const w = Math.min(50, Math.abs(z) / 4 * 50);
  return <div className="relative h-1.5 w-full rounded-full bg-zinc-800" aria-hidden><div className="absolute inset-y-0 left-1/2 w-px bg-zinc-600"/><div className={`absolute inset-y-0 rounded-full ${Math.abs(z) >= Z_WARN ? "bg-amber-400" : "bg-zinc-500"}`} style={z >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}/></div>;
}

function AlertRow({ a }: { a: UfAlert }) {
  const d = a.diag, style = LEVEL_STYLE[a.level];
  return <li className="rounded-lg border border-zinc-800 bg-black/20 p-3">
    <div className="flex items-center gap-2.5"><UfChip uf={d.uf}/><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-zinc-100">{UF_NAMES[d.uf]}</div><div className="tabular text-xs text-zinc-500">{pct(d.c * 100, 0)} apurado · peso {pct(d.weight * 100, 1)} do total</div></div>
      <div className="shrink-0 text-right"><div className={`tabular text-base font-semibold ${d.dev >= 0 ? "text-rose-300" : "text-sky-300"}`}>{sign(d.dev, 1)} pp</div><div className="tabular text-xs text-zinc-500">z = {sign(d.z, 1)}</div></div></div>
    <div className="mt-2"><ZBar z={d.z}/></div>
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400"><span className={`rounded-full border px-2 py-0.5 text-[11px] ${style.cls}`}>{style.label}{a.level !== "normal" && a.persist > 0 ? ` · ${a.persist}/${PERSIST_OF}` : ""}</span><span className="tabular">esperado {num(d.expected, 1)}% · UF aponta {num(d.observed, 1)}%</span><span className="tabular">margem nacional {sign(d.impact)} pp</span></div>
  </li>;
}

export function DeviationsCard({ alerts, projection, limit, onSeeAll }: { alerts: UfAlert[]; projection: Projection; limit?: number; onSeeAll?: () => void }) {
  const [all, setAll] = useState(false);
  const flagged = alerts.filter(a => a.level === "forte" || a.level === "atencao");
  const watching = alerts.filter(a => a.level === "observando");
  const notable = alerts.filter(a => a.level !== "normal");
  const rows = limit ? notable.slice(0, limit) : all ? alerts : notable;
  const impact = flagged.reduce((s, a) => s + a.diag.impact, 0);
  const none = flagged.length === 0;
  return <Card className={none ? "" : "border-amber-700/50"}><CardHeader className="pb-2"><div className="flex items-start gap-2.5">
    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${none ? "bg-emerald-950/60 text-emerald-300" : "bg-amber-950/60 text-amber-300"}`}>{none ? <CircleCheck size={17}/> : <TriangleAlert size={17}/>}</span>
    <div className="min-w-0"><CardTitle className="text-base">{alerts.length === 0 ? "UFs fora do esperado" : none ? "Nenhuma UF fora do esperado" : `${flagged.length} UF${flagged.length > 1 ? "s" : ""} fora do esperado`}</CardTitle>
      <CardDescription className="mt-1">{alerts.length === 0 ? "Aguardando UFs com dados suficientes para comparar com o esperado." : none ? `${watching.length ? `${watching.length} em observação. ` : ""}As ${alerts.length} UFs com dado estão compatíveis com o 1º turno mais a oscilação nacional (${sign(projection.swingPp, 1)} pp).` : `Impacto somado na margem nacional: ${sign(impact)} pp. A projeção já incorpora o que essas UFs mostram.`}</CardDescription></div></div></CardHeader>
    <CardContent>
      {rows.length > 0 && <ul className="space-y-2">{rows.map(a => <AlertRow key={a.diag.uf} a={a}/>)}</ul>}
      {limit ? (onSeeAll && alerts.length > 0 ? <button onClick={onSeeAll} className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-800 text-sm text-zinc-300 active:bg-zinc-900">Ver todas as UFs</button> : null)
        : alerts.length > notable.length ? <button onClick={() => setAll(v => !v)} className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-800 text-sm text-zinc-300 active:bg-zinc-900">{all ? "Mostrar só as principais" : `Mostrar as ${alerts.length} UFs`}<ChevronDown size={15} className={all ? "rotate-180" : ""}/></button> : null}
      <details className="group mt-3 rounded-lg border border-zinc-800 text-xs text-zinc-400"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2"><span className="flex items-center gap-1.5"><BellRing size={13}/>Como ler este painel</span><ChevronDown size={15} className="shrink-0 text-zinc-500 transition-transform group-open:rotate-180"/></summary>
        <p className="border-t border-zinc-800 px-3 py-3 leading-relaxed">Desvio = quanto a participação de Lula entre os dois que a UF aponta está acima ou abaixo do esperado (1º turno + oscilação nacional). O z compara o desvio com a variação normal: {num(Z_WARN, 1)} = atenção, {num(Z_STRONG, 1)} = forte. O alerta só dispara se persistir em {PERSIST_MIN} das últimas {PERSIST_OF} atualizações. Com 28 UFs, um desvio isolado pode ser acaso, e um desvio real pode ser a eleição se comportando diferente do 1º turno naquela UF.</p></details>
    </CardContent></Card>;
}

// ---- lista de UFs ----
type SortKey = "apuracao" | "desvio" | "peso" | "margem";
const SORTS: { key: SortKey; label: string }[] = [{ key: "apuracao", label: "Apuração" }, { key: "desvio", label: "Desvio" }, { key: "peso", label: "Peso" }, { key: "margem", label: "Margem" }];

export function UfList({ rows, alerts, election }: { rows: StateResult[]; alerts: UfAlert[]; election: string }) {
  const [sort, setSort] = useState<SortKey>(alerts.length ? "desvio" : "apuracao");
  const [open, setOpen] = useState<string | null>(null);
  const byUf = useMemo(() => new Map(alerts.map(a => [a.diag.uf, a])), [alerts]);
  const keys = alerts.length ? SORTS : SORTS.filter(s => s.key !== "desvio");
  const sorted = useMemo(() => {
    const share = (r: StateResult) => r.lula + r.flavio > 0 ? (r.lula - r.flavio) / (r.lula + r.flavio) : 0;
    const prog = (r: StateResult) => r.electorsTotal ? r.electorsDone / r.electorsTotal : 0;
    const key: Record<SortKey, (r: StateResult) => number> = { apuracao: prog, desvio: r => Math.abs(byUf.get(r.uf)?.diag.z ?? 0), peso: r => r.valid / Math.max(prog(r), 0.001), margem: r => Math.abs(share(r)) };
    // estados sem votos ainda ficam no fim, qualquer que seja a ordenação
    return [...rows].sort((a, b) => Number(b.valid > 0) - Number(a.valid > 0) || key[sort](b) - key[sort](a));
  }, [rows, sort, byUf]);

  return <Card><CardHeader className="pb-3"><CardTitle>Distribuição por estado</CardTitle><CardDescription>Participação entre os dois candidatos nos votos apurados, com apuração e alerta de desvio por UF. Os 28 estados aparecem; os que ainda não têm votos ficam no fim.</CardDescription>
    <div className="mt-2 flex flex-wrap gap-2" role="tablist" aria-label="Ordenar estados">{keys.map(s => <button key={s.key} role="tab" aria-selected={sort === s.key} onClick={() => setSort(s.key)} className={`min-h-10 rounded-full border px-3.5 text-sm ${sort === s.key ? "border-zinc-200 bg-zinc-100 text-zinc-950" : "border-zinc-700 text-zinc-300 active:bg-zinc-900"}`}>{s.label}</button>)}</div></CardHeader>
    <CardContent>
      {/* celular e tablet: cartões */}
      <ul className="space-y-2 md:hidden">{sorted.map(r => {
        const two = r.lula + r.flavio, pl = two ? r.lula / two * 100 : 50, prog = r.electorsTotal ? r.electorsDone / r.electorsTotal * 100 : 0, a = byUf.get(r.uf), isOpen = open === r.uf, counted = r.valid > 0;
        const flagged = a && (a.level === "forte" || a.level === "atencao");
        return <li key={r.uf} className={`rounded-lg border bg-black/20 ${flagged ? "border-amber-700/60" : "border-zinc-800"}`}>
          <button onClick={() => setOpen(isOpen ? null : r.uf)} aria-expanded={isOpen} className="block w-full p-3 text-left">
            <div className="flex items-center gap-2.5"><UfChip uf={r.uf}/><span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{UF_NAMES[r.uf]}</span>
              {a && a.level !== "normal" && <span className={`rounded-full border px-2 py-0.5 text-[11px] ${LEVEL_STYLE[a.level].cls}`}>{a.level === "observando" ? "Obs." : LEVEL_STYLE[a.level].label}</span>}
              {counted ? <span className={`tabular text-sm font-semibold ${pl >= 50 ? "text-rose-300" : "text-sky-300"}`}>{pl >= 50 ? "Lula" : "Flávio"} +{num(Math.abs(pl - 50) * 2, 1)} pp</span> : <span className="text-xs text-zinc-500">aguardando votos</span>}</div>
            {counted && <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-zinc-800"><div className="bg-rose-400" style={{ width: `${pl}%` }}/><div className="flex-1 bg-sky-400"/></div>}
            <div className="tabular mt-1 flex justify-between text-xs"><span className="text-rose-300">{counted && `Lula ${num(pl, 1)}%`}</span><span className="text-zinc-500">{pct(prog, 0)} apurado</span><span className="text-sky-300">{counted && `${num(100 - pl, 1)}% Flávio`}</span></div>
          </button>
          {isOpen && <div className="tabular space-y-1 border-t border-zinc-800 px-3 py-2.5 text-xs text-zinc-400">
            <Progress value={prog} className="mb-2 h-1.5"/>
            <div className="flex justify-between"><span>Eleitorado apurado</span><span className="text-zinc-200">{fmt.format(r.electorsDone)} / {fmt.format(r.electorsTotal)}</span></div>
            <div className="flex justify-between"><span>Votos válidos</span><span className="text-zinc-200">{fmt.format(r.valid)}</span></div>
            <div className="flex justify-between"><span>Lula · Flávio</span><span className="text-zinc-200">{fmt.format(r.lula)} · {fmt.format(r.flavio)}</span></div>
            {a && <div className="flex justify-between"><span>Esperado · UF aponta (Lula)</span><span className="text-zinc-200">{num(a.diag.expected, 1)}% · {num(a.diag.observed, 1)}% (z {sign(a.diag.z, 1)})</span></div>}
          </div>}
        </li>;
      })}</ul>
      {/* desktop: tabela */}
      <div className="hidden overflow-x-auto md:block"><table className="tabular w-full text-left text-sm"><thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500"><tr><th className="pb-3 font-medium">UF</th><th className="pb-3 pr-4 font-medium">Apuração</th><th className="pb-3 pr-4 text-right font-medium">Lula</th><th className="pb-3 pr-4 text-right font-medium">Flávio</th><th className="pb-3 pr-4 text-right font-medium">Margem</th>{alerts.length > 0 && <><th className="pb-3 pr-4 text-right font-medium">Esperado</th><th className="pb-3 pr-4 text-right font-medium">Desvio</th><th className="pb-3 font-medium">Alerta</th></>}<th className="pb-3 pl-4 text-right font-medium">Válidos</th></tr></thead>
        <tbody className="divide-y divide-zinc-900">{sorted.map(r => {
          const two = r.lula + r.flavio, pl = two ? r.lula / two * 100 : 50, prog = r.electorsTotal ? r.electorsDone / r.electorsTotal * 100 : 0, a = byUf.get(r.uf), counted = r.valid > 0;
          return <tr key={r.uf} className="hover:bg-zinc-900/50"><td className="py-2.5"><span className="flex items-center gap-2"><UfChip uf={r.uf}/><span className="text-zinc-300">{UF_NAMES[r.uf]}</span></span></td>
            <td className="w-40 py-2.5 pr-4"><div className="flex items-center gap-2"><Progress value={prog} className="h-1.5"/><span className="w-10 text-right text-xs text-zinc-500">{prog.toFixed(0)}%</span></div></td>
            <td className="py-2.5 pr-4 text-right text-rose-300">{counted ? pct(r.lula / r.valid * 100) : "—"}</td><td className="py-2.5 pr-4 text-right text-sky-300">{counted ? pct(r.flavio / r.valid * 100) : "—"}</td>
            <td className={`py-2.5 pr-4 text-right ${pl >= 50 ? "text-rose-300" : "text-sky-300"}`}>{counted ? `${sign((pl - 50) * 2)} pp` : "—"}</td>
            {alerts.length > 0 && <><td className="py-2.5 pr-4 text-right text-zinc-400">{a ? `${num(a.diag.expected, 1)}%` : "—"}</td><td className="py-2.5 pr-4 text-right text-zinc-300">{a ? `${sign(a.diag.dev, 1)} pp (z ${sign(a.diag.z, 1)})` : "—"}</td><td className="py-2.5">{a && a.level !== "normal" && <span className={`rounded-full border px-2 py-0.5 text-[11px] ${LEVEL_STYLE[a.level].cls}`}>{LEVEL_STYLE[a.level].label}</span>}</td></>}
            <td className="py-2.5 pl-4 text-right text-zinc-400">{fmt.format(r.valid)}</td></tr>;
        })}</tbody></table></div>
      <a className="mt-4 inline-block text-xs text-zinc-500 underline-offset-2 hover:text-zinc-200 hover:underline" href={`https://resultados.tse.jus.br/oficial/ele2026/${election}/dados/br/br-c0001-e${election.padStart(6, "0")}-u.json`} target="_blank" rel="noreferrer">Ver o JSON nacional do TSE</a>
    </CardContent></Card>;
}
