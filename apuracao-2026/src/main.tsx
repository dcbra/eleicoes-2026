import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, AlertCircle, ChartLine, Clock3, Gauge, Info, MapPinned, RefreshCw, SlidersHorizontal, Vote } from "lucide-react";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from "./components";
import { ageText, fmt, num, pct, sign } from "./format";
import { CurveCard, HeroCard, PathCard, PhaseCard, TrajectoryCard, buildSeries, type Snapshot } from "./insights";
import { totals, type Raw, type StateResult } from "./tse";
import { TvView } from "./tv";
import { DeviationsCard, UfList, alertCount, computeAlerts } from "./ufpanels";
import "./index.css";

const DEFAULT_ELECTION = "6258";
const ELECTIONS = [{ code: "6257", label: "1º turno" }, { code: "6258", label: "2º turno" }];
type Tab = "resumo" | "evolucao" | "ufs" | "metodo";

async function fetchResults(election: string): Promise<{ rows: StateResult[]; national: StateResult | null; sourceUpdatedAt: string | null }> {
  const response = await fetch(`/api/results?ele=${encodeURIComponent(election)}`, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Falha ao consultar o TSE (HTTP ${response.status})`);
  const payload = result as { results: Raw[]; national?: StateResult | null; sourceUpdatedAt: string | null };
  return { rows: payload.results.map(data => totals(data, String(data.cdabr ?? "").toLowerCase())), national: payload.national ?? null, sourceUpdatedAt: payload.sourceUpdatedAt };
}

function App() {
  const [rows, setRows] = useState<StateResult[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState<string | null>(null);
  const [national, setNational] = useState<StateResult | null>(null);
  const [tab, setTabState] = useState<Tab>(() => { const h = window.location.hash.slice(1); return (["resumo", "evolucao", "ufs", "metodo"] as string[]).includes(h) ? h as Tab : "resumo"; });
  const setTab = (t: Tab) => { setTabState(t); try { window.history.replaceState(null, "", `#${t}`); } catch { /* opcional */ } };
  const [settings, setSettings] = useState(false);
  const [tvMode, setTvMode] = useState(() => window.location.hash === "#tv");
  useEffect(() => { const f = () => setTvMode(window.location.hash === "#tv"); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  const [election, setElection] = useState(() => { try { return localStorage.getItem("ele") || DEFAULT_ELECTION; } catch { return DEFAULT_ELECTION; } });
  const [history, setHistory] = useState<Snapshot[]>([]);
  const sinceRef = useRef("");
  const changeElection = (value: string) => { setElection(value); setHistory([]); sinceRef.current = ""; try { localStorage.setItem("ele", value); } catch { /* opcional */ } };
  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch(`/api/history?ele=${encodeURIComponent(election)}&since=${encodeURIComponent(sinceRef.current)}`, { cache: "no-store" });
      const { snapshots } = await response.json() as { snapshots: Snapshot[] };
      if (snapshots?.length) { sinceRef.current = snapshots[snapshots.length - 1].t; setHistory(h => [...h, ...snapshots]); }
    } catch { /* o histórico é opcional */ }
  }, [election]);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { const data = await fetchResults(election); void loadHistory(); setRows(data.rows); setNational(data.national); setSourceUpdatedAt(data.sourceUpdatedAt); setError(""); setLastFetch(new Date()); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao consultar TSE"); }
    finally { setBusy(false); }
  }, [election, loadHistory]);
  useEffect(() => { void refresh(); const id = window.setInterval(() => void refresh(), 30000); return () => window.clearInterval(id); }, [refresh]);

  const model = useMemo(() => {
    const ready = rows.filter(r => r.valid > 0 && r.sectionsTotal > 0);
    const totalValid = ready.reduce((a, r) => a + r.valid, 0);
    // Estimativa do 1º turno: cada UF escala os válidos pela fração do eleitorado totalizado e aplica a participação atual.
    const estimate = (key: "lula" | "flavio") => ready.reduce((sum, r) => {
      const turnout = r.electorsDone / r.electorsTotal;
      if (turnout <= 0 || r.electorsTotal <= 0) return sum;
      return sum + (r[key] / r.valid) * (r.valid / turnout);
    }, 0);
    const projectedValid = ready.reduce((sum, r) => sum + (r.electorsDone > 0 && r.electorsTotal > 0 ? r.valid / (r.electorsDone / r.electorsTotal) : r.valid), 0);
    const electorate = ready.reduce((a, r) => a + r.electorsTotal, 0), appeared = ready.reduce((a, r) => a + r.electorsDone, 0);
    const lulaVotes = rows.reduce((a, r) => a + r.lula, 0), flavioVotes = rows.reduce((a, r) => a + r.flavio, 0);
    return { ready, totalValid, projectedValid, electorate, appeared, lulaVotes, flavioVotes, coverage: electorate ? appeared / electorate * 100 : 0,
      lulaPct: projectedValid ? estimate("lula") / projectedValid * 100 : 0, flavioPct: projectedValid ? estimate("flavio") / projectedValid * 100 : 0 };
  }, [rows]);

  const secondRound = rows.length > 0 && rows.every(r => r.turn === "2");
  const historySeries = useMemo(() => secondRound ? buildSeries(history) : [], [history, secondRound]);
  const series = useMemo(() => secondRound && rows.length ? [...historySeries, ...buildSeries([{ t: (lastFetch ?? new Date()).toISOString(), rows }])] : [], [historySeries, rows, secondRound, lastFetch]);
  const projection = series.length ? series[series.length - 1].proj : null;
  const alerts = useMemo(() => series.length ? computeAlerts(series) : [], [series]);
  const flagged = alertCount(alerts);

  const sourceDate = sourceUpdatedAt ? new Date(sourceUpdatedAt) : null;
  const sourceAge = sourceDate ? Math.max(0, Math.floor((Date.now() - sourceDate.getTime()) / 60000)) : null;
  const sourceStale = sourceAge !== null && sourceAge >= 3;
  const clock = (d: Date | null, seconds = true) => {
    if (!d) return null;
    const old = Date.now() - d.getTime() > 12 * 3600_000;
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...(old ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit", ...(seconds && !old ? { second: "2-digit" } : {}) }).format(d);
  };

  if (tvMode) return <TvView series={series} projection={projection} alerts={alerts} rows={rows} national={national} coverage={model.coverage} sourceStamp={clock(sourceDate)} stale={sourceStale} error={error} election={election} legacy={{ lulaPct: model.lulaPct, flavioPct: model.flavioPct }}/>;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "resumo", label: "Resumo", icon: <Gauge size={20}/> },
    ...(projection ? [{ key: "evolucao" as Tab, label: "Evolução", icon: <ChartLine size={20}/> }] : []),
    { key: "ufs", label: "Estados", icon: <MapPinned size={20}/> },
    { key: "metodo", label: "Método", icon: <Info size={20}/> },
  ];
  const active: Tab = tabs.some(t => t.key === tab) ? tab : "resumo";
  const show = (t: Tab) => `${active === t ? "block" : "hidden"} lg:block`;
  const heading = (text: string) => <h2 className="mb-3 mt-2 hidden text-xs font-semibold uppercase tracking-[.18em] text-zinc-500 lg:block">{text}</h2>;

  return <div className="mx-auto min-h-dvh max-w-7xl overflow-x-clip pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-10">
    <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/90 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-950"><Activity size={17}/></span>
        <div className="min-w-0 flex-1"><h1 className="truncate text-base font-semibold leading-tight tracking-tight sm:text-lg">Apuração 2026 <span className="text-zinc-500">· {secondRound ? "2º turno" : rows.length ? "1º turno" : "presidencial"}</span></h1>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400"><span className={`shrink-0 h-1.5 w-1.5 rounded-full ${error ? "bg-amber-400" : sourceStale ? "bg-amber-400" : "bg-emerald-400"} ${busy ? "animate-pulse" : ""}`}/><span className="truncate">{error ? "erro de conexão" : sourceStale ? `TSE sem novidades há ${ageText(sourceAge ?? 0)}` : "ao vivo"}</span>{lastFetch && <span className="shrink-0 text-zinc-600">· {clock(lastFetch, false)}</span>}</div></div>
        <button onClick={() => setSettings(v => !v)} aria-expanded={settings} aria-label="Escolher eleição" className={`flex h-11 w-11 items-center justify-center rounded-lg border ${settings ? "border-zinc-300 bg-zinc-800" : "border-zinc-800"} text-zinc-300 active:bg-zinc-800`}><SlidersHorizontal size={18}/></button>
        <button onClick={() => void refresh()} disabled={busy} aria-label="Atualizar agora" className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-800 text-zinc-300 active:bg-zinc-800 disabled:opacity-60"><RefreshCw size={18} className={busy ? "animate-spin" : ""}/></button>
      </div>
      {projection && series.length > 0 && <div className="tabular mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"><span className="text-rose-300">Lula {pct(projection.lulaPct, 1)}</span><span className="text-sky-300">Flávio {pct(projection.flavioPct, 1)}</span><span className={projection.marginPp >= 0 ? "text-rose-300" : "text-sky-300"}>{sign(projection.marginPp)} pp</span><span className="text-zinc-500">±{num(1.96 * projection.sdMargin, 1)} · {num(series[series.length - 1].c * 100, 0)}% apurado</span></div>}
      {settings && <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-2">
        {ELECTIONS.map(e => <button key={e.code} onClick={() => changeElection(e.code)} className={`min-h-10 rounded-full border px-4 text-sm ${election === e.code ? "border-zinc-200 bg-zinc-100 text-zinc-950" : "border-zinc-700 text-zinc-300 active:bg-zinc-900"}`}>{e.label}</button>)}
        <a href="#tv" className="flex min-h-10 items-center rounded-full border border-zinc-700 px-4 text-sm text-zinc-300 active:bg-zinc-900">Modo TV</a>
        <label className="ml-auto flex items-center gap-2 text-xs text-zinc-400">Código TSE <input value={election} onChange={e => changeElection(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" className="tabular h-10 w-20 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-base text-zinc-100" aria-label="Código da eleição no TSE (6257 = 1º turno, 6258 = 2º turno)"/></label></div>}
    </header>

    <main className="px-4 pt-4 sm:px-6 lg:px-8">
      {error && <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-3 text-sm text-amber-200"><AlertCircle size={16} className="mt-0.5 shrink-0"/><span>{error}</span></div>}

      <section className={show("resumo")} aria-label="Resumo">{heading("Resumo")}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {projection && series.length > 0 ? <HeroCard series={series} projection={projection}/> : <LegacyHero model={model}/>}
          </div>
          <div className="space-y-4">
            {projection && series.length > 0 && <DeviationsCard alerts={alerts} projection={projection} limit={3} onSeeAll={() => setTab("ufs")}/>}
            <Card><CardHeader className="pb-2"><CardDescription>Base da projeção</CardDescription><CardTitle className="text-base">Apuração e fonte</CardTitle></CardHeader><CardContent className="space-y-3">
              <div><div className="mb-1.5 flex items-end justify-between"><span className="tabular text-3xl font-semibold">{pct(model.coverage, 1)}</span><span className="pb-1 text-xs text-zinc-500">do eleitorado apurado</span></div><Progress value={model.coverage}/></div>
              <div className="tabular grid grid-cols-3 gap-2 text-xs"><div className="text-zinc-500">Válidos<div className="text-sm text-zinc-200">{fmt.format(model.totalValid)}</div></div><div className="text-rose-300/80">Lula<div className="text-sm text-rose-300">{fmt.format(model.lulaVotes)}</div></div><div className="text-sky-300/80">Flávio<div className="text-sm text-sky-300">{fmt.format(model.flavioVotes)}</div></div></div>
              <div className="space-y-1.5 border-t border-zinc-800 pt-3 text-xs">
                <div className={`flex items-center gap-2 ${sourceStale ? "text-amber-300" : "text-emerald-300"}`}><Clock3 size={13} className="shrink-0"/>TSE atualizado {sourceDate && Date.now() - sourceDate.getTime() > 12 * 3600_000 ? "em" : "às"} {clock(sourceDate) ?? "—"} (Brasília){sourceAge !== null ? ` · há ${ageText(sourceAge)}` : ""}{sourceStale ? " · sem novos dados" : ""}</div>
                <div className="flex items-center gap-2 text-zinc-500"><RefreshCw size={12} className="shrink-0"/>Consultado às {clock(lastFetch) ?? "—"} · a cada 30 s</div>
                <div className="flex items-center gap-2 text-zinc-500"><Vote size={13} className="shrink-0"/>{model.ready.length}/28 UFs com votos</div></div>
            </CardContent></Card>
          </div>
        </div>
      </section>

      {projection && series.length > 0 && <section className={`${show("evolucao")} lg:mt-8`} aria-label="Evolução">{heading("Evolução")}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><div className="lg:col-span-2"><PathCard series={series} projection={projection}/></div><TrajectoryCard series={series} projection={projection}/><CurveCard series={series} projection={projection}/><div className="lg:col-span-2"><PhaseCard series={series} projection={projection}/></div></div>
      </section>}

      <section className={`${show("ufs")} lg:mt-8`} aria-label="Estados">{heading("Estados")}
        <div className="space-y-4">{projection && series.length > 0 && <DeviationsCard alerts={alerts} projection={projection}/>}<UfList rows={rows} alerts={alerts} election={election}/></div>
      </section>

      <section className={`${show("metodo")} lg:mt-8`} aria-label="Método">{heading("Método")}
        <Card><CardHeader className="pb-2"><CardTitle>Como a projeção é feita</CardTitle></CardHeader><CardContent className="space-y-3 text-sm leading-relaxed text-zinc-400">
          {secondRound ? <>
            <p><span className="text-zinc-200">Votos finais por estado:</span> votos válidos ÷ fração do eleitorado já totalizado.</p>
            <p><span className="text-zinc-200">Participação por estado:</span> combina o que a UF mostra com uma estimativa a priori: o 1º turno mais a oscilação nacional medida ao vivo. O peso do que a UF mostra cresce com a fração apurada dela, e UFs com menos de 0,2% apurado são ignoradas.</p>
            <p><span className="text-zinc-200">Deriva:</span> no 1º turno, Lula ganhou participação nas partes apuradas depois. A apuração do 2º turno não seguiu a mesma ordem, então o modelo principal não supõe deriva; a projeção com a curva do 1º turno aparece como alternativa (linha laranja e "E se o 2º turno repetir a curva do 1º?").</p>
            <p><span className="text-zinc-200">Margem de erro:</span> vem do erro de cada UF medido no 1º turno, e da incerteza da oscilação nacional; o erro por fase vem da simulação do modelo sem deriva. A "chance de Lula" descreve o modelo, não o resultado oficial.</p>
            <p><span className="text-zinc-200">UFs fora do esperado:</span> comparam o que cada UF aponta com o esperado. O alerta só dispara se o desvio persistir em atualizações seguidas.</p>
          </> : <p>Em cada UF, estima o comparecimento final pelo eleitorado apto e pelo comparecimento observado, e aplica ao total projetado de votos válidos a distribuição atual dos candidatos naquele estado. Supõe que os votos ainda não apurados mantenham o perfil observado na UF. Estimativa simples, sem intervalo; o modelo calibrado e os alertas aparecem no 2º turno (código 6258).</p>}
          <p className="text-xs text-zinc-500">Projeção indicativa. Comparecimento e perfil eleitoral mudam durante a apuração. Fonte: Tribunal Superior Eleitoral (arquivos públicos). Projeto independente, sem vínculo com o TSE.</p>
        </CardContent></Card>
      </section>
    </main>

    <nav aria-label="Seções" className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto flex max-w-xl">{tabs.map(t => <li key={t.key} className="flex-1"><button onClick={() => { setTab(t.key); window.scrollTo({ top: 0 }); }} aria-current={active === t.key ? "page" : undefined} className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] ${active === t.key ? "text-zinc-50" : "text-zinc-500"}`}>
        {active === t.key && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-zinc-100"/>}
        <span className="relative">{t.icon}{t.key === "ufs" && flagged > 0 && <Badge className="absolute -right-3 -top-2 h-4 min-w-4 justify-center border-amber-600 bg-amber-500 px-1 text-[10px] font-semibold text-zinc-950">{flagged}</Badge>}</span>{t.label}</button></li>)}</ul>
    </nav>
  </div>;
}

function LegacyHero({ model }: { model: { lulaPct: number; flavioPct: number; lulaVotes: number; flavioVotes: number; totalValid: number; projectedValid: number } }) {
  const cand = (name: string, color: string, text: string, share: number, votes: number, current: number) => <div className="rounded-lg border border-zinc-800 bg-black/20 p-3"><div className="flex items-center gap-1.5 text-xs text-zinc-400"><i className={`h-2 w-2 rounded-full ${color}`}/>{name}</div><div className={`tabular mt-1 text-2xl font-semibold ${text}`}>{pct(share)}</div><div className="tabular text-xs text-zinc-500">{fmt.format(Math.round(votes))} votos estimados</div><div className="mt-1 text-xs text-zinc-500">Agora: <span className={text}>{pct(current)}</span> dos apurados</div></div>;
  return <Card className="border-zinc-700 bg-zinc-900/70"><CardHeader className="pb-2"><CardDescription>Estimativa de votos válidos no 1º turno</CardDescription><CardTitle className="text-lg">Projeção nacional</CardTitle></CardHeader><CardContent>
    <div className="grid grid-cols-2 gap-3">{cand("Lula", "bg-rose-400", "text-rose-300", model.lulaPct, model.lulaPct / 100 * model.projectedValid, model.totalValid ? model.lulaVotes / model.totalValid * 100 : 0)}{cand("Flávio", "bg-sky-400", "text-sky-300", model.flavioPct, model.flavioPct / 100 * model.projectedValid, model.totalValid ? model.flavioVotes / model.totalValid * 100 : 0)}</div>
    <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-zinc-800"><div className="bg-rose-400 transition-all" style={{ width: `${model.lulaPct}%` }}/><div className="bg-sky-400 transition-all" style={{ width: `${model.flavioPct}%` }}/><div className="flex-1 bg-zinc-700"/></div>
    <div className="mt-2 flex justify-between text-xs text-zinc-500"><span>Lula {pct(model.lulaPct)}</span><span>outros + brancos/nulos</span><span>Flávio {pct(model.flavioPct)}</span></div>
  </CardContent></Card>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
