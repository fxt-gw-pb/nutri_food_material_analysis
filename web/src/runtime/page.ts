// Page() 注册与页面实例。
//
// 小程序页面文件（miniprogram/pages/*/*.ts）在模块求值时调用全局 Page({...})。
// 构建插件会在每个页面模块最前面写入 globalThis.__wxRoute，这里据此把定义登记到对应路由。
// 每次打开页面都按小程序的规则新建一个实例：非函数字段深拷贝，data 深拷贝，setData 合并。
import { nextTick, reactive } from 'vue';

export interface PageDefinition {
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PageInstance {
  route: string;
  options: Record<string, string>;
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>, callback?: () => void): void;
  [key: string]: unknown;
}

const definitions = new Map<string, PageDefinition>();

export function registerPageGlobal(): void {
  const g = globalThis as unknown as { Page: (def: PageDefinition) => void; __wxRoute?: string };
  g.Page = (def: PageDefinition) => {
    const route = g.__wxRoute;
    if (!route) throw new Error('Page() 调用时缺少路由信息');
    definitions.set(route, def);
  };
}

export function pageDefinition(route: string): PageDefinition | undefined {
  return definitions.get(route);
}

/** 小程序 setData 会把值序列化后再传给视图层；这里同样做一次 JSON 深拷贝，保证语义一致。 */
function cloneData<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneField(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Promise) return value;
  try { return cloneData(value); } catch { return value; }
}

/** 解析 'a.b[0].c' 这样的 setData 路径 */
export function parsePath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) out.push(m[2] !== undefined ? Number(m[2]) : m[1]);
  return out;
}

export function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    const value = cloneData(patch[key]);
    const path = parsePath(key);
    if (path.length === 1) { target[key] = value; continue; }
    let cursor: Record<string | number, unknown> = target;
    for (let i = 0; i < path.length - 1; i += 1) {
      const seg = path[i];
      let next = cursor[seg];
      if (next === null || typeof next !== 'object') {
        next = typeof path[i + 1] === 'number' ? [] : {};
        cursor[seg] = next;
      }
      cursor = next as Record<string | number, unknown>;
    }
    cursor[path[path.length - 1]] = value;
  }
}

export function createPageInstance(route: string, options: Record<string, string>): PageInstance {
  const def = definitions.get(route);
  if (!def) throw new Error(`页面 ${route} 未注册`);
  const inst = {} as PageInstance;
  for (const key of Object.keys(def)) {
    if (key === 'data') continue;
    const value = def[key];
    inst[key] = typeof value === 'function' ? value : cloneField(value);
  }
  inst.route = route;
  inst.options = options;
  inst.data = reactive(cloneData(def.data || {})) as Record<string, unknown>;
  inst.setData = function setData(patch, callback) {
    applyPatch(this.data, patch || {});
    if (callback) void nextTick(callback);
  };
  return inst;
}

export function callHook(inst: PageInstance, name: string, ...args: unknown[]): unknown {
  const fn = inst[name];
  if (typeof fn !== 'function') return undefined;
  try {
    const result = (fn as (...a: unknown[]) => unknown).apply(inst, args);
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch((err) => console.error(`[${inst.route}] ${name} 出错`, err));
    }
    return result;
  } catch (err) {
    console.error(`[${inst.route}] ${name} 出错`, err);
    return undefined;
  }
}
