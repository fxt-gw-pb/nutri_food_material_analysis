// 网页版构建插件：WXML → Vue 模板、WXSS → 网页 CSS。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const load = () => Promise.all([import('../web/plugins/wxml.mjs'), import('../web/plugins/miniprogram.mjs')]);

test('全部页面与模板都能转换并编译（遇到不支持的标签会直接报错）', async () => {
  const [{ wxmlModule }, { applyWebText }] = await load();
  const pages = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8')).pages;
  for (const route of pages) {
    const rel = `${route}.wxml`;
    const code = wxmlModule(applyWebText(rel, fs.readFileSync(path.join(root, 'miniprogram', rel), 'utf8')), rel, (s) => s);
    assert.match(code, /export const render = __render;/, route);
  }
  const tpl = wxmlModule(fs.readFileSync(path.join(root, 'miniprogram/templates/intake.wxml'), 'utf8'), 'intake', (s) => s);
  assert.match(tpl, /"intake-summary": __tpl0/);
});

test('属性表达式：单个 {{}} 保留原类型，混合文本拼接成字符串', async () => {
  const [{ attrExpr }] = await load();
  assert.equal(attrExpr('{{busy || !loaded}}'), '(busy || !loaded)');
  assert.equal(attrExpr('chip {{a ? \'x\' : \'\'}}'), '"chip " + (a ? \'x\' : \'\')');
  assert.equal(attrExpr('删除{{ing.name}}'), '"删除" + (ing.name)');
  assert.equal(attrExpr('plain'), '"plain"');
});

test('事件、dataset、wx:for 与 wx:if 的转换', async () => {
  const [{ wxmlToVue }] = await load();
  const { template } = wxmlToVue('<button wx:for="{{presets}}" wx:key="*this" wx:for-item="p" wx:if="{{p > 0}}" data-name="{{row.name}}" data-value="{{p}}" bindtap="choosePercent" hover-class="btn-hover" loading="{{busy}}">{{p}}%</button>');
  // WXML 里 wx:for 优先于 wx:if，必须拆成两层
  assert.match(template, /^<template v-for="\(p, index\) in \(presets\)" :key="p"><button v-if="\(p > 0\)"/);
  assert.match(template, /__ev\(&quot;choosePercent&quot;, \$event, \{&quot;name&quot;: \(row\.name\), &quot;value&quot;: \(p\)\}, &quot;tap&quot;\)/);
  assert.match(template, /v-wx-hover="&quot;btn-hover&quot;"/);
  assert.match(template, /<span v-if="\(busy\)" class="wx-button-loading"/);
  const longpress = wxmlToVue('<button bindtap="goDetail" bindlongpress="confirmDelete" data-id="{{item.analysisId}}">x</button>').template;
  assert.match(longpress, /v-wx-longpress="\(\$event\) => __ev\(&quot;confirmDelete&quot;/);
  const input = wxmlToVue('<input type="digit" value="{{v}}" bindinput="onInput" placeholder-class="p" />').template;
  assert.match(input, /type="text" inputmode="decimal"/);
  assert.doesNotMatch(input, /placeholder-class/);
  assert.throws(() => wxmlToVue('<scroll-view></scroll-view>'), /不支持 <scroll-view>/);
});

test('图片、静态资源与 <template is>', async () => {
  const [{ wxmlToVue }] = await load();
  const img = wxmlToVue('<image class="meal-img" src="{{imageUrl}}" mode="aspectFill" bindtap="previewImage" />').template;
  assert.match(img, /<img :src="\(imageUrl\)" class="wx-image meal-img wx-mode-aspectFill"/);
  const icon = wxmlToVue('<image class="ui-icon" src="/assets/icons/leaf.svg" />').template;
  assert.match(icon, /:src="__asset\(&quot;\/assets\/icons\/leaf\.svg&quot;\)"/);
  const tpl = wxmlToVue('<template is="intake-summary" data="{{...intake, textureOpen, nutrientOpen}}" />').template;
  assert.equal(tpl, '<wx-tpl name="intake-summary" :data="{...intake, textureOpen, nutrientOpen}"></wx-tpl>');
});

test('WXSS：rpx 换算、100vh 扣导航栏、页面样式加零权重作用域、动画关键帧不改', async () => {
  const [, { processWxss, convertUnits, scopeSelector }] = await load();
  assert.equal(convertUnits('0 10rpx 36rpx'), '0 calc(var(--rpx) * 10) calc(var(--rpx) * 36)');
  assert.equal(convertUnits('min(100vh, 2px)'), 'min(calc(100vh - var(--wx-nav-h) * 1), 2px)');
  assert.equal(scopeSelector('page', ''), ':where(.wx-page)');
  assert.equal(scopeSelector('button.chip', 'pages/upload/upload'), ':where(.wx-page[data-route="pages/upload/upload"]) button.chip');
  const css = processWxss(path.join(root, 'miniprogram/pages/daily/daily.wxss'), 'pages/daily/daily');
  assert.doesNotMatch(css, /\drpx/);
  assert.doesNotMatch(css, /@import/);
  // 内联进来的 styles/intake.wxss 也在本页作用域里
  assert.match(css, /:where\(\.wx-page\[data-route="pages\/daily\/daily"\]\) \.intake-section/);
  const app = processWxss(path.join(root, 'miniprogram/app.wxss'), '');
  assert.match(app, /@keyframes spin \{ to \{/);
  assert.match(app, /:where\(\.wx-page\) \{/);
});

test('网页文案替换找不到原文时报错', async () => {
  const [, { applyWebText }] = await load();
  assert.throws(() => applyWebText('pages/daily/daily.wxml', '<view>改过的文案</view>'), /找不到需要替换的文案/);
});
