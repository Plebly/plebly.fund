#!/usr/bin/env python3
"""Build Latin+site-glyph woff2 subsets for Inter and IBM Plex Mono.

The committed subsets are the default download. Full font files stay next to
them as unicode-range fallbacks for any other character.

Requires fonttools and brotli (dev-only, not a package.json dependency):

    python3 -m venv .venv && .venv/bin/pip install fonttools brotli
    .venv/bin/python scripts/subset-fonts.py

Run from the repository root.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / "public" / "fonts"

# woff2 filenames are not content-hashed; rename them (for example with a version suffix) whenever their contents change.

# Standard Latin range (same coverage Google Fonts uses for Inter Latin),
# plus code points the site actually renders that sit outside that range.
LATIN = [
    (0x0000, 0x00FF),
    (0x0131, 0x0131),
    (0x0152, 0x0153),
    (0x02BB, 0x02BC),
    (0x02C6, 0x02C6),
    (0x02DA, 0x02DA),
    (0x02DC, 0x02DC),
    (0x0304, 0x0304),
    (0x0308, 0x0308),
    (0x0329, 0x0329),
    (0x2000, 0x206F),
    (0x20AC, 0x20AC),
    (0x2122, 0x2122),
    (0x2191, 0x2191),
    (0x2193, 0x2193),
    (0x2212, 0x2212),
    (0x2215, 0x2215),
    (0xFEFF, 0xFEFF),
    (0xFFFD, 0xFFFD),
]

# Used in UI copy or CSS (arrows, ≥, stars, check, ⅔, ceilings, triangles,
# lightning). A few of these are missing from Inter / Plex; they are still
# listed so unicode-range does not fetch the full fallback font for them.
SITE_EXTRA = [
    (0x20BF, 0x20BF),  # ₿ (not in source today; cheap to keep in the default face)
    (0x2154, 0x2154),  # ⅔
    (0x2190, 0x2190),  # ←
    (0x2192, 0x2192),  # →
    (0x2260, 0x2260),  # ≠
    (0x2264, 0x2265),  # ≤ ≥
    (0x2308, 0x2309),  # ⌈ ⌉ (not in Inter; system fallback)
    (0x25B8, 0x25B8),  # ▸ (not in Inter; system fallback)
    (0x25BE, 0x25BE),  # ▾ (not in Inter; system fallback)
    (0x2605, 0x2606),  # ★ ☆
    (0x26A1, 0x26A1),  # ⚡ (not in Inter; system fallback)
    (0x2713, 0x2713),  # ✓
]

SOURCES = [
    FONTS / "inter" / "InterVariable.woff2",
    FONTS / "ibm-plex-mono" / "IBMPlexMono-Regular.woff2",
    FONTS / "ibm-plex-mono" / "IBMPlexMono-Medium.woff2",
    FONTS / "ibm-plex-mono" / "IBMPlexMono-SemiBold.woff2",
    FONTS / "ibm-plex-mono" / "IBMPlexMono-Bold.woff2",
]


def merge(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    out: list[list[int]] = []
    for a, b in sorted(ranges):
        if not out or a > out[-1][1] + 1:
            out.append([a, b])
        else:
            out[-1][1] = max(out[-1][1], b)
    return [(a, b) for a, b in out]


def complement(
    ranges: list[tuple[int, int]], lo: int = 0, hi: int = 0x10FFFF
) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    cursor = lo
    for a, b in merge(ranges):
        if cursor < a:
            out.append((cursor, a - 1))
        cursor = max(cursor, b + 1)
    if cursor <= hi:
        out.append((cursor, hi))
    return out


def css_range(ranges: list[tuple[int, int]]) -> str:
    parts: list[str] = []
    for a, b in merge(ranges):
        def fmt(n: int) -> str:
            return f"U+{n:04X}" if n <= 0xFFFF else f"U+{n:05X}"

        parts.append(fmt(a) if a == b else f"{fmt(a)}-{fmt(b)[2:]}")
    return ", ".join(parts)


def unicodes_list(ranges: list[tuple[int, int]]) -> list[int]:
    out: list[int] = []
    for a, b in merge(ranges):
        out.extend(range(a, b + 1))
    return out


def subset_font(src: Path, unicodes: list[int]) -> Path:
    dest = src.with_name(src.stem + "-Latin.woff2")
    options = subset.Options(
        layout_features=["*"],
        flavor="woff2",
        ignore_missing_unicodes=True,
        recommended_glyphs=True,
        notdef_glyph=True,
        notdef_outline=True,
        name_IDs=["*"],
        name_legacy=True,
        name_languages=["*"],
        # Keep variable axes (wght, opsz) and associated variation tables.
        hinting=True,
    )
    font = subset.load_font(str(src), options)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    subset.save_font(font, str(dest), options)
    font.close()
    return dest


def verify_axes(src: Path, dest: Path) -> None:
    original = TTFont(str(src))
    subsetted = TTFont(str(dest))
    if "fvar" in original:
        if "fvar" not in subsetted:
            sys.exit(f"{dest.name}: missing fvar after subset")
        src_axes = [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in original["fvar"].axes]
        dst_axes = [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in subsetted["fvar"].axes]
        if src_axes != dst_axes:
            sys.exit(f"{dest.name}: axes changed {src_axes} -> {dst_axes}")
        print(f"  axes preserved: {', '.join(a[0] for a in dst_axes)}")
    original.close()
    subsetted.close()


def wrap_range(css: str, indent: str = "    ") -> str:
    # Break long unicode-range lists at ~80 columns.
    parts = [p.strip() for p in css.split(",")]
    lines: list[str] = []
    current = indent
    for i, part in enumerate(parts):
        piece = part if i == len(parts) - 1 else part + ","
        if current == indent:
            current += piece
            continue
        if len(current) + 1 + len(piece) > 80:
            lines.append(current)
            current = indent + piece
        else:
            current += " " + piece
    if current.strip():
        lines.append(current)
    return "\n".join(lines)


def face(
    family: str,
    src: str,
    weight: str,
    unicode_css: str,
    variable: bool = False,
) -> str:
    weight_decl = "100 900" if variable else weight
    return "\n".join(
        [
            "@font-face {",
            f"  font-family: {family};",
            "  font-style: normal;",
            f"  font-weight: {weight_decl};",
            "  font-display: swap;",
            f'  src: url("{src}") format("woff2");',
            "  unicode-range:",
            wrap_range(unicode_css) + ";",
            "}",
        ]
    )


def write_fonts_css(latin: str, rest: str) -> None:
    inter = 'Inter'
    plex = '"IBM Plex Mono"'
    blocks = [
        "/* Latin+site subsets are the default download. Full files are a fallback",
        "   for any other unicode-range (user content, future copy). Subsets are",
        "   built by scripts/subset-fonts.py. */",
        "",
        "/* Latin + glyphs the site actually uses (arrows, dashes, ₿, ≥, stars, …). */",
        face(inter, "./inter/InterVariable-Latin.woff2", "", latin, variable=True),
        "",
        "/* Remaining Inter coverage; downloaded only when a non-subset glyph appears. */",
        face(inter, "./inter/InterVariable.woff2", "", rest, variable=True),
    ]
    plex_files = [
        ("400", "IBMPlexMono-Regular"),
        ("500", "IBMPlexMono-Medium"),
        ("600", "IBMPlexMono-SemiBold"),
        ("700", "IBMPlexMono-Bold"),
    ]
    for weight, stem in plex_files:
        blocks += [
            "",
            face(plex, f"./ibm-plex-mono/{stem}-Latin.woff2", weight, latin),
            "",
            face(plex, f"./ibm-plex-mono/{stem}.woff2", weight, rest),
        ]
    dest = FONTS / "fonts.css"
    dest.write_text("\n".join(blocks) + "\n")
    print(f"wrote {dest.relative_to(ROOT)}")


def main() -> None:
    ranges = merge(LATIN + SITE_EXTRA)
    rest = complement(ranges)
    latin_css = css_range(ranges)
    rest_css = css_range(rest)
    unicodes = unicodes_list(ranges)
    print("latin+site unicode-range:")
    print("  " + latin_css)
    print("remaining unicode-range:")
    print("  " + rest_css)
    print()
    write_fonts_css(latin_css, rest_css)
    for src in SOURCES:
        if not src.exists():
            sys.exit(f"missing {src}")
        dest = subset_font(src, unicodes)
        verify_axes(src, dest)
        print(f"{src.relative_to(ROOT)}  {src.stat().st_size:>8}  ->  {dest.name}  {dest.stat().st_size:>8}")


if __name__ == "__main__":
    main()
