#!/usr/bin/env python3
"""
Complete messages/lv.json using Argos Translate (en -> lv).
Translates only strings that still match English; preserves placeholders.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN_PATH = ROOT / "messages" / "en.json"
LV_PATH = ROOT / "messages" / "lv.json"
CACHE_PATH = ROOT / "scripts" / ".lv-argos-cache.json"
BRAND = "PDFCraft"

PLACEHOLDER_RE = re.compile(r"(\{[^}]+\}|<[^>]+>)")


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


def install_en_lv() -> None:
    import argostranslate.package

    argostranslate.package.update_package_index()
    available = argostranslate.package.get_available_packages()
    pkg = next(
        (p for p in available if p.from_code == "en" and p.to_code == "lv"),
        None,
    )
    if pkg is None:
        raise RuntimeError("No en->lv package in Argos index")
    installed = argostranslate.package.get_installed_packages()
    if not any(p.from_code == "en" and p.to_code == "lv" for p in installed):
        print("Installing Argos en->lv model...")
        argostranslate.package.install_from_path(pkg.download())
    else:
        print("Argos en->lv model already installed")


def get_translator():
    import argostranslate.translate

    langs = argostranslate.translate.get_installed_languages()
    en = next((l for l in langs if l.code == "en"), None)
    lv = next((l for l in langs if l.code == "lv"), None)
    if not en or not lv:
        raise RuntimeError("en or lv language not installed")
    return en.get_translation(lv)


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


def walk(en, lv, translator, cache: dict[str, str], stats: dict) -> None:
    if isinstance(en, str):
        return
    if isinstance(en, list):
        for i, item in enumerate(en):
            if isinstance(item, str) and i < len(lv) and isinstance(lv[i], str):
                if lv[i] == item:
                    lv[i] = translate_string(item, translator, cache)
                    stats["translated"] += 1
                else:
                    stats["skipped"] += 1
            elif isinstance(item, (dict, list)):
                walk(item, lv[i], translator, cache, stats)
        return
    if isinstance(en, dict):
        for key, en_val in en.items():
            if key not in lv:
                lv[key] = en_val
            lv_val = lv[key]
            if isinstance(en_val, str) and isinstance(lv_val, str):
                if lv_val == en_val:
                    lv[key] = translate_string(en_val, translator, cache)
                    stats["translated"] += 1
                else:
                    stats["skipped"] += 1
            else:
                walk(en_val, lv_val, translator, cache, stats)


def main() -> int:
    install_en_lv()
    translator = get_translator()

    en = json.loads(EN_PATH.read_text(encoding="utf-8"))
    if LV_PATH.exists():
        lv = json.loads(LV_PATH.read_text(encoding="utf-8"))
    else:
        lv = json.loads(json.dumps(en))

    cache: dict[str, str] = {}
    if CACHE_PATH.exists():
        cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        print(f"Loaded {len(cache)} cached segments")

    stats = {"translated": 0, "skipped": 0}
    walk(en, lv, translator, cache, stats)

    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    LV_PATH.write_text(json.dumps(lv, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Done: translated={stats['translated']}, kept existing={stats['skipped']}")
    print(f"Wrote {LV_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
