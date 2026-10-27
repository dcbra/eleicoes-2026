import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, RotateCw } from "lucide-react";
import { fmt, num, pct, sign } from "./format";
import params from "./parametros.json";
import { PathChart, TrajectoryChart, buildPathView, extrapolationError, type SeriesPoint } from "./insights";
import type { Projection } from "./model";
import type { StateResult } from "./tse";
import type { UfAlert } from "./ufpanels";

// Modo TV: página única em um canvas fixo de 1920x1080 que se ajusta a qualquer tela (TV, iPhone espelhado, monitor).
const W = 1920, H = 1080;
const LULA = "251,113,133", FLAVIO = "56,189,248";

// contentH: altura real do conteúdo; a escala garante que ele sempre caiba inteiro, mesmo que cresça além de 1080.
function useFit(contentH: number) {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => { const f = () => setSize({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  const scale = Math.min(size.w / W, size.h / contentH);
  return { scale, left: (size.w - W * scale) / 2, top: (size.h - contentH * scale) / 2, portrait: size.h > size.w };
}

// Mantém a tela acesa enquanto o Modo TV está aberto (o iPhone espelhado apaga a tela se não houver toque).
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null, closed = false;
    const request = async () => { try { lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* opcional */ } };
    void request();
    const onVisible = () => { if (!closed && document.visibilityState === "visible") void request(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { closed = true; document.removeEventListener("visibilitychange", onVisible); void lock?.release(); };
  }, []);
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(id); }, []);
  return now;
}

// Horário do arquivo do TSE ("dd/mm/aaaa hh:mm:ss", hora de Brasília) em ms.
export function tseTime(updated: string) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(updated);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 3, +m[5], +m[6]) : Number.NaN;
}
// Arquivo de UF com votos parado bem atrás do arquivo mais novo do TSE.
const STALE_MS = 5 * 60_000;
export function staleStates(rows: StateResult[]) {
  const newest = Math.max(...rows.map(r => tseTime(r.updated)).filter(Number.isFinite));
  return rows.filter(r => r.valid > 0 && newest - tseTime(r.updated) > STALE_MS);
}

function tileStyle(r: StateResult | undefined) {
  const two = r ? r.lula + r.flavio : 0;
  if (!r || two <= 0) return { bg: "rgba(39,39,42,0.7)", text: "#71717a", sub: "sem votos", urnas: "", prog: 0, has: false };
  const m = (r.lula - r.flavio) / two * 100, k = Math.min(1, Math.abs(m) / 40), prog = r.sectionsTotal ? r.sectionsDone / r.sectionsTotal : 0;
  const rgb = m >= 0 ? LULA : FLAVIO;
  return { bg: `rgba(${rgb},${0.22 + 0.68 * k})`, text: "#fafafa", sub: `${m >= 0 ? "L" : "F"}+${Math.abs(m).toFixed(0)}`, urnas: `${prog < 0.01 ? num(prog * 100, 2) : prog < 0.1 ? num(prog * 100, 1) : (prog * 100).toFixed(0)}%`, prog, has: true };
}

// Variação da parte de Flávio entre os dois candidatos em relação ao 1º turno (pp); null sem votos.
const FIRST = params.primeiro_turno as Record<string, { lula: number; flavio: number; valid: number }>;
const FIRST_TOTAL = Object.values(FIRST).reduce((s, x) => ({ lula: s.lula + x.lula, flavio: s.flavio + x.flavio }), { lula: 0, flavio: 0 });
const mi = (x: number, signed = false) => `${signed ? sign(x / 1e6) : num(x / 1e6)} mi`;
// Variação da parte de Flávio entre os dois candidatos em relação ao 1º turno (pp) num conjunto de UFs (null = Brasil); null sem votos.
export function flavioShift(ufs: string[] | null, lula: number, flavio: number) {
  const base = (ufs ?? Object.keys(FIRST)).map(u => FIRST[u.toUpperCase()]).filter(Boolean);
  const b = base.reduce((s, x) => ({ lula: s.lula + x.lula, flavio: s.flavio + x.flavio }), { lula: 0, flavio: 0 });
  if (b.lula + b.flavio <= 0 || lula + flavio <= 0) return null;
  return (flavio / (lula + flavio) - b.flavio / (b.lula + b.flavio)) * 100;
}
const shiftText = (d: number | null) => d === null ? "—" : `${d >= 0 ? "▲" : "▼"}${num(Math.abs(d), 1)}`;
const shiftColor = (d: number | null) => d === null ? "text-zinc-600" : d >= 0 ? "text-sky-300" : "text-rose-300";

