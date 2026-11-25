# What Works: agent instructions

> Ultrastable is the foundation for any autonomous system.

What Works is a tenant system on Ultrastable: a living atlas of what works in public policy. This repository holds its code (`worker/`) and the core files it reads, vendored under `vendor/ultrastable/`. Its manifest (IDEA.md, instance.json, lifecycle.json, runway.json) and the platform rules every agent follows live in the core repository, `ultrastable/ultrastable` (`agents/AGENTS.md`, `instances/what-works/`, `doctrine/tenant-repos.json`).

- Test: `node --test worker/*.test.mjs`.
- Deploy: the platform builds this repository's `main` into the `ultrastable-what-works` Worker (D1 `ultrastable-what-works`, Workers AI, hourly cron). Nothing here holds a credential.
- Honest grading: every verdict is computed by `worker/grade.js`; never type a grade. Findings carry no typed numbers. A model may only label a study's design and direction, each with a verbatim quote from its abstract.
- No accounts, no cookies; reader guesses are anonymous counts.
- Static content is not autonomous (STATIC-IS-NOT-AUTONOMOUS-1, Rowan 2026-11-25: "Static content is NOT autonomous and is contrary to objective of an Ultrastable system."). The curated programmes are a seed: `worker/discover.js` finds new programmes in systematic reviews and impact evaluations (Crossref, OpenAlex, Europe PMC), reads them in under the verbatim guard and adds them to D1 `found_programmes`; every page, feed, graph and the social queue read the grown list. `/health` `discovery.ok` goes false when no discovery route answered for 30 hours. Never grow the atlas by hand-editing `programmes.js` alone.
- Global, not one country (GLOBAL-1, Rowan 2026-11-25: "Make sure this isn't country specific and applies to many different types of countries and governments. There are many lessons learned around the world to cross pollinate."). `worker/countries.js` reads the countries each source names and tags region and World Bank income group; `worker/learn.js` turns grades by setting into cross-country questions at `/world` and `/api/settings`. Discovery reads sources whose evidence spans every income group.
