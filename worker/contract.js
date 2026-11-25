// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// FLEET-CONTRACT-1: what What Works states, the page that shows each statement and the endpoint that backs it. The shared module
// (vendor/ultrastable/contract.js, the core's seed/worker/src/contract.js) serves /.well-known/ultrastable.json and /claims.json from this one
// declaration; contract.test.mjs runs its verify() against the router, and the platform runs the same reading against the deployed site.
import { SITE } from "./promote.js";

export const SPEC = {
  name: "What Works",
  summary: "A living atlas of what works in public policy: every programme graded by its trials and re-graded as evidence lands.",
  url: SITE,
  repo: "ultrastable/what-works",
  statements: [
    { id: "graded", text: "Each public programme is graded by its trials and re-graded as new evidence lands.", page: "/", api: "/api/programmes" },
    { id: "measures", text: "The counts on the home page (programmes, trials and reviews, re-grades in 30 days, share checked this week) are computed on each request.", page: "/", api: "/api/metrics" },
    { id: "regrades", text: "Every change of verdict or strength is listed, newest first, with the evidence that moved it.", page: "/changes", api: "/api/changes" },
    { id: "recheck", text: "Every hour the atlas checks the programmes checked longest ago for new evidence.", page: "/rubric", api: "/api/freshness" },
    { id: "settings", text: "Every question about what countries could learn from each other is computed from the grades and from the countries the sources themselves name.", page: "/world", api: "/api/settings" },
    { id: "connections", text: "Every hour the atlas rebuilds a graph of its programmes, trials, authors, outcomes and places, and reads it for patterns nobody typed in.", page: "/connections", api: "/graph.json" },
    { id: "catalog", text: "The atlas describes itself as a data catalogue in open linked-data vocabularies, so other systems can read what it holds.", page: "/", api: "/api/catalog" },
    { id: "regrades-provenance", text: "Every re-grade is also published with its provenance as linked data.", page: "/changes", api: "/api/changes.jsonld" },
    { id: "data-graph", text: "The atlas also keeps a graph of all its records and reads it for hubs, bridges and records that connect to nothing.", page: "/connections", api: "/api/graph/insights" },
  ],
  internal: [
    { path: "/api/guess", why: "write route for the guess buttons on a programme page (POST only); nothing to read" },
    { path: "/api/programmes.json", why: "alias of /api/programmes kept for older links; same body" },
    { path: "/api/programme/*", why: "one programme of /api/programmes by id (the graded statement's data); each programme page /p/<id> shows the same record" },
    { path: "/api/graph/*", why: "query routes of the records graph (one node, a search) that need a parameter; the graph itself is the data-graph statement" },
  ],
};
