// pages/home/home.js
const db = require('../../utils/db.js');
const app = getApp();

Page({
  data: {
    userName: '',
    activities: [],
  },
  
  onShareAppMessage() {
    return {
      title: '账单活动列表',
      path: '/pages/home/home',
      imageUrl: '' // 可选：分享图片
    };
  },
  
  onShareTimeline() {
    return {
      title: '账单活动列表',
      imageUrl: '' // 可选：分享图片
    };
  },
  
  onLoad() {
    // 首页允许游客浏览；仅在使用账户和记账功能时再主动登录。
    this.loadUserInfo();
    this.loadActivities();
  },
  
  onShow() {
    // 初次进入时 onLoad 已加载，避免紧接着重复发起一整轮云数据库请求。
    // 从详情页返回时再刷新，确保新建、编辑后的活动信息及时显示。
    if (this._activitiesLoaded) this.loadActivities();
  },
  
  loadUserInfo() {
    const userName = db.getCurrentUser();
    if (userName) {
      this.setData({ userName });
      app.globalData.currentUserName = userName;
    } else {
      this.setData({ userName: '' });
    }
  },
  
  async loadActivities() {
    wx.showLoading({ title: '加载中...' });
    
    try {
      const userName = db.getCurrentUser();
      const dbCloud = wx.cloud.database();
      const allAccessibleActivities = await db.getActivities();
      const childParentIds = [...new Set(allAccessibleActivities
        .filter(activity => activity.parentId)
        .map(activity => activity.parentId))];
      const parentCreatorById = {};

      // 一级活动创建者在首页看到一级活动；其他成员仅看到自己参与的二级活动。
      // 查询结果仅用于判断展示权限，一级活动名称和成员不会传入二级活动卡片。
      for (let i = 0; i < childParentIds.length; i += 20) {
        const ids = childParentIds.slice(i, i + 20);
        try {
          const parentRes = await dbCloud.collection('activities')
            .where({ _id: dbCloud.command.in(ids) })
            .get();
          (parentRes.data || []).forEach(parent => {
            parentCreatorById[parent._id] = parent.creator;
          });
        } catch (e) {
          console.error('加载二级活动所属一级活动失败:', e);
        }
      }

      const activities = allAccessibleActivities.filter(activity => {
        if (activity.isParent) return activity.creator === userName;
        if (!activity.parentId) return true;
        return parentCreatorById[activity.parentId] !== userName;
      });
      
      // activities 已保存成员信息；列表页不再为每个活动额外查询 groups 集合。
      const activitiesWithMembers = activities.map((act) => {
        const members = Array.isArray(act.members) ? act.members : [];
        const memberNames = Array.isArray(act.memberNames) && act.memberNames.length > 0
          ? act.memberNames
          : members.map(m => typeof m === 'string' ? m : m.name).filter(Boolean);
        return {
          ...act,
          memberNames,
          memberNamesText: memberNames.length > 0 ? memberNames.join('、') : '暂无成员',
          isCreator: act.creator === userName,
          isPrepaid: act.isPrepaid === true || act.isPrepaid === 'true' || act.isPrepaid === 1 || act.isPrepaid === '1',
          isParent: act.isParent === true
        };
      });
      
      // 确保数据正确设置
      // 创建一个全新的数组和对象，确保触发视图更新
      const newActivities = activitiesWithMembers.map(act => {
        const memberText = act.memberNamesText || (act.memberNames && act.memberNames.length > 0 
          ? act.memberNames.join('、') 
          : '暂无成员');
        const isPrepaid = act.isPrepaid === true || act.isPrepaid === 'true';
        return {
          _id: act._id,
          name: act.name,
          type: act.type,
          creator: act.creator,
          isCreator: act.isCreator,
          isPrepaid: isPrepaid, // 是否预存活动
          isParent: act.isParent === true,
          memberNames: act.memberNames,
          memberNamesText: memberText, // 确保这个字段存在
          lastBillAt: act.lastBillAt,
          updatedAt: act.updatedAt,
          createdAt: act.createdAt
        };
      });
      
      const toTimestamp = (value) => {
        if (!value) return 0;
        const timestamp = value.getTime ? value.getTime() : new Date(value).getTime();
        return Number.isNaN(timestamp) ? 0 : timestamp;
      };
      // 最近记账时间由账单云函数同步写回活动，列表无需逐活动查询 bills。
      const activitiesWithLastBillTime = newActivities.map(act => ({
        ...act,
        lastBillTime: toTimestamp(act.lastBillAt || act.updatedAt || act.createdAt)
      }));
      
      // 按照最新账单时间倒序排序（最新的排在最前面）
      activitiesWithLastBillTime.sort((a, b) => {
        return (b.lastBillTime || 0) - (a.lastBillTime || 0);
      });
      
      // 直接设置数据
      this.setData({ 
        activities: activitiesWithLastBillTime 
      });
      this._activitiesLoaded = true;
    } catch (e) {
      console.error('加载活动列表失败:', e);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
    }
    
    wx.hideLoading();
  },
  
  createActivity() {
    if (!db.getCurrentUser()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    wx.navigateTo({
      url: '/pages/activity/create'
    });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  switchAccount() {
    wx.navigateTo({ url: '/pages/login/login?switchAccount=1' });
  },
  
  openActivity(e) {
    const activityId = e.currentTarget.dataset.id;
    const isCreator = e.currentTarget.dataset.isCreator === 'true';
    // 创建者可以编辑，其他人只能浏览
    // 通过detail页面处理编辑逻辑
    wx.navigateTo({
      url: `/pages/activity/detail?id=${activityId}`
    });
  },
  
  deleteActivity(e) {
    const activityId = e.currentTarget.dataset.id;
    const activityName = e.currentTarget.dataset.name;
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除活动"${activityName}"吗？此操作不可恢复！`,
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            // TODO: 实现删除活动的逻辑
            await db.deleteActivity(activityId);
            wx.hideLoading();
            wx.showToast({
              title: '删除成功',
              icon: 'success'
            });
            this.loadActivities();
          } catch (e) {
            wx.hideLoading();
            wx.showToast({
              title: '删除失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },
});
