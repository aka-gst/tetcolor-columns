import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('admin sound meter observes the shared master output and exposes playback by moment', () => {
  assert.match(page, /type SoundLevel = \{ rms: number; peak: number \}/);
  assert.match(page, /const meter = context\.createAnalyser\(\)/);
  assert.match(page, /out\.connect\(meter\);\s*meter\.connect\(context\.destination\)/);
  assert.match(page, /sound: \{ play:.*level:/s);
  assert.match(page, /ЗАМЕР:\s*RMS/);
  assert.match(page, /setSoundProbe/);
  assert.match(page, /ПРОВЕРИТЬ ТИШИНУ/);
});

test('every bundled sound has one finite output trim', () => {
  const library = [...page.matchAll(/`sounds\/(?:custom\/custom-|eggs\/egg-)?\$\{index \+ 1\}\.mp3`/g)].length;
  const trims = page.match(/const LEVEL_TRIM: Record<string, number> = \{([\s\S]*?)\n\};/);
  assert.ok(trims);
  const values = [...trims[1].matchAll(/^  '[^']+': ([0-9.]+),$/gm)].map(match => Number(match[1]));
  assert.equal(values.length, 43);
  assert.equal(values.every(value => Number.isFinite(value) && value > 0), true);
  assert.equal(library, 2);
});

test('backdrop is a non-persistent visual choice with three named pilot slots', () => {
  assert.match(page, /type Backdrop = 'current' \| 'neon-rhythm' \| 'neon-prism' \| 'neon-wave'/);
  assert.match(page, /data-backdrop=\{showcaseMode \? 'current' : backdrop\}/);
  for (const id of ['neon-rhythm', 'neon-prism', 'neon-wave']) {
    assert.match(css, new RegExp(`main\\[data-backdrop='${id}'\\]`));
  }
});

test('a saved game restores progress but never locks the next random block skin', () => {
  assert.match(page, /const rolled = choice === 'random' \? rollBlocks\(isBlockStyle\(previous\) \? previous : undefined\) : choice;/);
  assert.doesNotMatch(page, /restored && isBlockStyle\(restored\.look\) \? restored\.look/);
});
