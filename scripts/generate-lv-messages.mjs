/**
 * Generate messages/lv.json from en.json (en -> lv via MyMemory).
 * Deduplicates strings; caches progress for resume.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const EN_PATH = path.join(ROOT, 'messages/en.json');
const LV_PATH = path.join(ROOT, 'messages/lv.json');
const CACHE_PATH = path.join(ROOT, 'scripts/.lv-translation-cache.json');

const DELAY_MS = 280;
const BRAND = 'PDFCraft';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function collectStrings(obj, out = new Set()) {
  if (typeof obj === 'string') {
    out.add(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v) => collectStrings(v, out));
    return out;
  }
  if (obj && typeof obj === 'object') {
    Object.values(obj).forEach((v) => collectStrings(v, out));
  }
  return out;
}

function tokenize(str) {
  const parts = [];
  const re = /(\{[^}]+\}|<[^>]+>)/g;
  let last = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: str.slice(last, m.index) });
    parts.push({ type: 'keep', value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < str.length) parts.push({ type: 'text', value: str.slice(last) });
  if (parts.length === 0) parts.push({ type: 'text', value: str });
  return parts;
}

async function translateSegment(text) {
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (trimmed === BRAND) return text;

  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=en|lv`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.responseStatus !== 200) {
    throw new Error(`API ${data.responseStatus}: ${data.responseDetails || trimmed.slice(0, 50)}`);
  }
  const translated = data.responseData.translatedText;
  const lead = text.match(/^\s*/)?.[0] ?? '';
  const trail = text.match(/\s*$/)?.[0] ?? '';
  return lead + translated + trail;
}

async function translateString(str, cache) {
  if (cache[str]) return cache[str];

  const parts = tokenize(str);
  if (parts.every((p) => p.type === 'keep')) {
    cache[str] = str;
    return str;
  }

  let out = '';
  for (const part of parts) {
    if (part.type === 'keep') {
      out += part.value;
    } else {
      const key = part.value;
      if (!cache[key]) {
        cache[key] = await translateSegment(key);
        await sleep(DELAY_MS);
      }
      out += cache[key];
    }
  }
  cache[str] = out;
  return out;
}

function applyCache(obj, cache) {
  if (typeof obj === 'string') return cache[obj] ?? obj;
  if (Array.isArray(obj)) return obj.map((v) => applyCache(v, cache));
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = applyCache(v, cache);
    }
    return result;
  }
  return obj;
}

async function main() {
  const en = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));
  const unique = [...collectStrings(en)];
  let cache = {};
  if (fs.existsSync(CACHE_PATH)) {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  }

  const pending = unique.filter((s) => !cache[s]);
  console.log(`Unique strings: ${unique.length}, cached: ${unique.length - pending.length}, pending: ${pending.length}`);

  let i = 0;
  for (const str of pending) {
    i++;
    try {
      await translateString(str, cache);
    } catch (e) {
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
      console.error(`Failed at ${i}/${pending.length}:`, e.message);
      process.exit(1);
    }
    if (i % 25 === 0) {
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
      console.log(`Progress: ${i}/${pending.length}`);
    }
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  const lv = applyCache(en, cache);
  fs.writeFileSync(LV_PATH, JSON.stringify(lv, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${LV_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
