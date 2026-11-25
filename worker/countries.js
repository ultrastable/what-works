// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// Settings, so lessons cross borders (Rowan, 2026-11-25: "Make sure this isn't country specific and applies to many different types of countries and
// governments. There are many lessons learned around the world to cross pollinate."). Each country carries the context a reader needs to judge whether
// a result travels: world region, income group, how the state is organised (federal or unitary) and how the executive is formed. The knowledge graph
// (graph.js) links every programme to the settings its trials ran in, so programmes and results connect across countries, and a programme that works
// in one kind of setting but was never tested in another is named.
//
// Sources: income groups are the World Bank's country classification (fiscal year 2025, published July 2024); `null` where this file does not record a
// group with confidence, which the graph reports as unrecorded, never guessed. State structure and executive type are the constitutional form in 2024:
// executive is presidential, parliamentary, semi-presidential, monarchy (a monarch holds executive power), one-party or directorial.
// Aliases are the names and places that appear in programme and trial text; a sub-national place maps to its country.
export const INCOME = { high: "High income", "upper-middle": "Upper-middle income", "lower-middle": "Lower-middle income", low: "Low income" };
export const STRUCTURE = { federal: "Federal state", unitary: "Unitary state" };
export const EXECUTIVE = { presidential: "Presidential system", parliamentary: "Parliamentary system", "semi-presidential": "Semi-presidential system",
  monarchy: "Executive monarchy", "one-party": "One-party state", directorial: "Directorial system" };
export const REGIONS = { "north-america": "North America", "latin-america": "Latin America and Caribbean", europe: "Europe and Central Asia", "middle-east": "Middle East and North Africa",
  "sub-saharan-africa": "Sub-Saharan Africa", "south-asia": "South Asia", "east-asia": "East Asia and Pacific" };

