import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { request } from "node:https";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { totals } from "./src/tse";

const states = ["ac","al","am","ap","ba","ce","df","es","go","ma","mg","ms","mt","pa","pb","pe","pi","pr","rj","rn","ro","rr","rs","sc","se","sp","to","zz"];
const DEFAULT_ELECTION = "6257";
// Eleição gravada em segundo plano mesmo sem a página aberta ("off" desliga). 6257 = 1º turno, 6258 = 2º turno.
const RECORD_ELECTION = process.env.APURACAO_RECORD_ELE ?? "6258";
const RECORD_EVERY_MS = 120_000;
const snapshotDir = fileURLToPath(new URL("../predicao-2turno/snapshots/", import.meta.url));

type Raw = Record<string, any>;
const lastSaved = new Map<string, { at: number; signature: string }>();
const parsedSnapshots = new Map<string, { t: string; rows: ReturnType<typeof totals>[] } | null>();

function tseTimestamp(data: { dg?: string; hg?: string }) {
  const [day, month, year] = (data.dg ?? "").split("/").map(Number);
  const [hour, minute, second] = (data.hg ?? "").split(":").map(Number);
  if (![day, month, year, hour, minute, second].every(Number.isFinite)) return Number.NaN;
  // The result files publish their clock in Brasília time (UTC-3).
  return Date.UTC(year, month - 1, day, hour + 3, minute, second);
}

function getJson(url: string): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const upstreamRequest = request(url, { headers: { "User-Agent": "apuracao-2026/1.0" } }, (upstreamResponse) => {
      let body = "";
      upstreamResponse.setEncoding("utf8");
      upstreamResponse.on("data", (chunk: string) => body += chunk);
      upstreamResponse.on("end", () => {
        if ((upstreamResponse.statusCode ?? 500) >= 400) return reject(new Error(`HTTP ${upstreamResponse.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error("JSON inválido do TSE")); }
      });
    });
    upstreamRequest.on("error", reject);
    upstreamRequest.end();
  });
}

async function fetchElection(election: string): Promise<Raw[]> {
  const base = `https://resultados.tse.jus.br/oficial/ele2026/${election}/dados`;
  return Promise.all(states.map(async (uf) => {
    try { return await getJson(`${base}/${uf}/${uf}-c0001-e${election.padStart(6, "0")}-u.json`); }
    catch (error) { throw new Error(`${uf.toUpperCase()}: ${error instanceof Error ? error.message : "falha"}`); }
  }));
}

// Guarda um instantâneo para recalibrar o modelo depois (predicao-2turno/avaliar.py) e alimentar o histórico da tela.
// Só grava se os arquivos do TSE mudaram e se passou o intervalo mínimo.
function saveSnapshot(election: string, results: Raw[]) {
  const signature = results.map(r => `${r.dg}${r.hg}${r.idg}`).join("|");
  const previous = lastSaved.get(election);
  if (previous && (previous.signature === signature || Date.now() - previous.at < RECORD_EVERY_MS - 10_000)) return;
  try {
    mkdirSync(snapshotDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const resultados = Object.fromEntries(states.map((uf, i) => [uf, results[i]]));
    writeFileSync(`${snapshotDir}${stamp}_ele${election}.json`, JSON.stringify({ coletado_em: new Date().toISOString(), ele: election, resultados }));
    lastSaved.set(election, { at: Date.now(), signature });
  } catch { /* gravar o histórico é opcional */ }
}

function readHistory(election: string, since: string) {
  let files: string[] = [];
  try { files = readdirSync(snapshotDir).filter(name => name.endsWith(`_ele${election}.json`)).sort(); } catch { return []; }
  const out: { t: string; rows: ReturnType<typeof totals>[] }[] = [];
  for (const name of files) {
    if (!parsedSnapshots.has(name)) {
      try {
        const snapshot = JSON.parse(readFileSync(`${snapshotDir}${name}`, "utf8")) as { coletado_em: string; resultados: Record<string, Raw> };
        const rows = Object.entries(snapshot.resultados).filter(([uf]) => uf !== "br").map(([uf, data]) => totals(data, uf));
        parsedSnapshots.set(name, rows.some(r => r.valid > 0) ? { t: snapshot.coletado_em, rows } : null);
      } catch { parsedSnapshots.set(name, null); }
    }
    const item = parsedSnapshots.get(name);
    if (item && item.t > since) out.push(item);
  }
  return out;
}

function tseResults() {
  return {
    name: "tse-results-proxy",
    configureServer(server: { middlewares: { use: (handler: (req: any, res: any, next: () => void) => void) => void }; httpServer?: { on: (event: string, handler: () => void) => void } | null }) {
      if (/^\d{3,6}$/.test(RECORD_ELECTION)) {
        const record = () => { fetchElection(RECORD_ELECTION).then(results => saveSnapshot(RECORD_ELECTION, results)).catch(() => undefined); };
        record();
        const timer = setInterval(record, RECORD_EVERY_MS);
        server.httpServer?.on("close", () => clearInterval(timer));
      }
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url ?? "", "http://localhost");
        const isResults = requestUrl.pathname === "/api/results", isHistory = requestUrl.pathname === "/api/history";
        if (!isResults && !isHistory) return next();
        const election = requestUrl.searchParams.get("ele") ?? DEFAULT_ELECTION;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        if (!/^\d{3,6}$/.test(election)) { res.statusCode = 400; res.end(JSON.stringify({ error: "Código de eleição inválido" })); return; }
        if (isHistory) { res.statusCode = 200; res.end(JSON.stringify({ snapshots: readHistory(election, requestUrl.searchParams.get("since") ?? "") })); return; }
        try {
          // O total nacional oficial vem do arquivo br: a soma das UFs atrasa quando algum estado demora a publicar.
          const [results, brData] = await Promise.all([fetchElection(election), getJson(`https://resultados.tse.jus.br/oficial/ele2026/${election}/dados/br/br-c0001-e${election.padStart(6, "0")}-u.json`).catch(() => null)]);
          const national = brData ? totals(brData, "br") : null;
          saveSnapshot(election, results);
          res.statusCode = 200;
          const validTimestamps = results.map(data => tseTimestamp(data as { dg?: string; hg?: string })).filter(Number.isFinite);
          // A última atualização publicada pelo TSE, não a mais antiga: estados sem votos novos mantêm o arquivo de dias atrás.
          const sourceUpdatedAt = validTimestamps.length ? new Date(Math.max(...validTimestamps)).toISOString() : null;
          res.end(JSON.stringify({ results, national, sourceUpdatedAt }));
        } catch (error) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Falha ao consultar o TSE" }));
        }
      });
    }
  };
}

export default defineConfig({ plugins: [react(), tailwindcss(), tseResults()] });
