#!/usr/bin/env python3
"""Generate src/config/tool-content/lv.ts from en.ts using Argos Translate."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN_TS = ROOT / "src/config/tool-content/en.ts"
OUT_TS = ROOT / "src/config/tool-content/lv.ts"
CACHE_PATH = ROOT / "scripts/.lv-tool-content-cache.json"
BRAND = "PDFCraft"
PLACEHOLDER_RE = re.compile(r"(\{[^}]+\}|<[^>]+>)")


def setup_argos() -> None:
    data_dir = ROOT / ".argos-data"
    data_dir.mkdir(exist_ok=True)
    os.environ["ARGOS_TRANSLATE_PACKAGE_DIR"] = str(data_dir)
    os.environ["ARGOS_TRANSLATE_DATA_DIR"] = str(data_dir)

    import argostranslate.package

    argostranslate.package.update_package_index()
    available = argostranslate.package.get_available_packages()
    pkg = next((p for p in available if p.from_code == "en" and p.to_code == "lv"), None)
    if pkg is None:
        raise RuntimeError("No en->lv Argos package")
    installed = argostranslate.package.get_installed_packages()
    if not any(p.from_code == "en" and p.to_code == "lv" for p in installed):
        print("Installing Argos en->lv model...")
        argostranslate.package.install_from_path(pkg.download())


def get_translator():
    import argostranslate.translate

    langs = argostranslate.translate.get_installed_languages()
    en = next(l for l in langs if l.code == "en")
    lv = next(l for l in langs if l.code == "lv")
    return en.get_translation(lv)


def load_en_content() -> dict:
    result = subprocess.run(
        ["npx", "tsx", "-e", "import { toolContentEn } from './src/config/tool-content/en.ts'; console.log(JSON.stringify(toolContentEn));"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout.strip())


def tokenize(text: str) -> list[tuple[str, str]]:
    parts: list[tuple[str, str]] = []
    last = 0
    for m in PLACEHOLDER_RE.finditer(text):
        if m.start() > last:
            parts.append(("text", text[last : m.start()]))
        parts.append(("keep", m.group(0)))
        last = m.end()
    if last < len(text):
        parts.append(("text", text[last:]))
    if not parts:
        parts.append(("text", text))
    return parts


def translate_segment(text: str, translator, cache: dict[str, str]) -> str:
    if text in cache:
        return cache[text]
    stripped = text.strip()
    if not stripped or stripped == BRAND:
        cache[text] = text
        return text
    translated = translator.translate(stripped)
    lead = text[: len(text) - len(text.lstrip())]
    trail = text[len(text.rstrip()) :]
    result = lead + translated + trail
    cache[text] = result
    return result


def translate_string(text: str, translator, cache: dict[str, str]) -> str:
    if text in cache:
        return cache[text]
    parts = tokenize(text)
    if all(kind == "keep" for kind, _ in parts):
        cache[text] = text
        return text
    out = ""
    for kind, value in parts:
        if kind == "keep":
            out += value
        else:
            out += translate_segment(value, translator, cache)
    cache[text] = out
    return out


def translate_value(value, translator, cache: dict[str, str]):
    if isinstance(value, str):
        return translate_string(value, translator, cache)
    if isinstance(value, list):
        return [translate_value(v, translator, cache) for v in value]
    if isinstance(value, dict):
        return {k: translate_value(v, translator, cache) for k, v in value.items()}
    return value


def ts_string(s: str) -> str:
    if "\n" in s:
        escaped = s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
        return f"`{escaped}`"
    return json.dumps(s, ensure_ascii=False)


def serialize(obj, indent: int = 2) -> str:
    pad = " " * indent
    pad_inner = " " * (indent + 2)
    if isinstance(obj, list):
        if not obj:
            return "[]"
        items = ",\n".join(f"{pad_inner}{serialize(v, indent + 2)}" for v in obj)
        return f"[\n{items}\n{pad}]"
    if isinstance(obj, dict):
        lines = []
        for k, v in obj.items():
            key = k if re.match(r"^[A-Za-z_$][\w$]*$", k) else json.dumps(k)
            lines.append(f"{pad_inner}{key}: {serialize(v, indent + 2)}")
        return "{\n" + ",\n".join(lines) + f"\n{pad}}}"
    if isinstance(obj, str):
        return ts_string(obj)
    return json.dumps(obj)


def main() -> int:
    setup_argos()
    translator = get_translator()

    cache: dict[str, str] = {}
    if CACHE_PATH.exists():
        cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        print(f"Loaded {len(cache)} cached strings")

    messages_cache = ROOT / "scripts/.lv-translation-cache.json"
    if messages_cache.exists():
        cache.update(json.loads(messages_cache.read_text(encoding="utf-8")))

    en = load_en_content()
    lv = {}
    total = len(en)
    for i, (tool_id, content) in enumerate(en.items(), 1):
        print(f"[{i}/{total}] {tool_id}")
        lv[tool_id] = translate_value(content, translator, cache)
        if i % 10 == 0:
            CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    body = ",\n\n".join(f"  {json.dumps(tool_id)}: {serialize(content, 2)}" for tool_id, content in lv.items())
    out = f"""/**
 * Latvian tool content for SEO
 * Auto-generated by scripts/generate-lv-tool-content.py
 */

import {{ ToolContent }} from '@/types/tool';

export const toolContentLv: Record<string, ToolContent> = {{
{body}
}};
"""
    OUT_TS.write_text(out, encoding="utf-8")
    print(f"Wrote {OUT_TS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
