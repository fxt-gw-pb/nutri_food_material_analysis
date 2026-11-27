// WXML → Vue 模板 → 渲染函数。
//
// 网页版不重写页面：miniprogram/pages/*/*.wxml 原样作为模板来源，在构建期转成 Vue 模板，
// 再交给 @vue/compiler-dom 编译成渲染函数。只支持本项目实际用到的标签与属性；
// 遇到没实现的标签直接报错，免得网页上悄悄少一块界面。
import { compile } from '@vue/compiler-dom';

const SUPPORTED = new Set(['view', 'text', 'image', 'button', 'input', 'block', 'slider', 'picker', 'template', 'import']);
const VOID = new Set(['image', 'input', 'slider', 'import']);
const EVENTS = { tap: 'tap', input: 'input', change: 'change', confirm: 'confirm', blur: 'blur', focus: 'focus', longpress: 'longpress' };
const DROP = new Set(['placeholder-class', 'placeholder-style', 'hover-class', 'hover-stay-time', 'hover-start-time', 'user-select',
  'selectable', 'decode', 'space', 'lazy-load', 'show-menu-by-longpress', 'mode', 'loading', 'block-size', 'block-color',
  'activecolor', 'activeColor', 'backgroundcolor', 'backgroundColor', 'confirm-type', 'cursor-spacing', 'adjust-position', 'form-type']);

// ---------------------------------------------------------------------------
// 解析：一个只为 WXML 写的小解析器，{{ }} 内的 < > 引号都当作普通字符。
// ---------------------------------------------------------------------------
export function parseWxml(source, file = 'wxml') {
  const root = { type: 'root', children: [] };
  const stack = [root];
  let i = 0;
  const fail = (msg) => { throw new Error(`${file}: ${msg}（位置 ${i}）`); };
  while (i < source.length) {
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i);
      if (end < 0) fail('注释没有闭合');
      i = end + 3;
      continue;
    }
    if (source[i] === '<' && source[i + 1] === '/') {
      const end = source.indexOf('>', i);
      const name = source.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) fail(`闭合标签 </${name}> 与 <${top && top.name}> 不匹配`);
      i = end + 1;
      continue;
    }
    if (source[i] === '<' && /[a-zA-Z]/.test(source[i + 1] || '')) {
      i += 1;
      const nameMatch = /^[a-zA-Z][\w-]*/.exec(source.slice(i));
      const name = nameMatch[0];
      i += name.length;
      const attrs = [];
      let selfClosing = false;
      for (;;) {
        while (/\s/.test(source[i])) i += 1;
        if (source.startsWith('/>', i)) { selfClosing = true; i += 2; break; }
        if (source[i] === '>') { i += 1; break; }
        if (i >= source.length) fail(`<${name}> 没有结束`);
        const attrName = /^[^\s=/>]+/.exec(source.slice(i))[0];
        i += attrName.length;
        while (/\s/.test(source[i])) i += 1;
        let value = null;
        if (source[i] === '=') {
          i += 1;
          while (/\s/.test(source[i])) i += 1;
          const quote = source[i];
          if (quote !== '"' && quote !== "'") fail(`属性 ${attrName} 的值必须加引号`);
          const end = source.indexOf(quote, i + 1);
          value = source.slice(i + 1, end);
          i = end + 1;
        }
        attrs.push({ name: attrName, value });
      }
      const node = { type: 'element', name, attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing && !VOID.has(name)) stack.push(node);
      continue;
    }
    // 文本：读到下一个不在 {{ }} 里的 <
    let j = i;
    while (j < source.length) {
      if (source.startsWith('{{', j)) {
        const end = source.indexOf('}}', j + 2);
        if (end < 0) fail('{{ 没有闭合');
        j = end + 2;
        continue;
      }
      if (source[j] === '<') break;
      j += 1;
    }
    stack[stack.length - 1].children.push({ type: 'text', value: source.slice(i, j) });
    i = j;
  }
  if (stack.length !== 1) fail(`<${stack[stack.length - 1].name}> 没有闭合`);
  return root;
}

