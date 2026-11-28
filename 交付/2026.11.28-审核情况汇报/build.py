#!/usr/bin/env python3
"""Build the notes template with checked syntax highlighting and XeLaTeX.

    python build.py                  # the only root entry .tex -> <name>.pdf
    python build.py 统计推断_1013     # 统计推断_1013.tex -> 统计推断_1013.pdf
    python build.py --preview        # also render pages to PNG for inspection
    python build.py --preview DIR --preview-pages 1-3 --preview-dpi 120
    python build.py --all-warnings   # list every warning, not only the first few
    python build.py --clean          # delete build/ and stray by-products, then stop
    python build.py --keep-build     # keep build/ (aux, logs) after success
    python build.py --highlight-only # prepare/check highlighting only

The script can be run from any directory (python /path/to/report/build.py).
Every build starts from an empty build/ and runs three XeLaTeX passes there.
After a successful build it prints a summary of the final-pass warnings
(undefined references, missing glyphs, overfull boxes, ...), copies the PDF
next to its .tex in the project root and deletes build/, so only source and
PDF remain. A failed build keeps build/ for its logs; the next build or
--clean removes it. With --preview it renders the pages to
<DIR>/<name>-page-N.png (default DIR: <system temp>/pku-latex-preview),
replacing only that document's earlier preview images. Agents therefore never
need to delete build/ or preview folders by hand.

Pygments is optional when the bundled source/configuration/output hashes match.
Install Pygments to update highlighted code. XeLaTeX always uses
-no-shell-escape; source-code files are formatted, not executed.

Projects without scripts/highlight.py skip highlighting and only run the
XeLaTeX passes.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

# Keep the project free of __pycache__ from loading the bundled helper.
sys.dont_write_bytecode = True

PROJECT_ROOT = Path(__file__).resolve().parent

# Load our own helper by its absolute path, including with PYTHONSAFEPATH=1
# or when this script is launched from a different working directory.
_HIGHLIGHT_SCRIPT = PROJECT_ROOT / "scripts" / "highlight.py"
if _HIGHLIGHT_SCRIPT.is_file():
    _highlighter_spec = importlib.util.spec_from_file_location(
        "pku_template_highlight", _HIGHLIGHT_SCRIPT
    )
    if _highlighter_spec is None or _highlighter_spec.loader is None:
        raise RuntimeError("The bundled scripts/highlight.py could not be loaded.")
    _highlighter = importlib.util.module_from_spec(_highlighter_spec)
    sys.modules[_highlighter_spec.name] = _highlighter
    _highlighter_spec.loader.exec_module(_highlighter)
    HighlightError = _highlighter.HighlightError
    ensure_cache = _highlighter.ensure_cache
else:
    # No bundled highlighter in this project: skip highlighting.
    class HighlightError(Exception):
        """A build error reported to the user."""

    ensure_cache = None


# Root .tex files that are inputs or reference starters, never entry points.
NON_ENTRY_TEX = {
    "settings.tex", "pku-font-latin.tex", "pku-font-math.tex", "pku-font-cjk.tex",
    "starter.tex", "notes-starter.tex", "progress-starter.tex",
}
# Compiler by-products that a direct xelatex run may leave in the root.
AUX_SUFFIXES = (
    ".aux", ".log", ".toc", ".out", ".xdv", ".synctex.gz", ".fls",
    ".fdb_latexmk", ".bbl", ".blg", ".bcf", ".run.xml", ".lof", ".lot",
    ".listing", ".nav", ".snm", ".vrb",
)
DEFAULT_PREVIEW_DIR = Path(tempfile.gettempdir()) / "pku-latex-preview"

# Warning categories in the final XeLaTeX log, checked in order; the number is
# how many distinct lines to print by default (all with --all-warnings).
WARNING_CATEGORIES = (
    ("undefined references/citations",
     re.compile(r"LaTeX Warning: .*(undefined|Rerun)|There were undefined"), 20),
    ("missing glyphs", re.compile(r"^Missing character"), 20),
    ("overfull boxes", re.compile(r"^Overfull \\[hv]box"), 10),
    ("underfull boxes", re.compile(r"^Underfull \\[hv]box"), 3),
    ("font substitutions", re.compile(r"LaTeX Font Warning"), 3),
    ("other warnings", re.compile(r"Warning:"), 10),
)


def _target_name(value: str) -> str:
    name = value[:-4] if value.endswith(".tex") else value
    # Unicode (e.g. Chinese) names are fine; reject paths, whitespace and
    # characters that TeX or the shell would interpret.
    if not re.fullmatch(r"[^\s/\\{}$&#^~%\"'*?<>|:.-][^\s/\\{}$&#^~%\"'*?<>|:]*", name):
        raise argparse.ArgumentTypeError(
            "Use a project-root document name such as 统计推断_1013 or report.tex. "
            "Paths, whitespace, TeX special characters and names beginning "
            "with '-' or '.' are not accepted."
        )
    return name


def _page_range(value: str) -> tuple[int, int]:
    match = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+)\s*)?", value)
    if not match:
        raise argparse.ArgumentTypeError("Use a page or page range such as 3 or 2-5.")
    first = int(match.group(1))
    last = int(match.group(2) or first)
    if first < 1 or last < first:
        raise argparse.ArgumentTypeError("Pages start at 1 and the range must not be reversed.")
    return first, last


def _entry_candidates() -> list[str]:
    candidates = []
    for path in sorted(PROJECT_ROOT.glob("*.tex")):
        if path.name in NON_ENTRY_TEX:
            continue
        try:
            head = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if re.search(r"^[^%\n]*\\documentclass", head, re.MULTILINE):
            candidates.append(path.stem)
    return candidates


def _detect_target() -> str:
    candidates = _entry_candidates()
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise HighlightError("No entry .tex file with \\documentclass was found in the project root.")
    raise HighlightError(
        "Several entry .tex files were found; name one explicitly: " + ", ".join(candidates)
    )


def _remove_root_aux(target: str) -> None:
    for suffix in AUX_SUFFIXES:
        stray = PROJECT_ROOT / f"{target}{suffix}"
        if stray.is_file():
            stray.unlink()


def _clean(output_dir: Path, targets: list[str]) -> None:
    if output_dir.is_dir():
        shutil.rmtree(output_dir)
        print("Removed build/.")
    for target in targets:
        _remove_root_aux(target)
    print("Cleared compiler by-products; only source and PDF remain.")


def _log_tail(path: Path, lines: int = 30) -> str:
    try:
        return "\n".join(
            path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]
        )
    except OSError:
        return "(The compiler log could not be read.)"


def _summarize_warnings(log_path: Path, show_all: bool) -> None:
    """Print the final pass's warnings so build/ never has to be kept."""
    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        print(f"WARNING: the final LaTeX log could not be read: {log_path}")
        return
    found: dict[str, list[str]] = {name: [] for name, _, _ in WARNING_CATEGORIES}
    for line in lines:
        text = line.strip()
        for name, pattern, _ in WARNING_CATEGORIES:
            if pattern.search(text):
                if text not in found[name]:
                    found[name].append(text)
                break
    total = sum(len(items) for items in found.values())
    if total == 0:
        print("Final-pass warnings: none.")
        return
    counts = ", ".join(f"{len(items)} {name}" for name, items in found.items() if items)
    print(f"Final-pass warnings (distinct lines): {counts}.")
    for name, _, limit in WARNING_CATEGORIES:
        items = found[name]
        shown = items if show_all else items[:limit]
        for text in shown:
            print(f"  [{name}] {text}")
        if len(items) > len(shown):
            print(f"  [{name}] ... {len(items) - len(shown)} more (use --all-warnings)")