// Regiões em duas colunas de tamanho parecido; dentro de cada região, do maior eleitorado ao menor.
const REGION_COLUMNS: [string, string[]][][] = [
  [["Nordeste", ["al", "ba", "ce", "ma", "pb", "pe", "pi", "rn", "se"]], ["Sudeste", ["es", "mg", "rj", "sp"]], ["Exterior", ["zz"]]],
  [["Norte", ["ac", "am", "ap", "pa", "ro", "rr", "to"]], ["Centro-Oeste", ["df", "go", "ms", "mt"]], ["Sul", ["pr", "rs", "sc"]]],
];

// Os 28 estados agrupados por região: margem, Flávio vs 1º turno e % de urnas apuradas; o cabeçalho soma a região.
function StateTable({ rows, alerts }: { rows: StateResult[]; alerts: UfAlert[] }) {
  const alertOf = new Map(alerts.map(a => [a.diag.uf, a.level]));
  const stale = new Set(staleStates(rows).map(r => r.uf));
  const byUf = new Map(rows.map(r => [r.uf, r]));
  const row = (r: StateResult) => {
    const st = tileStyle(r), level = alertOf.get(r.uf), d = flavioShift([r.uf], r.lula, r.flavio);
    const ring = level === "forte" || level === "atencao" ? "0 0 0 3px #f59e0b" : "none";
    return <div key={r.uf} className="tabular flex h-[30px] items-center gap-1.5">
      <span className="flex h-[30px] w-[50px] shrink-0 items-center justify-center rounded-lg text-[18px] font-bold uppercase" style={{ background: st.bg, color: st.text, boxShadow: ring }}>{r.uf === "zz" ? "EXT" : r.uf}</span>
      <span className={`w-[54px] shrink-0 text-[20px] font-semibold ${!st.has ? "text-zinc-600" : st.sub.startsWith("L") ? "text-rose-300" : "text-sky-300"}`}>{st.has ? st.sub : "—"}</span>
      <span className={`min-w-0 flex-1 whitespace-nowrap text-center text-[20px] font-semibold ${shiftColor(d)}`}>{shiftText(d)}</span>
      <span className={`w-[60px] shrink-0 text-right text-[18px] ${st.has ? "text-zinc-300" : "text-zinc-600"}`}>{st.has ? st.urnas : "0%"}</span>
      <i className={`h-3 w-3 shrink-0 rounded-full ${stale.has(r.uf) ? "bg-amber-400" : "bg-transparent"}`}/>
    </div>;
  };
  const group = ([name, ufs]: [string, string[]]) => {
    const members = ufs.map(u => byUf.get(u)).filter((r): r is StateResult => !!r).sort((a, b) => b.electorsTotal - a.electorsTotal);
    const sum = members.reduce((s, r) => ({ lula: s.lula + r.lula, flavio: s.flavio + r.flavio, done: s.done + r.sectionsDone, total: s.total + r.sectionsTotal }), { lula: 0, flavio: 0, done: 0, total: 0 });
    const two = sum.lula + sum.flavio, m = two ? (sum.lula - sum.flavio) / two * 100 : null, d = flavioShift(ufs, sum.lula, sum.flavio);
    return <div key={name} className="space-y-[5px]">
      {members.length > 1 && <div className="tabular flex items-baseline gap-2 border-b border-zinc-800 pb-1 text-[17px]">
        <span className="font-semibold text-zinc-200">{name}</span>
        {m !== null && <span className={`font-semibold ${m >= 0 ? "text-rose-300" : "text-sky-300"}`}>{m >= 0 ? "L" : "F"}+{Math.abs(m).toFixed(0)}</span>}
        <span className={`font-semibold ${shiftColor(d)}`}>{shiftText(d)}</span>
        <span className="ml-auto text-zinc-500">{sum.total ? `${(sum.done / sum.total * 100).toFixed(0)}%` : ""}</span>
      </div>}
      {members.map(row)}
    </div>;
  };
  return <div className="grid grid-cols-2 gap-x-6">{REGION_COLUMNS.map((col, i) => <div key={i} className="space-y-3">{col.map(group)}</div>)}</div>;
}

