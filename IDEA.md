---
# Level 1: a tenant system bootstrapped on Ultrastable. Reports to its parent (tenant 0).
org_name: What Works
slug: what-works
owner: Rowan
owner_contact: set-in-secret-store
owner_contact_backup: set-in-secret-store
parent: ultrastable
parent_health_url: https://ultrastable-tick.ultrastable.workers.dev/health
level: 1
---

# Idea

What Works in Public Policy is a living atlas of public programmes, each graded by its trials and re-graded as evidence lands. A programme names one intervention and the one outcome it is graded on (Scared Straight on later offending, microcredit on household income, Housing First on stable housing). Every verdict (works, promising, mixed, no effect, backfires, too little evidence) and its strength is computed by one rubric from the designs and directions of the studies under it, never typed by hand: randomized evidence weighs most, follow-ups of one experiment count once, and a result must be replicated before it is called works. Readers guess the verdict before the reveal. An hourly loop checks every citation against Crossref and searches OpenAlex and Europe PMC for new trials and reviews; a new publication joins the grade only when its design and effect are each backed by a quote copied word for word from its own abstract, and every change of verdict is logged with the study that moved it.

# System test

- Loop: every hour the beat checks the programmes checked longest ago, resolves their citations, searches two indexes for new trials and reviews, reads them in under the verbatim-quote guard, recomputes every grade and logs each move with its reason, with no person in the middle
- Measure: share of programmes checked for new evidence within 7 days, target 1.0 (/api/freshness, 503 otherwise); every re-grade logged with a reason (/changes); share of readers whose guess missed the verdict (/api/metrics)
- Upkeep: new trials and reviews are published every week, DOIs and links rot, grades must move when the evidence moves, and new programmes keep being added
- Run cost: 5 USD a month for the back end

# Hook

- Guess first: did this famous programme work? Then the trials. The surprise, either way, is the hook.

# Public good

- Citizens, journalists and public servants can see what the best evidence says about a programme before money is spent on it again, and see the verdict move when new evidence lands.

# Who it is for

- Policy staff and analysts choosing or defending a programme
- Journalists and teachers who want a graded, cited summary to point people to
- Anyone curious whether a famous policy did what it promised

# First outcomes

- Every programme checked for new evidence within 7 days, measured at /api/freshness
- Every re-grade logged with the study that moved it, published at /changes and /feed.json
- The atlas grows past its first 15 programmes in five areas

# Constraints

- Budget per month: 5
- No accounts, cookies or trackers; guesses are counted per programme with nothing that identifies the reader
- A model may only label a publication's design and direction, each with a verbatim quote from its abstract; it never adds a number, a name or a claim
- Mixed evidence is graded mixed, never rounded to a verdict
