// 后台识别队列：与云函数 analyzeMeal 的 process 动作一致，状态机 pending → preprocessing → recognizing → completed / failed。
//
// 模型调用直接复用 cloudfunctions/analyzeMeal/vision.js（固定快照 qwen3.8-max-0902、提示词 v8、
// quantityCalibration.js 份量校准与 ADAPTER_VERSION 都不变），保证网页版与小程序的科研数据口径连续。
// 唯一差别：小程序把云存储临时链接交给千问，网页版把照片以 base64 data URL 直接放进请求体
// （DashScope 兼容接口同样支持），服务器不需要对公网暴露照片地址。
import { Store } from './db';
import { Images } from './images';
import { MOCK_DISHES } from '../../miniprogram/mock/dishes';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import vision = require('../../cloudfunctions/analyzeMeal/vision.js');

export const { configuredModel, PROMPT_VERSION, LEGACY_PROMPT_VERSION, ADAPTER_VERSION, TARGET_MODEL } = vision;

export interface VisionOptions { mock: boolean; concurrency: number }
type Call = (imageUrl: string, plateDiameterCm: number) => Promise<Record<string, unknown> & { dish: unknown }>;

export function modelFields(mock: boolean): { modelName: string; promptVersion: string; adapterVersion: string } {
  if (mock) return { modelName: 'web-mock', promptVersion: 'mock-v0', adapterVersion: ADAPTER_VERSION };
  const model = configuredModel();
  return { modelName: model, promptVersion: model === TARGET_MODEL ? PROMPT_VERSION : LEGACY_PROMPT_VERSION, adapterVersion: ADAPTER_VERSION };
}

let mockIndex = 0;
const mockCall: Call = async () => {
  await new Promise((r) => setTimeout(r, Number(process.env.VISION_MOCK_DELAY_MS ?? 2500)));
  const dish = JSON.parse(JSON.stringify(MOCK_DISHES[mockIndex++ % MOCK_DISHES.length]));
  return { dish, modelName: 'web-mock', resolvedModel: 'web-mock', promptVersion: 'mock-v0', adapterVersion: ADAPTER_VERSION, mock: true };
};

export class VisionQueue {
  private waiting: string[] = [];
  private running = 0;
  private readonly call: Call;

  constructor(private store: Store, private images: Images, private options: VisionOptions, call?: Call) {
    this.call = call || (options.mock ? mockCall : async (url, d) => {
      const response = await vision.callQwen(url, d);
      if (!response) throw new Error('千问没有返回识别结果');
      return response;
    });
  }

  get pending(): number { return this.waiting.length + this.running; }

  enqueue(id: string): void {
    if (!this.waiting.includes(id)) this.waiting.push(id);
    this.pump();
  }

  private pump(): void {
    while (this.running < this.options.concurrency && this.waiting.length) {
      const id = this.waiting.shift() as string;
      this.running += 1;
      this.process(id).finally(() => { this.running -= 1; this.pump(); });
    }
  }

  private setStatus(id: string, status: string): void {
    this.store.updateMeal(id, (doc) => { doc.status = status; doc.updatedAt = Date.now(); });
  }

  async process(id: string): Promise<void> {
    let stage = '初始化';
    try {
      stage = '读取任务记录';
      const doc = this.store.getMeal(id);
      if (!doc) return;
      // 用户在识别过程中要求重拍后，旧任务不能再写回 completed；已完成的也不重复识别。
      if (doc.status === 'discarded' || doc.status === 'completed') return;

      stage = '更新任务状态';
      this.setStatus(id, 'preprocessing');

      stage = '读取图片';
      const imageUrl = this.images.readBase64DataUrl(String(doc.imageFileId || ''));

      stage = '调用千问识别';
      this.setStatus(id, 'recognizing');
      const plateDiameterCm = Number(doc.plateDiameterCm) > 0 ? Number(doc.plateDiameterCm) : 26;
      const response = await this.call(imageUrl, plateDiameterCm);
      const { dish, ...modelAudit } = response;

      stage = '写回识别结果';
      this.store.updateMeal(id, (latest) => {
        if (latest.status === 'discarded') return latest;
        latest.result = { dish };
        latest.modelName = modelAudit.modelName;
        latest.promptVersion = modelAudit.promptVersion;
        latest.adapterVersion = ADAPTER_VERSION;
        latest.modelAudit = modelAudit;
        latest.status = 'completed';
        latest.errorStage = '';
        latest.errorMessage = '';
        latest.updatedAt = Date.now();
        return latest;
      });
    } catch (err) {
      const message = String((err && (err as Error).message) || err);
      console.error(`[vision] ${id} 失败于【${stage}】`, message);
      try {
        this.store.updateMeal(id, (latest) => {
          if (latest.status === 'discarded') return latest;
          latest.status = 'failed';
          latest.errorStage = stage;
          // 截断：错误里可能带一整段接口响应。
          latest.errorMessage = message.slice(0, 500);
          latest.updatedAt = Date.now();
          return latest;
        });
      } catch { /* 记录已被删除 */ }
    }
  }

  /** 启动时处理上次没跑完的任务：10 分钟内的重新排队，更早的标记失败。 */
  recover(now = Date.now()): { requeued: number; failed: number } {
    const stuck = this.store.queryMeals("status IN ('pending', 'preprocessing', 'recognizing')", [], 'createdAt ASC', 1000);
    let requeued = 0;
    let failed = 0;
    for (const doc of stuck) {
      if (now - Number(doc.createdAt) < 10 * 60 * 1000) {
        this.store.updateMeal(doc._id, (d) => { d.status = 'pending'; d.updatedAt = now; });
        this.enqueue(doc._id);
        requeued += 1;
      } else {
        this.store.updateMeal(doc._id, (d) => {
          d.status = 'failed'; d.errorStage = '服务重启'; d.errorMessage = '识别过程中服务器重启，请重新拍照'; d.updatedAt = now;
        });
        failed += 1;
      }
    }
    return { requeued, failed };
  }
}
