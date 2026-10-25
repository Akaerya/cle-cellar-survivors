// Exports every src/art/sprites/*.aseprite to a PNG strip and writes src/art/sprites/sprites.json,
// the manifest the game loads (see src/art/textures.ts). Run after editing art: `npm run sprites`.
// Needs the Aseprite CLI: on PATH as `aseprite`, or set ASEPRITE to the executable.
//
// Frame names: frames inside a tag are `<tag>_<i>` (`<tag>` when the tag has one frame); untagged
// frames are `<file>_<i>` (`<file>` when the file has one frame). Durations come from Aseprite.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = 'src/art/sprites';
const ASEPRITE = process.env.ASEPRITE || 'aseprite';
const tmp = mkdtempSync(join(tmpdir(), 'sprites-'));
const manifest = {};
const names = new Set();

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.aseprite')).sort()) {
  const sheet = file.slice(0, -'.aseprite'.length);
  const data = join(tmp, `${sheet}.json`);
  execFileSync(ASEPRITE, ['-b', join(DIR, file), '--sheet', join(DIR, `${sheet}.png`), '--sheet-type', 'horizontal',
    '--data', data, '--format', 'json-array', '--list-tags'], { stdio: ['ignore', 'ignore', 'inherit'] });
  const json = JSON.parse(readFileSync(data, 'utf8'));
  const frames = json.frames;
  const label = frames.map(() => null);
  for (const t of json.meta.frameTags ?? []) {
    for (let i = t.from; i <= t.to; i++) label[i] = t.to === t.from ? t.name : `${t.name}_${i - t.from}`;
  }
  frames.forEach((_, i) => { label[i] ??= frames.length === 1 ? sheet : `${sheet}_${i}`; });
  const { w, h } = frames[0].sourceSize;
  manifest[sheet] = {
    w,
    h,
    frames: Object.fromEntries(frames.map((f, i) => [label[i], [f.frame.x, f.frame.y, f.duration]])),
  };
  for (const n of label) {
    if (names.has(n)) throw new Error(`frame name ${n} is used twice (in ${sheet})`);
    names.add(n);
  }
}
rmSync(tmp, { recursive: true, force: true });
// One line per frame keeps diffs readable.
const text = JSON.stringify(manifest, null, 1).replace(/\[\s+(\d+),\s+(\d+),\s+(\d+)\s+\]/g, '[$1, $2, $3]');
writeFileSync(join(DIR, 'sprites.json'), text + '\n');
console.log(`exported ${Object.keys(manifest).length} sheets, ${names.size} frames`);