def _preview_directory(value: Path) -> Path:
    directory = value.expanduser().resolve()
    if directory == PROJECT_ROOT or PROJECT_ROOT in directory.parents:
        raise HighlightError(
            "Preview images are inspection by-products; write them outside the "
            "report directory (e.g. the default temp folder or an agent scratch folder)."
        )
    return directory


def _render_preview(
    pdf: Path, target: str, directory: Path, dpi: int, pages: tuple[int, int] | None
) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    stem = f"{target}-page"
    # Replace only this document's earlier previews; leave other files alone.
    for old in directory.glob(f"{stem}-*.png"):
        if old.is_file():
            old.unlink()

    renderer = shutil.which("pdftoppm")
    if renderer is not None:
        command = [renderer, "-png", "-r", str(dpi)]
        if pages is not None:
            command += ["-f", str(pages[0]), "-l", str(pages[1])]
        command += [str(pdf), str(directory / stem)]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode:
            raise HighlightError(
                "pdftoppm could not render the preview:\n" + completed.stderr.strip()
            )
    else:
        try:
            import fitz  # PyMuPDF
        except ImportError as error:
            raise HighlightError(
                "Neither pdftoppm (poppler) nor PyMuPDF is available for previews; "
                "inspect the PDF with the agent's own PDF capability instead."
            ) from error
        with fitz.open(pdf) as document:
            count = document.page_count
            width = len(str(count))
            first, last = pages if pages is not None else (1, count)
            for number in range(first, min(last, count) + 1):
                pixmap = document[number - 1].get_pixmap(dpi=dpi)
                pixmap.save(str(directory / f"{stem}-{number:0{width}d}.png"))

    images = sorted(directory.glob(f"{stem}-*.png"))
    if not images:
        raise HighlightError("No preview pages were rendered (check --preview-pages).")
    return images


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "target", nargs="?", default=None,
        type=_target_name,
        help="project-root .tex document (default: the only entry .tex in the root)",
    )
    parser.add_argument(
        "--preview", nargs="?", const=DEFAULT_PREVIEW_DIR, default=None,
        type=Path, metavar="DIR",
        help=f"after a successful build, render pages to DIR/<name>-page-N.png "
             f"(default DIR: {DEFAULT_PREVIEW_DIR})",
    )
    parser.add_argument(
        "--preview-dpi", type=int, default=150, metavar="DPI",
        help="preview resolution (default: 150)",
    )
    parser.add_argument(
        "--preview-pages", type=_page_range, default=None, metavar="FIRST[-LAST]",
        help="render only these pages, e.g. 1-3 (default: all pages)",
    )
    parser.add_argument(
        "--all-warnings", action="store_true",
        help="list every distinct final-pass warning instead of the first few per category",
    )
    parser.add_argument(
        "--clean", action="store_true",
        help="delete build/ and stray root by-products, then stop (no compilation)",
    )
    parser.add_argument(
        "--keep-build", action="store_true",
        help="keep build/ with aux files and logs after a successful build",
    )
    parser.add_argument(
        "--highlight-only", action="store_true",
        help="prepare or verify syntax highlighting, then stop",
    )
    arguments = parser.parse_args(argv)
    output_dir = PROJECT_ROOT / "build"

    try:
        if arguments.clean:
            targets = [arguments.target] if arguments.target else _entry_candidates()
            _clean(output_dir, targets)
            return 0

        if ensure_cache is not None:
            result = ensure_cache(PROJECT_ROOT)
            verb = "Regenerated" if result["mode"] == "generated" else "Verified cached"
            print(f"{verb} highlighting for {result['source_count']} source file(s).", flush=True)
        elif arguments.highlight_only:
            print("This project has no scripts/highlight.py; nothing to highlight.")
        if arguments.highlight_only:
            return 0

        preview_dir = (
            _preview_directory(arguments.preview) if arguments.preview is not None else None
        )
        target = arguments.target or _detect_target()
        source = PROJECT_ROOT / f"{target}.tex"
        if not source.is_file():
            raise HighlightError(f"Document not found: {source}")
        engine = shutil.which("xelatex")
        if engine is None:
            raise HighlightError(
                "XeLaTeX was not found. Install TeX Live or MiKTeX with XeLaTeX, "
                "Einfart, CTeX and the template's other LaTeX dependencies, "
                "then make xelatex available on PATH."
            )

        # Three passes always run, so start fresh: stale or corrupt aux files
        # from an earlier failed build cannot break this one.
        if output_dir.is_dir():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        command = [
            engine,
            "-no-shell-escape",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-file-line-error",
            "-output-directory=build",
            source.name,
        ]
        # Unwrapped log lines keep warnings readable in the summary below.
        environment = {**os.environ, "max_print_line": "10000",
                       "error_line": "254", "half_error_line": "238"}
        for pass_number in range(1, 4):
            console_log = output_dir / f"{target}-pass{pass_number}.log"
            print(f"XeLaTeX pass {pass_number}/3: {source.name}", flush=True)
            with console_log.open("w", encoding="utf-8", newline="\n") as stream:
                completed = subprocess.run(
                    command,
                    cwd=PROJECT_ROOT,
                    stdout=stream,
                    stderr=subprocess.STDOUT,
                    shell=False,
                    check=False,
                    env=environment,
                )
            if completed.returncode:
                raise HighlightError(
                    f"XeLaTeX failed on pass {pass_number}. "
                    "No successful new PDF is being reported.\n"
                    f"Log: {console_log}\n\n{_log_tail(console_log)}\n\n"
                    "build/ is kept for inspection; the next build or --clean removes it."
                )

        built = output_dir / f"{target}.pdf"
        if not built.is_file() or built.stat().st_size == 0:
            raise HighlightError(f"XeLaTeX did not produce a nonempty PDF: {built}")
        _summarize_warnings(output_dir / f"{target}.log", arguments.all_warnings)
        pdf = PROJECT_ROOT / f"{target}.pdf"
        shutil.copy2(built, pdf)
        _remove_root_aux(target)
        if arguments.keep_build:
            print(f"LaTeX log: {output_dir / (target + '.log')}")
        else:
            shutil.rmtree(output_dir)
            print("Removed intermediate files (build/).")
        print(f"Built: {pdf}")

        if preview_dir is not None:
            images = _render_preview(
                pdf, target, preview_dir, arguments.preview_dpi,
                arguments.preview_pages,
            )
            print(f"Preview: {len(images)} page image(s) at {arguments.preview_dpi} dpi")
            for image in images:
                print(f"  {image}")
    except (HighlightError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nBuild interrupted.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
