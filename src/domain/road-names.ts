const expansions: Record<string, string> = {
  cr: "crescent",
  cres: "crescent",
  prt: "paisley road toll",
  terr: "terrace",
  tce: "terrace",
  ov: "oval",
  rd: "road",
  prw: "paisley road west",
  pl: "place",
  ct: "court",
  dr: "drive",
  ave: "avenue",
  av: "avenue",
  gdns: "gardens",
  gdn: "gardens",
  sq: "square",
  ln: "lane",
  blvd: "boulevard",
};
const normalisedRoadNameCache = new Map<string, string>();

/** Comparison form only. Exam wording remains untouched everywhere else. */
export function normaliseRoadName(value: string) {
  const cached = normalisedRoadNameCache.get(value);
  if (cached !== undefined) return cached;
  const tokens = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-GB")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const normalised = tokens.map((token, index) => {
    // Glasgow road data uses both Saint and Street. At the start of a road
    // name St is Saint; elsewhere the taxi shorthand ST means Street.
    if (token === "st") return index === 0 && tokens.length > 1 ? "saint" : "street";
    return expansions[token] ?? token;
  }).join(" ");
  normalisedRoadNameCache.set(value, normalised);
  return normalised;
}
