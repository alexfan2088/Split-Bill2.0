// pages/recharge/add.js
const db = require('../../utils/db.js');
const { computeAmountFromInput } = require('../../utils/amountExpression.js');
const app = getApp();

Page({
  data: {
    activityId: '',
    rechargeId: '',
    isEdit: false,
    isReadOnly: false, // 是否只读模式
    amount: '',
    date: '',
    payerList: [],
    selectedPayer: '',
    keeper: '', // 保管人员
    keeperList: [], // 保管人员列表
    currentUser: '', // 当前登录用户（记录人）
  },

  onShareAppMessage() {
    return {
      title: '充值记录',
      path: `/pages/recharge/add?activityId=${this.data.activityId || ''}${this.data.rechargeId ? '&rechargeId=' + this.data.rechargeId : ''}`,
      imageUrl: '' // 可选：分享图片
    };
  },
  
  onShareTimeline() {
    return {
      title: '充值记录',
      imageUrl: '' // 可选：分享图片
    };
  },
  
  onLoad(options) {
    // 检查用户是否已登录
    const userName = db.getCurrentUser();
    if (!userName) {
      // 未登录，跳转到登录页
      wx.redirectTo({
        url: '/pages/login/login'
      });
      return;
    }
    
    if (options.activityId) {
      this.setData({ activityId: options.activityId });
      // 获取当前登录用户作为记录人
      const userName = db.getCurrentUser();
      this.setData({ currentUser: userName });
      this.loadActivityMembers();
      
      // 检查是否是编辑模式
      if (options.rechargeId) {
        this.setData({ 
          rechargeId: options.rechargeId,
          isEdit: true
        });
        wx.setNavigationBarTitle({
          title: '编辑充值'
        });
        this.loadRechargeData();
      } else {
        wx.setNavigationBarTitle({
          title: '添加充值'
        });
        this.initDate();
      }
    }
  },

  initDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    this.setData({ date: `${year}-${month}-${day}` });
  },

  async loadActivityMembers() {
    try {
      const dbCloud = wx.cloud.database();
      const activityId = this.data.activityId;

      // 加载活动的group（获取最新成员列表）
      const groupRes = await dbCloud.collection('groups')
        .where({ activityId: activityId })
        .limit(1)
        .get();

      let members = [];
      if (groupRes.data && groupRes.data.length > 0) {
        members = groupRes.data[0].members || [];
      } else {
        // 如果没有group，从activity中获取
        const actRes = await dbCloud.collection('activities').doc(activityId).get();
        members = actRes.data.members || [];
      }

      const payerList = members.map(m => ({
        name: typeof m === 'string' ? m : m.name
      }));

      // 加载活动的保管人员
      const actRes = await dbCloud.collection('activities').doc(activityId).get();
      const activity = actRes.data;
      const keeper = activity.keeper || '';
      
      this.setData({ 
        payerList,
        keeper, // 保管人员固定为活动的保管人员，不可修改
        keeperList: payerList
      });
    } catch (e) {
      console.error('加载活动成员失败:', e);
      wx.showToast({
        title: '加载成员失败',
        icon: 'none'
      });
    }
  },

  onAmountInput(e) {
    const raw = e.detail.value;
    const computed = computeAmountFromInput(raw);
    if (computed !== null) {
      this.setData({ amount: computed });
      return;
    }
    this.setData({ amount: raw });
  },

  onAmountConfirm(e) {
    this.applyAmountFormula(e.detail.value);
  },

  onAmountBlur(e) {
    this.applyAmountFormula(e.detail.value);
  },

  applyAmountFormula(value) {
    const computed = computeAmountFromInput(value);
    if (computed !== null) {
      this.setData({ amount: computed });
    }
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
  },

  selectPayer(e) {
    if (this.data.isReadOnly) {
      return; // 只读模式下不允许选择
    }
    const payer = e.currentTarget.dataset.name;
    this.setData({ selectedPayer: payer });
  },
  
  goBack() {
    wx.navigateBack();
  },

  async loadRechargeData() {
    try {
      const dbCloud = wx.cloud.database();
      const rechargeDoc = await dbCloud.collection('recharges').doc(this.data.rechargeId).get();
      const recharge = rechargeDoc.data;
      
      // 检查是否是自动生成的充值记录
      if (recharge.isAuto) {
        wx.showToast({
          title: '自动生成的充值记录不可编辑',
          icon: 'none'
        });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
        return;
      }
      
      // 检查权限：只有记录人可以编辑，其他人只能浏览
      const userName = db.getCurrentUser();
      const recorder = recharge.recorder || recharge.creator;
      const isReadOnly = recorder !== userName;
      
      if (isReadOnly) {
        wx.setNavigationBarTitle({
          title: '查看充值'
        });
      }
      
      this.setData({ isReadOnly });
      
      // 格式化日期
      const date = recharge.date;
      let dateStr = '';
      if (date) {
        const d = date.getTime ? new Date(date) : new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
      }
      
      this.setData({
        amount: String(recharge.amount || ''),
        date: dateStr,
        selectedPayer: recharge.payer || '',
      });
    } catch (e) {
      console.error('加载充值记录失败:', e);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  async saveRecharge() {
    // 只读模式下不允许保存
    if (this.data.isReadOnly) {
      return;
    }
    
    const amount = Number(this.data.amount);
    if (!amount || amount <= 0) {
      wx.showToast({
        title: '金额必须大于0',
        icon: 'none'
      });
      return;
    }

    if (!this.data.selectedPayer) {
      wx.showToast({
        title: '请选择预存人',
        icon: 'none'
      });
      return;
    }

    if (!this.data.keeper) {
      wx.showToast({
        title: '活动未设置保管人员，请先编辑活动设置保管人员',
        icon: 'none',
        duration: 3000
      });
      return;
    }

    wx.showLoading({
      title: '保存中...'
    });

    try {
      const dbCloud = wx.cloud.database();
      const userName = db.getCurrentUser();

      // 组合日期
      const dateStr = this.data.date; // 格式：yyyy-MM-dd
      const date = new Date(`${dateStr}T00:00:00`);

      if (this.data.isEdit) {
        // 更新充值记录
        await dbCloud.collection('recharges').doc(this.data.rechargeId).update({
          data: {
            amount: amount,
            payer: this.data.selectedPayer,
            date: date,
            // 记录人和创建者不变
          }
        });
        
        wx.hideLoading();
        wx.showToast({
          title: '更新成功',
          icon: 'success'
        });
      } else {
        // 创建充值记录
        await dbCloud.collection('recharges').add({
          data: {
            activityId: this.data.activityId,
            amount: amount,
            payer: this.data.selectedPayer,
            keeper: this.data.keeper,
            recorder: userName, // 记录人
            date: date,
            creator: userName,
            createdAt: new Date()
          }
        });
        
        wx.hideLoading();
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
      }

      // 返回上一页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (e) {
      wx.hideLoading();
      console.error('保存充值失败:', e);
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },
});
