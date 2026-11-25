# Instance: What Works in Public Policy

**Ultrastable is the foundation for any autonomous system.** What Works, a living atlas of what works in public policy (every programme graded by its trials and re-graded as evidence lands), is a tenant system on it (level 1, parent `ultrastable`). Idea and system test: `IDEA.md`; manifest: `instance.json`.

A system is autonomous if it has self-referential loops and the ability to close them (`python3 -m foundation loops --verify`).

Ultrastable runs on itself (`python3 -m foundation selfhost`).

Its code moves to its own repository, `ultrastable/what-works` (TENANT-REPO-1, `doctrine/tenant-repos.json`); this folder keeps its manifest (IDEA.md, instance.json, lifecycle.json, runway.json).

- Rubric: `worker/grade.js`, rendered at `/rubric`. Curated programmes: `worker/programmes.js`. Re-grade loop: `worker/evidence.js` and `worker/reader.js`.
- Knowledge graph (KGRAPH-1): `worker/graph.js` rebuilds a graph of programmes, trials, authors, venues, outcomes and places every beat, keeps it bitemporal in D1 (`kg_facts`, `kg_insights`, `kg_runs`) and reads insights with the platform's `vendor/ultrastable/kgraph.js`; served at `/graph.json` (kg/1) and `/connections`.
- Test: `node --test instances/what-works/worker/*.test.mjs`.