// ---------------------------------------------------------------------------
// 表达式工具
// ---------------------------------------------------------------------------
const MUSTACHE = /\{\{([\s\S]*?)\}\}/g;
const hasMustache = (v) => typeof v === 'string' && v.includes('{{');
/** 属性值 → JS 表达式。整段只有一个 {{x}} 时保留原类型（布尔、数字、对象）。 */
export function attrExpr(value) {
  const whole = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(value);
  if (whole && !whole[1].includes('}}')) return `(${whole[1].trim()})`;
  const parts = [];
  let last = 0;
  value.replace(MUSTACHE, (m, expr, offset) => {
    if (offset > last) parts.push(JSON.stringify(value.slice(last, offset)));
    parts.push(`(${expr.trim()})`);
    last = offset + m.length;
    return m;
  });
  if (last < value.length) parts.push(JSON.stringify(value.slice(last)));
  return parts.length ? parts.join(' + ') : JSON.stringify(value);
}
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const attrQuote = (expr) => expr.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// 转换
// ---------------------------------------------------------------------------
export function wxmlToVue(source, file = 'wxml') {
  const root = parseWxml(source, file);
  const templates = {};
  const imports = [];
  const out = [];
  for (const node of root.children) {
    if (node.type === 'element' && node.name === 'import') {
      imports.push(node.attrs.find((a) => a.name === 'src').value);
    } else if (node.type === 'element' && node.name === 'template' && attr(node, 'name') !== undefined) {
      templates[attr(node, 'name')] = node.children.map((c) => convertNode(c, file)).join('');
    } else {
      out.push(convertNode(node, file));
    }
  }
  return { template: out.join(''), templates, imports };
}

function attr(node, name) {
  const found = node.attrs.find((a) => a.name === name);
  return found ? (found.value === null ? '' : found.value) : undefined;
}

