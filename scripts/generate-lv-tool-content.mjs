/**
 * Generate src/config/tool-content/lv.ts from en.ts (en -> lv via MyMemory).
 * Resumes from scripts/.lv-tool-content-cache.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'src/config/tool-content/lv.ts');
const CACHE_PATH = path.join(ROOT, 'scripts/.lv-tool-content-cache.json');
const MESSAGES_CACHE_PATH = path.join(ROOT, 'scripts/.lv-translation-cache.json');

const DELAY_MS = 250;
const BRAND = 'PDFCraft';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
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
    throw new Error(`API ${data.responseStatus}: ${data.responseDetails || trimmed.slice(0, 60)}`);
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
      out += await translateSegment(part.value);
      await sleep(DELAY_MS);
    }
  }
  cache[str] = out;
  return out;
}

async function translateValue(value, cache) {
  if (typeof value === 'string') {
    return translateString(value, cache);
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      out.push(await translateValue(item, cache));
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await translateValue(v, cache);
    }
    return out;
  }
  return value;
}

function escapeTsString(str) {
  return JSON.stringify(str);
}

function serializeObject(obj, indent = 2) {
  const pad = ' '.repeat(indent);
  const padInner = ' '.repeat(indent + 2);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    const items = obj.map((item) => `${padInner}${serializeObject(item, indent + 2)}`).join(',\n');
    return `[\n${items}\n${pad}]`;
  }
  if (obj && typeof obj === 'object') {
    const entries = Object.entries(obj).map(([key, val]) => {
      const safeKey = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : escapeTsString(key);
      return `${padInner}${safeKey}: ${serializeObject(val, indent + 2)}`;
    });
    return `{\n${entries.join(',\n')}\n${pad}}`;
  }
  if (typeof obj === 'string') {
    if (obj.includes('\n')) {
      const escaped = obj.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      return `\`${escaped}\``;
    }
    return escapeTsString(obj);
  }
  return String(obj);
}

function loadToolContentEn() {
  const result = spawnSync('npx', ['tsx', '-e', "import { toolContentEn } from './src/config/tool-content/en.ts'; console.log(JSON.stringify(toolContentEn));"], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error('Failed to load toolContentEn');
  }
  return JSON.parse(result.stdout.trim());
}

async function main() {
  const cache = loadJson(CACHE_PATH, {});
  const messagesCache = loadJson(MESSAGES_CACHE_PATH, {});
  Object.assign(cache, messagesCache);

  const toolContentEn = loadToolContentEn();
  const toolIds = Object.keys(toolContentEn);
  console.log(`Translating ${toolIds.length} tools...`);

  const toolContentLv = {};
  let i = 0;
  for (const toolId of toolIds) {
    i += 1;
    process.stdout.write(`\r[${i}/${toolIds.length}] ${toolId}                    `);
    toolContentLv[toolId] = await translateValue(toolContentEn[toolId], cache);
    if (i % 5 === 0) {
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
    }
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');

  const body = Object.entries(toolContentLv)
    .map(([id, content]) => `  ${escapeTsString(id)}: ${serializeObject(content, 2)},`)
    .join('\n\n');

  const file = `/**
 * Latvian tool content for SEO
 * Auto-generated by scripts/generate-lv-tool-content.mjs — do not edit manually
 */

import { ToolContent } from '@/types/tool';

export const toolContentLv: Record<string, ToolContent> = {
${body}
};
`;

  fs.writeFileSync(OUT_PATH, file);
  console.log(`\nWrote ${OUT_PATH}`);
  console.log(`Cache: ${Object.keys(cache).length} strings`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
