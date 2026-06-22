# 微信小程序餐盘识别项目：第一阶段开发任务

请在当前工作目录中完成一个可运行的微信小程序 MVP 骨架。当前阶段不要求真实调用千问 API，也不要求创建或配置任何微信/CloudBase 云资源；我会自行完成 AppID、CloudBase 环境、云函数部署和 API Key 配置。

## 项目目标

开发一个简约的“餐盘拍照识别与食材重量估算”微信小程序。

核心用户流程：

1. 首页介绍产品并提供“开始拍照识别”入口；
2. 用户拍照或从相册选择餐盘图片；
3. 用户选择餐盘直径，默认 26 cm；
4. 上传后进入分析加载页；
5. 展示模拟识别结果：

   * 菜品名称；
   * 烹饪方式；
   * 可见主要食材；
   * 每种食材预估重量；
   * 菜品总重量；
   * 重量区间和可信度；
6. 用户对每道菜选择吃了多少：

   * 1/4；
   * 1/2；
   * 3/4；
   * 全吃完；
7. 页面自动计算并展示实际摄入重量；
8. 支持查看模拟历史记录。

## 技术要求

* 使用**原生微信小程序 + TypeScript**；
* 使用 WXML、WXSS、TypeScript、JSON 的标准小程序目录结构；
* UI 风格简约、清爽、现代，适合健康饮食记录类产品；
* 优先适配手机屏幕；
* 不引入复杂且不必要的 UI 框架；
* 所有接口先使用 mock 数据和可替换的 service 层；
* 不写入任何真实 API Key、AppID、CloudBase 环境 ID 或个人信息；
* 所有敏感配置使用 `.env.example`、`config.example.ts` 或占位符说明；
* 不需要调用真实千问 API；
* 不需要真的部署云函数、云数据库或云存储。

## 需要完成的页面

### 1. 首页

包含：

* 产品名称；
* 一句话介绍；
* “开始拍照识别”主按钮；
* “历史记录”入口；
* 简短免责声明。

建议文案：

> 拍一拍，记录这一餐。
> 识别菜品与主要食材，估算食材重量和实际摄入量。

免责声明：

> 识别结果基于图像估算，仅供饮食记录与健康管理参考，不等同于真实称重或医学建议。

### 2. 拍照上传页

实现：

* 调用微信拍照或相册选择能力；
* 图片预览；
* 删除和重新选择图片；
* 餐盘直径选择器，默认 26 cm；
* 可选值：22、24、26、28 cm，以及自定义输入；
* 简短拍摄提示：

  * 餐盘完整入镜；
  * 尽量俯拍；
  * 避免手和餐具遮挡；
  * 一次只拍一份餐盘；
* “开始分析”按钮。

当前阶段点击“开始分析”后，不调用真实后端，进入加载页并使用模拟分析过程。

### 3. 分析加载页

展示阶段性加载文案，例如：

* 正在识别菜品；
* 正在分析餐盘面积；
* 正在估算食材重量；
* 正在生成饮食记录。

模拟 2–4 秒后跳转结果页。

页面设计时预留真实异步任务状态接口，例如：

```ts
pending
preprocessing
stage_1_recognition
geometry_analysis
stage_2_weight_estimation
completed
failed
```

### 4. 识别结果页

以菜品卡片形式展示模拟结果。

每道菜展示：

* 菜品名称；
* 烹饪方式；
* 可见主要食材；
* 食材预估重量；
* 菜品总重量；
* 最小/最大重量区间；
* 识别可信度；
* 重量可信度；
* 限制说明。

每道菜下方提供食用比例选择：

```text
1/4、1/2、3/4、全吃完
```

用户选择比例后，前端自动计算：

```text
实际摄入菜品重量 = 菜品预估重量 × 食用比例
实际摄入食材重量 = 食材预估重量 × 食用比例
```

示例 mock 数据：