function RangeBar({ margin, lo, hi }: { margin: number; lo: number; hi: number }) {
  const lim = Math.min(15, Math.max(4, Math.ceil(Math.max(Math.abs(lo), Math.abs(hi), Math.abs(margin)) / 2) * 2));
  const at = (x: number) => Math.min(100, Math.max(0, (x + lim) / (2 * lim) * 100));
  return <div><div className="relative h-8 rounded-full bg-zinc-800">
    <div className="absolute inset-y-0 left-0 w-1/2 rounded-l-full bg-sky-500/20"/><div className="absolute inset-y-0 right-0 w-1/2 rounded-r-full bg-rose-400/20"/>
    <div className="absolute inset-y-0 rounded-full bg-zinc-300/50" style={{ left: `${at(lo)}%`, width: `${Math.max(1, at(hi) - at(lo))}%` }}/>
    <div className="absolute -inset-y-2 left-1/2 w-[3px] bg-zinc-200/80"/>
    <div className="absolute top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-zinc-950 bg-zinc-50" style={{ left: `${at(margin)}%` }}/>
  </div><div className="mt-3 flex justify-between text-[22px] text-zinc-500"><span>← Flávio à frente</span><span>Lula à frente →</span></div></div>;
}

export type TvProps = {
  series: SeriesPoint[]; projection: Projection | null; alerts: UfAlert[]; rows: StateResult[]; national: StateResult | null;
  coverage: number; sourceStamp: string | null; stale: boolean; error: string; election: string;
  legacy: { lulaPct: number; flavioPct: number };
};

