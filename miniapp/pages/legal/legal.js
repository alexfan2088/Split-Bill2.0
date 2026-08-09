Page({
  data: { type: 'privacy' },

  onLoad(options) {
    const type = options.type === 'terms' ? 'terms' : 'privacy';
    this.setData({ type });
    wx.setNavigationBarTitle({ title: type === 'terms' ? '用户服务协议' : '隐私政策' });
  },

  switchType(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ type });
    wx.setNavigationBarTitle({ title: type === 'terms' ? '用户服务协议' : '隐私政策' });
  }
});
