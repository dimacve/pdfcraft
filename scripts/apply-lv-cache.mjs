import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'messages/en.json'), 'utf8'));
const cache = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/.lv-translation-cache.json'), 'utf8'));

function apply(obj) {
  if (typeof obj === 'string') return cache[obj] ?? obj;
  if (Array.isArray(obj)) return obj.map(apply);
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = apply(v);
  return out;
}

const lv = apply(en);
fs.writeFileSync(path.join(ROOT, 'messages/lv.json'), JSON.stringify(lv, null, 2) + '\n');
console.log('lv.json written, translated strings:', Object.keys(cache).length);
