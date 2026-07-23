// tests/server/body-limit.test.js
// Regression guard for the 2026-07 snapshot-persistence bug.
//
// Snapshots embed a full state clone (subjects + values + descriptions) each,
// ~8.7KB apiece; the SnapshotStore caps at 20, so a snapshots flush payload
// reaches ~175KB. The world resource-write route parsed the body with a bare
// `express.json()`, whose DEFAULT limit is 100KB — so every snapshot flush past
// ~12 snapshots was silently rejected with HTTP 413 (PayloadTooLarge), swallowed
// client-side by reportFlushError. snapshots.json froze in June; values.json
// (5.8KB, under the limit) kept saving. Net effect: delete/swipe/regen reverts
// had no fresh snapshot to restore from and silently did nothing.
//
// Fix: every JSON body parser must declare an explicit, generous limit. This
// test fails if any bare `express.json()` (default 100KB) is reintroduced.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(path.join(HERE, '..', '..', 'server-plugin.js'), 'utf8');
// Strip comments so the explanatory note (which necessarily spells out the bad
// pattern) isn't itself flagged — only real code counts.
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('no bare express.json() — the default 100KB limit silently 413s snapshot flushes', () => {
  const bare = SRC.match(/express\.json\(\s*\)/g) ?? [];
  assert.deepEqual(
    bare, [],
    `found ${bare.length} bare express.json() parser(s) using the default 100KB limit; ` +
    `each must pass an explicit { limit: ... } so large snapshot payloads persist`,
  );
});

test('every express.json body parser declares an explicit limit', () => {
  const total = (SRC.match(/express\.json\(/g) ?? []).length;
  const withLimit = (SRC.match(/express\.json\(\s*\{\s*limit\s*:/g) ?? []).length;
  assert.equal(
    withLimit, total,
    `expected all ${total} express.json() parsers to declare a limit, only ${withLimit} do`,
  );
});
