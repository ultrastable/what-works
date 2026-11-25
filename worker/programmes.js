// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The atlas's curated programmes. A programme names one intervention and the one outcome it is graded on; its trials are the published
// evaluations of that outcome. No grade is typed here: the verdict and strength are computed from the trials by grade.js, and the hourly
// beat (evidence.js) checks every citation against Crossref and adds new trials as they are published, so the grade moves with the evidence.
//
// Trial fields: title, authors, year, venue (as published), design (a key of DESIGNS in grade.js), direction (a key of DIRECTIONS),
// study (one id per experiment, so follow-ups of the same trial never count as replication), finding (plain words, no numbers: a number
// enters only from the source itself).

export const AREAS = [
  { id: "crime", name: "Crime and justice", hue: 8 },
  { id: "children", name: "Children and schools", hue: 210 },
  { id: "poverty", name: "Poverty and cash", hue: 140 },
  { id: "housing", name: "Housing and neighbourhoods", hue: 35 },
  { id: "development", name: "Global development", hue: 280 },
  { id: "health", name: "Health and care", hue: 330 },
  { id: "work", name: "Work and welfare", hue: 175 },
  // DOMAINS-1: government itself is a programme area: how the state is run, the law it enforces and how it is chosen.
  { id: "governance", name: "Governance and public administration", hue: 55 },
  { id: "law", name: "Law, regulation and courts", hue: 20 },
  { id: "democracy", name: "Elections and democratic institutions", hue: 300 },
  { id: "environment", name: "Environment and energy", hue: 110 },
  { id: "other", name: "Other public programmes", hue: 250 }
];

