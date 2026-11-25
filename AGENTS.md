# What Works: agent instructions

> Ultrastable is the foundation for any autonomous system.

What Works is a tenant system on Ultrastable: a living atlas of what works in public policy. This repository holds its code (`worker/`) and the core files it reads, vendored under `vendor/ultrastable/`. Its manifest (IDEA.md, instance.json, lifecycle.json, runway.json) and the platform rules every agent follows live in the core repository, `ultrastable/ultrastable` (`agents/AGENTS.md`, `instances/what-works/`, `doctrine/tenant-repos.json`).

- Test: `node --test worker/*.test.mjs`.
- Deploy: the platform builds this repository's `main` into the `ultrastable-what-works` Worker (D1 `ultrastable-what-works`, Workers AI, hourly cron). Nothing here holds a credential.
- Honest grading: every verdict is computed by `worker/grade.js`; never type a grade. Findings carry no typed numbers. A model may only label a study's design and direction, each with a verbatim quote from its abstract.
- No accounts, no cookies; reader guesses are anonymous counts.
