import { uploadMealImage, createMealAnalysis } from '../../services/mealService';

const DIAMETER_OPTIONS = [22, 24, 26, 28];
const DEFAULT_DIAMETER = 26;

Page({
  data: {
    imageUrl: '',
    diameterOptions: DIAMETER_OPTIONS,
    selectedDiameter: DEFAULT_DIAMETER,
    useCustom: false,
    customDiameter: '',
    tips: [
      '餐盘完整入镜',
      '尽量俯拍',
      '避免手和餐具遮挡',
      '一次只拍一份餐盘',
    ],
    submitting: false,
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

  // 计算最终直径
  resolveDiameter(): number {
    if (this.data.useCustom) {
      return Number(this.data.customDiameter);
    }
    return this.data.selectedDiameter;
  },

  async startAnalyze() {
    if (this.data.submitting) {
      return;
    }
    if (!this.data.imageUrl) {
      wx.showToast({ title: '请先选择餐盘照片', icon: 'none' });
      return;
    }
    const diameter = this.resolveDiameter();
    if (!diameter || diameter < 10 || diameter > 60) {
      wx.showToast({ title: '请输入有效直径（10–60 cm）', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '上传中', mask: true });
    try {
      const { fileId, imageUrl } = await uploadMealImage(this.data.imageUrl);
      const { analysisId } = await createMealAnalysis({
        imageUrl,
        imageFileId: fileId,
        plateDiameterCm: diameter,
      });
      wx.hideLoading();
      wx.navigateTo({ url: `/pages/analyzing/analyzing?analysisId=${analysisId}` });
    } catch (err) {
      console.error('[upload] startAnalyze failed', err);
      wx.hideLoading();
      wx.showToast({ title: '创建分析失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
