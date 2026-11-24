#!/bin/zsh
# 从《中国食物成分表标准版（第 6 版）》第一、二册扫描 PDF 提取「表一 能量和食物一般营养成分」。
# 只能在 macOS 上运行（用系统自带的 Vision 文字识别），全程本地，不上传任何内容。约 15 分钟。
#
# 用法：scripts/nutrition/extract.sh <第一册.pdf> <第二册.pdf>
# 产物：scripts/source/中国食物成分表第6版_表一.csv（受版权保护，已加入 .gitignore）
set -euo pipefail
HERE=${0:A:h}
ROOT=${HERE:h:h}
B1=${1:?第一册 PDF}
B2=${2:?第二册 PDF}
WORK=$(mktemp -d)
echo "工作目录：$WORK"

swiftc -O -o "$WORK/ocr" "$HERE/ocr.swift"
mkdir -p "$WORK"/{a1,a2,b1,b2}
# 两遍独立识别（300dpi、400dpi），后面逐格互相校对。表一所在页：第一册 52–149，第二册 77–206。
OCR_DPI=300 "$WORK/ocr" "$B1" 52 149 "$WORK/a1" -90 img > /dev/null &
OCR_DPI=300 "$WORK/ocr" "$B2" 77 206 "$WORK/a2" -90 img > /dev/null &
OCR_DPI=400 "$WORK/ocr" "$B1" 52 149 "$WORK/b1" -90 > /dev/null &
OCR_DPI=400 "$WORK/ocr" "$B2" 77 206 "$WORK/b2" -90 > /dev/null &
wait

python3 -I "$HERE/parse_pages.py" "$WORK" "$WORK/passA.json" 1.0 a1 a2
python3 -I "$HERE/parse_pages.py" "$WORK" "$WORK/passB.json" 0.75 b1 b2
python3 -I "$HERE/merge_passes.py" "$WORK/passA.json" "$WORK/passB.json" "$WORK/merged.json" > "$WORK/review.txt"
mkdir -p "$ROOT/scripts/source"
python3 -I "$HERE/finalize_table.py" "$WORK/passA.json" "$WORK/passB.json" "$WORK/merged.json" \
  "$ROOT/scripts/source/中国食物成分表第6版_表一.csv"
echo "需要人工核对的格子见 $WORK/review.txt；核对后写进 finalize_table.py 的 MANUAL。"
echo "然后运行：python3 scripts/build-nutrition-db.py"
