import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('card showcase has a quiet URL entry point without replacing the normal showcase API', () => {
  assert.match(page, /showcase=card/);
  assert.match(page, /data-showcase=\{showcaseMode \?\? undefined\}/);
  assert.match(page, /window\.tetcolor = \{[\s\S]*scene,[\s\S]*showcase,/);
});
