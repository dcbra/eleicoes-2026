import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from "./components";
import { brt, chance, num, pct, sign } from "./format";
import { extrapolate, project, type Extrapolation, type Projection, type UfInput } from "./model";
import type { StateResult } from "./tse";
import params from "./parametros.json";

export type Snapshot = { t: string; rows: StateResult[] };
// Projeção principal sem a deriva do 1º turno (a apuração do 2º turno não seguiu a mesma ordem); a versão com deriva fica como alternativa.
export const MAIN_DRIFT = 0;
export type SeriesPoint = { ms: number; c: number; proj: Projection; withDrift: Projection; extrap: Extrapolation | null; raw: number | null; curve: number | null };

// Erro típico simulado da extrapolação simples por estado nesta fase: [sem deriva no 2º turno, se a deriva do 1º turno se repetir].
export function extrapolationError(c: number): [number, number] | null {
  const f = params.erro_simulado.find(x => c >= x.de && c < (x.ate >= 1 ? 1.01 : x.ate));
  return f ? [f.rmse_app_0, f.rmse_app_100] : null;
}

const curve1 = [...params.curva_1turno_margem_duas].sort((a, b) => a[0] - b[0]);
const FINAL_1 = curve1[curve1.length - 1][1];

function interp(nodes: number[][], x: number) {
  if (x <= nodes[0][0]) return nodes[0][1];
  for (let i = 0; i < nodes.length - 1; i++) {
    const [x0, y0] = nodes[i], [x1, y1] = nodes[i + 1];
    if (x <= x1) return x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1;
  }
  return nodes[nodes.length - 1][1];
}

// Margem Lula − Flávio entre os dois (pp) do 1º turno no mesmo grau de apuração e o valor final.
export function curveReference(c: number) { return { atual: interp(curve1, c), final: FINAL_1 }; }

export function buildSeries(snapshots: Snapshot[]): SeriesPoint[] {
  return snapshots.map(({ t, rows }) => {
    const inputs = rows.map<UfInput>(r => ({ uf: r.uf, valid: r.valid, lula: r.lula, flavio: r.flavio, electorsDone: r.electorsDone, electorsTotal: r.electorsTotal }));
    const done = rows.reduce((a, r) => a + r.electorsDone, 0), total = rows.reduce((a, r) => a + r.electorsTotal, 0);
    const lula = rows.reduce((a, r) => a + r.lula, 0), flavio = rows.reduce((a, r) => a + r.flavio, 0);
    const c = total ? done / total : 0;
    const raw = lula + flavio > 0 ? (lula - flavio) / (lula + flavio) * 100 : null;
    const ref = curveReference(c);
    return { ms: new Date(t).getTime(), c, proj: project(inputs, { driftScale: MAIN_DRIFT }), withDrift: project(inputs, { driftScale: 1 }), extrap: extrapolate(inputs), raw, curve: raw === null || c < 0.02 ? null : raw + (ref.final - ref.atual) };
  });
}

