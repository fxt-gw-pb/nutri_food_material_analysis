"""Scientific figure palette and matplotlib style for pku-latex-reports projects.

Figures never use Beida red: data colors are Okabe-Ito (categorical, fixed order), viridis (sequential / ordered
classes, light = low), ColorBrewer RdBu (diverging) and neutral grays for context. See the skill's
references/figure-colors.md for the rules.

    import sys; sys.path.insert(0, 'scripts')
    import sci_palette as sp
    sp.apply()
    fig, ax = plt.subplots()
    ax.plot(x, y, color=sp.FOCAL)
    sp.save(fig, 'figures/fig_name')          # vector PDF (+ PNG preview)
"""
import shutil
import subprocess
from pathlib import Path

# Okabe-Ito, in the order that passes the colour-vision-deficiency adjacent-pair check.
CATEGORICAL = ['#0072B2', '#D55E00', '#009E73', '#E69F00', '#CC79A7', '#56B4E9']
BLUE, VERMILLION, GREEN, ORANGE, PURPLE, SKY = CATEGORICAL
FOCAL, CONTRAST = BLUE, VERMILLION
INK, INK2, CONTEXT, LIGHT, GRID = '#1A1A1A', '#5B5A56', '#9A9893', '#C9C7C1', '#E6E5E1'
SEQUENTIAL, SEQUENTIAL_GRAY_SAFE, DIVERGING = 'viridis', 'cividis', 'RdBu_r'


def ordinal(n, cmap=SEQUENTIAL, light=0.92, dark=0.05):
    """n hex colours for ordered classes, light (low) -> dark (high), sampled evenly from viridis."""
    import matplotlib as mpl
    import numpy as np
    cm = mpl.colormaps[cmap]
    pos = [light] if n == 1 else np.linspace(light, dark, n)
    return [mpl.colors.to_hex(cm(p)) for p in pos]


def _fandol():
    """Register Fandol fonts from the local TeX installation; returns the sans family name or None."""
    from matplotlib import font_manager
    if not shutil.which('kpsewhich'):
        return None
    found = None
    for name in ['FandolHei-Regular.otf', 'FandolHei-Bold.otf']:
        path = subprocess.run(['kpsewhich', name], capture_output=True, text=True).stdout.strip()
        if path and Path(path).is_file():
            font_manager.fontManager.addfont(path)
            found = 'FandolHei'
    return found


def apply(font_size=8):
    """Matplotlib defaults: CJK-capable sans, thin recessive axes, light solid grid, embedded TrueType fonts."""
    import matplotlib.pyplot as plt
    from cycler import cycler
    family = _fandol()
    rc = {'font.size': font_size, 'axes.titlesize': font_size + 0.5, 'axes.titleweight': 'bold',
          'axes.spines.top': False, 'axes.spines.right': False, 'axes.linewidth': 0.6,
          'axes.edgecolor': INK2, 'axes.labelcolor': INK, 'xtick.color': INK2, 'ytick.color': INK2,
          'xtick.major.width': 0.6, 'ytick.major.width': 0.6, 'axes.grid': True, 'grid.color': GRID,
          'grid.linewidth': 0.5, 'axes.axisbelow': True, 'legend.frameon': False, 'lines.linewidth': 1.4,
          'axes.prop_cycle': cycler(color=CATEGORICAL), 'image.cmap': SEQUENTIAL,
          'pdf.fonttype': 42, 'ps.fonttype': 42, 'axes.unicode_minus': False, 'savefig.bbox': 'tight'}
    if family:
        rc['font.family'] = family
    plt.rcParams.update(rc)


def save(fig, stem, png=True):
    """Save <stem>.pdf (for LaTeX) and, by default, a <stem>.png preview for visual checks."""
    import matplotlib.pyplot as plt
    stem = Path(stem)
    stem.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(stem.with_suffix('.pdf'))
    if png:
        fig.savefig(stem.with_suffix('.png'), dpi=170)
    plt.close(fig)
