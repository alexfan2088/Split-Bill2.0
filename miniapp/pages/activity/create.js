// pages/activity/create.js
const db = require('../../utils/db.js');
const app = getApp();

Page({
  data: {
    isEdit: false,
    activityId: '',
    name: '',
    type: '聚餐',
    members: [],
    memberNames: [],
    newMemberName: '',
    remark: '',
    isPrepaid: false, // 是否预存
    originalIsPrepaid: false, // 原始活动的预存状态（用于编辑时判断）
    showPrepaidOption: true, // 是否显示预存选项
    keeper: '', // 保管人员
    keeperList: [], // 保管人员列表（从成员中选择）
    creator: '', // 活动创建者
    originalMemberNames: [], // 编辑前的成员列表（用于同步账单成员）
    defaultTypes: ['聚餐', '秋秋妹', '麻将', '掼蛋', '公园'], // 系统默认类型（不可删除）
    commonTypes: ['聚餐', '秋秋妹', '麻将', '掼蛋', '公园'], // 常用类型（包含系统类型和自定义类型）
    remarkEditing: false, // 备注是否在编辑状态
    formattedRemark: [], // 格式化后的备注内容（用于显示高亮）
    isParent: false,
    parentId: '',
    parentName: ''
  },
  
  onShareAppMessage() {
    return {
      title: '创建账单活动',
      path: '/pages/activity/create',
      imageUrl: '' // 可选：分享图片
    };
  },
  
  onShareTimeline() {
    return {
      title: '创建账单活动',
      imageUrl: '' // 可选：分享图片
    };
  },
  
  async onLoad(options) {
    // 检查用户是否已登录
    const userName = db.getCurrentUser();
    if (!userName) {
      // 未登录，跳转到登录页
      wx.redirectTo({
        url: '/pages/login/login'
      });
      return;
    }
    
    // 获取当前用户（创建者）
    this.setData({ creator: userName });
    
    // 加载常用类型列表（从数据库）
    await this.loadCommonTypes();
    
    if (options.parentId) {
      let parentName = options.parentName || '';
      try {
        parentName = decodeURIComponent(parentName);
      } catch (e) {}
      this.setData({ parentId: options.parentId, parentName });
      await this.loadParentName(options.parentId, parentName);
    }

    if (options.id && options.data) {
      // 编辑模式
      try {
        const activity = JSON.parse(decodeURIComponent(options.data));
        
        // 从groups集合加载最新成员列表
        let members = activity.members || [];
        try {
          const dbCloud = wx.cloud.database();
          const groupRes = await dbCloud.collection('groups')
            .where({ activityId: activity._id })
            .limit(1)
            .get();
          
          if (groupRes.data && groupRes.data.length > 0 && groupRes.data[0].members) {
            members = groupRes.data[0].members;
          }
        } catch (e) {
          console.error('加载活动成员失败:', e);
          // 如果加载失败，使用activity中的members
          members = activity.members || [];
        }
        
        // 提取成员名称
        let memberNames = members.map(m => typeof m === 'string' ? m : m.name);
        
        // 确保创建者在第一位
        const creator = activity.creator || userName;
        memberNames = memberNames.filter(name => name !== creator); // 移除创建者（如果存在）
        memberNames.unshift(creator); // 将创建者添加到第一位
        
        const originalIsPrepaid = activity.isPrepaid || false;
        const isParent = activity.isParent === true;
        this.setData({
          isEdit: true,
          activityId: activity._id,
          name: activity.name || '',
          type: activity.type || '',
          remark: activity.remark || '',
          remarkEditing: true, // 编辑模式始终显示textarea
          isPrepaid: originalIsPrepaid,
          originalIsPrepaid: originalIsPrepaid, // 保存原始值
          showPrepaidOption: originalIsPrepaid, // 只有原始活动是预存时才显示
          keeper: activity.keeper || '',
          creator: creator,
          originalMemberNames: memberNames,
          isParent,
          parentId: activity.parentId || '',
        });
        if (activity.parentId) {
          await this.loadParentName(activity.parentId);
        }
        this.setMembersFromNames(memberNames);
        wx.setNavigationBarTitle({
          title: '编辑活动'
        });
      } catch (e) {
        console.error('解析活动数据失败:', e);
        wx.showToast({
          title: '加载失败',
          icon: 'none'
        });
      }
    } else {
      // 新建模式，自动将创建者添加到第一位
      if (userName) {
        this.setMembersFromNames([userName]);
      }
      
      // 自动填写备注说明
      const defaultRemark = '默认方式：A B C 每次费用轮流付款，长期会平衡，也可以通过 结算 页面的余额信息，线下转账强制平衡后，补录账单实现账务清零，默认模式也可以用于人情账记账，例如小孩结婚，升学，吃席等。\n预存模式：A B C 提前转到A 那里，A 保管费用，每次费用A 来付款，费用结算页面可以看到当前余额，如果某一个人余额为负，则应自觉去A那里充值。';
      this.setData({
        remark: defaultRemark
      });
      // 格式化备注内容用于显示（高亮"默认方式"和"预存模式"）
      this.formatRemarkForDisplay(defaultRemark);
      
      wx.setNavigationBarTitle({
        title: '创建活动'
      });
    }
  },
  
  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },

  async loadParentName(parentId, fallbackName = '') {
    if (!parentId) return;
    try {
      const res = await wx.cloud.database().collection('activities').doc(parentId).get();
      const parentName = (res.data && res.data.name) || fallbackName;
      this.setData({ parentName });
    } catch (e) {
      console.error('加载父活动名称失败:', e);
      if (fallbackName) this.setData({ parentName: fallbackName });
    }
  },

  toggleParent(e) {
    const isParent = e.detail.value;
    this.setData({ isParent, isPrepaid: isParent ? false : this.data.isPrepaid, keeper: isParent ? '' : this.data.keeper });
  },
  
  // 加载常用类型列表（从数据库）
  async loadCommonTypes() {
    try {
      const dbCloud = wx.cloud.database();
      // 查询当前用户的自定义活动类型
      const res = await dbCloud.collection('userCustomActivityTypes')
        .orderBy('createdAt', 'desc')
        .get();
      
      const savedCustomTypes = (res.data || []).map(item => item.type);
      
      // 合并默认类型和保存的自定义类型，去重
      const defaultTypes = this.data.defaultTypes;
      const allTypes = [...new Set([...defaultTypes, ...savedCustomTypes])];
      this.setData({ commonTypes: allTypes });
    } catch (e) {
      console.error('加载常用类型失败:', e);
      // 如果查询失败，只使用默认类型
      this.setData({ commonTypes: this.data.defaultTypes });
    }
  },
  
  // 保存新类型到数据库（只保存自定义类型）
  async saveCustomTypeToDB(newType) {
    try {
      const dbCloud = wx.cloud.database();
      // 检查该类型是否已存在
      const checkRes = await dbCloud.collection('userCustomActivityTypes')
        .where({ type: newType })
        .get();
      
      if (checkRes.data && checkRes.data.length > 0) {
        // 类型已存在，不需要重复保存
        return;
      }
      
      // 保存新类型到数据库
      await dbCloud.collection('userCustomActivityTypes').add({
        data: {
          type: newType,
          createdAt: new Date()
        }
      });
    } catch (e) {
      console.error('保存自定义类型到数据库失败:', e);
    }
  },
  
  // 选择常用类型
  selectType(e) {
    const selectedType = e.currentTarget.dataset.type;
    this.setData({ type: selectedType });
  },
  
  // 长按删除自定义类型
  async deleteType(e) {
    const typeToDelete = e.currentTarget.dataset.type;
    const defaultTypes = this.data.defaultTypes;
    
    // 检查是否是系统默认类型
    if (defaultTypes.includes(typeToDelete)) {
      wx.showToast({
        title: '系统类型不可删除',
        icon: 'none',
        duration: 2000
      });
      return;
    }
    
    // 确认删除
    wx.showModal({
      title: '确认删除',
      content: `确定要删除类型"${typeToDelete}"吗？`,
      success: async (res) => {
        if (res.confirm) {
          // 从数据库删除
          try {
            const dbCloud = wx.cloud.database();
            const deleteRes = await dbCloud.collection('userCustomActivityTypes')
              .where({ type: typeToDelete })
              .get();
            
            if (deleteRes.data && deleteRes.data.length > 0) {
              // 删除所有匹配的文档（理论上每个用户每种类型只有一个）
              for (const doc of deleteRes.data) {
                await dbCloud.collection('userCustomActivityTypes').doc(doc._id).remove();
              }
            }
          } catch (e) {
            console.error('从数据库删除类型失败:', e);
            wx.showToast({
              title: '删除失败',
              icon: 'none'
            });
            return;
          }
          
          // 从常用类型列表中删除
          const updatedTypes = this.data.commonTypes.filter(type => type !== typeToDelete);
          this.setData({ commonTypes: updatedTypes });
          
          // 如果当前选中的类型被删除，清空输入框
          if (this.data.type === typeToDelete) {
            this.setData({ type: '' });
          }
          
          wx.showToast({
            title: '已删除',
            icon: 'success',
            duration: 1500
          });
        }
      }
    });
  },
  
  onTypeInput(e) {
    this.setData({ type: e.detail.value });
  },
  
  // 类型输入框失去焦点时，如果输入了新类型，自动添加到常用类型
  async onTypeBlur(e) {
    const newType = e.detail.value.trim();
    if (newType && !this.data.commonTypes.includes(newType)) {
      // 检查是否是系统默认类型
      const defaultTypes = this.data.defaultTypes;
      if (!defaultTypes.includes(newType)) {
        // 新类型，保存到数据库
        await this.saveCustomTypeToDB(newType);
        // 添加到常用类型列表
        const updatedTypes = [...this.data.commonTypes, newType];
        this.setData({ commonTypes: updatedTypes });
      }
    }
  },
  
  setMembersFromNames(memberNames) {
    const creator = this.data.creator || db.getCurrentUser();
    let names = (memberNames || []).filter(Boolean);
    if (creator) {
      names = names.filter(n => n !== creator);
      names.unshift(creator);
    }
    const members = names.map(name => ({ name, active: true }));
    this.setData({
      members,
      memberNames: names,
      keeperList: names.map(name => ({ name })),
    });
    if (this.data.keeper && !names.includes(this.data.keeper)) {
      this.setData({ keeper: '' });
    }
  },

  onNewMemberInput(e) {
    this.setData({ newMemberName: e.detail.value });
  },

  addMember() {
    const name = (this.data.newMemberName || '').trim();
    if (!name) {
      wx.showToast({
        title: '请输入成员姓名',
        icon: 'none'
      });
      return;
    }
    const memberNames = this.data.memberNames || [];
    if (memberNames.includes(name)) {
      wx.showToast({
        title: '成员已存在',
        icon: 'none'
      });
      return;
    }
    const updatedNames = [...memberNames, name];
    this.setMembersFromNames(updatedNames);
    this.setData({ newMemberName: '' });
  },

  onMemberLongPress(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    const creator = this.data.creator || db.getCurrentUser();
    wx.showActionSheet({
      itemList: ['修改名字', '删除成员'],
      success: (res) => {
        if (res.tapIndex === 0) {
          if (this.data.isEdit) {
            this.renameMember(name);
          } else {
            this.renameMemberLocal(name);
          }
        } else if (res.tapIndex === 1) {
          if (name === creator) {
            wx.showToast({
              title: '创建者不可删除',
              icon: 'none'
            });
            return;
          }
          if (this.data.isEdit) {
            this.deleteMember(name);
          } else {
            this.deleteMemberLocal(name);
          }
        }
      }
    });
  },

  renameMemberLocal(oldName) {
    const memberNames = this.data.memberNames || [];
    wx.showModal({
      title: oldName,
      content: '',
      editable: true,
      placeholderText: '输入新名字',
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        const newName = (modalRes.content || '').trim();
        if (!newName) {
          wx.showToast({ title: '请输入新名字', icon: 'none' });
          return;
        }
        if (newName === oldName) {
          wx.showToast({ title: '名字未改变', icon: 'none' });
          return;
        }
        if (memberNames.includes(newName)) {
          wx.showToast({ title: '成员已存在', icon: 'none' });
          return;
        }
        const updatedNames = memberNames.map(n => (n === oldName ? newName : n));
        this.setMembersFromNames(updatedNames);
        if (this.data.keeper === oldName) {
          this.setData({ keeper: newName });
        }
      }
    });
  },

  deleteMemberLocal(name) {
    const updatedNames = (this.data.memberNames || []).filter(n => n !== name);
    this.setMembersFromNames(updatedNames);
    if (this.data.keeper === name) {
      this.setData({ keeper: '' });
    }
  },

  renameMember(oldName) {
    const userName = db.getCurrentUser();
    const passwordHash = db.getCurrentUserPasswordHash();
    if (!userName || !passwordHash) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      });
      return;
    }
    const memberNames = this.data.memberNames || [];
    wx.showModal({
      title: oldName,
      content: '',
      editable: true,
      placeholderText: '输入新名字',
      success: async (modalRes) => {
        if (!modalRes.confirm) return;
        const newName = (modalRes.content || '').trim();
        if (!newName) {
          wx.showToast({ title: '请输入新名字', icon: 'none' });
          return;
        }
        if (newName === oldName) {
          wx.showToast({ title: '名字未改变', icon: 'none' });
          return;
        }
        if (memberNames.includes(newName)) {
          wx.showToast({ title: '成员已存在', icon: 'none' });
          return;
        }

        wx.showLoading({ title: '同步中...' });
        try {
          const cfRes = await wx.cloud.callFunction({
            name: 'activityOps',
            data: {
              action: 'renameMembersByMap',
              activityId: this.data.activityId,
              userName,
              passwordHash,
              renameMap: { [oldName]: newName }
            }
          });
          const result = (cfRes && cfRes.result) ? cfRes.result : {};
          if (!result.success) {
            wx.hideLoading();
            wx.showToast({
              title: result.error || '同步失败',
              icon: 'none',
              duration: 3000
            });
            return;
          }
          const updatedNames = memberNames.map(n => (n === oldName ? newName : n));
          this.setMembersFromNames(updatedNames);
          const updatedOriginal = (this.data.originalMemberNames || [])
            .map(n => (n === oldName ? newName : n));
          const nextKeeper = this.data.keeper === oldName ? newName : this.data.keeper;
          this.setData({
            originalMemberNames: updatedOriginal,
            keeper: nextKeeper
          });
          wx.hideLoading();
          wx.showToast({ title: '修改成功', icon: 'success' });
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '同步失败', icon: 'none' });
          console.error('同步改名失败:', e);
        }
      }
    });
  },

  async deleteMember(name) {
    const userName = db.getCurrentUser();
    const passwordHash = db.getCurrentUserPasswordHash();
    if (!userName || !passwordHash) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      });
      return;
    }
    wx.showModal({
      title: '确认删除',
      content: `确定要删除成员"${name}"吗？`,
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...' });
        try {
          const cfRes = await wx.cloud.callFunction({
            name: 'activityOps',
            data: {
              action: 'deleteMemberIfNoRecords',
              activityId: this.data.activityId,
              userName,
              passwordHash,
              memberName: name
            }
          });
          const result = (cfRes && cfRes.result) ? cfRes.result : {};
          if (!result.success) {
            wx.hideLoading();
            wx.showToast({
              title: result.error || '删除失败',
              icon: 'none',
              duration: 3000
            });
            return;
          }
          const updatedNames = (this.data.memberNames || []).filter(n => n !== name);
          this.setMembersFromNames(updatedNames);
          const updatedOriginal = (this.data.originalMemberNames || []).filter(n => n !== name);
          this.setData({ originalMemberNames: updatedOriginal });
          wx.hideLoading();
          wx.showToast({ title: '删除成功', icon: 'success' });
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '删除失败', icon: 'none' });
          console.error('删除成员失败:', e);
        }
      }
    });
  },
  
  onRemarkInput(e) {
    this.setData({ 
      remark: e.detail.value,
      remarkEditing: true // 用户开始编辑，标记为编辑状态
    });
  },
  
  // 格式化备注内容用于显示（高亮"默认方式"和"预存模式"）
  formatRemarkForDisplay(remarkText) {
    if (!remarkText) {
      this.setData({ formattedRemark: [] });
      return;
    }
    
    const parts = [];
    const keywords = ['默认方式', '预存模式'];
    let text = remarkText;
    
    // 查找所有关键词的位置
    const matches = [];
    keywords.forEach(keyword => {
      let index = text.indexOf(keyword);
      while (index !== -1) {
        matches.push({ keyword, index });
        index = text.indexOf(keyword, index + 1);
      }
    });
    
    // 按位置排序
    matches.sort((a, b) => a.index - b.index);
    
    // 如果没有匹配，直接返回整个文本
    if (matches.length === 0) {
      this.setData({ formattedRemark: [{ text: remarkText, highlight: false }] });
      return;
    }
    
    // 拆分文本
    let lastIndex = 0;
    matches.forEach((match) => {
      // 添加关键词前的文本
      if (match.index > lastIndex) {
        parts.push({ text: text.substring(lastIndex, match.index), highlight: false });
      }
      // 添加高亮的关键词
      parts.push({ text: match.keyword, highlight: true });
      lastIndex = match.index + match.keyword.length;
    });
    
    // 添加最后剩余的文本
    if (lastIndex < text.length) {
      parts.push({ text: text.substring(lastIndex), highlight: false });
    }
    
    this.setData({ formattedRemark: parts });
  },
  
  // 开始编辑备注
  startEditRemark() {
    this.setData({ remarkEditing: true });
  },
  
  // 切换预存选项
  togglePrepaid(e) {
    // 如果是编辑模式且原始活动是预存，不允许修改
    if (this.data.isEdit && this.data.originalIsPrepaid) {
      return;
    }
    const isPrepaid = e.detail.value;
    this.setData({ isPrepaid });
    
    // 如果选择预存，初始化保管人员列表
    if (isPrepaid) {
      const memberNames = this.data.memberNames || [];
      this.setData({
        keeperList: memberNames.map(name => ({ name }))
      });
    }
  },
  
  // 选择保管人员
  selectKeeper(e) {
    const keeper = e.currentTarget.dataset.name;
    this.setData({ keeper });
  },

  async refreshParentMembers(parentId, userName) {
    const passwordHash = db.getCurrentUserPasswordHash();
    if (!parentId || !passwordHash) return;
    const res = await wx.cloud.callFunction({
      name: 'activityOps',
      data: { action: 'refreshParentMembers', parentId, userName, passwordHash }
    });
    const result = (res && res.result) || {};
    if (!result.success) throw new Error(result.error || '更新父活动成员失败');
  },



  
  async saveActivity() {
    const name = this.data.name.trim();
    let type = this.data.type.trim();
    if (!type) type = '聚餐';
    const remark = this.data.remark.trim();
    
    if (!name) {
      wx.showToast({
        title: '请输入活动名称',
        icon: 'none'
      });
      return;
    }
    
    
    const isParent = this.data.isParent === true;
    // 父活动不单独维护参与者，仅保留创建者用于访问控制；详情页会实时汇总子活动成员。
    let memberNames = (this.data.memberNames || []).slice();
    
    if (!isParent && memberNames.length === 0) {
      wx.showToast({
        title: '请至少添加一个成员',
        icon: 'none'
      });
      return;
    }

    // 确保创建者在第一位且不可删除
    const creator = this.data.creator || db.getCurrentUser();
    if (creator) {
      memberNames = memberNames.filter(name => name !== creator);
      memberNames.unshift(creator);
    }
    
    // 检查成员是否有重名
    const nameCounts = {};
    const duplicateNames = [];
    memberNames.forEach(name => {
      if (nameCounts[name]) {
        nameCounts[name]++;
        if (nameCounts[name] === 2) {
          // 第一次发现重复，添加到重复列表
          duplicateNames.push(name);
        }
      } else {
        nameCounts[name] = 1;
      }
    });
    
    if (!isParent && duplicateNames.length > 0) {
      wx.showModal({
        title: '提示',
        content: `参与成员有重名：${duplicateNames.join('、')}，请修改后重试。`,
        showCancel: false,
        confirmText: '确定'
      });
      return;
    }
    
    // 如果是预存活动，必须选择保管人
    if (!isParent && this.data.isPrepaid && !this.data.keeper) {
      wx.showModal({
        title: '提示',
        content: '预存活动必须选择保管人员，请选择后再保存。',
        showCancel: false,
        confirmText: '确定'
      });
      return;
    }
    
    const members = memberNames.map(name => ({
      name: name,
      active: true
    }));
    
    wx.showLoading({
      title: this.data.isEdit ? '更新中...' : '创建中...'
    });
    
    try {
      const userName = db.getCurrentUser();
      const dbCloud = wx.cloud.database();
      
      if (this.data.isEdit) {
        const passwordHash = db.getCurrentUserPasswordHash();
        if (!passwordHash) {
          wx.hideLoading();
          wx.showToast({
            title: '请先登录',
            icon: 'none'
          });
          return;
        }

        // 更新活动
        const updateData = {
          name,
          type,
          remark,
          isPrepaid: isParent ? false : this.data.isPrepaid,
          members,
          memberNames,
          updatedAt: new Date()
        };
        updateData.isParent = isParent;
        // 如果是预存活动，保存保管人员
        if (this.data.isPrepaid) {
          updateData.keeper = this.data.keeper;
        }

        // 通过云函数更新活动及同步账单成员
        const res = await wx.cloud.callFunction({
          name: 'activityOps',
          data: {
            action: 'updateActivity',
            activityId: this.data.activityId,
            userName,
            passwordHash,
            updateData,
            originalMemberNames: this.data.originalMemberNames || [],
            newMemberNames: memberNames
          }
        });

        const result = (res && res.result) ? res.result : {};
        if (!result.success) {
          wx.hideLoading();
          wx.showToast({
            title: result.error || '保存失败',
            icon: 'none',
            duration: 3000
          });
          return;
        }
        if (this.data.parentId) {
          await this.refreshParentMembers(this.data.parentId, userName);
        }
        
        wx.hideLoading();
        wx.showToast({
          title: '更新成功',
          icon: 'success'
        });
      } else {
        // 创建活动
        console.log('创建活动，isPrepaid:', this.data.isPrepaid);
        const createData = {
          name,
          type,
          remark,
          isPrepaid: isParent ? false : this.data.isPrepaid,
          isParent,
          members,
          memberNames,
          creator: userName,
          createdAt: new Date()
        };
        if (this.data.parentId) {
          createData.parentId = this.data.parentId;
        }
        // 如果是预存活动，保存保管人员
        if (this.data.isPrepaid) {
          createData.keeper = this.data.keeper;
        }
        const actRes = await dbCloud.collection('activities').add({
          data: createData
        });
        
        // 创建活动的group
        await dbCloud.collection('groups').add({
          data: {
            activityId: actRes._id,
            members: members,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });

        if (this.data.parentId) {
          await this.refreshParentMembers(this.data.parentId, userName);
        }
        
        wx.hideLoading();
        wx.showToast({
          title: '创建成功',
          icon: 'success'
        });
  }
      
      // 如果输入了新类型，保存到常用类型列表
      if (type && !this.data.commonTypes.includes(type)) {
        // 检查是否是系统默认类型
        const defaultTypes = this.data.defaultTypes;
        if (!defaultTypes.includes(type)) {
          // 新类型，保存到数据库
          await this.saveCustomTypeToDB(type);
          // 添加到常用类型列表
          const updatedTypes = [...this.data.commonTypes, type];
          this.setData({ commonTypes: updatedTypes });
        }
      }
      
      // 返回上一页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (e) {
      wx.hideLoading();
      console.error('保存活动失败:', e);
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },
});