```ts
{
  dishId: "dish_1",
  dishName: "西兰花炒鸡胸肉",
  cookingMethod: "炒",
  estimatedTotalG: 180,
  minTotalG: 130,
  maxTotalG: 240,
  recognitionConfidence: "medium",
  weightConfidence: "medium",
  ingredients: [
    {
      name: "鸡胸肉",
      estimatedG: 95,
      minG: 65,
      maxG: 130,
      confidence: "medium"
    },
    {
      name: "西兰花",
      estimatedG: 85,
      minG: 60,
      maxG: 115,
      confidence: "medium"
    }
  ],
  limitations: [
    "重量基于餐盘尺度、食物面积和常见份量估算",
    "未对油、盐、酱料进行精确测量"
  ]
}
```

### 5. 历史记录页

先用本地 mock 数据实现：

* 日期；
* 餐盘图片缩略图；
* 菜品摘要；
* 总预估重量；
* 用户食用比例；
* 实际摄入重量；
* 点击进入详情页。

## 数据与服务层设计

请建立清晰的类型定义和 service 层，便于后续替换为 CloudBase。

建议至少建立：

```text
types/
services/
utils/
mock/
```

核心类型包括：

```ts
MealAnalysis
Dish
Ingredient
ConsumptionRecord
AnalysisStatus
```

建立以下 service 占位接口：

```ts
uploadMealImage()
createMealAnalysis()
getMealAnalysisStatus()
getMealAnalysisResult()
saveDishConsumption()
getMealHistory()
deleteMealRecord()
```

当前实现全部返回 mock 数据，但接口签名应为后续接入 CloudBase 和云函数设计。

## CloudBase 预留设计

请创建一份 `docs/cloudbase-integration.md`，说明后续需要接入的内容，但不要真的创建资源。

规划如下：

```text
CloudBase 云存储：
保存用户餐盘照片

CloudBase 云函数：
analyzeMeal
负责调用千问视觉模型、图片几何分析、保存结果

CloudBase 云数据库：
meal_records
model_logs
```

`meal_records` 建议按单条餐盘分析记录存储，结构中嵌套 dishes 和 ingredients，避免 MVP 阶段拆太多集合。

同时预留以下字段：

```ts
imageFileId
imageUrl
plateDiameterCm
status
modelName
promptVersion
result
createdAt
updatedAt
```

## 千问模型与后端预留

请创建 `docs/ai-pipeline.md`，简要记录后续真实后端流程：

```text
图片上传
→ 第一次千问识别菜品、食材、烹饪方式、菜品区域
→ OpenCV/几何脚本计算餐盘尺度和食物面积
→ 第二次千问综合估算各食材重量
→ 保存结构化 JSON
→ 前端读取和展示
```

明确说明：

* 千问 API Key 只能放在云函数或后端环境变量；
* 小程序前端不得直接调用千问；
* 前端不得包含 API Key；
* 重量展示必须为预估值和区间，不得表现为真实称重；
* 用户选择食用比例后无需再次调用大模型。

## UI 要求

* 使用卡片式布局；
* 页面不拥挤；
* 重点突出拍照入口和结果可读性；
* 不要使用医学诊断风格；
* 不要显示复杂图表；
* 可信度使用“高 / 中 / 低”或“较高 / 中等 / 较低”；
* 重量统一展示为整数 g；
* 结果页需要明显显示“预估结果，仅供记录参考”。

## 交付要求

完成后请：

1. 输出项目目录结构；
2. 说明各页面和核心文件用途；
3. 说明 mock 数据如何替换为 CloudBase；
4. 确保项目可在微信开发者工具中导入；
5. 添加 README，写明本地启动步骤；
6. 添加 `.gitignore`，排除本地配置、密钥和构建产物；
7. 不要提交真实密钥；
8. 修改前先检查当前目录、Git 状态、远程仓库和分支；
9. 修改后运行基础检查，确认无明显 TypeScript 或配置错误；
10. 最后展示 `git diff` 和改动摘要，但不要自动 push，等待我确认。

## github仓库
这是这个项目的仓库：
https://github.com/fxt-gw-pb/nutri_food_material_analysis
我已经在这台电脑上配置好了 GitHub SSH key，GitHub 用户名是 fxt-gw-pb。
以后和 GitHub 仓库交互时，请优先使用 SSH 地址，例如：
git@github.com:fxt-gw-pb/仓库名.git