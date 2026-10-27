import params from "./parametros.json";

// Porta de predicao-2turno/modelo.py. Mantenha os dois iguais; parametros.json vem de estudo.py, estudo_uf.py e simulacao.py.
export type UfInput = { uf: string; valid: number; lula: number; flavio: number; electorsDone: number; electorsTotal: number };
export type UfDiagnostic = { uf: string; c: number; expected: number; observed: number; dev: number; z: number; weight: number; impact: number };
export type Projection = {
  lulaPct: number; flavioPct: number; marginPp: number; ci95: [number, number]; sdMargin: number; probLula: number;
  coverage: number; swingPp: number; sigmaPrior: number; sigmaPriorLive: boolean; ufsUsed: number; ufsTotal: number; ufs: UfDiagnostic[];
};
export type ProjectOptions = { cMinObs?: number; driftScale?: number };

type Nodes = number[][];
const sortNodes = (nodes: Nodes) => [...nodes].sort((a, b) => a[0] - b[0]);
const sigmaNodes = sortNodes(params.sigma_obs_p), driftNodes = sortNodes(params.deriva_p), commonNodes = sortNodes(params.fator_comum);
const prior = params.primeiro_turno as Record<string, { valid: number; lula: number; flavio: number; te: number }>;

function interp(nodes: Nodes, x: number) {
  if (x <= nodes[0][0]) return nodes[0][1];
  for (let i = 0; i < nodes.length - 1; i++) {
    const [x0, y0] = nodes[i], [x1, y1] = nodes[i + 1];
    if (x <= x1) return x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1;
  }
  return nodes[nodes.length - 1][1];
}
// Abramowitz-Stegun 7.1.26 (erro < 1,5e-7).
function erf(x: number) {
  const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

type U = { uf: string; valid: number; c: number; duas: number; drift: number; pObs: number | null; p1: number; valid1: number; V: number; omega: number; pr: number };

// driftScale: 1 supõe que o 2º turno repete a deriva do 1º turno; 0 supõe que não há deriva.
export function project(rows: UfInput[], options: ProjectOptions = {}): Projection {
  const cMinObs = options.cMinObs ?? params.c_min_obs, driftScale = options.driftScale ?? 1;
  const ufs: U[] = [];
  for (const r of rows) {
    const base = prior[r.uf.toUpperCase()];
    if (!base) continue;
    const duas = r.lula + r.flavio, c = r.electorsTotal > 0 ? r.electorsDone / r.electorsTotal : 0;
    const raw = duas > 0 ? r.lula / duas : null, drift = driftScale * interp(driftNodes, c);
    ufs.push({ uf: r.uf, valid: r.valid, c, duas, drift, pObs: raw === null ? null : Math.min(0.98, Math.max(0.02, raw + drift)),
      p1: base.lula / (base.lula + base.flavio), valid1: base.valid, V: 0, omega: 0, pr: 0 });
  }
  const counted = ufs.filter(u => u.valid > 0 && u.c >= params.c_min_validos);
  const ratio = counted.length ? counted.reduce((a, u) => a + u.valid / u.c, 0) / counted.reduce((a, u) => a + u.valid1, 0) : 1;
  for (const u of ufs) u.V = counted.includes(u) ? u.valid / u.c : u.valid1 * ratio;

  let sigmaP = params.sigma_prior_padrao, swing = 0, seSwing: number, sigmaLive = false;
  const usable = ufs.filter(u => u.c >= Math.max(cMinObs, params.c_min_oscilacao) && u.pObs !== null);
  const so = (u: U) => interp(sigmaNodes, u.c);
  if (usable.length) {
    let w = usable.map(u => u.V / (so(u) ** 2 + sigmaP ** 2)), total = w.reduce((a, b) => a + b, 0);
    swing = usable.reduce((a, u, i) => a + w[i] * (u.pObs! - u.p1), 0) / total * 100;
    const well = usable.filter(u => u.c >= 0.3);
    if (well.length >= params.min_ufs_sigma_prior) {
      const res2 = well.map(u => ((u.pObs! - u.p1) * 100 - swing) ** 2 - so(u) ** 2);
      const live = Math.sqrt(Math.max(0, res2.reduce((a, b) => a + b, 0) / res2.length));
      sigmaP = Math.min(params.sigma_prior_max, Math.max(params.sigma_prior_min, live)); sigmaLive = true;
    }
    w = usable.map(u => u.V / (so(u) ** 2 + sigmaP ** 2)); total = w.reduce((a, b) => a + b, 0);
    seSwing = Math.max(0.3, Math.sqrt(usable.reduce((a, u, i) => a + w[i] ** 2 * (so(u) ** 2 + sigmaP ** 2), 0)) / total);
  } else seSwing = sigmaP;

  const sumV = ufs.reduce((a, u) => a + u.V, 0);
  let pNat = 0, varIndep = 0, priorWeight = 0, commonDrift = 0;
  for (const u of ufs) {
    const pr = Math.min(98, Math.max(2, u.p1 * 100 + swing)); u.pr = pr;
    let est: number, variance: number;
    if (u.c >= cMinObs && u.pObs !== null && u.duas > 0) {
      const s = so(u);
      u.omega = sigmaP ** 2 / (sigmaP ** 2 + s ** 2);
      est = u.omega * u.pObs * 100 + (1 - u.omega) * pr;
      variance = sigmaP ** 2 * s ** 2 / (sigmaP ** 2 + s ** 2);
    } else { u.omega = 0; est = pr; variance = sigmaP ** 2; }
    const w = u.V / sumV;
    pNat += w * est; varIndep += w * w * variance; priorWeight += w * (1 - u.omega);
    commonDrift += w * u.omega * u.drift * 100;
  }
  const coverage = ufs.reduce((a, u) => a + u.c * u.V, 0) / sumV;
  const factor = interp(commonNodes, coverage); // erros das UFs não são independentes perto do fim
  const sdP = Math.sqrt(varIndep * factor ** 2 + (priorWeight * seSwing) ** 2 + (commonDrift * params.kappa_sd) ** 2);
  const duasObs = ufs.reduce((a, u) => a + u.duas, 0), validObs = ufs.reduce((a, u) => a + u.valid, 0);
  const q = duasObs > 0 ? duasObs / validObs : 1;
  const margin = (2 * pNat - 100) * q, sd = 2 * sdP * q;
  // Desvio de cada UF apurada contra o esperado (1º turno + oscilação nacional), já com a deriva corrigida.
  const diagnostics = ufs.filter(u => u.omega > 0 && u.pObs !== null).map<UfDiagnostic>(u => {
    const observed = u.pObs! * 100, dev = observed - u.pr, w = u.V / sumV;
    return { uf: u.uf, c: u.c, expected: u.pr, observed, dev, z: dev / Math.sqrt(so(u) ** 2 + sigmaP ** 2), weight: w, impact: 2 * w * u.omega * dev };
  });
  return {
    lulaPct: pNat * q, flavioPct: (100 - pNat) * q, marginPp: margin, ci95: [margin - 1.96 * sd, margin + 1.96 * sd], sdMargin: sd,
    probLula: sd > 0 ? phi(margin / sd) : Number(margin > 0), coverage, swingPp: swing, sigmaPrior: sigmaP, sigmaPriorLive: sigmaLive,
    ufsUsed: ufs.filter(u => u.omega > 0).length, ufsTotal: ufs.length, ufs: diagnostics,
  };
}

// Método antigo (metodo_app em simulacao.py): cada UF com votos tem seus válidos estendidos ao eleitorado inteiro
// (válidos / fração do eleitorado apurada) e mantém a participação atual. Não usa 1º turno nem deriva; UF sem votos fica de fora.
export type Extrapolation = { lulaPct: number; flavioPct: number; marginPp: number; states: number; lulaVotes: number; flavioVotes: number };
export function extrapolate(rows: UfInput[]): Extrapolation | null {
  let lula = 0, flavio = 0, states = 0;
  for (const r of rows) {
    if (r.valid <= 0 || r.electorsDone <= 0 || r.electorsTotal <= 0) continue;
    const scale = r.electorsTotal / r.electorsDone;
    lula += r.lula * scale; flavio += r.flavio * scale; states++;
  }
  if (lula + flavio <= 0) return null;
  const two = lula + flavio;
  return { lulaPct: lula / two * 100, flavioPct: flavio / two * 100, marginPp: (lula - flavio) / two * 100, states, lulaVotes: lula, flavioVotes: flavio };
}
