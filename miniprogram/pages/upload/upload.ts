import { uploadMealImage, createMealAnalysis } from '../../services/mealService';
import {
  DEFAULT_PLATE_DIAMETER,
  MAX_PLATE_DIAMETER,
  MIN_PLATE_DIAMETER,
  PLATE_DIAMETER_OPTIONS,
  normalizePlateDiameter,
} from '../../utils/weight';
import { safeGet, safeSet } from '../../utils/storage';

// 上次选过的盘径记在本地：同一个人多半天天用同一个盘子，不该每次都重选。
const LAST_DIAMETER_KEY = 'last_plate_diameter';

Page({
  data: {
    imageUrl: '',
    diameterOptions: PLATE_DIAMETER_OPTIONS,
    selectedDiameter: DEFAULT_PLATE_DIAMETER,
    useCustom: false,
    customDiameter: '',
    tips: [
      '餐盘完整入镜，且不要被裁掉边缘',
      '尽量俯拍，光线充足',
      '避免手和餐具遮挡',
      '一次只拍一道菜',
    ],
    submitting: false,
  },

  onLoad() {
    const last = normalizePlateDiameter(safeGet<number>(LAST_DIAMETER_KEY, DEFAULT_PLATE_DIAMETER));
    // 上次用的是自定义尺寸（不在预设里）时，直接把自定义框填好并激活。
    const preset = PLATE_DIAMETER_OPTIONS.indexOf(last) >= 0;
    this.setData({
      selectedDiameter: last,
      useCustom: !preset,
      customDiameter: preset ? '' : String(last),
    });
  },

  // 选择预设直径
  selectDiameter(e: WechatMiniprogram.TouchEvent) {
    const value = Number(e.currentTarget.dataset.value);
    this.setData({ selectedDiameter: value, useCustom: false });
  },

  // 切换到自定义输入
  enableCustom() {
    this.setData({ useCustom: true });
  },

  onCustomInput(e: WechatMiniprogram.Input) {
    this.setData({ customDiameter: e.detail.value });
  },

  /** 最终采用的盘径。自定义值非法时不静默兜底，而是返回 0 让调用方提示用户 */
  resolveDiameter(): number {
    if (!this.data.useCustom) return this.data.selectedDiameter;
    const n = Number(this.data.customDiameter);
    if (!isFinite(n) || n < MIN_PLATE_DIAMETER || n > MAX_PLATE_DIAMETER) return 0;
    return Math.round(n * 10) / 10;
  },

  // 拍照或从相册选择
  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles[0];
        if (file && file.tempFilePath) {
          this.setData({ imageUrl: file.tempFilePath });
        }
      },
      fail: () => {
        // 用户取消选择不提示
      },
    });
  },

  removeImage() {
    this.setData({ imageUrl: '' });
  },

  async startAnalyze() {
    if (this.data.submitting) {
      return;
    }
    if (!this.data.imageUrl) {
      wx.showToast({ title: '请先选择菜品照片', icon: 'none' });
      return;
    }
    const plateDiameterCm = this.resolveDiameter();
    if (!plateDiameterCm) {
      wx.showToast({
        title: `请输入 ${MIN_PLATE_DIAMETER}–${MAX_PLATE_DIAMETER} cm 之间的盘径`,
        icon: 'none',
      });
      return;
    }
    safeSet(LAST_DIAMETER_KEY, plateDiameterCm);

    this.setData({ submitting: true });
    wx.showLoading({ title: '上传中', mask: true });
    try {
      const { fileId, imageUrl } = await uploadMealImage(this.data.imageUrl);
      const { analysisId } = await createMealAnalysis({
        imageUrl,
        imageFileId: fileId,
        plateDiameterCm,
      });
      wx.hideLoading();
      wx.navigateTo({ url: `/pages/analyzing/analyzing?analysisId=${analysisId}` });
    } catch (err) {
      console.error('[upload] startAnalyze failed', err);
      wx.hideLoading();
      wx.showToast({ title: '创建识别任务失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
