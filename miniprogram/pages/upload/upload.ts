import { uploadMealImage, createMealAnalysis } from '../../services/mealService';

Page({
  data: {
    imageUrl: '',
    tips: [
      '菜品完整入镜',
      '尽量俯拍，光线充足',
      '避免手和餐具遮挡',
      '一次只拍一道菜',
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

  async startAnalyze() {
    if (this.data.submitting) {
      return;
    }
    if (!this.data.imageUrl) {
      wx.showToast({ title: '请先选择菜品照片', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '上传中', mask: true });
    try {
      const { fileId, imageUrl } = await uploadMealImage(this.data.imageUrl);
      const { analysisId } = await createMealAnalysis({ imageUrl, imageFileId: fileId });
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