function convertNode(node, file) {
  // 解析器只会在 {{ }} 外遇到 < 时切断文本，所以文本里不会出现裸的 <，原样交给 Vue。
  if (node.type === 'text') return node.value;
  const { name } = node;
  if (!SUPPORTED.has(name)) throw new Error(`${file}: 网页版还不支持 <${name}>，请在 web/plugins/wxml.mjs 里补上对应实现`);
  if (name === 'import') return '';

  const control = [];   // v-if / v-for 等结构指令
  const props = [];     // 普通属性
  const dataset = [];   // data-* → 事件里的 currentTarget.dataset
  const events = [];
  const staticClasses = [];
  let dynamicClass = null;
  let forInfo = null;
  let ifDirective = null;
  let hoverClass = null;
  let loadingExpr = null;

  for (const { name: rawName, value } of node.attrs) {
    const v = value === null ? '' : value;
    if (rawName === 'wx:if') { ifDirective = `v-if="${attrQuote(attrExpr(v))}"`; continue; }
    if (rawName === 'wx:elif') { ifDirective = `v-else-if="${attrQuote(attrExpr(v))}"`; continue; }
    if (rawName === 'wx:else') { ifDirective = 'v-else'; continue; }
    if (rawName === 'wx:for') { forInfo = { list: attrExpr(v), item: 'item', index: 'index', key: null, ...forInfo }; continue; }
    if (rawName === 'wx:for-item') { forInfo = { ...forInfo, item: v }; continue; }
    if (rawName === 'wx:for-index') { forInfo = { ...forInfo, index: v }; continue; }
    if (rawName === 'wx:key') { forInfo = { ...forInfo, key: v }; continue; }
    const ev = /^(bind|catch|bind:|catch:)([a-z]+)$/.exec(rawName.replace(/^(bind|catch):/, '$1'));
    if (ev) {
      const kind = EVENTS[ev[2]];
      if (!kind) throw new Error(`${file}: 网页版还不支持事件 ${rawName}`);
      if (hasMustache(v)) throw new Error(`${file}: 事件处理函数名不能是表达式（${rawName}）`);
      events.push({ kind, handler: v, stop: rawName.startsWith('catch') });
      continue;
    }
    if (rawName.startsWith('data-')) { dataset.push(`${JSON.stringify(camel(rawName.slice(5)))}: ${hasMustache(v) ? attrExpr(v) : JSON.stringify(v)}`); continue; }
    if (rawName === 'hover-class') { if (v && v !== 'none') hoverClass = v; continue; }
    if (rawName === 'loading') { loadingExpr = hasMustache(v) ? attrExpr(v) : (v === 'false' ? 'false' : 'true'); continue; }
    if (rawName === 'class') {
      if (hasMustache(v)) dynamicClass = attrExpr(v); else staticClasses.push(v);
      continue;
    }
    if (rawName === 'hidden') { props.push(`v-show="${attrQuote(`!${hasMustache(v) ? attrExpr(v) : 'true'}`)}"`); continue; }
    if (DROP.has(rawName) && !(name === 'image' && rawName === 'mode')) {
      if (rawName === 'user-select' && v !== 'false') staticClasses.push('wx-selectable');
      continue;
    }
    if (name === 'image' && rawName === 'mode') { staticClasses.push(`wx-mode-${v || 'scaleToFill'}`); continue; }
    props.push(renderProp(name, rawName, v));
  }

  // 元素映射
  let tag = name;
  const extra = [];
  const children = node.children.map((c) => convertNode(c, file)).join('');
  let inner = children;
  if (name === 'image') {
    tag = 'img';
    staticClasses.unshift('wx-image');
    if (!staticClasses.some((c) => c.startsWith('wx-mode-'))) staticClasses.push('wx-mode-scaleToFill');
    extra.push('draggable="false"');
  } else if (name === 'button') {
    extra.push('type="button"');
    if (loadingExpr) inner = `<span v-if="${attrQuote(loadingExpr)}" class="wx-button-loading" aria-hidden="true"></span>${children}`;
    if (loadingExpr) extra.push(`:aria-busy="${attrQuote(`${loadingExpr} ? 'true' : 'false'`)}"`);
  } else if (name === 'slider') {
    tag = 'input';
    extra.push('type="range"');
    staticClasses.unshift('wx-slider');
  } else if (name === 'picker') {
    const mode = attr(node, 'mode');
    if (mode !== 'date') throw new Error(`${file}: 网页版 <picker> 目前只实现了 mode="date"`);
    tag = 'label';
    staticClasses.unshift('wx-picker');
  } else if (name === 'block') {
    tag = 'template';
  } else if (name === 'template') {
    const is = attr(node, 'is');
    if (is === undefined) throw new Error(`${file}: <template> 需要 is 或 name`);
    tag = 'wx-tpl';
    props.length = 0;
    props.push(`name="${attrQuote(is)}"`);
    const data = attr(node, 'data');
    props.push(`:data="${attrQuote(data ? `{${attrExpr(data).replace(/^\(|\)$/g, '')}}` : '{}')}"`);
  }

  if (staticClasses.length) props.push(`class="${attrQuote(staticClasses.join(' '))}"`);
  if (dynamicClass) props.push(`:class="${attrQuote(dynamicClass)}"`);
  if (hoverClass) props.push(`v-wx-hover="${attrQuote(JSON.stringify(hoverClass))}"`);

  const ds = `{${dataset.join(', ')}}`;
  for (const { kind, handler, stop } of events) {
    const call = `__ev(${JSON.stringify(handler)}, $event, ${ds}, ${JSON.stringify(kind)})`;
    if (kind === 'longpress') { props.push(`v-wx-longpress="${attrQuote(`($event) => ${call}`)}"`); continue; }
    const domEvent = { tap: 'click', input: 'input', change: 'change', confirm: 'keydown.enter', blur: 'blur', focus: 'focus' }[kind];
    props.push(`@${domEvent}${stop ? '.stop' : ''}="${attrQuote(call)}"`);
  }

  if (name === 'picker') {
    // 原生日期选择器盖在内容上方，点击区域与小程序一致。
    const value = attr(node, 'value');
    const end = attr(node, 'end');
    const start = attr(node, 'start');
    const change = events.find((e) => e.kind === 'change');
    const bind = (n, v) => (v === undefined ? '' : hasMustache(v) ? ` :${n}="${attrQuote(attrExpr(v))}"` : ` ${n}="${attrQuote(v)}"`);
    const pickerProps = props.filter((p) => !/^(@change|value=|:value=|end=|:end=|start=|:start=|mode=)/.test(p));
    const onChange = change ? ` @change="${attrQuote(`__ev(${JSON.stringify(change.handler)}, $event, ${ds}, 'change')`)}"` : '';
    inner = `${children}<input class="wx-picker-native" type="date"${bind('value', value)}${bind('max', end)}${bind('min', start)}${onChange} />`;
    return wrapControl(`<label ${pickerProps.join(' ')}>${inner}</label>`, ifDirective, forInfo, tag);
  }

  const attrsText = [...props, ...extra].filter(Boolean).join(' ');
  const open = attrsText ? `<${tag} ${attrsText}` : `<${tag}`;
  const element = tag === 'input' || tag === 'img' ? `${open} />` : `${open}>${inner}</${tag}>`;
  if (name === 'block' && !ifDirective && !forInfo) return children;
  return wrapControl(element, ifDirective, forInfo, tag);
}