// ---- gráfico responsivo: usa a largura real do contêiner para manter o texto legível no celular ----
type Line = { points: [number, number][]; color: string; dash?: string; width?: number; dots?: boolean };
type Band = { points: [number, number, number][]; color: string };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(240, Math.floor(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function LineChart({ lines, band, bands, vlines, xDomain, yDomain, xTicks, yTicks, fmtX, fmtY, label, scale, height: heightProp }: {
  lines: Line[]; band?: Band; bands?: Band[]; vlines?: { x: number; label: string }[]; xDomain: [number, number]; yDomain: [number, number]; xTicks: number[]; yTicks: number[]; fmtX: (x: number) => string; fmtY?: (y: number) => string; label: string; scale?: number; height?: number;
}) {
  const [ref, W] = useWidth();
  const k = scale ?? 1, narrow = W < 480 * k, height = heightProp ?? (narrow ? 200 : 230);
  const pad = { l: (narrow ? 30 : 36) * k, r: 14 * k, t: 10 * k, b: 24 * k };
  const sx = (x: number) => pad.l + (x - xDomain[0]) / (xDomain[1] - xDomain[0] || 1) * (W - pad.l - pad.r);
  const clampY = (y: number) => Math.min(yDomain[1], Math.max(yDomain[0], y));
  const sy = (y: number) => pad.t + (yDomain[1] - clampY(y)) / (yDomain[1] - yDomain[0] || 1) * (height - pad.t - pad.b);
  const inX = (x: number) => x >= xDomain[0] && x <= xDomain[1];
  const maxTicks = Math.max(2, Math.floor((W - pad.l - pad.r) / (56 * k)));
  const step = Math.ceil(xTicks.length / maxTicks) || 1;
  const ticks = xTicks.filter((_, i) => i % step === 0);
  return <div ref={ref} className="w-full min-w-0 overflow-hidden">
    <svg width={W} height={height} className="block max-w-full text-zinc-500" role="img" aria-label={label}>
      {yTicks.map(y => <g key={y}><line x1={pad.l} x2={W - pad.r} y1={sy(y)} y2={sy(y)} stroke={y === 0 ? "#a1a1aa" : "#27272a"} strokeWidth={(y === 0 ? 1 : 0.7) * k} strokeDasharray={y === 0 ? "4 3" : undefined}/><text x={pad.l - 5 * k} y={sy(y) + 4 * k} textAnchor="end" fontSize={11 * k} fill="currentColor">{fmtY ? fmtY(y) : `${y > 0 ? "+" : ""}${y}`}</text></g>)}
      {ticks.map(x => <text key={x} x={sx(x)} y={height - 7 * k} textAnchor="middle" fontSize={11 * k} fill="currentColor">{fmtX(x)}</text>)}
      {[...(band ? [band] : []), ...(bands ?? [])].map((b, i) => b.points.length > 1 && <polygon key={i} fill={b.color} points={[...b.points.filter(p => inX(p[0])).map(p => `${sx(p[0])},${sy(p[2])}`), ...[...b.points].reverse().filter(p => inX(p[0])).map(p => `${sx(p[0])},${sy(p[1])}`)].join(" ")}/>)}
      {(vlines ?? []).filter(v => inX(v.x)).map(v => <g key={v.label}><line x1={sx(v.x)} x2={sx(v.x)} y1={pad.t} y2={height - pad.b} stroke="#a1a1aa" strokeWidth={k} strokeDasharray="2 3"/><text x={sx(v.x) + 4 * k} y={pad.t + 9 * k} fontSize={10 * k} fill="#a1a1aa">{v.label}</text></g>)}
      {lines.map((l, i) => {
        const pts = l.points.filter(p => inX(p[0]));
        return <g key={i}>{pts.length > 1 && <polyline fill="none" stroke={l.color} strokeWidth={(l.width ?? 1.8) * k} strokeLinejoin="round" strokeDasharray={l.dash} points={pts.map(p => `${sx(p[0])},${sy(p[1])}`).join(" ")}/>}
          {(l.dots || pts.length === 1) && pts.map((p, j) => <circle key={j} cx={sx(p[0])} cy={sy(p[1])} r={(narrow ? 2.6 : 3) * k} fill={l.color}/>)}</g>;
      })}
    </svg>
  </div>;
}

const LEGEND = [["#e4e4e7", "Projeção do modelo (sem deriva)"], ["#f59e0b", "Com a curva do 1º turno"], ["#34d399", "Extrapolação por estado"], ["#38bdf8", "Se seguir a curva do 1º turno"], ["#71717a", "Margem apurada (bruta)"]];

function chartScale(series: SeriesPoint[]) {
  const valid = series.filter(p => p.c >= 0.02);
  const edges = valid.flatMap(p => [p.proj.ci95[0], p.proj.ci95[1], p.proj.marginPp, p.extrap?.marginPp ?? 0]);
  const refEdges = curve1.filter(p => p[0] >= 0.05).map(p => p[1]);
  const lim = Math.min(15, Math.max(4, Math.ceil(Math.max(0, ...edges.map(Math.abs), ...refEdges.map(Math.abs)) / 2) * 2));
  const stepY = lim > 8 ? 5 : 2, half = Math.floor(lim / stepY);
  return { lim, ySteps: Array.from({ length: half * 2 + 1 }, (_, i) => (i - half) * stepY) };
}

// Barra da faixa de 95% da margem: ponto = esperado, faixa = incerteza, centro = empate.
function RangeBar({ margin, lo, hi }: { margin: number; lo: number; hi: number }) {
  const lim = Math.min(15, Math.max(4, Math.ceil(Math.max(Math.abs(lo), Math.abs(hi), Math.abs(margin)) / 2) * 2));
  const at = (x: number) => Math.min(100, Math.max(0, (x + lim) / (2 * lim) * 100));
  return <div className="mt-4" role="img" aria-label={`Margem esperada ${sign(margin)} pontos, faixa de 95% de ${sign(lo)} a ${sign(hi)}`}>
    <div className="relative h-3 rounded-full bg-zinc-800">
      <div className="absolute inset-y-0 left-0 w-1/2 rounded-l-full bg-sky-500/15"/><div className="absolute inset-y-0 right-0 w-1/2 rounded-r-full bg-rose-400/15"/>
      <div className="absolute inset-y-0 rounded-full bg-zinc-400/50" style={{ left: `${at(lo)}%`, width: `${Math.max(1, at(hi) - at(lo))}%` }}/>
      <div className="absolute -inset-y-1 left-1/2 w-px bg-zinc-300/70"/>
      <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-950 bg-zinc-50" style={{ left: `${at(margin)}%` }}/>
    </div>
    <div className="mt-1.5 flex justify-between text-xs text-zinc-500"><span>← Flávio à frente</span><span>Lula à frente →</span></div>
  </div>;
}

// Segunda previsão, independente da curva do 1º turno: a extrapolação simples de cada estado.
function ExtrapolationBlock({ extrap, c }: { extrap: Extrapolation; c: number }) {
  const err = extrapolationError(c);
  return <div className="mt-4 rounded-lg border border-emerald-900/70 bg-emerald-950/20 p-3">
    <div className="flex items-baseline justify-between gap-2"><span className="text-xs text-emerald-300">Extrapolação por estado · sem curva do 1º turno</span><span className={`tabular text-lg font-semibold ${extrap.marginPp >= 0 ? "text-rose-300" : "text-sky-300"}`}>{sign(extrap.marginPp)} pp</span></div>
    <div className="tabular mt-1 flex justify-between text-sm"><span className="text-rose-300">Lula {pct(extrap.lulaPct)}</span><span className="text-sky-300">Flávio {pct(extrap.flavioPct)}</span></div>
    <div className="tabular mt-1.5 text-xs leading-relaxed text-zinc-500">Cada estado com votos mantém a participação atual e é estendido ao seu eleitorado ({extrap.states} estados; os sem votos ficam de fora). {err ? `Erro típico simulado nesta fase: ±${num(err[0])} pp se o 2º turno não tiver deriva, ±${num(err[1])} pp se repetir a do 1º.` : "Antes de 3% apurado, o erro é alto e não foi calibrado."}</div>
  </div>;
}

export function HeroCard({ series, projection }: { series: SeriesPoint[]; projection: Projection }) {
  const last = series[series.length - 1];
  const phase = params.erro_simulado.find(f => last.c >= f.de && last.c < (f.ate >= 1 ? 1.01 : f.ate));
  const waiting = last.c < 0.002;
  const p = projection.probLula;
  const verdict = p >= 0.95 ? { text: "Lula tende a vencer", color: "text-rose-300" } : p <= 0.05 ? { text: "Flávio tende a vencer", color: "text-sky-300" } : { text: "Resultado em aberto", color: "text-amber-300" };
  const lulaRange = [(100 + projection.ci95[0]) / 2, (100 + projection.ci95[1]) / 2];
  const gap = last.withDrift.marginPp - projection.marginPp;
  return <Card className="border-zinc-700 bg-zinc-900/70"><CardContent className="p-4 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><div className="text-xs text-zinc-400">{waiting ? "Estimativa a priori (ainda sem votos)" : `Com ${num(last.c * 100, 1)}% do eleitorado apurado`}</div><div className={`mt-0.5 text-lg font-semibold ${verdict.color}`}>{verdict.text}</div></div>
      <div className="shrink-0 text-right"><div className="text-xs text-zinc-400">Chance de Lula</div><div className="tabular text-lg font-semibold">{chance(p)}</div></div>
    </div>
    <div className="mt-3 flex items-baseline gap-2"><span className={`tabular text-5xl font-semibold tracking-tight ${projection.marginPp >= 0 ? "text-rose-300" : "text-sky-300"}`}>{sign(projection.marginPp)}</span><span className="text-lg text-zinc-500">pp</span><span className="ml-auto text-xs text-zinc-500">margem final esperada</span></div>
    <div className="tabular text-sm text-zinc-400">faixa de 95%: {sign(projection.ci95[0])} a {sign(projection.ci95[1])} pp</div>
    <RangeBar margin={projection.marginPp} lo={projection.ci95[0]} hi={projection.ci95[1]}/>
    <div className="mt-4 grid grid-cols-2 gap-3">
      <div className="rounded-lg border border-zinc-800 bg-black/20 p-3"><div className="flex items-center gap-1.5 text-xs text-zinc-400"><i className="h-2 w-2 rounded-full bg-rose-400"/>Lula</div><div className="tabular mt-1 text-2xl font-semibold text-rose-300">{pct(projection.lulaPct)}</div><div className="tabular text-xs text-zinc-500">{num(lulaRange[0])}% a {num(lulaRange[1])}%</div></div>
      <div className="rounded-lg border border-zinc-800 bg-black/20 p-3"><div className="flex items-center gap-1.5 text-xs text-zinc-400"><i className="h-2 w-2 rounded-full bg-sky-400"/>Flávio</div><div className="tabular mt-1 text-2xl font-semibold text-sky-300">{pct(projection.flavioPct)}</div><div className="tabular text-xs text-zinc-500">{num(100 - lulaRange[1])}% a {num(100 - lulaRange[0])}%</div></div>
    </div>
    <div className="mt-4"><div className="mb-1.5 flex justify-between text-xs text-zinc-400"><span>Eleitorado apurado</span><span className="tabular">{pct(last.c * 100, 1)}</span></div><Progress value={last.c * 100}/>
      {phase && <div className="tabular mt-1.5 text-xs text-zinc-500">Nesta fase ({Math.round(phase.de * 100)}–{Math.round(phase.ate * 100)}%), o erro típico da margem é de ±{num(phase.rmse_semderiva_0)} pp se o 2º turno não tiver deriva (±{num(phase.rmse_semderiva_100)} pp se repetir toda a do 1º turno).</div>}</div>
    {last.extrap && <ExtrapolationBlock extrap={last.extrap} c={last.c}/>}
    <details className="group mt-4 rounded-lg border border-zinc-800 bg-black/20 text-sm"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-zinc-300"><span>E se o 2º turno repetir a curva do 1º?</span><ChevronDown size={16} className="shrink-0 text-zinc-500 transition-transform group-open:rotate-180"/></summary>
      <p className="tabular border-t border-zinc-800 px-3 py-3 text-xs leading-relaxed text-zinc-400">O modelo não supõe deriva: a participação atual de cada estado vale para o resto da apuração dele, e o 1º turno só serve de ponto de partida para estados com pouco voto. <span className="text-zinc-200">Se o 2º turno repetisse a deriva do 1º</span> (Lula ganhando ~1,3 pp nas partes apuradas depois), a margem esperada seria {sign(last.withDrift.marginPp)} pp (faixa de 95%: {sign(last.withDrift.ci95[0])} a {sign(last.withDrift.ci95[1])}), {sign(gap)} pp de diferença.</p></details>
  </CardContent></Card>;
}

// compact (Modo TV): só modelo, curva do 1º turno e extrapolação, com o eixo vertical ajustado a essas linhas para não achatá-las.
export function TrajectoryChart({ series, scale, height, compact }: { series: SeriesPoint[]; scale?: number; height?: number; compact?: boolean }) {
  const view = useMemo(() => {
    const start = series[0]?.ms ?? Date.now(), end = Math.max(series[series.length - 1]?.ms ?? start, start + 30 * 60_000);
    const minute = 60_000, every = (end - start > 150 * minute ? 60 : end - start > 70 * minute ? 30 : 15) * minute, ticks: number[] = [];
    for (let t = Math.ceil(start / every) * every; t <= end; t += every) ticks.push(t);
    if (!compact) return { start, end, ticks, yDomain: undefined as [number, number] | undefined, ...chartScale(series) };
    const vals = series.filter(p => p.c >= 0.002).flatMap(p => [p.proj.marginPp, p.withDrift.marginPp, p.extrap?.marginPp ?? p.proj.marginPp, 0]);
    const stepY = Math.max(...vals) - Math.min(...vals) > 12 ? 5 : 2;
    const lo = Math.floor((Math.min(...vals) - 1) / stepY) * stepY, hi = Math.ceil((Math.max(...vals) + 1) / stepY) * stepY;
    const ySteps: number[] = []; for (let y = lo; y <= hi; y += stepY) ySteps.push(y);
    return { start, end, ticks, yDomain: [lo, hi] as [number, number], lim: hi, ySteps };
  }, [series, compact]);
  const live = series.filter(p => p.c >= 0.002);
  const lines: Line[] = [
    ...(compact ? [] : [{ color: "#71717a", width: 1.2, points: series.filter(p => p.raw !== null && p.c >= 0.02).map<[number, number]>(p => [p.ms, p.raw!]) },
      { color: "#38bdf8", dash: "5 3", width: 1.5, points: series.filter(p => p.curve !== null).map<[number, number]>(p => [p.ms, p.curve!]) }]),
    { color: "#f59e0b", dash: "2 3", width: compact ? 2 : 1.6, points: live.map<[number, number]>(p => [p.ms, p.withDrift.marginPp]) },
    { color: "#34d399", width: compact ? 2.4 : 1.8, points: live.filter(p => p.extrap).map<[number, number]>(p => [p.ms, p.extrap!.marginPp]) },
    { color: "#e4e4e7", width: compact ? 2.8 : 2.2, dots: true, points: live.map<[number, number]>(p => [p.ms, p.proj.marginPp]) }];
  return <LineChart label="Trajetória da projeção da margem" scale={scale} height={height} xDomain={[view.start, view.end]} yDomain={view.yDomain ?? [-view.lim, view.lim]} xTicks={view.ticks} yTicks={view.ySteps} fmtX={brt}
      band={{ color: "rgba(161,161,170,0.22)", points: live.map(p => [p.ms, p.proj.ci95[0], p.proj.ci95[1]]) }} lines={lines}/>;
}

export function TrajectoryCard({ series, projection }: { series: SeriesPoint[]; projection: Projection }) {
  const last = series[series.length - 1];
  const movement = (minutes: number) => { const past = [...series].reverse().find(p => last.ms - p.ms >= minutes * 60_000); return past ? last.proj.marginPp - past.proj.marginPp : null; };
  const m15 = movement(15), m30 = movement(30);
  const seen = series.filter(p => p.c >= 0.02);
  const covered = seen.length >= 5 ? seen.filter(p => p.proj.ci95[0] <= projection.marginPp && projection.marginPp <= p.proj.ci95[1]).length / seen.length : null;
  return <Card><CardHeader className="pb-2"><CardTitle>Trajetória da projeção</CardTitle><CardDescription>Margem final projetada a cada atualização, com faixa de 95%. Acima de zero, Lula à frente.</CardDescription></CardHeader><CardContent>
    <TrajectoryChart series={series}/>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-400">{LEGEND.map(([color, name]) => <span key={name} className="flex items-center gap-1.5"><i className="h-0.5 w-4 shrink-0" style={{ background: color }}/>{name}</span>)}<span className="flex items-center gap-1.5"><i className="h-2.5 w-4 shrink-0" style={{ background: "rgba(161,161,170,0.35)" }}/>Faixa de 95%</span></div>
    <div className="tabular mt-3 grid grid-cols-3 gap-2 border-t border-zinc-800 pt-3 text-xs text-zinc-400">
      <div>15 min<div className="text-sm text-zinc-200">{m15 === null ? "—" : `${sign(m15)} pp`}</div></div>
      <div>30 min<div className="text-sm text-zinc-200">{m30 === null ? "—" : `${sign(m30)} pp`}</div></div>
      <div>Faixas que contêm a atual<div className="text-sm text-zinc-200">{covered === null ? "—" : `${Math.round(covered * 100)}%`}</div></div>
    </div></CardContent></Card>;
}

export function CurveCard({ series, projection }: { series: SeriesPoint[]; projection: Projection }) {
  const last = series[series.length - 1];
  const { lim, ySteps } = useMemo(() => chartScale(series), [series]);
  const ref = curveReference(last.c);
  const deviation = last.raw !== null ? last.raw - ref.atual : null;
  const raw2 = series.filter(p => p.raw !== null && p.c >= 0.02).map<[number, number]>(p => [p.c * 100, p.raw!]);
  const raw1 = curve1.filter(p => p[0] >= 0.02).map<[number, number]>(p => [p[0] * 100, p[1]]);
  return <Card><CardHeader className="pb-2"><CardTitle>2º turno × curva do 1º turno</CardTitle><CardDescription>Margem apurada (bruta, entre os dois) por grau de apuração. Cinza: 1º turno. Azul: 2º turno.</CardDescription></CardHeader><CardContent>
    <LineChart label="Margem apurada por grau de apuração, 1º e 2º turnos" xDomain={[0, 100]} yDomain={[-lim, lim]} xTicks={[0, 20, 40, 60, 80, 100]} yTicks={ySteps} fmtX={x => `${x}%`}
      lines={[{ color: "#71717a", width: 1.8, points: raw1 }, { color: "#38bdf8", width: 1.8, dots: true, points: raw2 }]}/>
    <div className="tabular mt-3 grid grid-cols-3 gap-2 border-t border-zinc-800 pt-3 text-xs text-zinc-400">
      <div>Desvio da curva<div className="text-sm text-zinc-200">{deviation === null ? "—" : `${sign(deviation)} pp`}</div></div>
      <div>Se seguir a curva<div className="text-sm text-zinc-200">{last.curve === null ? "—" : `${sign(last.curve)} pp`}</div></div>
      <div>Modelo − curva<div className="text-sm text-zinc-200">{last.curve === null ? "—" : `${sign(projection.marginPp - last.curve)} pp`}</div></div>
    </div></CardContent></Card>;
}

type Scenario = "100" | "50" | "0";
const SCENARIOS: { key: Scenario; label: string; text: string }[] = [
  { key: "100", label: "Curva se repete", text: "o 2º turno repete toda a deriva do 1º turno" },
  { key: "50", label: "Em parte", text: "o 2º turno repete cerca de metade da deriva do 1º turno (curva mais ou menos respeitada)" },
  { key: "0", label: "Sem deriva", text: "o 2º turno não tem deriva nenhuma" },
];

export function PhaseCard({ series, projection }: { series: SeriesPoint[]; projection: Projection }) {
  const [scenario, setScenario] = useState<Scenario>("0");
  const last = series[series.length - 1];
  const phase = params.erro_simulado.find(f => last.c >= f.de && last.c < (f.ate >= 1 ? 1.01 : f.ate));
  const get = (f: object, name: string) => (f as Record<string, number | null>)[`${name}_${scenario}`] ?? 0;
  const pp = (x: number) => `±${num(x, x < 0.1 ? 2 : 1)}`;
  return <Card><CardHeader className="pb-2"><CardTitle>Margem de erro por fase da apuração</CardTitle><CardDescription>Erro da margem final Lula − Flávio (pp), simulado com os caminhos reais de erro de cada UF no 1º turno. O modelo não corrige deriva; escolha quanto da curva do 1º turno o 2º turno realmente repete para ver o custo disso.</CardDescription>
    <div className="mt-2 flex flex-wrap gap-2" role="tablist" aria-label="Cenário de deriva">{SCENARIOS.map(s => <button key={s.key} role="tab" aria-selected={scenario === s.key} onClick={() => setScenario(s.key)} className={`min-h-10 rounded-full border px-3.5 text-sm ${scenario === s.key ? "border-zinc-200 bg-zinc-100 text-zinc-950" : "border-zinc-700 text-zinc-300 active:bg-zinc-900"}`}>{s.label}</button>)}</div></CardHeader><CardContent>
    <table className="tabular w-full text-left text-sm"><thead className="border-b border-zinc-800 text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="pb-2 pr-2 font-medium">Apurado</th><th className="pb-2 pr-2 text-right font-medium">Erro<span className="block normal-case tracking-normal text-zinc-600">típico</span></th><th className="pb-2 pr-2 text-right font-medium">Erro<span className="block normal-case tracking-normal text-zinc-600">em 95%</span></th><th className="pb-2 pr-2 text-right font-medium">Faixa<span className="block normal-case tracking-normal text-zinc-600">exibida</span></th><th className="hidden pb-2 pr-2 text-right font-medium sm:table-cell">Método antigo<span className="block normal-case tracking-normal text-zinc-600">erro típico</span></th><th className="pb-2 text-right font-medium">Cobertura</th></tr></thead>
      <tbody className="divide-y divide-zinc-900">{params.erro_simulado.map(f => { const on = phase === f; return <tr key={f.de} className={on ? "bg-zinc-800/60 text-zinc-100" : "text-zinc-400"}>
        <td className="whitespace-nowrap py-2.5 pr-2">{Math.round(f.de * 100)}–{Math.round(f.ate * 100)}%{on && <span className="ml-1.5 text-[11px] text-emerald-300">agora</span>}</td>
        <td className="py-2.5 pr-2 text-right">{pp(get(f, "rmse_semderiva"))}</td><td className="py-2.5 pr-2 text-right">{pp(get(f, "erro95_semderiva"))}</td><td className="py-2.5 pr-2 text-right">{pp(get(f, "faixa_exibida_semderiva"))}</td><td className="hidden py-2.5 pr-2 text-right sm:table-cell">{pp(get(f, "rmse_app"))}</td>
        <td className="py-2.5 text-right">{Math.round(get(f, "cobertura_semderiva") * 100)}%</td></tr>; })}</tbody></table>
    <div className="tabular mt-3 rounded-lg border border-zinc-800 bg-black/20 p-3 text-xs leading-relaxed text-zinc-400">Calculado ao vivo para este instante: faixa de 95% de <span className="text-zinc-100">±{num(1.96 * projection.sdMargin)} pp</span>{phase && <> (a média da mesma conta na simulação, nesta fase, é ±{num(get(phase, "faixa_exibida_semderiva"))} pp)</>}. A chance de vitória e a faixa do resumo usam esta conta ao vivo; esta tabela só mostra como ela se comportou na simulação.</div>
    <p className="mt-3 text-xs leading-relaxed text-zinc-500">Cenário: {SCENARIOS.find(s => s.key === scenario)?.text}. <span className="text-zinc-400">Erro típico</span> é o desvio padrão do erro da margem final; <span className="text-zinc-400">erro em 95%</span> é o erro que só 5% dos casos superam; <span className="text-zinc-400">faixa exibida</span> é a metade da faixa de 95% do modelo. Se o 2º turno repetir a deriva do 1º, o modelo sem deriva erra mais e a cobertura cai (veja "Curva se repete"). <span className="text-zinc-400">Medido no 1º turno:</span> erro por UF, deriva e correlação entre UFs. <span className="text-zinc-400">Suposto, não medido:</span> σ a priori de 3,5 pp até haver 6 UFs bem apuradas, e, na simulação, diferença do 2º turno para o 1º de 2,5 pp (nacional) e 3 pp (por UF). Por isso a validação de verdade é o 2º turno. Agora: {projection.ufsUsed}/{projection.ufsTotal} UFs com dado útil, oscilação vs 1º turno {sign(projection.swingPp)} pp, σ a priori {num(projection.sigmaPrior, 1)} pp ({projection.sigmaPriorLive ? "medido ao vivo" : "valor padrão"}).</p>
  </CardContent></Card>;
}

// ---- curva real da contagem (passado) e projetada (futuro), para Lula e Flávio ----
const pace = params.ritmo_1turno; // [grau de apuração, minutos desde as 17h] no 1º turno
// meia-faixa de 95% da margem que o modelo exibe em cada grau de apuração (simulação): o erro esperado encolhe conforme a apuração avança
const bandNodes = params.faixa_por_c_semderiva["0"];
const bandAt = (c: number) => interp(bandNodes, c);
const minutesAt = (c: number) => interp(pace.map(([cc, m]) => [cc, m]), c);
const LULA = "#fb7185", FLAVIO = "#38bdf8";

export type PathAxis = "pct" | "time";
export type PathView = NonNullable<ReturnType<typeof buildPathView>>;

// Curva real até o "agora" e projeção até o fim; só existe a partir de 5% apurado.
export function buildPathView(axis: PathAxis, series: SeriesPoint[], projection: Projection) {
  const last = series[series.length - 1];
  const real = series.filter(p => p.raw !== null && p.c >= 0.02);
  if (!(real.length > 0 && last.c >= 0.05 && last.raw !== null)) return null;
  const cNow = last.c, cEnd = axis === "time" ? 0.995 : 1;
  const lNow = 50 + (last.raw as number) / 2, lFinal = projection.lulaPct, fFinal = projection.flavioPct;
  const halfShare = 1.96 * projection.sdMargin / 2; // meia-faixa de 95% da participação (pp)
  // fecha a diferença entre o apurado e o final em linha reta (sem supor a forma da curva do 1º turno)
  const shrink = (c: number) => Math.min(1, bandAt(c) / Math.max(bandAt(cNow), 1e-6)); // 1 no "agora", menor depois
  let prev = 1;
  const grid = Array.from({ length: 41 }, (_, i) => {
    const c = cNow + (cEnd - cNow) * i / 40;
    const raw = (1 - c) / (1 - cNow);
    prev = Math.min(prev, Math.max(0, raw));
    return { c, h: i === 0 ? 1 : prev };
  });
  const at = (c: number) => axis === "pct" ? c * 100 : last.ms + (minutesAt(c) - minutesAt(cNow)) * 60_000;
  const path = grid.map(g => ({ x: at(g.c), lula: lFinal + (lNow - lFinal) * g.h, flavio: fFinal + (100 - lNow - fFinal) * g.h, w: halfShare * shrink(g.c) }));
  const realPts = real.map(p => ({ x: axis === "pct" ? p.c * 100 : p.ms, lula: 50 + (p.raw as number) / 2 }));
  const values = [...realPts.map(p => p.lula), ...realPts.map(p => 100 - p.lula), ...path.flatMap(p => [p.lula - p.w, p.lula + p.w, p.flavio - p.w, p.flavio + p.w])];
  const stepY = Math.max(...values) - Math.min(...values) > 24 ? 10 : 5;
  const lo = Math.max(0, Math.floor((Math.min(...values) - 1) / stepY) * stepY), hi = Math.min(100, Math.ceil((Math.max(...values) + 1) / stepY) * stepY);
  const yTicks: number[] = []; for (let y = lo; y <= hi; y += stepY) yTicks.push(y);
  let xDomain: [number, number] = [0, 100], xTicks = [0, 25, 50, 75, 100];
  if (axis === "time") {
    const start = realPts[0].x, end = Math.max(path[path.length - 1].x, last.ms + 30 * 60_000), half = 1_800_000;
    xDomain = [start, end]; xTicks = [];
    for (let t = Math.ceil(start / (2 * half)) * 2 * half; t <= end; t += 2 * half) xTicks.push(t);
  }
  return { cNow, path, realPts, lNow, lFinal, fFinal, halfShare, yDomain: [lo, hi] as [number, number], yTicks, xDomain, xTicks, xNow: axis === "pct" ? cNow * 100 : last.ms, endClock: axis === "time" ? path[path.length - 1].x : null };
}

export function PathChart({ view, axis, scale, height }: { view: PathView; axis: PathAxis; scale?: number; height?: number }) {
  const end = view.path[view.path.length - 1].x;
  return <LineChart label="Participação de Lula e Flávio: curva apurada e projeção até o fim" scale={scale} height={height} xDomain={view.xDomain} yDomain={view.yDomain} xTicks={view.xTicks} yTicks={view.yTicks} fmtX={axis === "pct" ? x => `${x}%` : brt} fmtY={y => `${y}%`}
    vlines={[{ x: view.xNow, label: "agora" }]}
    bands={[{ color: "rgba(251,113,133,0.20)", points: view.path.map(p => [p.x, p.lula - p.w, p.lula + p.w]) }, { color: "rgba(56,189,248,0.20)", points: view.path.map(p => [p.x, p.flavio - p.w, p.flavio + p.w]) }]}
    lines={[{ color: LULA, width: 2.2, points: view.realPts.map(p => [p.x, p.lula]) }, { color: FLAVIO, width: 2.2, points: view.realPts.map(p => [p.x, 100 - p.lula]) },
      { color: LULA, dash: "6 4", width: 2, points: view.path.map(p => [p.x, p.lula]) }, { color: FLAVIO, dash: "6 4", width: 2, points: view.path.map(p => [p.x, p.flavio]) },
      { color: "rgba(251,113,133,0.85)", width: 5, points: [[end, view.lFinal - view.halfShare], [end, view.lFinal + view.halfShare]] },
      { color: "rgba(56,189,248,0.85)", width: 5, points: [[end, view.fFinal - view.halfShare], [end, view.fFinal + view.halfShare]] },
      { color: LULA, width: 1, dots: true, points: [[view.xNow, view.lNow]] }, { color: FLAVIO, width: 1, dots: true, points: [[view.xNow, 100 - view.lNow]] }]}/>;
}

export function PathCard({ series, projection }: { series: SeriesPoint[]; projection: Projection }) {
  const [axis, setAxis] = useState<PathAxis>("pct");
  const view = useMemo(() => buildPathView(axis, series, projection), [axis, series, projection]);
  const range = (x: number, half: number) => `${num(x - half, 1)}% a ${num(x + half, 1)}%`;
  return <Card><CardHeader className="pb-2"><CardTitle>Curva da apuração: real e projetada</CardTitle><CardDescription>Linha contínua: o que já foi apurado. Tracejada: o que o modelo espera até o fim. A sombra é a margem de erro de 95% do modelo em cada momento: começa com o erro de agora e encolhe conforme a apuração avança.</CardDescription>
    <div className="mt-2 flex flex-wrap gap-2" role="tablist" aria-label="Eixo do gráfico">{([["pct", "% apurado"], ["time", "Horário"]] as const).map(([k, label]) => <button key={k} role="tab" aria-selected={axis === k} onClick={() => setAxis(k)} className={`min-h-10 rounded-full border px-3.5 text-sm ${axis === k ? "border-zinc-200 bg-zinc-100 text-zinc-950" : "border-zinc-700 text-zinc-300 active:bg-zinc-900"}`}>{label}</button>)}</div></CardHeader><CardContent>
    {!view ? <p className="py-6 text-sm text-zinc-400">A curva aparece a partir de 5% do eleitorado apurado. Até lá só existe a estimativa a priori do resumo.</p> : <>
      <PathChart view={view} axis={axis} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-400"><span className="flex items-center gap-1.5"><i className="h-0.5 w-4 shrink-0" style={{ background: LULA }}/>Lula</span><span className="flex items-center gap-1.5"><i className="h-0.5 w-4 shrink-0" style={{ background: FLAVIO }}/>Flávio</span><span className="flex items-center gap-1.5"><i className="h-0 w-4 shrink-0 border-t-2 border-dashed border-zinc-400"/>Projeção</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-4 shrink-0 bg-zinc-500/40"/>Erro de 95% em cada momento</span><span className="flex items-center gap-1.5"><i className="h-3 w-1 shrink-0 bg-zinc-300"/>Faixa do resultado final hoje</span></div>
      <div className="tabular mt-3 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-3 text-xs text-zinc-400">
        <div>Apurado agora<div className="text-sm"><span className="text-rose-300">Lula {pct(view.lNow, 1)}</span> · <span className="text-sky-300">Flávio {pct(100 - view.lNow, 1)}</span></div></div>
        <div>Final esperado (faixa de 95%)<div className="text-sm text-rose-300">Lula {pct(view.lFinal, 1)}</div><div className="text-zinc-500">{range(view.lFinal, view.halfShare)}</div><div className="mt-1 text-sm text-sky-300">Flávio {pct(view.fFinal, 1)}</div><div className="text-zinc-500">{range(view.fFinal, view.halfShare)}</div></div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">A projeção termina na participação final esperada pelo modelo. O caminho até lá fecha em linha reta, sem supor a forma da curva do 1º turno. A sombra é a margem de erro de 95% que o modelo teria em cada fase da apuração: igual à de agora no "agora" e menor a cada ponto, porque o erro diminui conforme chegam mais votos (o encolhimento foi medido em simulação com o 1º turno). A barra na ponta direita é a faixa do resultado final como o modelo a vê hoje; ela só se estreita quando chegam votos. {axis === "time" ? `No eixo de horário, o ritmo supõe que a apuração avança como no 1º turno (até 99,5%, por volta de ${view.endClock ? brt(view.endClock) : ""}); se for mais lenta ou rápida, os horários mudam, e a participação projetada não.` : "Troque para Horário para ver quando cada grau de apuração deve ser atingido."}</p></>}
  </CardContent></Card>;
}
