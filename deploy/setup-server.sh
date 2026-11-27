#!/usr/bin/env bash
# 新服务器一次性初始化（Ubuntu 22.04 / 24.04，root 运行）：
#   sudo bash setup-server.sh 你的域名
# 做的事：安装 Node 24、Nginx、certbot；建 foodweb 用户与目录；装 systemd 服务、Nginx 站点、
#        管理命令 food-web-admin、每日 3:30 自动备份。不会申请证书，也不会启动服务（等 deploy.sh 上传代码后再启动）。
set -euo pipefail
DOMAIN="${1:?用法：sudo bash setup-server.sh 你的域名}"
NODE_VERSION="${NODE_VERSION:-v24.14.0}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" = 0 ] || { echo "请用 root 运行"; exit 1; }

apt-get update
apt-get install -y nginx certbot python3-certbot-nginx rsync curl xz-utils sqlite3

# Node：从国内镜像下载官方二进制，避免海外源超时
if ! /usr/local/bin/node --version 2>/dev/null | grep -q "^${NODE_VERSION}$"; then
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) echo "不支持的架构"; exit 1 ;; esac
  TARBALL="node-${NODE_VERSION}-linux-${ARCH}.tar.xz"
  curl -fsSL "https://registry.npmmirror.com/-/binary/node/${NODE_VERSION}/${TARBALL}" -o "/tmp/${TARBALL}"
  tar -xJf "/tmp/${TARBALL}" -C /usr/local --strip-components=1 --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE'
  rm -f "/tmp/${TARBALL}"
fi
/usr/local/bin/node --version

id foodweb >/dev/null 2>&1 || useradd --system --home /opt/food-web --shell /usr/sbin/nologin foodweb
install -d -o foodweb -g foodweb -m 750 /opt/food-web /opt/food-web/app /opt/food-web/data
install -d -o foodweb -g foodweb -m 700 /var/backups/food-web

if [ ! -f /etc/food-web.env ]; then
  sed "s#https://example.cn#https://${DOMAIN}#" "$HERE/food-web.env.example" > /etc/food-web.env
  PASS="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 16)"
  sed -i "s#^RESEARCHER_PASSCODE=.*#RESEARCHER_PASSCODE=${PASS}#" /etc/food-web.env
  chmod 600 /etc/food-web.env
  echo "已生成 /etc/food-web.env，调研员口令：${PASS}（请记下）。还需要填 DASHSCOPE_API_KEY：sudo nano /etc/food-web.env"
fi

install -m 644 "$HERE/food-web.service" /etc/systemd/system/food-web.service
systemctl daemon-reload
systemctl enable food-web

sed "s#DOMAIN#${DOMAIN}#g" "$HERE/nginx-food-web.conf" > /etc/nginx/sites-available/food-web
ln -sf /etc/nginx/sites-available/food-web /etc/nginx/sites-enabled/food-web
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

cat > /usr/local/bin/food-web-admin <<'ADMIN'
#!/bin/sh
# 管理命令：sudo food-web-admin help
set -a; . /etc/food-web.env; set +a
exec runuser -u foodweb -- /usr/local/bin/node --disable-warning=ExperimentalWarning /opt/food-web/app/server/dist/admin.cjs "$@"
ADMIN
chmod 750 /usr/local/bin/food-web-admin

echo "30 3 * * * root /usr/local/bin/food-web-admin backup --out /var/backups/food-web --keep 14 >> /var/log/food-web-backup.log 2>&1" > /etc/cron.d/food-web-backup

echo
echo "初始化完成。接下来："
echo "  1. sudo nano /etc/food-web.env    填 DASHSCOPE_API_KEY（备案号下来后再填 ICP_NUMBER）"
echo "  2. 在电脑上运行 deploy/deploy.sh 用户名@服务器IP   上传代码并启动"
echo "  3. sudo certbot --nginx -d ${DOMAIN}   申请 HTTPS 证书（域名备案并解析到本机后）"
