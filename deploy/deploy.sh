#!/usr/bin/env bash
# 在电脑上运行：构建并上传到服务器，然后重启服务。
#   deploy/deploy.sh ubuntu@1.2.3.4
# 需要：本机能 ssh 登录该账号，且该账号可 sudo。构建产物含《中国食物成分表》数据，只传服务器、不进仓库。
set -euo pipefail
TARGET="${1:?用法：deploy/deploy.sh 用户名@服务器地址}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -f miniprogram/data/nutritionDb.data.ts ] || { echo "缺少 miniprogram/data/nutritionDb.data.ts（本地生成的食物成分表数据），无法构建"; exit 1; }
npm test
npm run web:build

STAGE="/tmp/food-web-upload"
ssh "$TARGET" "rm -rf $STAGE && mkdir -p $STAGE/web $STAGE/server"
rsync -az --delete web/dist/ "$TARGET:$STAGE/web/dist/"
rsync -az --delete server/dist/ "$TARGET:$STAGE/server/dist/"
rsync -az deploy/ "$TARGET:$STAGE/deploy/"
ssh -t "$TARGET" "sudo rsync -a --delete $STAGE/web/ /opt/food-web/app/web/ && sudo rsync -a --delete $STAGE/server/ /opt/food-web/app/server/ \
  && sudo rsync -a $STAGE/deploy/ /opt/food-web/app/deploy/ && sudo chown -R foodweb:foodweb /opt/food-web/app \
  && sudo systemctl restart food-web && sleep 2 && systemctl --no-pager --lines=5 status food-web && curl -fsS http://127.0.0.1:8787/healthz && echo"
echo "部署完成。"
