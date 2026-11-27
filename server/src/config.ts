// 运行配置，全部来自环境变量（部署时写在 /etc/food-web.env，见 deploy/README.md）。
import path from 'node:path';

export interface ServerConfig {
  host: string;
  port: number;
  /** SQLite 数据库与菜品照片的存放目录 */
  dataDir: string;
  /** 前端构建产物目录（web/dist） */
  webDist: string;
  /** 对外访问地址，如 https://example.cn；用于生成参与者链接、判断 Cookie 是否加 Secure */
  publicOrigin: string;
  /** 调研员口令；不配置则调研员无法登录（参与者链接仍可用） */
  researcherPasscode: string;
  /** 本地联调用：不调用千问，3 秒后返回示例菜品 */
  visionMock: boolean;
  visionConcurrency: number;
  /** 部署在 Nginx 之后时为 true，从 X-Real-IP 取客户端地址 */
  trustProxy: boolean;
  /** 首页显示的站点名称（备案期间可按备案信息填写） */
  siteTitle: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerConfig {
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(cwd, p));
  const publicOrigin = (env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT) || 8787,
    dataDir: resolve(env.DATA_DIR || 'web-data'),
    webDist: resolve(env.WEB_DIST || 'web/dist'),
    publicOrigin,
    researcherPasscode: env.RESEARCHER_PASSCODE || '',
    visionMock: env.VISION_MOCK === '1',
    visionConcurrency: Math.max(1, Math.min(8, Number(env.VISION_CONCURRENCY) || 2)),
    trustProxy: env.TRUST_PROXY === '1',
    siteTitle: env.SITE_TITLE || '饮食记录',
  };
}

export function cookieSecure(config: ServerConfig): boolean {
  return config.publicOrigin.startsWith('https://');
}
