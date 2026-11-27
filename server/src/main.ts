// 网页版后端入口：node server/dist/server.cjs（环境变量见 deploy/food-web.env.example）。
import { createDeps, createServer } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const deps = createDeps(config);
const recovered = deps.queue.recover();
if (recovered.requeued || recovered.failed) console.log(`[server] 恢复未完成的识别：重新排队 ${recovered.requeued} 条，标记失败 ${recovered.failed} 条`);
if (!config.visionMock && !process.env.DASHSCOPE_API_KEY) console.warn('[server] 未配置 DASHSCOPE_API_KEY：识别会失败。本地联调可设 VISION_MOCK=1');
if (!config.researcherPasscode) console.warn('[server] 未配置 RESEARCHER_PASSCODE：调研员无法登录（参与者链接不受影响）');

const server = createServer(config, deps);
server.listen(config.port, config.host, () => {
  console.log(`[server] 已启动 http://${config.host}:${config.port}  数据目录 ${config.dataDir}${config.visionMock ? '  （识别为模拟模式）' : ''}`);
});

function shutdown(signal: string): void {
  console.log(`[server] 收到 ${signal}，正在关闭`);
  server.close(() => { deps.store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