function renderProp(tag, name, value) {
  let attrName = name;
  let v = value;
  if (tag === 'input' && name === 'type') {
    const map = { digit: ['text', 'decimal'], number: ['text', 'numeric'], idcard: ['text', 'text'], text: ['text', null], nickname: ['text', null], safePassword: ['password', null], password: ['password', null] };
    const [type, mode] = map[v] || ['text', null];
    return `type="${type}"${mode ? ` inputmode="${mode}"` : ''}`;
  }
  if (tag === 'button' && name === 'type') attrName = 'data-type';
  if (tag === 'input' && name === 'maxlength' && v === '-1') return '';
  // 包内静态资源（/assets/...）在网页里要加上部署前缀，交给运行时的 __asset 处理。
  if (tag === 'image' && name === 'src' && !hasMustache(v) && v.startsWith('/')) return `:src="${attrQuote(`__asset(${JSON.stringify(v)})`)}"`;
  if (hasMustache(v)) return `:${attrName}="${attrQuote(attrExpr(v))}"`;
  return value === null ? attrName : `${attrName}="${attrQuote(v)}"`;
}

function wrapControl(element, ifDirective, forInfo, tag) {
  const insert = (el, directive) => el.replace(/^<([\w-]+)/, `<$1 ${directive}`);
  if (!forInfo) return ifDirective ? insert(element, ifDirective) : element;
  const { list, item, index, key } = forInfo;
  const keyExpr = !key ? index : key === '*this' ? item : `${item}.${key}`;
  const forDirective = `v-for="(${item}, ${index}) in ${attrQuote(list)}" :key="${attrQuote(keyExpr)}"`;
  if (ifDirective) {
    // WXML 里 wx:for 优先于 wx:if（每一项各自判断）；Vue 相反，所以拆成两层。
    return `<template ${forDirective}>${insert(element, ifDirective)}</template>`;
  }
  if (tag === 'template') return insert(element, forDirective);
  return insert(element, forDirective);
}

// ---------------------------------------------------------------------------
// 编译
// ---------------------------------------------------------------------------
const CUSTOM_ELEMENTS = new Set(['view', 'text']);
export function compileVueTemplate(template, file) {
  const errors = [];
  const { code } = compile(template, {
    mode: 'module',
    prefixIdentifiers: true,
    hoistStatic: false,
    cacheHandlers: false,
    comments: false,
    whitespace: 'condense',
    isCustomElement: (tag) => CUSTOM_ELEMENTS.has(tag),
    onError: (e) => errors.push(e),
    onWarn: () => {},
  });
  if (errors.length) throw new Error(`${file}: Vue 模板编译失败：${errors.map((e) => e.message).join('；')}\n${template}`);
  return code;
}

/**
 * 生成一个 ES 模块：
 *   export const render  —— 页面主体
 *   export const templates —— 本文件定义的 <template name> 以及 <import> 进来的全部模板
 */
export function wxmlModule(source, file, resolveImport) {
  const { template, templates, imports } = wxmlToVue(source, file);
  const lines = [];
  imports.forEach((src, i) => lines.push(`import { templates as __imported${i} } from ${JSON.stringify(resolveImport(src))};`));
  const renderCode = compileVueTemplate(template || '<view></view>', file).replace('export function render', 'function __render');
  lines.push(renderCode);
  const entries = [];
  Object.entries(templates).forEach(([name, tpl], i) => {
    const code = compileVueTemplate(tpl || '<view></view>', `${file}#${name}`)
      .replace('export function render', `function __tpl${i}`);
    lines.push(code);
    entries.push(`${JSON.stringify(name)}: __tpl${i}`);
  });
  lines.push(`export const render = __render;`);
  lines.push(`export const templates = Object.assign({}, ${imports.map((_, i) => `__imported${i}, `).join('')}{ ${entries.join(', ')} });`);
  return dedupeVueImports(lines.join('\n'));
}

// 多段编译结果各自带一行 import { ... } from "vue"，合并成一行。
function dedupeVueImports(code) {
  const specifiers = new Set();
  const body = code.replace(/^import \{([^}]*)\} from "vue"\n?/gm, (_, list) => {
    list.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => specifiers.add(s));
    return '';
  });
  return `import { ${[...specifiers].join(', ')} } from "vue";\n${body}`;
}