// [key, name, region, income, structure, executive, aliases[]]
const ROWS = [
  ["united-states", "United States", "north-america", "high", "federal", "presidential", ["United States", "US cities", "U.S.", "Tennessee", "Chicago", "New York", "Massachusetts", "Boston", "Tulsa", "Minneapolis", "Philadelphia", "California"]],
  ["canada", "Canada", "north-america", "high", "federal", "parliamentary", ["Canada", "Canadian", "Toronto", "Montreal", "Vancouver"]],
  ["mexico", "Mexico", "latin-america", "upper-middle", "federal", "presidential", ["Mexico", "Mexican", "Progresa", "Oportunidades"]],
  ["brazil", "Brazil", "latin-america", "upper-middle", "federal", "presidential", ["Brazil", "Brazilian", "Bolsa Fam"]],
  ["argentina", "Argentina", "latin-america", "upper-middle", "federal", "presidential", ["Argentina"]],
  ["chile", "Chile", "latin-america", "high", "unitary", "presidential", ["Chile"]],
  ["colombia", "Colombia", "latin-america", "upper-middle", "unitary", "presidential", ["Colombia", "Bogot", "Medell"]],
  ["peru", "Peru", "latin-america", "upper-middle", "unitary", "presidential", ["Peru"]],
  ["ecuador", "Ecuador", "latin-america", "upper-middle", "unitary", "presidential", ["Ecuador"]],
  ["uruguay", "Uruguay", "latin-america", "high", "unitary", "presidential", ["Uruguay"]],
  ["nicaragua", "Nicaragua", "latin-america", "lower-middle", "unitary", "presidential", ["Nicaragua"]],
  ["honduras", "Honduras", "latin-america", "lower-middle", "unitary", "presidential", ["Honduras"]],
  ["united-kingdom", "United Kingdom", "europe", "high", "unitary", "parliamentary", ["United Kingdom", "England", "Scotland", "Wales", "London", "Britain", "British"]],
  ["ireland", "Ireland", "europe", "high", "unitary", "parliamentary", ["Ireland"]],
  ["france", "France", "europe", "high", "unitary", "semi-presidential", ["France", "French"]],
  ["germany", "Germany", "europe", "high", "federal", "parliamentary", ["Germany", "German"]],
  ["netherlands", "Netherlands", "europe", "high", "unitary", "parliamentary", ["Netherlands", "Dutch"]],
  ["belgium", "Belgium", "europe", "high", "federal", "parliamentary", ["Belgium"]],
  ["switzerland", "Switzerland", "europe", "high", "federal", "directorial", ["Switzerland", "Swiss"]],
  ["austria", "Austria", "europe", "high", "federal", "parliamentary", ["Austria"]],
  ["italy", "Italy", "europe", "high", "unitary", "parliamentary", ["Italy", "Italian"]],
  ["spain", "Spain", "europe", "high", "unitary", "parliamentary", ["Spain", "Spanish"]],
  ["portugal", "Portugal", "europe", "high", "unitary", "semi-presidential", ["Portugal"]],
  ["sweden", "Sweden", "europe", "high", "unitary", "parliamentary", ["Sweden", "Swedish"]],
  ["norway", "Norway", "europe", "high", "unitary", "parliamentary", ["Norway", "Norwegian"]],
  ["denmark", "Denmark", "europe", "high", "unitary", "parliamentary", ["Denmark", "Danish"]],
  ["finland", "Finland", "europe", "high", "unitary", "parliamentary", ["Finland", "Finnish"]],
  ["poland", "Poland", "europe", "high", "unitary", "semi-presidential", ["Poland"]],
  ["bosnia", "Bosnia and Herzegovina", "europe", "upper-middle", "federal", null, ["Bosnia"]],
  ["turkey", "Turkey", "europe", "upper-middle", "unitary", "presidential", ["Turkey", "Türkiye"]],
  ["israel", "Israel", "middle-east", "high", "unitary", "parliamentary", ["Israel"]],
  ["morocco", "Morocco", "middle-east", "lower-middle", "unitary", "monarchy", ["Morocco"]],
  ["egypt", "Egypt", "middle-east", "lower-middle", "unitary", "semi-presidential", ["Egypt"]],
  ["jordan", "Jordan", "middle-east", null, "unitary", "monarchy", ["Jordan"]],
  ["kenya", "Kenya", "sub-saharan-africa", "lower-middle", "unitary", "presidential", ["Kenya", "Kenyan", "Nairobi"]],
  ["uganda", "Uganda", "sub-saharan-africa", "low", "unitary", "presidential", ["Uganda"]],
  ["tanzania", "Tanzania", "sub-saharan-africa", "lower-middle", "unitary", "presidential", ["Tanzania"]],
  ["rwanda", "Rwanda", "sub-saharan-africa", "low", "unitary", "presidential", ["Rwanda"]],
  ["ethiopia", "Ethiopia", "sub-saharan-africa", "low", "federal", "parliamentary", ["Ethiopia"]],
  ["malawi", "Malawi", "sub-saharan-africa", "low", "unitary", "presidential", ["Malawi"]],
  ["mozambique", "Mozambique", "sub-saharan-africa", "low", "unitary", "presidential", ["Mozambique"]],
  ["ghana", "Ghana", "sub-saharan-africa", "lower-middle", "unitary", "presidential", ["Ghana"]],
  ["nigeria", "Nigeria", "sub-saharan-africa", "lower-middle", "federal", "presidential", ["Nigeria"]],
  ["niger", "Niger", "sub-saharan-africa", "low", "unitary", null, ["Niger,", "Niger "]],
  ["liberia", "Liberia", "sub-saharan-africa", "low", "unitary", "presidential", ["Liberia"]],
  ["sierra-leone", "Sierra Leone", "sub-saharan-africa", "low", "unitary", "presidential", ["Sierra Leone"]],
  ["south-africa", "South Africa", "sub-saharan-africa", "upper-middle", "unitary", "parliamentary", ["South Africa"]],
  ["india", "India", "south-asia", "lower-middle", "federal", "parliamentary", ["India"]],
  ["pakistan", "Pakistan", "south-asia", "lower-middle", "federal", "parliamentary", ["Pakistan"]],
  ["bangladesh", "Bangladesh", "south-asia", "lower-middle", "unitary", "parliamentary", ["Bangladesh"]],
  ["nepal", "Nepal", "south-asia", "lower-middle", "federal", "parliamentary", ["Nepal"]],
  ["sri-lanka", "Sri Lanka", "south-asia", "lower-middle", "unitary", "semi-presidential", ["Sri Lanka"]],
  ["china", "China", "east-asia", "upper-middle", "unitary", "one-party", ["China", "Chinese"]],
  ["vietnam", "Vietnam", "east-asia", "lower-middle", "unitary", "one-party", ["Vietnam", "Viet Nam"]],
  ["indonesia", "Indonesia", "east-asia", "upper-middle", "unitary", "presidential", ["Indonesia"]],
  ["philippines", "Philippines", "east-asia", "lower-middle", "unitary", "presidential", ["Philippines", "Filipino"]],
  ["thailand", "Thailand", "east-asia", "upper-middle", "unitary", "parliamentary", ["Thailand"]],
  ["mongolia", "Mongolia", "east-asia", "upper-middle", "unitary", "semi-presidential", ["Mongolia"]],
  ["japan", "Japan", "east-asia", "high", "unitary", "parliamentary", ["Japan", "Japanese"]],
  ["south-korea", "South Korea", "east-asia", "high", "unitary", "presidential", ["South Korea"]],
  ["australia", "Australia", "east-asia", "high", "federal", "parliamentary", ["Australia", "Australian"]],
  ["new-zealand", "New Zealand", "east-asia", "high", "unitary", "parliamentary", ["New Zealand"]],
];
export const COUNTRIES = Object.fromEntries(ROWS.map(([key, name, region, income, structure, executive, aliases]) => [key, { key, name, region, income, structure, executive, aliases }]));
// Every country whose name or a place inside it appears in the text ("Niger" is matched only as a whole word, never inside "Nigeria").
export function countriesOf(text) {
  const t = String(text || "") + " ";
  return Object.values(COUNTRIES).filter(c => c.aliases.some(a => t.includes(a))).map(c => c.key);
}
