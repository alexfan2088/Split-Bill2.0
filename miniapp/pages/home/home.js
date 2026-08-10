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
    // 每次显示页面时刷新列表
    console.log('活动列表页面 onShow 触发，开始重新加载活动列表');
    // 强制刷新，确保数据正确加载
    this.setData({ activities: [] });
    this.loadActivities();
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
      // 二级活动仅在所属父活动内展示，首页只显示独立活动和父活动。
      const activities = (await db.getActivities()).filter(activity => !activity.parentId);
      const userName = db.getCurrentUser();
      const dbCloud = wx.cloud.database();
      
      // 为每个活动加载最新的成员列表（从groups集合）
      const activitiesWithMembers = await Promise.all(activities.map(async (act) => {
        let memberNames = act.memberNames;
        let members = act.members || [];
        
        // 优先从groups集合加载最新成员列表
        try {
          const groupRes = await dbCloud.collection('groups')
            .where({ activityId: act._id })
            .limit(1)
            .get();
          
          if (groupRes.data && groupRes.data.length > 0 && groupRes.data[0].members) {
            members = groupRes.data[0].members;
            // 从members中提取memberNames
            memberNames = members.map(m => typeof m === 'string' ? m : m.name);
          } else if (act.members && Array.isArray(act.members)) {
            // 如果没有group，使用activity中的members
            members = act.members;
            memberNames = members.map(m => typeof m === 'string' ? m : m.name);
          } else if (act.memberNames && Array.isArray(act.memberNames)) {
            // 如果只有memberNames，使用它
            memberNames = act.memberNames;
          } else {
            memberNames = [];
          }
        } catch (e) {
          console.error('加载活动成员失败:', e);
          // 如果加载失败，使用activity中的members或memberNames
          if (act.members && Array.isArray(act.members)) {
            members = act.members;
            memberNames = members.map(m => typeof m === 'string' ? m : m.name);
          } else if (act.memberNames && Array.isArray(act.memberNames)) {
            memberNames = act.memberNames;
          } else {
            memberNames = [];
          }
        }
        
        // 确保memberNames是数组且不为空
        const finalMemberNames = Array.isArray(memberNames) && memberNames.length > 0 
          ? memberNames 
          : (Array.isArray(members) && members.length > 0 
              ? members.map(m => typeof m === 'string' ? m : m.name) 
              : []);
        
        // 将成员数组转换为字符串，用于显示
        const memberNamesText = finalMemberNames.length > 0 
          ? finalMemberNames.join('、') 
          : '暂无成员';
        
        console.log(`活动 ${act.name} 的成员:`, finalMemberNames, '显示文本:', memberNamesText);
        console.log(`活动 ${act.name} - isPrepaid 原始值:`, act.isPrepaid, '类型:', typeof act.isPrepaid);
        
        // 判断是否是预存活动（支持布尔值、字符串、数字等多种格式）
        let isPrepaidValue = false;
        if (act.isPrepaid === true || act.isPrepaid === 'true' || act.isPrepaid === 1 || act.isPrepaid === '1') {
          isPrepaidValue = true;
        }
        console.log(`活动 ${act.name} - isPrepaid 处理后:`, isPrepaidValue);
        
        return {
          ...act,
          members: members,
          memberNames: finalMemberNames, // 数组形式
          memberNamesText: memberNamesText, // 字符串形式，用于显示
          isCreator: act.creator === userName,
          isPrepaid: isPrepaidValue, // 是否预存活动
          isParent: act.isParent === true
        };
      }));
      
      console.log('活动列表加载完成，活动数量:', activitiesWithMembers.length);
      activitiesWithMembers.forEach(act => {
        console.log(`活动 ${act.name} - memberNamesText:`, act.memberNamesText, 'memberNames:', act.memberNames);
      });
      
      // 确保数据正确设置
      // 创建一个全新的数组和对象，确保触发视图更新
      const newActivities = activitiesWithMembers.map(act => {
        const memberText = act.memberNamesText || (act.memberNames && act.memberNames.length > 0 
          ? act.memberNames.join('、') 
          : '暂无成员');
        const isPrepaid = act.isPrepaid === true || act.isPrepaid === 'true';
        console.log(`准备设置 - 活动 ${act.name} - isPrepaid:`, isPrepaid, '原始值:', act.isPrepaid);
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
        };
      });
      
      console.log('准备设置数据，活动数量:', newActivities.length);
      newActivities.forEach(act => {
        console.log(`准备设置 - 活动 ${act.name} - memberNamesText:`, act.memberNamesText);
      });
      
      // 查询每个活动的最新账单时间，用于排序（按创建时间或更新时间）
      const activitiesWithLastBillTime = await Promise.all(newActivities.map(async (act) => {
        let lastBillTime = null;
        try {
          // 先尝试按updatedAt排序查询最新账单
          let billRes = null;
          try {
            billRes = await dbCloud.collection('bills')
              .where({ activityId: act._id })
              .orderBy('updatedAt', 'desc')
              .limit(1)
              .get();
          } catch (e) {
            // 如果updatedAt字段没有索引，尝试按createdAt排序
            console.log(`按updatedAt查询失败，尝试按createdAt查询:`, e);
            billRes = await dbCloud.collection('bills')
              .where({ activityId: act._id })
              .orderBy('createdAt', 'desc')
              .limit(1)
              .get();
          }
          
          if (billRes && billRes.data && billRes.data.length > 0) {
            const bill = billRes.data[0];
            // 优先使用账单的updatedAt，如果没有则使用createdAt（不再使用time字段）
            if (bill.updatedAt) {
              lastBillTime = bill.updatedAt.getTime ? bill.updatedAt.getTime() : new Date(bill.updatedAt).getTime();
            } else if (bill.createdAt) {
              lastBillTime = bill.createdAt.getTime ? bill.createdAt.getTime() : new Date(bill.createdAt).getTime();
            }
          }
        } catch (e) {
          console.log(`查询活动 ${act.name} 的最新账单失败:`, e);
          // 如果查询失败，尝试使用活动的更新时间
          if (act.updatedAt) {
            lastBillTime = act.updatedAt.getTime ? act.updatedAt.getTime() : new Date(act.updatedAt).getTime();
          } else if (act.createdAt) {
            lastBillTime = act.createdAt.getTime ? act.createdAt.getTime() : new Date(act.createdAt).getTime();
          }
        }
        
        // 如果没有账单，使用活动的创建时间
        if (!lastBillTime) {
          if (act.createdAt) {
            lastBillTime = act.createdAt.getTime ? act.createdAt.getTime() : new Date(act.createdAt).getTime();
          } else {
            lastBillTime = 0; // 没有时间信息的活动排到最后
          }
        }
        
        return {
          ...act,
          lastBillTime: lastBillTime
        };
      }));
      
      // 按照最新账单时间倒序排序（最新的排在最前面）
      activitiesWithLastBillTime.sort((a, b) => {
        return (b.lastBillTime || 0) - (a.lastBillTime || 0);
      });
      
      // 直接设置数据
      this.setData({ 
        activities: activitiesWithLastBillTime 
      }, () => {
        console.log('数据设置完成，当前活动列表:', this.data.activities);
        this.data.activities.forEach(act => {
          console.log(`设置后 - 活动 ${act.name} - memberNamesText:`, act.memberNamesText);
        });
      });
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
