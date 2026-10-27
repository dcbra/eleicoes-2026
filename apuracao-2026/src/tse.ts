// Leitura dos arquivos públicos de apuração do TSE (usada pela tela e pelo servidor local).
export type Candidate = { name: string; votes: number };
export type StateResult = { uf: string; lula: number; flavio: number; valid: number; sectionsDone: number; sectionsTotal: number; electorsDone: number; electorsTotal: number; updated: string; turn: string };
export type Raw = Record<string, any>;
export const number = (v: unknown) => { const n = Number(String(v ?? "0").replaceAll(".", "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
function candidates(data: Raw): Candidate[] {
  const out: Candidate[] = [];
  const walk = (value: any) => { if (!value) return; if (Array.isArray(value)) { value.forEach(walk); return; } if (typeof value !== "object") return;
    if (Array.isArray(value.cand)) for (const c of value.cand) out.push({ name: String(c.nmu ?? c.nm ?? "").toUpperCase(), votes: number(c.vap) });
    for (const [key, child] of Object.entries(value)) if (key !== "cand") walk(child);
  }; walk(data.carg); return out;
}
export function totals(data: Raw, uf: string): StateResult {
  const cs = candidates(data);
  const lula = cs.filter(c => c.name.includes("LULA")).reduce((a,c) => a+c.votes, 0);
  const flavio = cs.filter(c => c.name.includes("FLAVIO")).reduce((a,c) => a+c.votes, 0);
  const stats = data;
  const valid = number(data.v?.vv ?? data.v?.tv ?? data.v?.vvc ?? "0");
  const sectionsDone = number(stats.s?.st), sectionsTotal = number(stats.s?.ts);
  const electorsDone = number(stats.e?.est), electorsTotal = number(stats.e?.te);
  return { uf, lula, flavio, valid, sectionsDone, sectionsTotal, electorsDone, electorsTotal, updated: `${data.dg ?? ""} ${data.hg ?? ""}`.trim(), turn: String(data.t ?? "") };
}
