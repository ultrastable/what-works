// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// GLOBAL-1 (Rowan, 2026-11-25: "Make sure this isn't country specific and applies to many different types of countries and governments. There
// are many lessons learned around the world to cross pollinate.") Where the evidence comes from is read from the sources' own words, never typed:
// settingsOf() finds the countries a title, abstract or "where" line names, and tags each with its region and its World Bank income group
// (classification for fiscal year 2026, published July 2025). A country the table does not hold is simply not tagged; nothing is guessed.
// Pooled phrases ("low- and middle-income countries") are kept as pooled settings, because many reviews report them that way.

const C = (name, region, income, ...aliases) => ({ id: name.toLowerCase().normalize("NFKD").replace(/[^a-z]+/g, "-").replace(/^-|-$/g, ""), name, region, income, aliases: [name, ...aliases] });
export const INCOME = { low: "Low income", "lower-middle": "Lower-middle income", "upper-middle": "Upper-middle income", high: "High income" };
export const COUNTRIES = [
  // Sub-Saharan Africa
  C("Burkina Faso", "Sub-Saharan Africa", "low"), C("Burundi", "Sub-Saharan Africa", "low"), C("Ethiopia", "Sub-Saharan Africa", "low"),
  C("Liberia", "Sub-Saharan Africa", "low"), C("Madagascar", "Sub-Saharan Africa", "low"), C("Malawi", "Sub-Saharan Africa", "low"),
  C("Mali", "Sub-Saharan Africa", "low"), C("Mozambique", "Sub-Saharan Africa", "low"), C("Niger", "Sub-Saharan Africa", "low"),
  C("Rwanda", "Sub-Saharan Africa", "low"), C("Sierra Leone", "Sub-Saharan Africa", "low"), C("Somalia", "Sub-Saharan Africa", "low"),
  C("Uganda", "Sub-Saharan Africa", "low"), C("Democratic Republic of the Congo", "Sub-Saharan Africa", "low", "DR Congo", "DRC"),
  C("Benin", "Sub-Saharan Africa", "lower-middle"), C("Cameroon", "Sub-Saharan Africa", "lower-middle"), C("Ghana", "Sub-Saharan Africa", "lower-middle"),
  C("Kenya", "Sub-Saharan Africa", "lower-middle"), C("Nigeria", "Sub-Saharan Africa", "lower-middle"), C("Senegal", "Sub-Saharan Africa", "lower-middle"),
  C("Tanzania", "Sub-Saharan Africa", "lower-middle"), C("Zambia", "Sub-Saharan Africa", "lower-middle"), C("Zimbabwe", "Sub-Saharan Africa", "lower-middle"),
  C("Lesotho", "Sub-Saharan Africa", "lower-middle"), C("Côte d'Ivoire", "Sub-Saharan Africa", "lower-middle", "Cote d'Ivoire", "Ivory Coast"),
  C("South Africa", "Sub-Saharan Africa", "upper-middle"),
  // South Asia
  C("Afghanistan", "South Asia", "low"), C("Bangladesh", "South Asia", "lower-middle"), C("India", "South Asia", "lower-middle"),
  C("Nepal", "South Asia", "lower-middle"), C("Pakistan", "South Asia", "lower-middle"), C("Sri Lanka", "South Asia", "lower-middle"),
  // East Asia and Pacific
  C("Cambodia", "East Asia and Pacific", "lower-middle"), C("Myanmar", "East Asia and Pacific", "lower-middle"), C("Philippines", "East Asia and Pacific", "lower-middle"),
  C("Vietnam", "East Asia and Pacific", "lower-middle", "Viet Nam"), C("Papua New Guinea", "East Asia and Pacific", "lower-middle"),
  C("China", "East Asia and Pacific", "upper-middle"), C("Indonesia", "East Asia and Pacific", "upper-middle"), C("Malaysia", "East Asia and Pacific", "upper-middle"),
  C("Thailand", "East Asia and Pacific", "upper-middle"),
  C("Australia", "East Asia and Pacific", "high"), C("New Zealand", "East Asia and Pacific", "high"), C("Japan", "East Asia and Pacific", "high"),
  C("South Korea", "East Asia and Pacific", "high", "Republic of Korea"), C("Singapore", "East Asia and Pacific", "high"),
  // Latin America and Caribbean
  C("Haiti", "Latin America and Caribbean", "lower-middle"), C("Honduras", "Latin America and Caribbean", "lower-middle"), C("Nicaragua", "Latin America and Caribbean", "lower-middle"),
  C("Bolivia", "Latin America and Caribbean", "lower-middle"),
  C("Argentina", "Latin America and Caribbean", "upper-middle"), C("Brazil", "Latin America and Caribbean", "upper-middle"), C("Colombia", "Latin America and Caribbean", "upper-middle"),
  C("Ecuador", "Latin America and Caribbean", "upper-middle"), C("Guatemala", "Latin America and Caribbean", "upper-middle"), C("Jamaica", "Latin America and Caribbean", "upper-middle"),
  C("Mexico", "Latin America and Caribbean", "upper-middle"), C("Paraguay", "Latin America and Caribbean", "upper-middle"), C("Peru", "Latin America and Caribbean", "upper-middle"),
  C("Dominican Republic", "Latin America and Caribbean", "upper-middle"),
  C("Chile", "Latin America and Caribbean", "high"), C("Uruguay", "Latin America and Caribbean", "high"),
  // Middle East and North Africa
  C("Yemen", "Middle East and North Africa", "low"), C("Syria", "Middle East and North Africa", "low"),
  C("Egypt", "Middle East and North Africa", "lower-middle"), C("Morocco", "Middle East and North Africa", "lower-middle"), C("Tunisia", "Middle East and North Africa", "lower-middle"),
  C("Israel", "Middle East and North Africa", "high"), C("Saudi Arabia", "Middle East and North Africa", "high"), C("United Arab Emirates", "Middle East and North Africa", "high"),
  // Europe and Central Asia
  C("Kyrgyz Republic", "Europe and Central Asia", "lower-middle", "Kyrgyzstan"), C("Uzbekistan", "Europe and Central Asia", "lower-middle"), C("Tajikistan", "Europe and Central Asia", "lower-middle"),
  C("Albania", "Europe and Central Asia", "upper-middle"), C("Bosnia and Herzegovina", "Europe and Central Asia", "upper-middle", "Bosnia"), C("Kazakhstan", "Europe and Central Asia", "upper-middle"),
  C("Serbia", "Europe and Central Asia", "upper-middle"), C("Türkiye", "Europe and Central Asia", "upper-middle", "Turkey"), C("Armenia", "Europe and Central Asia", "upper-middle"),
  C("United Kingdom", "Europe and Central Asia", "high", "UK", "England", "Scotland", "Wales", "Northern Ireland", "Britain"),
  C("Germany", "Europe and Central Asia", "high"), C("France", "Europe and Central Asia", "high"), C("Netherlands", "Europe and Central Asia", "high"),
  C("Belgium", "Europe and Central Asia", "high"), C("Denmark", "Europe and Central Asia", "high"), C("Norway", "Europe and Central Asia", "high"),
  C("Sweden", "Europe and Central Asia", "high"), C("Finland", "Europe and Central Asia", "high"), C("Ireland", "Europe and Central Asia", "high"),
  C("Italy", "Europe and Central Asia", "high"), C("Spain", "Europe and Central Asia", "high"), C("Portugal", "Europe and Central Asia", "high"),
  C("Switzerland", "Europe and Central Asia", "high"), C("Austria", "Europe and Central Asia", "high"), C("Poland", "Europe and Central Asia", "high"),
  C("Czechia", "Europe and Central Asia", "high", "Czech Republic"), C("Estonia", "Europe and Central Asia", "high"), C("Greece", "Europe and Central Asia", "high"),
  // North America
  C("United States", "North America", "high", "USA", "U.S.", "US cities", "American cities", "Chicago", "New York", "Massachusetts", "Tennessee", "Boston", "Tulsa", "California", "Texas"),
  C("Canada", "North America", "high", "Canadian")
];
export const POOLED = [
  { id: "pooled-lmic", name: "Low- and middle-income countries (pooled)", income: "lmic", re: /\blow-?\s*(and|or)\s*middle[- ]income\s+countr|\bLMICs?\b|\bdeveloping countr/i },
  { id: "pooled-high", name: "High-income countries (pooled)", income: "high", re: /\bhigh[- ]income\s+countr|\bOECD countr/i }
];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = COUNTRIES.map(c => ({ c, re: new RegExp("(^|[^A-Za-z])(" + c.aliases.map(esc).join("|") + ")(?![A-Za-z])", c.aliases.some(a => a.length <= 3) ? "" : "i") }));

// settingsOf(text) -> [{ id, name, region, income }] in the order of the table; pooled phrases included.
export function settingsOf(...texts) {
  const t = texts.filter(Boolean).join(" \n ");
  if (!t) return [];
  const out = PATTERNS.filter(x => x.re.test(t)).map(x => ({ id: x.c.id, name: x.c.name, region: x.c.region, income: x.c.income }));
  for (const p of POOLED) if (p.re.test(t)) out.push({ id: p.id, name: p.name, region: "pooled", income: p.income });
  return out;
}

// Income groups a list of settings covers; a pooled LMIC review covers the three non-high groups at once.
export function incomesOf(settings) {
  const s = new Set();
  for (const x of settings) { if (x.income === "lmic") ["low", "lower-middle", "upper-middle"].forEach(i => s.add(i)); else if (INCOME[x.income]) s.add(x.income); }
  return s;
}