export const PROGRAMMES = [
  {
    id: "scared-straight", area: "crime", name: "Scared Straight prison visits",
    what: "Young people at risk of offending visit a prison, where inmates confront them with the reality of prison life.",
    outcome: "later offending by the young people who took part",
    where: "United States, also copied elsewhere",
    feels: "A frightening look at prison seems like it should deter a teenager from the path that leads there.",
    query: "\"scared straight\" OR \"juvenile awareness\" prison visit delinquency",
    trials: [
      { study: "petrosino-cochrane", title: "'Scared Straight' and other juvenile awareness programs for preventing juvenile delinquency", authors: "Petrosino A, Turpin-Petrosino C, Hollis-Peel ME, Lavenberg JG", year: 2013, venue: "Cochrane Database of Systematic Reviews", design: "meta-rct", direction: "negative",
        finding: "Across the randomized trials, young people who went on the prison visits offended more afterwards than those who did not." }
    ]
  },
  {
    id: "cambridge-somerville", area: "crime", name: "Mentoring and counselling for at-risk boys (Cambridge-Somerville)",
    what: "Boys judged at risk of delinquency got years of counselling, mentoring, tutoring, medical care and summer camps.",
    outcome: "criminal records and life outcomes in adulthood",
    where: "Massachusetts, United States",
    feels: "Years of caring adult attention for boys at risk sounds like the kindest and surest prevention there is.",
    query: "Cambridge-Somerville youth study mentoring delinquency follow-up",
    trials: [
      { study: "cambridge-somerville", title: "A thirty-year follow-up of treatment effects", authors: "McCord J", year: 1978, venue: "American Psychologist", design: "rct", direction: "negative",
        finding: "Thirty years on, the boys who received the programme did worse than their matched controls on several outcomes, including later convictions." }
    ]
  },
  {
    id: "hot-spots-policing", area: "crime", name: "Hot spots policing",
    what: "Police concentrate patrols and problem-solving on the small places, a few street blocks, where crime clusters.",
    outcome: "crime in the targeted places, and whether it moves next door",
    where: "United States, United Kingdom and elsewhere",
    feels: "Many people expect crime simply to move around the corner when police focus on one spot.",
    query: "\"hot spots policing\" randomized crime displacement",
    trials: [
      { study: "minneapolis-hot-spots", title: "General deterrent effects of police patrol in crime \"hot spots\": a randomized, controlled trial", authors: "Sherman LW, Weisburd D", year: 1995, venue: "Justice Quarterly", design: "rct", direction: "positive",
        finding: "Doubling patrol presence at randomly chosen hot spots reduced calls for service and observed disorder there." },
      { study: "braga-campbell-2019", title: "Hot spots policing of small geographic areas effects on crime", authors: "Braga AA, Turchan BS, Papachristos AV, Hureau DM", year: 2019, venue: "Campbell Systematic Reviews", design: "review", direction: "positive",
        finding: "Across many evaluations, hot spots policing reduced crime in the targeted places, and nearby areas more often saw a fall than a rise." }
    ]
  },
  {
    id: "dare", area: "children", name: "D.A.R.E. drug education in schools",
    what: "Uniformed police officers teach a classroom curriculum on resisting drugs, alcohol and peer pressure.",
    outcome: "later drug and alcohol use by the pupils",
    where: "United States",
    feels: "Teaching children the facts and the refusal skills, from a figure of authority, sounds like it must reduce drug use.",
    query: "\"drug abuse resistance education\" OR \"Project DARE\" evaluation",
    trials: [
      { study: "dare-meta-1994", title: "How effective is drug abuse resistance education? A meta-analysis of Project DARE outcome evaluations", authors: "Ennett ST, Tobler NS, Ringwalt CL, Flewelling RL", year: 1994, venue: "American Journal of Public Health", design: "review", direction: "null",
        finding: "Effects on drug use were small and not distinguishable from none, smaller than for interactive prevention programmes." },
      { study: "dare-kentucky", title: "The effectiveness of Drug Abuse Resistance Education (Project DARE): 5-year follow-up results", authors: "Clayton RR, Cattarello AM, Johnstone BM", year: 1996, venue: "Preventive Medicine", design: "cluster-rct", direction: "null",
        finding: "Schools randomly given DARE showed no lasting difference in pupils' drug use five years later." },
      { study: "dare-meta-2004", title: "Project D.A.R.E. outcome effectiveness revisited", authors: "West SL, O'Neal KK", year: 2004, venue: "American Journal of Public Health", design: "review", direction: "null",
        finding: "Pooling the rigorous evaluations again, the effect on drug use stayed close to zero." }
    ]
  },
  {
    id: "becoming-a-man", area: "crime", name: "Becoming a Man (CBT for teenage boys)",
    what: "Weekly group sessions in school teach teenage boys to slow down and rethink automatic reactions, drawing on cognitive behavioural therapy.",
    outcome: "arrests, especially for violent crime, and staying in school",
    where: "Chicago, United States",
    feels: "Talking about thinking habits seems too soft to touch something as hard as youth violence.",
    query: "\"Becoming a Man\" cognitive behavioral therapy youth violence randomized",
    trials: [
      { study: "bam-chicago", title: "Thinking, fast and slow? Some field experiments to reduce crime and dropout in Chicago", authors: "Heller SB, Shah AK, Guryan J, Ludwig J, Mullainathan S, Pollack HA", year: 2017, venue: "Quarterly Journal of Economics", design: "rct", direction: "positive",
        finding: "Boys randomly offered the programme were arrested less during it, with large falls in violent-crime arrests, and a juvenile-detention version reduced readmission." }
    ]
  },
  {
    id: "summer-jobs", area: "crime", name: "Summer jobs for young people",
    what: "Teenagers from high-violence neighbourhoods get a paid summer job, sometimes with a mentor.",
    outcome: "violent-crime arrests and later involvement with the justice system",
    where: "Chicago, New York and other US cities",
    feels: "A few weeks of work in one summer seems too short to change what happens in a young person's life after it ends.",
    query: "\"summer youth employment\" violence arrests randomized lottery",
    trials: [
      { study: "chicago-summer-2012", title: "Summer jobs reduce violence among disadvantaged youth", authors: "Heller SB", year: 2014, venue: "Science", design: "rct", direction: "positive",
        finding: "Youth randomly offered a summer job had fewer violent-crime arrests over the following year, mostly after the job had ended." },
      { study: "chicago-summer-2013", title: "Rethinking the benefits of youth employment programs: the heterogeneous effects of summer jobs", authors: "Davis JMV, Heller SB", year: 2020, venue: "Review of Economics and Statistics", design: "rct", direction: "positive",
        finding: "A second cohort again showed fewer violent-crime arrests, while later employment did not improve." },
      { study: "nyc-syep", title: "The effects of youth employment: evidence from New York City lotteries", authors: "Gelber A, Isen A, Kessler JB", year: 2016, venue: "Quarterly Journal of Economics", design: "rct", direction: "positive",
        finding: "Lottery winners were less likely to be incarcerated and less likely to die, though later earnings did not rise." }
    ]
  },
  {
    id: "nurse-home-visiting", area: "children", name: "Nurse home visiting for first-time mothers",
    what: "A trained nurse visits a first-time, low-income mother regularly from pregnancy until the child turns two.",
    outcome: "child maltreatment, maternal life course and early child health",
    where: "United States (Nurse-Family Partnership) and England (Family Nurse Partnership)",
    feels: "Regular expert support for a new mother sounds like it should help everywhere it is tried.",
    query: "\"nurse home visiting\" OR \"Nurse-Family Partnership\" OR \"Family Nurse Partnership\" randomized",
    trials: [
      { study: "nfp-elmira", title: "Long-term effects of home visitation on maternal life course and child abuse and neglect: fifteen-year follow-up of a randomized trial", authors: "Olds DL, Eckenrode J, Henderson CR, et al.", year: 1997, venue: "JAMA", design: "rct", direction: "positive",
        finding: "Fifteen years on, visited families had fewer verified reports of child abuse and neglect, and mothers fewer later births and less welfare use." },
      { study: "nfp-memphis", title: "Effect of prenatal and infancy home visitation by nurses on pregnancy outcomes, childhood injuries, and repeated childbearing: a randomized controlled trial", authors: "Kitzman H, Olds DL, Henderson CR, et al.", year: 1997, venue: "JAMA", design: "rct", direction: "positive",
        finding: "In a mostly African American urban sample, visited families had fewer childhood injury visits and fewer closely spaced second births." },
      { study: "fnp-building-blocks", title: "Effectiveness of a nurse-led intensive home-visitation programme for first-time teenage mothers (Building Blocks): a pragmatic randomised controlled trial", authors: "Robling M, Bekkers MJ, Bell K, et al.", year: 2016, venue: "The Lancet", design: "rct", direction: "null",
        finding: "In England, where usual care already included health visitors, adding the programme did not improve the trial's primary outcomes." }
    ]
  },
  {
    id: "class-size", area: "children", name: "Smaller classes in the early grades",
    what: "Children in the first years of school are taught in classes of about fifteen instead of about twenty-two.",
    outcome: "test scores and later life outcomes",
    where: "Tennessee (Project STAR) and Israel",
    feels: "Some argue class size barely matters once a teacher is good; others assume smaller is always better.",
    query: "\"class size\" reduction randomized OR \"regression discontinuity\" achievement",
    trials: [
      { study: "star", title: "Experimental estimates of education production functions", authors: "Krueger AB", year: 1999, venue: "Quarterly Journal of Economics", design: "rct", direction: "positive",
        finding: "Pupils randomly assigned to small classes scored higher, with larger gains for minority and low-income pupils." },
      { study: "star", title: "How does your kindergarten classroom affect your earnings? Evidence from Project STAR", authors: "Chetty R, Friedman JN, Hilger N, Saez E, Schanzenbach DW, Yagan D", year: 2011, venue: "Quarterly Journal of Economics", design: "rct", direction: "positive",
        finding: "Following the same trial into adulthood, small-class pupils were more likely to attend college; earnings differences were not significant." },
      { study: "maimonides", title: "Using Maimonides' rule to estimate the effect of class size on scholastic achievement", authors: "Angrist JD, Lavy V", year: 1999, venue: "Quarterly Journal of Economics", design: "natural-experiment", direction: "positive",
        finding: "Where a class-size cap split cohorts into smaller classes, older pupils in those classes scored higher in reading and maths." }
    ]
  },
  {
    id: "public-pre-k", area: "children", name: "Public pre-kindergarten at scale",
    what: "A state or city offers a free year of preschool to four-year-olds, run through the public school system.",
    outcome: "school readiness and achievement in the years after",
    where: "Tennessee, Tulsa and Boston, United States",
    feels: "Small model preschools famously changed lives, so a public programme for everyone seems sure to do the same.",
    query: "\"pre-kindergarten\" OR \"pre-K\" public program effects achievement randomized OR \"regression discontinuity\"",
    trials: [
      { study: "tulsa-prek", title: "The effects of universal pre-K on cognitive development", authors: "Gormley WT, Gayer T, Phillips D, Dawson B", year: 2005, venue: "Developmental Psychology", design: "natural-experiment", direction: "positive",
        finding: "Children who had just finished Tulsa's pre-K scored higher on early literacy and maths tests than those who just missed the age cutoff." },
      { study: "boston-prek", title: "Impacts of a prekindergarten program on children's mathematics, language, literacy, executive function, and emotional skills", authors: "Weiland C, Yoshikawa H", year: 2013, venue: "Child Development", design: "natural-experiment", direction: "positive",
        finding: "Boston's pre-K raised language, literacy and maths skills at kindergarten entry, by an age-cutoff comparison." },
      { study: "tn-vpk", title: "Effects of a statewide pre-kindergarten program on children's achievement and behavior through sixth grade", authors: "Durkin K, Lipsey MW, Farran DC, Wiesen SE", year: 2022, venue: "Developmental Psychology", design: "rct", direction: "negative",
        finding: "Children randomly admitted to Tennessee's programme did worse by sixth grade on achievement and had more disciplinary problems." }
    ]
  },
  {
    id: "unconditional-cash", area: "poverty", name: "Unconditional cash transfers",
    what: "Poor households receive money with no conditions on how it is spent.",
    outcome: "consumption, assets and wellbeing of recipients",
    where: "Kenya, Uganda",
    feels: "Many expect free money to be wasted on alcohol or to make people stop working.",
    query: "\"unconditional cash transfer\" randomized consumption",
    trials: [
      { study: "givedirectly-kenya-2016", title: "The short-term impact of unconditional cash transfers to the poor: experimental evidence from Kenya", authors: "Haushofer J, Shapiro J", year: 2016, venue: "Quarterly Journal of Economics", design: "rct", direction: "positive",
        finding: "Recipients spent more on food and assets such as metal roofs and livestock, and reported better psychological wellbeing; spending on alcohol and tobacco did not rise." },
      { study: "givedirectly-ge", title: "General equilibrium effects of cash transfers: experimental evidence from Kenya", authors: "Egger D, Haushofer J, Miguel E, Niehaus P, Walker M", year: 2022, venue: "Econometrica", design: "cluster-rct", direction: "positive",
        finding: "Large transfers to villages raised spending for recipients and non-recipients alike, with little rise in local prices." },
      { study: "uganda-yop", title: "Generating skilled self-employment in developing countries: experimental evidence from Uganda", authors: "Blattman C, Fiala N, Martinez S", year: 2014, venue: "Quarterly Journal of Economics", design: "rct", direction: "positive",
        finding: "Groups of young people given unsupervised grants invested in skills and tools and earned more four years later." }
    ]
  },
  {
    id: "conditional-cash", area: "poverty", name: "Conditional cash transfers for schooling",
    what: "Poor families are paid regularly on condition that their children attend school and health check-ups.",
    outcome: "school enrolment and attendance",
    where: "Mexico (Progresa) and Malawi",
    feels: "Paying families to send children to school can seem like bribery that should not be needed, or that will not stick.",
    query: "\"conditional cash transfer\" schooling enrolment randomized",
    trials: [
      { study: "progresa", title: "School subsidies for the poor: evaluating the Mexican Progresa poverty program", authors: "Schultz TP", year: 2004, venue: "Journal of Development Economics", design: "rct", direction: "positive",
        finding: "Villages randomly phased in first saw higher school enrolment, most of all at the move to secondary school." },
      { study: "malawi-zomba", title: "Cash or condition? Evidence from a cash transfer experiment", authors: "Baird S, McIntosh C, Özler B", year: 2011, venue: "Quarterly Journal of Economics", design: "rct", direction: "positive",
        finding: "Schoolgirls paid on condition of attendance enrolled and learned more than unconditional recipients, though unconditional cash did more to delay marriage and pregnancy." }
    ]
  },
  {
    id: "microcredit", area: "development", name: "Microcredit",
    what: "Small loans are offered to poor people, often women, to start or grow a business.",
    outcome: "household income and poverty",
    where: "Bosnia, Ethiopia, India, Mexico, Mongolia, Morocco, the Philippines",
    feels: "Small loans to the poor were celebrated as a way out of poverty that pays for itself.",
    query: "microcredit OR microfinance randomized household income poverty",
    trials: [
      { study: "six-microcredit", title: "Six randomized evaluations of microcredit: introduction and further steps", authors: "Banerjee A, Karlan D, Zinman J", year: 2015, venue: "American Economic Journal: Applied Economics", design: "meta-rct", direction: "null",
        finding: "Across six randomized evaluations on four continents, access to credit did not transform household incomes, though some businesses grew." },
      { study: "meager-microcredit", title: "Understanding the average impact of microcredit expansions: a Bayesian hierarchical analysis of seven randomized experiments", authors: "Meager R", year: 2019, venue: "American Economic Journal: Applied Economics", design: "meta-rct", direction: "null",
        finding: "Pooling seven randomized experiments, the average effect on household outcomes was likely small, and fairly consistent across places." }
    ]
  },
  {
    id: "deworming", area: "development", name: "Mass deworming in schools",
    what: "All children in schools in affected areas get cheap deworming pills, without testing who is infected.",
    outcome: "school attendance, learning and long-run welfare",
    where: "Kenya and other low-income countries",
    feels: "Treating a common infection cheaply seems an obvious way to help children learn.",
    query: "deworming school children randomized attendance OR cognition",
    trials: [
      { study: "pse-kenya", title: "Worms: identifying impacts on education and health in the presence of treatment externalities", authors: "Miguel E, Kremer M", year: 2004, venue: "Econometrica", design: "cluster-rct", direction: "positive",
        finding: "Schools phased into deworming saw lower absenteeism, including among untreated children nearby; test scores did not rise." },
      { study: "cochrane-deworming-2015", title: "Deworming drugs for soil-transmitted intestinal worms in children: effects on nutritional indicators, haemoglobin, and school performance", authors: "Taylor-Robinson DC, Maayan N, Soares-Weiser K, Donegan S, Garner P", year: 2015, venue: "Cochrane Database of Systematic Reviews", design: "meta-rct", direction: "null",
        finding: "Across the randomized trials, mass deworming showed little or no effect on weight, haemoglobin, cognition or school performance." }
    ]
  },
  {
    id: "moving-to-opportunity", area: "housing", name: "Housing vouchers to move to lower-poverty neighbourhoods",
    what: "Families in public housing get a voucher usable only in a low-poverty neighbourhood, with help to move.",
    outcome: "economic self-sufficiency of the adults and later earnings of the children",
    where: "Five US cities (Moving to Opportunity)",
    feels: "Moving out of a poor neighbourhood seems as if it must lift a family's income.",
    query: "\"Moving to Opportunity\" neighborhood effects randomized",
    trials: [
      { study: "mto", title: "Experimental analysis of neighborhood effects", authors: "Kling JR, Liebman JB, Katz LF", year: 2007, venue: "Econometrica", design: "rct", direction: "null",
        finding: "Adults who moved did not see better employment or earnings, though their mental health improved." },
      { study: "mto", title: "The effects of exposure to better neighborhoods on children: new evidence from the Moving to Opportunity experiment", authors: "Chetty R, Hendren N, Katz LF", year: 2016, venue: "American Economic Review", design: "rct", direction: "positive",
        finding: "Children who moved before about age thirteen earned more as adults and were more likely to attend college; older children did not gain." }
    ]
  },
  {
    id: "housing-first", area: "housing", name: "Housing First",
    what: "Homeless people with mental illness get a permanent home straight away, with support, and no requirement to be sober or in treatment first.",
    outcome: "stable housing",
    where: "New York and five Canadian cities (At Home/Chez Soi)",
    feels: "It can seem reckless to give a home before someone has dealt with addiction or illness.",
    query: "\"Housing First\" randomized homeless housing stability",
    trials: [
      { study: "pathways-nyc", title: "Housing First, consumer choice, and harm reduction for homeless individuals with a dual diagnosis", authors: "Tsemberis S, Gulcur L, Nakae M", year: 2004, venue: "American Journal of Public Health", design: "rct", direction: "positive",
        finding: "People given housing first spent much less time homeless than those in treatment-first services, with no rise in substance use." },
      { study: "at-home-toronto", title: "Effect of scattered-site housing using rent supplements and intensive case management on housing stability among homeless adults with mental illness: a randomized trial", authors: "Stergiopoulos V, Hwang SW, Gozdzik A, et al.", year: 2015, venue: "JAMA", design: "rct", direction: "positive",
        finding: "In Toronto, participants offered Housing First spent far more of their time stably housed than those in usual services." }
    ]
  }
];

