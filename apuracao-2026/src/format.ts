export const UF_NAMES: Record<string, string> = { ac: "Acre", al: "Alagoas", am: "Amazonas", ap: "Amapá", ba: "Bahia", ce: "Ceará", df: "Distrito Federal", es: "Espírito Santo", go: "Goiás", ma: "Maranhão", mg: "Minas Gerais", ms: "Mato Grosso do Sul", mt: "Mato Grosso", pa: "Pará", pb: "Paraíba", pe: "Pernambuco", pi: "Piauí", pr: "Paraná", rj: "Rio de Janeiro", rn: "Rio Grande do Norte", ro: "Rondônia", rr: "Roraima", rs: "Rio Grande do Sul", sc: "Santa Catarina", se: "Sergipe", sp: "São Paulo", to: "Tocantins", zz: "Exterior" };
export const fmt = new Intl.NumberFormat("pt-BR");
export const pct = (x: number, digits = 2) => `${x.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
export const num = (x: number, digits = 2) => x.toFixed(digits).replace(".", ",");
export const sign = (x: number, digits = 2) => `${x >= 0 ? "+" : "−"}${num(Math.abs(x), digits)}`;
export const brt = (ms: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(ms);
export const ageText = (minutes: number) => minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} d`;
export const chance = (p: number) => p > 0.999 ? ">99,9%" : p < 0.001 ? "<0,1%" : pct(p * 100, 1);