export function TvView({ series, projection, alerts, rows, national, coverage, sourceStamp, stale, error, election, legacy }: TvProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState(H);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => setContentH(Math.max(H, el.scrollHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fit = useFit(contentH), now = useClock();
  useWakeLock();
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === "Escape") window.location.hash = "#resumo"; }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, []);
  const last = series[series.length - 1];
  const view = useMemo(() => projection && series.length ? buildPathView("pct", series, projection) : null, [series, projection]);
  const p = projection?.probLula ?? 0.5;
  const verdict = !projection ? { text: "Estimativa do 1º turno", color: "text-zinc-200" } : p >= 0.95 ? { text: "Lula tende a vencer", color: "text-rose-300" } : p <= 0.05 ? { text: "Flávio tende a vencer", color: "text-sky-300" } : { text: "Resultado em aberto", color: "text-amber-300" };
  const lulaPct = projection?.lulaPct ?? legacy.lulaPct, flavioPct = projection?.flavioPct ?? legacy.flavioPct;
  const half = projection ? 1.96 * projection.sdMargin / 2 : 0;
  // Apurado agora: o total nacional oficial (o mesmo das transmissões); a soma das UFs só se o arquivo br faltar.
  const tally = national && national.valid > 0 ? national : rows.reduce((s, r) => ({ lula: s.lula + r.lula, flavio: s.flavio + r.flavio, valid: s.valid + r.valid }), { lula: 0, flavio: 0, valid: 0 });
  const countedPct = (votes: number) => tally.valid ? votes / tally.valid * 100 : 0;
  const marginNow = tally.lula + tally.flavio > 0 ? (tally.lula - tally.flavio) / (tally.lula + tally.flavio) * 100 : 0;
  // Urnas apuradas: o número das transmissões (arquivo br); sem ele, a soma das UFs.
  const sections = national && national.sectionsTotal > 0 ? national : rows.reduce((s, r) => ({ sectionsDone: s.sectionsDone + r.sectionsDone, sectionsTotal: s.sectionsTotal + r.sectionsTotal }), { sectionsDone: 0, sectionsTotal: 0 });
  const urnasPct = sections.sectionsTotal ? sections.sectionsDone / sections.sectionsTotal * 100 : coverage;
  const withVotes = rows.filter(r => r.valid > 0), noVotes = rows.filter(r => r.valid <= 0), late = staleStates(rows);
  const hhmm = (r: StateResult) => r.updated.slice(11, 16);
  // Votos finais dos dois somados: cada estado com votos estendido ao seu eleitorado; sem votos, os válidos do 1º turno.
  const projectedTwo = rows.reduce((s, r) => { const c = r.electorsTotal ? r.electorsDone / r.electorsTotal : 0, b = FIRST[r.uf.toUpperCase()]; return s + (r.lula + r.flavio > 0 && c >= 0.002 ? (r.lula + r.flavio) / c : b?.valid ?? 0); }, 0);
  // O gráfico de evolução começa quando já há voto suficiente para a projeção dizer algo (antes disso o eixo fica vazio).
  const trajectory = useMemo(() => { const from = series.findIndex(p => p.c >= 0.003); return from < 0 ? series : series.slice(from); }, [series]);
  const waiting = !last || last.c < 0.002;
  const phase = last ? params.erro_simulado.find(f => last.c >= f.de && last.c < (f.ate >= 1 ? 1.01 : f.ate)) : undefined;
  const flagged = alerts.filter(a => a.level === "forte" || a.level === "atencao");
  const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);

  return <div className="fixed inset-0 overflow-hidden bg-zinc-950 text-zinc-50" style={{ cursor: "none" }}>
    <div ref={canvasRef} className="absolute origin-top-left" style={{ width: W, minHeight: H, left: fit.left, top: fit.top, transform: `scale(${fit.scale})`, background: "radial-gradient(ellipse at 50% -20%, rgba(36,40,48,.8), transparent 60%), #09090b" }}>
      {/* barra superior */}
      <div className="flex h-[104px] items-center gap-8 border-b border-zinc-800 px-12">
        <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-zinc-100 text-zinc-950"><Activity size={32}/></span>
        <div><div className="text-[38px] font-semibold leading-none tracking-tight">Apuração 2026 <span className="text-zinc-500">· {projection ? "2º turno" : "1º turno"}</span></div>
          <div className={`mt-1 flex items-center gap-2 text-[22px] ${error || stale ? "text-amber-300" : "text-emerald-300"}`}><span className={`h-3 w-3 rounded-full ${error || stale ? "bg-amber-400" : "animate-pulse bg-emerald-400"}`}/>{error ? "erro de conexão" : stale ? "TSE sem novidades" : "ao vivo"} · TSE {sourceStamp ?? "—"} · código {election}</div></div>
        <div className="ml-auto flex items-center gap-8">
          <div className="tabular text-right text-[22px] leading-tight text-zinc-400"><div><span className="text-[34px] font-semibold text-zinc-100">{withVotes.length}</span>/{rows.length || 28} estados</div><div>com votos</div></div>
          <div className="w-[560px]"><div className="mb-1 flex items-end justify-between"><span className="text-[22px] text-zinc-400">Urnas apuradas <span className="text-zinc-600">· eleitorado {pct(coverage, 1)}</span></span><span className="tabular text-[52px] font-semibold leading-none">{pct(urnasPct)}</span></div>
            <div className="h-5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-zinc-100 transition-all duration-700" style={{ width: `${Math.min(100, urnasPct)}%` }}/></div></div>
          <div className="tabular text-[62px] font-semibold leading-none text-zinc-200">{clock}</div>
        </div>
      </div>

      <div className="flex items-start gap-8 px-12 pb-8 pt-8" style={{ minHeight: H - 104 }}>
        {/* coluna esquerda: resultado */}
        <div className="flex w-[500px] shrink-0 flex-col gap-6">
          <div className="rounded-3xl border border-zinc-700 bg-zinc-900/70 px-6 py-5">
            <div className="text-[22px] text-zinc-400">{waiting ? "Estimativa a priori (sem votos ainda)" : projection ? "Margem final esperada · Lula − Flávio" : "Estimativa de votos válidos"}</div>
            <div className={`mt-1 whitespace-nowrap text-[38px] font-semibold leading-tight ${verdict.color}`}>{verdict.text}</div>
            {projection ? <>
              <div className="mt-2 flex items-baseline gap-3"><span className={`tabular text-[88px] font-semibold leading-none tracking-tight ${projection.marginPp >= 0 ? "text-rose-300" : "text-sky-300"}`}>{sign(projection.marginPp)}</span><span className="text-[44px] text-zinc-500">pp</span></div>
              <div className="tabular mt-2 text-[26px] text-zinc-400">faixa de 95%: {sign(projection.ci95[0])} a {sign(projection.ci95[1])} pp</div>
              <div className="tabular text-[19px] text-zinc-500">{phase ? `erro típico ±${num(phase.rmse_semderiva_0, 1)} pp · ` : ""}oscilação {sign(projection.swingPp, 1)} pp</div>
              <div className="tabular mt-2 flex items-baseline justify-between rounded-2xl bg-black/30 px-4 py-2 text-[24px] text-zinc-400"><span>Margem apurada agora</span><span className={`text-[34px] font-semibold ${marginNow >= 0 ? "text-rose-300" : "text-sky-300"}`}>{sign(marginNow)} pp</span></div>
              <div className="mt-4"><RangeBar margin={projection.marginPp} lo={projection.ci95[0]} hi={projection.ci95[1]}/></div>
              <div className="mt-3 flex items-baseline justify-between"><span className="text-[26px] text-zinc-400">Chance de Lula</span><span className="tabular text-[56px] font-semibold leading-none">{projection.probLula > 0.999 ? ">99,9%" : projection.probLula < 0.001 ? "<0,1%" : pct(projection.probLula * 100, 1)}</span></div>
            </> : <div className="mt-6 text-[26px] text-zinc-400">O modelo calibrado com margem de erro e curva projetada fica disponível no 2º turno (código 6258).</div>}
          </div>
          <div className="grid grid-cols-2 gap-5">
            {([["Lula", "bg-rose-400", "text-rose-300", lulaPct, tally.lula, FIRST_TOTAL.lula], ["Flávio", "bg-sky-400", "text-sky-300", flavioPct, tally.flavio, FIRST_TOTAL.flavio]] as const).map(([name, dot, text, share, votes, first]) => <div key={name} className="rounded-3xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
              <div className="flex items-center gap-2 text-[26px] text-zinc-300"><i className={`h-4 w-4 rounded-full ${dot}`}/>{name}</div>
              <div className="mt-1 text-[18px] uppercase tracking-wide text-zinc-500">apurado agora</div>
              <div className={`tabular text-[54px] font-semibold leading-none ${text}`}>{pct(countedPct(votes))}</div>
              <div className="tabular mt-1 text-[19px] text-zinc-500">{fmt.format(votes)} votos</div>
              <div className="tabular text-[17px] text-zinc-500"><span className="text-zinc-300">{mi(votes - first, true)}</span> vs 1º turno</div>
              <div className="mt-2 border-t border-zinc-800 pt-2 text-[18px] uppercase tracking-wide text-zinc-500">{projection ? "final projetado" : "estimativa final"}</div>
              <div className="tabular flex items-baseline gap-2"><span className="text-[30px] font-semibold leading-tight text-zinc-200">{pct(share, 1)}</span>{projection && <span className="text-[17px] text-zinc-500">{num(share - half, 1)}–{num(share + half, 1)}%</span>}</div>
              {projection && <div className="tabular text-[17px] leading-snug text-zinc-500">≈ {mi(share / 100 * projectedTwo)} votos<br/><span className="text-zinc-300">{mi(share / 100 * projectedTwo - first, true)}</span> vs 1º turno</div>}
            </div>)}
          </div>
        </div>

        {/* coluna do meio: curvas */}
        <div className="flex w-[660px] shrink-0 flex-col gap-6">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-6">
            <div className="flex items-baseline justify-between"><div className="text-[30px] font-semibold">Curva da apuração</div><div className="flex gap-6 text-[22px] text-zinc-400"><span><i className="mr-2 inline-block h-1 w-8 bg-rose-400 align-middle"/>Lula</span><span><i className="mr-2 inline-block h-1 w-8 bg-sky-400 align-middle"/>Flávio</span></div></div>
            <div className="text-[20px] text-zinc-500">contínua = apurado · tracejada = projeção · sombra = 95%</div>
            <div className="mt-2">{view ? <PathChart view={view} axis="pct" scale={1.9} height={230}/> : <div className="flex h-[180px] items-center justify-center text-center text-[28px] text-zinc-500">A curva aparece a partir de<br/>5% do eleitorado apurado (agora {pct(coverage, 1)})</div>}</div>
          </div>
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-6">
            <div className="text-[30px] font-semibold">Como a projeção da margem evoluiu</div>
            <div className="whitespace-nowrap text-[18px] text-zinc-500">branca = modelo · laranja = com curva do 1º turno · verde = extrapolação</div>
            <div className="mt-2">{series.length ? <TrajectoryChart series={trajectory} scale={1.9} height={210} compact/> : null}</div>
          </div>
          {projection && last?.extrap && (() => {
            const ex = last.extrap, err = extrapolationError(last.c);
            return <div className="rounded-3xl border border-emerald-900/80 bg-emerald-950/25 px-6 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 text-[26px] font-semibold text-emerald-300">Extrapolação por estado</div>
                <span className={`tabular shrink-0 whitespace-nowrap text-[48px] font-semibold leading-none ${ex.marginPp >= 0 ? "text-rose-300" : "text-sky-300"}`}>{sign(ex.marginPp)}<span className="text-[24px] text-zinc-500"> pp</span></span>
              </div>
              <div className="tabular mt-2 flex items-baseline gap-6 whitespace-nowrap text-[28px] font-semibold"><span className="text-rose-300">Lula {pct(ex.lulaPct, 1)}</span><span className="text-sky-300">Flávio {pct(ex.flavioPct, 1)}</span></div>
              <div className="tabular text-[18px] text-zinc-500">{ex.states} estados com votos · {err ? `erro típico nesta fase ±${num(err[0], 1)} a ±${num(err[1], 1)} pp` : "erro ainda sem calibragem (<3%)"}</div>
            </div>;
          })()}
        </div>

        {/* coluna direita: estados */}
        <div className="flex w-[600px] shrink-0 flex-col gap-6">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-6">
            <div className="flex items-baseline justify-between"><div className="text-[30px] font-semibold">Estados</div><div className="text-[18px] text-zinc-500">margem · Flávio vs 1º turno · urnas</div></div>
            <div className="mt-4"><StateTable rows={rows} alerts={alerts}/></div>
            <div className="mt-4 flex items-center gap-6 text-[18px] text-zinc-400"><span className="flex items-center gap-2"><i className="inline-block h-4 w-10 rounded" style={{ background: `linear-gradient(90deg, rgba(${FLAVIO},.9), rgba(39,39,42,.6), rgba(${LULA},.9))` }}/>F ← cor → L</span><span className="flex items-center gap-2"><i className="inline-block h-4 w-4 rounded" style={{ boxShadow: "0 0 0 3px #f59e0b" }}/>fora do esperado</span><span className="flex items-center gap-2"><i className="inline-block h-3 w-3 rounded-full bg-amber-400"/>TSE atrasado</span></div>
            <div className="tabular mt-2 space-y-1 text-[20px] leading-snug">
              {(() => { const d = flavioShift(null, tally.lula, tally.flavio); return <div className="whitespace-nowrap text-zinc-400">Brasil, Flávio vs 1º turno: <span className={`font-semibold ${shiftColor(d)}`}>{shiftText(d)} pp</span> <span className="text-[17px] text-zinc-500">· <span className="text-sky-300">▲</span> ganhou <span className="text-rose-300">▼</span> perdeu</span></div>; })()}
              {projection && <div className={flagged.length ? "text-amber-300" : "text-emerald-300"}>{flagged.length ? `Fora do esperado: ${flagged.slice(0, 3).map(x => `${x.diag.uf === "zz" ? "EXT" : x.diag.uf.toUpperCase()} ${sign(x.diag.dev, 1)} pp`).join(", ")}` : "Nenhuma UF fora do esperado"}</div>}
              {noVotes.length > 0 && <div className="text-zinc-400">Sem votos ainda: <span className="uppercase text-zinc-200">{noVotes.map(r => r.uf).join(" ")}</span></div>}
              {late.length > 0 && <div className="text-amber-300">TSE sem atualizar: {late.map(r => `${r.uf.toUpperCase()} (${hhmm(r)})`).join(", ")}</div>}
              {noVotes.length === 0 && late.length === 0 && <div className="text-emerald-300">Todos os estados com votos e em dia</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
    {fit.portrait && <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-zinc-950/95 text-center text-xl text-zinc-200"><RotateCw size={48}/>Gire o aparelho para deitar a tela<span className="text-sm text-zinc-500">O Modo TV usa a tela inteira em formato paisagem.</span></div>}
  </div>;
}