export const byId = Object.fromEntries(PROGRAMMES.map(p => [p.id, p]));
export const areaOf = id => AREAS.find(a => a.id === id) || AREAS.find(a => a.id === "other");

// STATIC-IS-NOT-AUTONOMOUS-1: the curated list above is only the seed. The atlas finds further programmes itself (discover.js) and keeps them
// in D1 (found_programmes). syncFound() makes PROGRAMMES and byId curated + found, in place, so every module that reads them (grades, pages,
// feed, sitemap, graph, social queue, evidence search) serves the grown atlas without a deploy.
export const CURATED = PROGRAMMES.slice();
export function fromRow(r) {
  return { id: r.id, area: AREAS.some(a => a.id === r.area) ? r.area : "other", name: r.name, what: r.what, outcome: r.outcome, where: r.place || "as reported in the review",
    feels: "", query: '"' + String(r.name).replace(/"/g, "") + '"', trials: [], found: { ref: r.ref, url: r.url || null, at: r.added_at } };
}
export function syncFound(rows = []) {
  const found = rows.map(fromRow).filter(f => !CURATED.some(c => c.id === f.id));
  PROGRAMMES.length = 0; PROGRAMMES.push(...CURATED, ...found);
  for (const k of Object.keys(byId)) delete byId[k];
  for (const p of PROGRAMMES) byId[p.id] = p;
  return found.length;
}
