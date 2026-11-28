#!/usr/bin/env python3
"""Prepare portable Pygments/LaTeX output, or verify the bundled cache.

Run from any directory:
    python scripts/highlight.py          # regenerate; requires Pygments
    python scripts/highlight.py --check  # verify only; standard library

The LaTeX compiler never invokes this script.  The template can therefore be
compiled with -no-shell-escape.  build.py handles regeneration or verification
before starting XeLaTeX.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from typing import Any


SCHEMA_VERSION = 1
PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_RELATIVE = Path("generated/highlight-manifest.json")
SUPPORTED_EXTENSIONS = {".py": "python", ".r": "r", ".sql": "sql"}
PKU_RED = "#8B0012"
BACKGROUND = "#FAFAFA"


class HighlightError(RuntimeError):
    """An actionable source, dependency, or cache error."""


def blend(first: str, second: str, first_weight: float) -> str:
    """Mix two sRGB hex colors; first_weight is the fraction of the first."""
    left = [int(first[i:i + 2], 16) for i in (1, 3, 5)]
    right = [int(second[i:i + 2], 16) for i in (1, 3, 5)]
    channels = [
        round(first_weight * a + (1.0 - first_weight) * b)
        for a, b in zip(left, right)
    ]
    return "#" + "".join(f"{channel:02X}" for channel in channels)


def configuration() -> dict[str, Any]:
    """All settings that affect generated TeX, independent of TeX page layout."""
    red_dark = blend(PKU_RED, "#000000", 0.80)
    red_soft = blend(PKU_RED, "#FFFFFF", 0.85)
    red_muted = blend(PKU_RED, "#666666", 0.75)
    return {
        "schema": SCHEMA_VERSION,
        "commandprefix": "PKU",
        "background": BACKGROUND,
        "supported_extensions": SUPPORTED_EXTENSIONS,
        "lexer_options": {
            "stripnl": False,
            "stripall": False,
            "ensurenl": True,
            "tabsize": 0,
        },
        "formatter_options": {
            "texcomments": False,
            "mathescape": False,
            "escapeinside": "",
            "verboptions": (
                r"breaklines=true,breakanywhere=true,fontsize=\small,"
                r"numbers=left,numbersep=8pt,xleftmargin=16pt,tabsize=4"
            ),
        },
        "styles": {
            "ide": {
                "": "#222222",
                "Keyword": "bold #6C398F",
                "Keyword.Constant": "bold #175E91",
                "Keyword.Type": "#175E91",
                "Name.Builtin": "#175E91",
                "Name.Function": "bold #795E26",
                "Name.Class": "bold #795E26",
                "Name.Decorator": "#795E26",
                "Name.Exception": "#8B0012",
                "Name.Constant": "#175E91",
                "Name.Namespace": "#222222",
                "Name.Tag": "#8B0012",
                "Name.Attribute": "#175E91",
                "String": "#A31515",
                "String.Escape": "bold #8B0012",
                "Number": "#098658",
                "Operator": "#444444",
                "Operator.Word": "bold #6C398F",
                "Punctuation": "#444444",
                "Comment": "#27744C",
                "Generic.Heading": "bold #222222",
                "Generic.Subheading": "bold #222222",
                "Generic.Deleted": "#8B0012",
                "Generic.Inserted": "#27744C",
                "Generic.Emph": "italic",
                "Generic.Strong": "bold",
                "Generic.Output": "#666666",
                "Generic.Traceback": "#8B0012",
                "Error": "bold #8B0012",
            },
            # Every non-neutral color is an explicit mixture of the official
            # RGB #8B0012 with black, white, or neutral gray.
            "pku": {
                "": "#222222",
                "Keyword": f"bold {PKU_RED}",
                "Keyword.Constant": f"bold {red_dark}",
                "Keyword.Type": red_dark,
                "Name.Builtin": red_dark,
                "Name.Function": f"bold {red_dark}",
                "Name.Class": f"bold {red_dark}",
                "Name.Decorator": red_muted,
                "Name.Exception": f"bold {PKU_RED}",
                "Name.Constant": red_dark,
                "Name.Namespace": "#222222",
                "Name.Tag": PKU_RED,
                "Name.Attribute": red_muted,
                "String": red_muted,
                "String.Escape": f"bold {red_dark}",
                "Number": red_soft,
                "Operator": "#444444",
                "Operator.Word": f"bold {PKU_RED}",
                "Punctuation": "#444444",
                "Comment": "#666666",
                "Generic.Heading": f"bold {PKU_RED}",
                "Generic.Subheading": f"bold {red_dark}",
                "Generic.Deleted": PKU_RED,
                "Generic.Inserted": red_muted,
                "Generic.Emph": "italic",
                "Generic.Strong": "bold",
                "Generic.Output": "#666666",
                "Generic.Traceback": PKU_RED,
                "Error": f"bold {PKU_RED}",
            },
        },
    }


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _configuration_hash(config: dict[str, Any]) -> str:
    serialized = json.dumps(
        config, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return _sha256(serialized)


def _script_hash() -> str:
    # Normalize line endings so a normal Windows checkout keeps its cache.
    text = Path(__file__).read_text(encoding="utf-8")
    return _sha256(text.encode("utf-8"))


def _source_records(root: Path) -> list[dict[str, str]]:
    code_root = root / "code"
    if not code_root.exists():
        return []
    if not code_root.is_dir():
        raise HighlightError(f"Expected a directory: {code_root}")
    records = []
    for path in sorted(code_root.rglob("*"), key=lambda item: item.as_posix()):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        if "__pycache__" in path.relative_to(code_root).parts:
            continue
        relative = path.relative_to(code_root)
        source_path = path.relative_to(root).as_posix()
        output_path = (Path("generated/code") / relative).as_posix() + ".tex"
        records.append({
            "source": source_path,
            "sha256": _sha256(path.read_bytes()),
            "lexer": SUPPORTED_EXTENSIONS[path.suffix.lower()],
            "output": output_path,
        })
    return records


def _expected_outputs(records: list[dict[str, str]]) -> set[str]:
    return {
        "generated/syntax-ide.tex",
        "generated/syntax-pku.tex",
        *(record["output"] for record in records),
    }


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=path.parent, prefix="." + path.name + ".", delete=False
        ) as temporary:
            temporary_name = temporary.name
            temporary.write(content)
        os.replace(temporary_name, path)
    finally:
        if temporary_name is not None:
            try:
                Path(temporary_name).unlink(missing_ok=True)
            except OSError:
                pass


def validate_cache(project_root: Path = PROJECT_ROOT) -> list[str]:
    """Return problems; an empty list means the cache matches current sources."""
    root = Path(project_root).resolve()
    manifest_path = root / MANIFEST_RELATIVE
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return [f"Cannot read {MANIFEST_RELATIVE.as_posix()}: {error}"]
    if not isinstance(manifest, dict):
        return ["The highlight manifest is not a JSON object."]

    problems = []
    config = configuration()
    if manifest.get("schema") != SCHEMA_VERSION:
        problems.append("The highlight manifest schema has changed.")
    if manifest.get("generator_sha256") != _script_hash():
        problems.append("scripts/highlight.py has changed since generation.")
    expected_config_hash = _configuration_hash(config)
    if (
        manifest.get("configuration_sha256") != expected_config_hash
        or manifest.get("configuration") != config
    ):
        problems.append("The highlighting configuration or palettes have changed.")

    try:
        current_records = _source_records(root)
    except (OSError, HighlightError) as error:
        return problems + [str(error)]
    saved_records = manifest.get("sources")
    if saved_records != current_records:
        saved = {}
        if isinstance(saved_records, list):
            saved = {
                item["source"]: item
                for item in saved_records
                if isinstance(item, dict) and isinstance(item.get("source"), str)
            }
        current = {item["source"]: item for item in current_records}
        for source in sorted(current.keys() - saved.keys()):
            problems.append(f"New source: {source}")
        for source in sorted(saved.keys() - current.keys()):
            problems.append(f"Removed source: {source}")
        for source in sorted(current.keys() & saved.keys()):
            if current[source] != saved[source]:
                problems.append(f"Changed source or source settings: {source}")
        if not problems:
            problems.append("The recorded source list is not valid.")

    expected_outputs = _expected_outputs(current_records)
    saved_outputs = manifest.get("outputs")
    if not isinstance(saved_outputs, dict):
        problems.append("The generated-file hash records are missing.")
        saved_outputs = {}
    if set(saved_outputs) != expected_outputs:
        problems.append("The recorded generated-file set does not match the sources.")

    for relative in sorted(expected_outputs):
        path = root / relative
        try:
            digest = _sha256(path.read_bytes())
        except OSError:
            problems.append(f"Missing or unreadable generated file: {relative}")
            continue
        if saved_outputs.get(relative) != digest:
            problems.append(f"Generated file has changed: {relative}")

    code_output_root = root / "generated/code"
    if code_output_root.is_dir():
        for path in code_output_root.rglob("*.tex"):
            relative = path.relative_to(root).as_posix()
            if relative not in expected_outputs:
                problems.append(f"Obsolete generated code file: {relative}")
    return problems


def _pygments_modules() -> dict[str, Any]:
    try:
        return {
            name: importlib.import_module(name)
            for name in (
                "pygments", "pygments.lexers", "pygments.formatters",
                "pygments.style", "pygments.token",
            )
        }
    except ImportError as error:
        raise HighlightError(
            "Pygments is needed to regenerate syntax highlighting. "
            "Install it in this Python environment:\n"
            f'  "{sys.executable}" -m pip install Pygments'
        ) from error


def _make_style(modules: dict[str, Any], name: str, colors: dict[str, str]) -> Any:
    token_root = modules["pygments.token"].Token
    styles = {}
    for dotted_name, specification in colors.items():
        token = token_root
        for component in dotted_name.split("."):
            if component:
                token = getattr(token, component)
        styles[token] = specification
    return type(
        f"PKU{name.title()}Style",
        (modules["pygments.style"].Style,),
        {"styles": styles, "background_color": BACKGROUND},
    )


def _precise_style_definitions(formatter: Any, colors: dict[str, str]) -> str:
    # Pygments 2.x rounds LaTeX RGB channels to 2 decimals. Restore sufficient
    # precision so the primary token color retains the specified #8B0012.
    definitions = formatter.get_style_defs()
    replacements = {}
    for specification in colors.values():
        for color in re.findall(r"#[0-9A-Fa-f]{6}", specification):
            channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
            rounded = ",".join(f"{channel:.2f}" for channel in channels)
            precise = ",".join(f"{channel:.8f}" for channel in channels)
            replacements[rounded] = precise
    for rounded, precise in replacements.items():
        definitions = definitions.replace("{" + rounded + "}", "{" + precise + "}")
    return definitions


def generate_cache(project_root: Path = PROJECT_ROOT) -> dict[str, Any]:
    """Regenerate both palettes and all supported code files; requires Pygments."""
    root = Path(project_root).resolve()
    modules = _pygments_modules()
    config = configuration()
    records = _source_records(root)
    payloads: dict[str, bytes] = {}
    formatters = {}
    for palette, colors in config["styles"].items():
        style = _make_style(modules, palette, colors)
        formatter = modules["pygments.formatters"].LatexFormatter(
            style=style,
            commandprefix=config["commandprefix"],
            **config["formatter_options"],
        )
        formatters[palette] = formatter
        header = (
            "% Generated by scripts/highlight.py; do not edit.\n"
            f"% Palette: {palette}; code background is supplied by pku-notes.sty.\n"
        )
        definitions = _precise_style_definitions(formatter, colors)
        payloads[f"generated/syntax-{palette}.tex"] = (
            header + definitions
        ).encode("utf-8")

    # Token classes are palette-independent; the active style is chosen in TeX.
    formatter = formatters["ide"]
    for record in records:
        source_path = root / record["source"]
        try:
            code = source_path.read_text(encoding="utf-8-sig")
        except UnicodeError as error:
            raise HighlightError(
                f"{record['source']} must be saved as UTF-8."
            ) from error
        lexer = modules["pygments.lexers"].get_lexer_by_name(
            record["lexer"], **config["lexer_options"]
        )
        rendered = modules["pygments"].highlight(code, lexer, formatter)
        header = "% Generated by scripts/highlight.py; do not edit.\n"
        payloads[record["output"]] = (header + rendered).encode("utf-8")

    # Commit the manifest last. A partial write will not validate as a cache.
    for relative, payload in payloads.items():
        _atomic_write(root / relative, payload)
    code_output_root = root / "generated/code"
    if code_output_root.is_dir():
        for path in code_output_root.rglob("*.tex"):
            if path.relative_to(root).as_posix() not in payloads:
                path.unlink()
    manifest = {
        "schema": SCHEMA_VERSION,
        "generator": "scripts/highlight.py",
        "generator_sha256": _script_hash(),
        "configuration": config,
        "configuration_sha256": _configuration_hash(config),
        "pygments_version": modules["pygments"].__version__,
        "sources": records,
        "outputs": {
            relative: _sha256(payload)
            for relative, payload in sorted(payloads.items())
        },
    }
    serialized = json.dumps(
        manifest, ensure_ascii=False, sort_keys=True, indent=2
    ) + "\n"
    _atomic_write(root / MANIFEST_RELATIVE, serialized.encode("utf-8"))
    return {
        "mode": "generated",
        "source_count": len(records),
        "pygments_version": modules["pygments"].__version__,
    }


def ensure_cache(project_root: Path = PROJECT_ROOT) -> dict[str, Any]:
    """Regenerate if Pygments is installed; otherwise require a matching cache."""
    try:
        importlib.import_module("pygments")
    except ImportError:
        problems = validate_cache(project_root)
        if problems:
            detail = "\n".join(f"  - {problem}" for problem in problems[:20])
            raise HighlightError(
                "Pygments is unavailable and the bundled syntax cache is not "
                "valid for the current source files/configuration:\n"
                f"{detail}\n"
                "Install Pygments and run the build again:\n"
                f'  "{sys.executable}" -m pip install Pygments\n'
                "Old highlighted output will not be used."
            )
        return {
            "mode": "validated",
            "source_count": len(_source_records(Path(project_root).resolve())),
        }
    return generate_cache(project_root)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true",
        help="verify the existing cache without importing Pygments",
    )
    arguments = parser.parse_args(argv)
    try:
        if arguments.check:
            problems = validate_cache()
            if problems:
                raise HighlightError(
                    "Syntax cache is not valid:\n"
                    + "\n".join(f"  - {problem}" for problem in problems)
                )
            print("Syntax cache verified: sources, configuration and output hashes match.")
        else:
            result = generate_cache()
            print(
                f"Generated highlighting for {result['source_count']} source file(s); "
                "both ide and pku palettes are ready."
            )
    except (HighlightError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
