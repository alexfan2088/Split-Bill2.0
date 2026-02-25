// pages/bill/edit.js
const db = require('../../utils/db.js');
const app = getApp();

Page({
  data: {
    activityId: '',
    billId: '',
    isEdit: false,
    isReadOnly: false,
    isCreator: false, // 是否是账单创建者
    amount: '',
    title: '',
    billType: '聚餐', // 账单类型
    date: '',
    time: '',
    payerIndex: 0,
    payerList: [],
    participants: [],
    remark: '',
    attachmentItems: [],
    remarkMaxLen: 200,
    attachmentCanvasWidth: 10,
    attachmentCanvasHeight: 10,
    isPrepaid: false, // 是否预存活动
    keeper: '', // 保管人员
    payerDisabled: false, // 付款人是否禁用
    defaultTypes: ['聚餐', '人情账', '麻将', '门票', '礼品', '衣服'], // 系统默认类型
    commonTypes: ['聚餐', '人情账', '麻将', '门票', '礼品', '衣服'], // 常用类型（包含系统类型和自定义类型）
    recentBillTitles: [], // 最近的账单名称列表
    showTitlePicker: false, // 是否显示账单名称选择器
  },
  
  onShareAppMessage() {
    return {
      title: this.data.title ? `${this.data.title} - 账单详情` : '账单详情',
      path: `/pages/bill/edit?activityId=${this.data.activityId || ''}${this.data.billId ? '&billId=' + this.data.billId : ''}`,
      imageUrl: '' // 可选：分享图片
    };
  },
  
  onShareTimeline() {
    return {
      title: this.data.title ? `${this.data.title} - 账单详情` : '账单详情',
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
    
    this.setData({ activityId: options.activityId || '' });
    
    // 加载常用账单类型列表（从数据库）
    await this.loadCommonTypes();
    
    // 检查是否是只读模式
    const isReadOnly = options.readOnly === 'true';
    this.setData({ isReadOnly });
    
    if (options.billId) {
      // 编辑/查看模式
      this.setData({ 
        billId: options.billId,
        isEdit: true 
      });
      this.loadBillData();
    } else {
      // 新建模式
      this.initNewBill();
    }
    
    this.loadActivityMembers();
    
    // 如果是只读模式，修改标题
    if (isReadOnly) {
      wx.setNavigationBarTitle({
        title: '账单详情'
      });
    }
  },
  
  // 加载常用类型列表（从数据库）
  async loadCommonTypes() {
    try {
      const dbCloud = wx.cloud.database();
      const userName = db.getCurrentUser();
      // 查询当前用户的自定义账单类型（只加载当前用户创建的）
      const res = await dbCloud.collection('userCustomBillTypes')
        .where({
          creator: userName
        })
        .orderBy('createdAt', 'desc')
        .get();
      
      const savedTypes = (res.data || []).map(item => item.type);
      
      // 合并默认类型和保存的类型，去重
      const defaultTypes = this.data.defaultTypes;
      const allTypes = [...new Set([...defaultTypes, ...savedTypes])];
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
      const userName = db.getCurrentUser();
      // 检查该类型是否已存在（只检查当前用户创建的）
      const checkRes = await dbCloud.collection('userCustomBillTypes')
        .where({
          type: newType,
          creator: userName
        })
        .get();
      
      if (checkRes.data && checkRes.data.length > 0) {
        // 类型已存在，不需要重复保存
        return;
      }
      
      // 保存新类型到数据库，包含创建者信息
      await dbCloud.collection('userCustomBillTypes').add({
        data: {
          type: newType,
          creator: userName,
          createdAt: new Date()
        }
      });
    } catch (e) {
      console.error('保存自定义类型到数据库失败:', e);
    }
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
      let activity = null;
      if (groupRes.data && groupRes.data.length > 0) {
        members = groupRes.data[0].members || [];
      } else {
        // 如果没有group，从activity中获取
        const actRes = await dbCloud.collection('activities').doc(activityId).get();
        activity = actRes.data;
        members = activity.members || [];
      }
      
      // 如果没有获取到activity，重新获取
      if (!activity) {
        const actRes = await dbCloud.collection('activities').doc(activityId).get();
        activity = actRes.data;
      }
      
      const payerList = members.map(m => ({
        name: typeof m === 'string' ? m : m.name
      }));
      
      // 检查是否是预存活动
      const isPrepaid = activity ? (activity.isPrepaid || false) : false;
      const keeper = activity ? (activity.keeper || '') : '';
      
      // 如果是预存活动，付款人默认为保管人员，但允许用户修改
      let payerIndex = 0;
      let payerDisabled = false;
      if (isPrepaid && keeper) {
        const keeperIndex = payerList.findIndex(p => p.name === keeper);
        if (keeperIndex >= 0) {
          payerIndex = keeperIndex;
          // 预存模式下允许选择其他人员，不禁用
          payerDisabled = false;
        }
      } else {
        // 如果不是预存活动，设置默认付款人为当前用户
        if (!this.data.isEdit && payerList.length > 0) {
          const userName = db.getCurrentUser();
          const defaultPayerIndex = payerList.findIndex(p => p.name === userName);
          if (defaultPayerIndex >= 0) {
            payerIndex = defaultPayerIndex;
          }
        }
      }
      
      this.setData({ 
        payerList,
        payerIndex,
        isPrepaid,
        keeper,
        payerDisabled
      });
    } catch (e) {
      console.error('加载活动成员失败:', e);
      wx.showToast({
        title: '加载成员失败',
        icon: 'none'
      });
    }
  },
  
  async initNewBill() {
    // 设置默认时间
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    this.setData({
      date: `${year}-${month}-${day}`,
      time: `${hours}:${minutes}`,
      attachmentItems: [],
    });
    
    // 加载活动成员并继承最近一次账单的权重
    await this.loadParticipantsWithInheritance();
  },
  
  async loadParticipantsWithInheritance() {
    try {
      const dbCloud = wx.cloud.database();
      const activityId = this.data.activityId;
      
      // 查询最近一次账单和最近的账单名称列表
      let lastBill = null;
      let lastBillParticipants = null;
      let recentBillTitles = [];
      try {
        // 查询最近的账单（最多5条，用于获取账单名称列表）
        const recentBillsRes = await dbCloud.collection('bills')
          .where({ activityId: activityId })
          .orderBy('createdAt', 'desc')
          .limit(5)
          .get();

        if (recentBillsRes.data && recentBillsRes.data.length > 0) {
          // 获取最近一次账单
          lastBill = recentBillsRes.data[0];
          lastBillParticipants = lastBill.participants || null;
          
          // 提取最近的账单名称列表（去重，保留顺序）
          const titleSet = new Set();
          recentBillTitles = recentBillsRes.data
            .map(bill => bill.title)
            .filter(title => {
              if (title && !titleSet.has(title)) {
                titleSet.add(title);
                return true;
              }
              return false;
            });
          
          // 继承最近一次账单的名称和类型
          if (lastBill.title) {
            this.setData({ title: lastBill.title });
          }
          // 继承最近一次账单的类型，如果没有则保持默认值"聚餐"
          if (lastBill.billType) {
            this.setData({ billType: lastBill.billType });
          } else {
            // 如果最近一次账单没有类型，保持默认值"聚餐"
            this.setData({ billType: '聚餐' });
          }
        }
      } catch (e) {
        console.log('查询最近一次账单失败（可能没有索引）:', e);
      }
      
      // 设置最近的账单名称列表
      this.setData({ recentBillTitles });
      
      // 加载成员列表
      const groupRes = await dbCloud.collection('groups')
        .where({ activityId: activityId })
        .limit(1)
        .get();
      
      let members = [];
      if (groupRes.data && groupRes.data.length > 0) {
        members = groupRes.data[0].members || [];
      }
      
      // 生成参与成员列表，继承权重
      const participants = members.map(m => {
        const name = typeof m === 'string' ? m : m.name;
        let weight = 2; // 默认权重为2
        
        if (lastBillParticipants && lastBillParticipants.hasOwnProperty(name)) {
          weight = Number(lastBillParticipants[name]) || 0;
        }
        
        return { name, weight };
      });
      
      this.setData({ participants });
    } catch (e) {
      console.error('加载参与成员失败:', e);
    }
  },
  
  async loadBillData() {
    wx.showLoading({ title: '加载中...' });
    
    try {
      const dbCloud = wx.cloud.database();
      const billRes = await dbCloud.collection('bills').doc(this.data.billId).get();
      const bill = billRes.data;
      
      // 检查权限
      const userName = db.getCurrentUser();
      const isCreator = bill.creator === userName;
      
      // 设置是否是创建者
      this.setData({ isCreator });
      
      // 如果不是创建者，设置为只读模式
      if (!isCreator && !this.data.isReadOnly) {
        this.setData({ isReadOnly: true });
        wx.setNavigationBarTitle({
          title: '账单详情'
        });
      }
      
      // 格式化时间
      const billTime = bill.time ? (bill.time.getTime ? bill.time : new Date(bill.time)) : new Date();
      const year = billTime.getFullYear();
      const month = String(billTime.getMonth() + 1).padStart(2, '0');
      const day = String(billTime.getDate()).padStart(2, '0');
      const hours = String(billTime.getHours()).padStart(2, '0');
      const minutes = String(billTime.getMinutes()).padStart(2, '0');
      
      // 加载参与成员
      const groupRes = await dbCloud.collection('groups')
        .where({ activityId: this.data.activityId })
        .limit(1)
        .get();
      
      let members = [];
      if (groupRes.data && groupRes.data.length > 0) {
        members = groupRes.data[0].members || [];
      }
      
      // 生成参与成员列表，使用账单中的权重
      const participants = members.map(m => {
        const name = typeof m === 'string' ? m : m.name;
        const weight = bill.participants && bill.participants[name] !== undefined 
          ? Number(bill.participants[name]) || 0 
          : 0;
        return { name, weight };
      });
      
      // 加载活动信息，检查是否是预存活动
      const actRes = await dbCloud.collection('activities').doc(this.data.activityId).get();
      const activity = actRes.data;
      const isPrepaid = activity ? (activity.isPrepaid || false) : false;
      const keeper = activity ? (activity.keeper || '') : '';
      
      // 设置付款人索引
      let payerIndex = 0;
      let payerDisabled = false;
      
      // 如果是预存活动，使用 billshow 字段来显示付款人（如果存在）
      // billshow 是原始付款人，用于显示和编辑，但实际保存的 payer 是保管人
      if (isPrepaid && keeper && bill.billshow) {
        // 如果有 billshow 字段，使用它来设置显示的付款人
        const billshowIndex = this.data.payerList.findIndex(p => p.name === bill.billshow);
        if (billshowIndex >= 0) {
          payerIndex = billshowIndex;
        } else {
          // 如果 billshow 不在列表中，使用保管人
          const keeperIndex = this.data.payerList.findIndex(p => p.name === keeper);
          if (keeperIndex >= 0) {
            payerIndex = keeperIndex;
          }
        }
        payerDisabled = false;
      } else if (isPrepaid && keeper) {
        // 如果没有 billshow 字段，检查是否是自动修改的账单
        const keeperIndex = this.data.payerList.findIndex(p => p.name === keeper);
        if (keeperIndex >= 0) {
          // 编辑模式下，如果账单中的付款人不是保管人，使用账单中的付款人
          // 否则使用保管人作为默认值
          const billPayerIndex = this.data.payerList.findIndex(p => p.name === bill.payer);
          if (billPayerIndex >= 0 && bill.payer !== keeper) {
            // 如果付款人不是保管人，使用账单中的付款人
            payerIndex = billPayerIndex;
          } else {
            payerIndex = keeperIndex;
          }
          // 预存模式下允许选择其他人员，不禁用
          payerDisabled = false;
        }
      } else {
        // 如果不是预存活动，使用账单中的付款人
        payerIndex = this.data.payerList.findIndex(p => p.name === bill.payer);
        if (payerIndex < 0) {
          payerIndex = 0;
        }
      }
      
      const remarkText = bill.remark || '';
      this.setData({
        amount: String(bill.amount || ''),
        title: bill.title || '',
        billType: bill.billType || '聚餐', // 加载账单类型
        date: `${year}-${month}-${day}`,
        time: `${hours}:${minutes}`,
        payerIndex: payerIndex,
        participants: participants,
        remark: remarkText,
        isPrepaid: isPrepaid,
        keeper: keeper,
        payerDisabled: payerDisabled,
      });

      await this.loadBillAttachments(bill.attachments || []);
      
    } catch (e) {
      console.error('加载账单数据失败:', e);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
    }
    
    wx.hideLoading();
  },
  
  onAmountInput(e) {
    const raw = e.detail.value;
    const computed = this.computeAmountFromInput(raw);
    if (computed !== null) {
      this.setData({ amount: computed });
      return;
    }
    this.setData({ amount: raw });
  },

  computeAmountFromInput(input) {
    if (!input) return null;
    const hasEqual = input.includes('=');
    const expr = this.normalizeAmountExpression(input, hasEqual);
    if (!expr) return null;
    if (!this.shouldComputeExpression(expr, hasEqual)) return null;
    const result = this.evaluateAmountExpression(expr);
    if (result === null) return null;
    return this.formatAmountResult(result);
  },

  normalizeAmountExpression(input, hasEqual) {
    const raw = hasEqual ? (input.split('=')[0] || '') : input;
    const expr = raw.replace(/\s+/g, '');
    if (!expr) return '';
    if (!/^[0-9+\-*/().]+$/.test(expr)) return '';
    if (/[+\-*/.]$/.test(expr)) return '';
    return expr;
  },

  shouldComputeExpression(expr, hasEqual) {
    if (hasEqual) return true;
    if (/^[0-9]*\.?[0-9]+$/.test(expr)) return false;
    const trimmed = expr.replace(/^\-/, '');
    return /[+\-*/]/.test(trimmed);
  },

  evaluateAmountExpression(expr) {
    try {
      const result = Function(`"use strict"; return (${expr})`)();
      if (typeof result !== 'number' || !Number.isFinite(result)) return null;
      return result;
    } catch (e) {
      return null;
    }
  },

  formatAmountResult(value) {
    const fixed = value.toFixed(2);
    return fixed.replace(/\.?0+$/, '');
  },
  
  selectTitle(e) {
    const title = e.currentTarget.dataset.title;
    if (title) {
      this.setData({ title: title });
    }
  },
  
  clearTitle() {
    this.setData({ title: '' });
  },
  
  deleteBill() {
    // 只有创建者才能删除账单
    if (!this.data.isCreator) {
      wx.showToast({
        title: '只有创建者可以删除账单',
        icon: 'none'
      });
      return;
    }

    const billTitle = this.data.title || '该账单';
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除账单"${billTitle}"吗？此操作不可恢复！`,
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            const userName = db.getCurrentUser();
            const passwordHash = db.getCurrentUserPasswordHash();
            if (!userName || !passwordHash) {
              wx.hideLoading();
              wx.showToast({
                title: '请先登录',
                icon: 'none'
              });
              return;
            }

            const res = await wx.cloud.callFunction({
              name: 'billOps',
              data: {
                action: 'deleteBill',
                billId: this.data.billId,
                userName,
                passwordHash
              }
            });

            const result = (res && res.result) ? res.result : {};
            if (result.success) {
              wx.hideLoading();
              wx.showToast({
                title: '删除成功',
                icon: 'success'
              });
              // 返回上一页
              setTimeout(() => {
                wx.navigateBack();
              }, 1500);
              return;
            }

            wx.hideLoading();
            console.error('删除账单失败:', result);
            let errorMsg = '删除失败';
            const errMsg = result.errMsg || result.error || '';
            if (result.errCode === -601034 || (errMsg && (errMsg.includes('权限') || errMsg.toLowerCase().includes('permission')))) {
              errorMsg = '删除失败：数据库权限不足，请检查bills集合的删除权限设置';
            } else if (errMsg) {
              errorMsg = `删除失败：${errMsg}`;
            }
            wx.showToast({
              title: errorMsg,
              icon: 'none',
              duration: 3000
            });
          } catch (e) {
            wx.hideLoading();
            console.error('删除账单失败:', e);
            const errMsg = (e && (e.errMsg || e.message)) || '';
            let errorMsg = '删除失败';
            if (e && (e.errCode === -601034 || (errMsg && (errMsg.includes('权限') || errMsg.toLowerCase().includes('permission'))))) {
              errorMsg = '删除失败：数据库权限不足，请检查bills集合的删除权限设置';
            } else if (errMsg) {
              errorMsg = `删除失败：${errMsg}`;
            }
            wx.showToast({
              title: errorMsg,
              icon: 'none',
              duration: 3000
            });
          }
        }
      }
    });
  },
  
  onTitleInput(e) {
    const title = e.detail.value;
    if (title.length > 20) {
      wx.showModal({
        title: '提示',
        content: '账单名称不能超过20个汉字，请修改后重试。',
        showCancel: false,
        confirmText: '确定',
        success: () => {
          // 焦点会自动回到输入框
        }
      });
      return;
    }
    this.setData({ title });
  },
  
  // 选择账单类型
  selectBillType(e) {
    const selectedType = e.currentTarget.dataset.type;
    this.setData({ billType: selectedType });
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
          // 从数据库删除（只删除当前用户创建的）
          try {
            const dbCloud = wx.cloud.database();
            const userName = db.getCurrentUser();
            const deleteRes = await dbCloud.collection('userCustomBillTypes')
              .where({
                type: typeToDelete,
                creator: userName
              })
              .get();
            
            if (deleteRes.data && deleteRes.data.length > 0) {
              // 删除所有匹配的文档（理论上每个用户每种类型只有一个）
              for (const doc of deleteRes.data) {
                await dbCloud.collection('userCustomBillTypes').doc(doc._id).remove();
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
          if (this.data.billType === typeToDelete) {
            this.setData({ billType: '' });
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
  
  // 账单类型输入框失去焦点时，如果输入了新类型，自动添加到常用类型
  async onBillTypeBlur(e) {
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
  
  // 账单类型输入
  onBillTypeInput(e) {
    this.setData({ billType: e.detail.value });
  },
  
  onDateChange(e) {
    this.setData({ date: e.detail.value });
  },
  
  onTimeChange(e) {
    this.setData({ time: e.detail.value });
  },
  
  onPayerChange(e) {
    // 预存模式下允许选择其他人员，保存时会自动处理
    this.setData({ payerIndex: e.detail.value });
  },
  
  onWeightChange(e) {
    const name = e.currentTarget.dataset.name;
    const weight = Number(e.detail.value);
    
    const participants = this.data.participants.map(p => {
      if (p.name === name) {
        return { ...p, weight: weight };
      }
      return p;
    });
    
    this.setData({ participants });
  },
  
  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  onAddAttachment() {
    if (this.data.isReadOnly) return;
    const maxCount = 1;
    const currentCount = (this.data.attachmentItems || []).length;
    if (currentCount >= maxCount) {
      wx.showToast({ title: '最多添加1张图片', icon: 'none' });
      return;
    }
    wx.chooseImage({
      count: maxCount - currentCount,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempFiles = res && res.tempFiles ? res.tempFiles : [];
        if (!tempFiles.length) return;
        const newItems = await this.processSelectedImages(tempFiles);
        if (!newItems.length) return;
        const merged = (this.data.attachmentItems || []).concat(newItems).slice(0, maxCount);
        this.setData({ attachmentItems: merged });
      }
    });
  },

  onPreviewAttachment(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const items = (this.data.attachmentItems || []).filter(i => i.previewUrl);
    if (!items.length) return;
    const urls = items.map(i => i.previewUrl);
    const current = urls[index] || urls[0];
    wx.previewImage({ urls, current });
  },

  onRemoveAttachment(e) {
    if (this.data.isReadOnly) return;
    const index = Number(e.currentTarget.dataset.index || 0);
    const items = (this.data.attachmentItems || []).slice();
    if (index < 0 || index >= items.length) return;
    items.splice(index, 1);
    this.setData({ attachmentItems: items });
  },

  normalizeAttachments(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const fileIDs = [];
    list.forEach((item) => {
      if (!item) return;
      if (typeof item === 'string') {
        fileIDs.push(item);
      } else if (item.fileID) {
        fileIDs.push(item.fileID);
      }
    });
    return fileIDs;
  },

  async processSelectedImages(tempFiles) {
    const limitBytes = 100 * 1024;
    const targets = tempFiles.slice(0, 1);
    if (!targets.length) return [];

    const compressed = await Promise.all(targets.map(async (file) => {
      const path = file.path;
      const finalPath = await this.compressImageToLimit(path, limitBytes);
      return finalPath;
    }));

    const valid = compressed.filter(p => p);
    if (!valid.length) {
      wx.showToast({ title: '图片压缩后仍超过100KB', icon: 'none' });
      return [];
    }

    return valid.map(p => ({
      fileID: '',
      localPath: p,
      previewUrl: p,
      isUploaded: false
    }));
  },

  async compressImageToLimit(path, limitBytes) {
    const fs = wx.getFileSystemManager();
    const getSize = async (p) => {
      try {
        const info = await new Promise((resolve, reject) => {
          fs.getFileInfo({
            filePath: p,
            success: resolve,
            fail: reject
          });
        });
        return info && info.size ? info.size : 0;
      } catch (e) {
        return 0;
      }
    };

    const getInfo = async (p) => {
      try {
        return await new Promise((resolve, reject) => {
          wx.getImageInfo({
            src: p,
            success: resolve,
            fail: reject
          });
        });
      } catch (e) {
        return null;
      }
    };

    const canvasToFile = async (p, width, height, quality) => {
      this.setData({
        attachmentCanvasWidth: width,
        attachmentCanvasHeight: height
      });
      const ctx = wx.createCanvasContext('attachmentCanvas', this);
      ctx.drawImage(p, 0, 0, width, height);
      await new Promise((resolve) => ctx.draw(false, resolve));
      return await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvasId: 'attachmentCanvas',
          width,
          height,
          destWidth: width,
          destHeight: height,
          fileType: 'jpg',
          quality,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        }, this);
      });
    };

    let currentPath = path;
    let size = await getSize(currentPath);
    if (size && size <= limitBytes) return currentPath;

    const qualities = [0.8, 0.6, 0.4, 0.2];
    for (const quality of qualities) {
      try {
        const res = await wx.compressImage({
          src: currentPath,
          quality: Math.round(quality * 100)
        });
        if (res && res.tempFilePath) {
          currentPath = res.tempFilePath;
          size = await getSize(currentPath);
          if (size && size <= limitBytes) return currentPath;
        }
      } catch (e) {
        // ignore and continue
      }
    }

    const info = await getInfo(path);
    if (!info || !info.width || !info.height) {
      return '';
    }

    const baseWidth = info.width;
    const baseHeight = info.height;
    const scaleSteps = [0.85, 0.7, 0.55, 0.4, 0.3, 0.2];
    for (const scale of scaleSteps) {
      const width = Math.max(200, Math.floor(baseWidth * scale));
      const height = Math.max(200, Math.floor(baseHeight * scale));
      for (const quality of qualities) {
        try {
          const tempPath = await canvasToFile(path, width, height, quality);
          size = await getSize(tempPath);
          if (size && size <= limitBytes) return tempPath;
          currentPath = tempPath;
        } catch (e) {
          // ignore and continue
        }
      }
    }

    return '';
  },

  async loadBillAttachments(rawAttachments) {
    const fileIDs = this.normalizeAttachments(rawAttachments);
    if (!fileIDs.length) {
      this.setData({ attachmentItems: [] });
      return;
    }
    try {
      const res = await wx.cloud.getTempFileURL({ fileList: fileIDs });
      const fileList = res && res.fileList ? res.fileList : [];
      const urlMap = {};
      fileList.forEach((f) => {
        if (f && f.fileID && f.tempFileURL) {
          urlMap[f.fileID] = f.tempFileURL;
        }
      });
      const items = fileIDs.map(id => ({
        fileID: id,
        localPath: '',
        previewUrl: urlMap[id] || '',
        isUploaded: true
      })).filter(i => i.previewUrl);
      this.setData({ attachmentItems: items });
    } catch (e) {
      console.error('加载附件失败:', e);
    }
  },

  getAttachmentExt(path) {
    const match = (path || '').match(/\.([a-zA-Z0-9]+)$/);
    if (!match) return 'jpg';
    return match[1].toLowerCase();
  },

  async uploadNewAttachments() {
    const items = this.data.attachmentItems || [];
    const toUpload = items.filter(i => !i.fileID && i.localPath);
    if (!toUpload.length) return items;
    const activityId = this.data.activityId || 'activity';
    const timestamp = Date.now();
    const uploads = toUpload.map((item, idx) => {
      const ext = this.getAttachmentExt(item.localPath);
      const cloudPath = `bill_attachments/${activityId}_${timestamp}_${Math.floor(Math.random() * 10000)}_${idx}.${ext}`;
      return wx.cloud.uploadFile({
        cloudPath,
        filePath: item.localPath
      }).then(res => res && res.fileID ? res.fileID : '');
    });
    const fileIDs = await Promise.all(uploads);
    let uploadIndex = 0;
    const merged = items.map((item) => {
      if (item.fileID || !item.localPath) return item;
      const fileID = fileIDs[uploadIndex++] || '';
      return {
        ...item,
        fileID,
        isUploaded: Boolean(fileID)
      };
    }).filter(item => item.fileID || item.previewUrl);
    this.setData({ attachmentItems: merged });
    return merged;
  },
  
  async saveBill() {
    // 验证账单名称长度
    if (this.data.title.length > 20) {
      wx.showModal({
        title: '提示',
        content: '账单名称不能超过20个汉字，请修改后重试。',
        showCancel: false,
        confirmText: '确定',
      });
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
    
    const title = this.data.title.trim() || '未命名';
    const billType = this.data.billType.trim() || '聚餐';
    let payer = this.data.payerList[this.data.payerIndex].name;
    const remark = this.data.remark.trim();

    if (remark.length > this.data.remarkMaxLen) {
      wx.showModal({
        title: '提示',
        content: `备注不能超过${this.data.remarkMaxLen}个汉字，请修改后重试。`,
        showCancel: false,
        confirmText: '确定',
      });
      return;
    }

    
    // 预存模式特殊处理：如果付款人不是保管人，需要创建充值记录
    let needCreateRecharge = false;
    let originalPayer = null;
    let billshow = null; // 用于显示的付款人（原始付款人）
    if (this.data.isPrepaid && this.data.keeper) {
      if (payer !== this.data.keeper) {
        // 如果付款人不是保管人，需要创建充值记录
        originalPayer = payer;
        billshow = payer; // 保存原始付款人用于显示
        payer = this.data.keeper; // 修改付款人为保管人员（实际保存的付款人）
        needCreateRecharge = true;
      } else {
        // 如果付款人就是保管人
        // 在编辑模式下，如果账单原来有 billshow，且用户选择了保管人，清除 billshow
        // 在新建模式下，如果用户选择了保管人，billshow 为空
        if (this.data.isEdit) {
          // 编辑模式：如果用户选择了保管人，清除 billshow（使用实际付款人）
          billshow = null;
        } else {
          // 新建模式：如果用户选择了保管人，billshow 为空
          billshow = null;
        }
      }
    }
    
    // 收集参与成员权重（与Web版本保持一致）
    // 确保所有成员都保存（包括权重为0的），以便编辑时能正确显示
    // 只保存当前活动成员，清除已不存在的旧成员
    const participants = {};
    this.data.participants.forEach(p => {
      // 确保权重值是数字类型，避免类型不一致的问题
      const weight = typeof p.weight === 'number' ? p.weight : Number(p.weight || 0);
      participants[p.name] = weight;
    });
    
    // 确保只保存当前活动成员，清除数据库中已不存在的旧成员
    // 获取当前活动成员列表
    const currentMemberNames = this.data.participants.map(p => p.name);
    console.log('当前活动成员:', currentMemberNames);
    console.log('准备保存的participants:', participants);
    
    // 计算分摊金额
    // 计算总权重（包括权重为0的成员）
    const totalWeight = Object.keys(participants).reduce((sum, name) => sum + (participants[name] || 0), 0);
    
    // 验证：参与人权重和必须大于0（针对默认模式和预存模式）
    if (totalWeight === 0) {
      wx.showModal({
        title: '提示',
        content: '参与人权重和必须大于0，请至少设置一个参与人的权重大于0',
        showCancel: false,
        confirmText: '确定',
        success: () => {
          // 用户确认后，不保存，返回让用户修改权重
        }
      });
      return; // 阻止保存
    }
    
    const splitDetail = {};
    
    // 如果总权重大于0，按权重比例计算
    Object.keys(participants).forEach(name => {
      const weight = participants[name] || 0;
      const share = amount * weight / totalWeight;
      splitDetail[name] = Number(share.toFixed(1));
    });
    
    // 组合时间（使用iOS兼容格式）
    const dateStr = this.data.date; // 格式：yyyy-MM-dd
    const timeStr = this.data.time; // 格式：HH:mm
    // 转换为 iOS 兼容格式：yyyy-MM-ddTHH:mm:ss
    const time = new Date(`${dateStr}T${timeStr}:00`);
    
    wx.showLoading({
      title: this.data.isEdit ? '更新中...' : '保存中...'
    });
    
    try {
      const dbCloud = wx.cloud.database();
      const userName = db.getCurrentUser();
      
      // 确保只包含当前活动成员，不包含任何旧成员
      // 获取当前活动成员名称列表
      const currentMemberNames = this.data.participants.map(p => p.name);
      
      // 清理participants，只保留当前活动成员
      const cleanParticipants = {};
      currentMemberNames.forEach(name => {
        if (participants.hasOwnProperty(name)) {
          cleanParticipants[name] = participants[name];
        }
      });
      
      // 清理splitDetail，只保留当前活动成员
      const cleanSplitDetail = {};
      currentMemberNames.forEach(name => {
        if (splitDetail.hasOwnProperty(name)) {
          cleanSplitDetail[name] = splitDetail[name];
        }
      });
      
      console.log('清理后的participants:', cleanParticipants);
      console.log('清理后的splitDetail:', cleanSplitDetail);
      console.log('当前活动成员:', currentMemberNames);

      const attachmentItems = await this.uploadNewAttachments();
      const attachments = attachmentItems
        .map(item => item.fileID)
        .filter(id => id);
      
      const billData = {
        activityId: this.data.activityId,
        amount,
        title,
        billType: billType, // 保存账单类型
        payer,
        participants: cleanParticipants, // 使用清理后的participants
        splitDetail: cleanSplitDetail, // 使用清理后的splitDetail
        time: time,
        remark,
        attachments,
      };
      
      if (this.data.isEdit) {
        // 更新账单
        // 更新时，必须明确设置所有字段，确保完全覆盖旧数据
        // 特别是participants和splitDetail，必须根据新的权重重新计算
        console.log('更新账单，billData.participants:', billData.participants);
        console.log('更新账单，billData.splitDetail:', billData.splitDetail);
        console.log('当前活动成员列表:', currentMemberNames);
        
        // 先读取当前账单，获取系统字段（_id, _openid, creator, createdAt等）
        const currentBillDoc = await dbCloud.collection('bills').doc(this.data.billId).get();
        const currentBill = currentBillDoc.data;
        const oldParticipants = currentBill.participants || {};
        const oldParticipantNames = Object.keys(oldParticipants);
        const existingRelatedRechargeId = currentBill.relatedRechargeId || null; // 获取现有的关联充值记录ID
        
        // 找出需要删除的旧成员（不在当前活动成员列表中的）
        const oldMembersToRemove = oldParticipantNames.filter(name => !currentMemberNames.includes(name));
        if (oldMembersToRemove.length > 0) {
          console.log('发现需要删除的旧成员:', oldMembersToRemove);
          console.log('旧participants:', oldParticipants);
        }
        
        // 使用 set 方法完全替换文档，确保清除所有旧成员数据
        // 构建完全干净的数据对象，只包含当前活动成员
        const cleanBillData = {
          activityId: billData.activityId,
          amount: billData.amount,
          title: billData.title,
          billType: billData.billType, // 保存账单类型
          payer: billData.payer,
          participants: billData.participants, // 只包含当前活动成员，完全替换旧对象
          splitDetail: billData.splitDetail,   // 只包含当前活动成员，完全替换旧对象
          time: billData.time,
          remark: billData.remark,
          attachments: billData.attachments || [],
          creator: currentBill.creator || userName, // 保留创建者
          createdAt: currentBill.createdAt || new Date(), // 保留创建时间
          updatedAt: new Date(),
        };
        
        const passwordHash = db.getCurrentUserPasswordHash();
        if (!passwordHash) {
          wx.hideLoading();
          wx.showToast({
            title: '请先登录',
            icon: 'none'
          });
          return;
        }

        const updateRes = await wx.cloud.callFunction({
          name: 'billOps',
          data: {
            action: 'updateBill',
            billId: this.data.billId,
            userName,
            passwordHash,
            billData: {
              activityId: cleanBillData.activityId,
              amount: cleanBillData.amount,
              title: cleanBillData.title,
              billType: cleanBillData.billType,
              payer: payer,
              participants: cleanBillData.participants,
              splitDetail: cleanBillData.splitDetail,
              time: cleanBillData.time,
              remark: cleanBillData.remark,
              attachments: cleanBillData.attachments
            },
            flags: {
              needCreateRecharge,
              originalPayer,
              billshow,
              existingRelatedRechargeId,
              isPrepaid: this.data.isPrepaid,
              keeper: this.data.keeper
            },
            dateStr: this.data.date
          }
        });

        const updateResult = (updateRes && updateRes.result) ? updateRes.result : {};
        if (!updateResult.success) {
          wx.hideLoading();
          console.error('更新账单失败:', updateResult);
          let errorMsg = '更新失败';
          const errMsg = updateResult.errMsg || updateResult.error || '';
          if (updateResult.errCode === -601034 || (errMsg && (errMsg.includes('权限') || errMsg.toLowerCase().includes('permission')))) {
            errorMsg = '更新失败：数据库权限不足，请检查bills集合的删除/更新权限设置';
          } else if (errMsg) {
            errorMsg = `更新失败：${errMsg}`;
          }
          wx.showToast({
            title: errorMsg,
            icon: 'none',
            duration: 3000
          });
          return;
        }

        // 预存模式下，若产生了充值记录变更，弹窗提示
        if (updateResult.rechargeMessage) {
          wx.hideLoading();
          wx.showModal({
            title: '提示',
            content: updateResult.rechargeMessage,
            showCancel: false,
            confirmText: '确定',
            success: () => {
              wx.showToast({
                title: '更新成功',
                icon: 'success'
              });
              setTimeout(() => {
                wx.navigateBack();
              }, 1500);
            }
          });
          return;
        }

        wx.hideLoading();
        wx.showToast({
          title: '更新成功',
          icon: 'success'
        });
        
        // 验证更新后的数据
        const updatedBill = await dbCloud.collection('bills').doc(this.data.billId).get();
        const updatedParticipants = updatedBill.data.participants || {};
        const updatedSplitDetail = updatedBill.data.splitDetail || {};
        console.log('更新后的账单数据:', updatedBill.data);
        console.log('更新后的participants:', updatedParticipants);
        console.log('更新后的splitDetail:', updatedSplitDetail);
        console.log('更新后的participants keys:', Object.keys(updatedParticipants));
        console.log('更新后的splitDetail keys:', Object.keys(updatedSplitDetail));
        
        // 验证是否还有旧成员
        const remainingOldMembers = Object.keys(updatedParticipants).filter(name => !currentMemberNames.includes(name));
        if (remainingOldMembers.length > 0) {
          console.error('错误：更新后仍有旧成员:', remainingOldMembers);
        } else {
          console.log('✓ 更新成功，已清除所有旧成员');
        }
        
        // 验证splitDetail是否包含所有成员
        const missingInSplitDetail = currentMemberNames.filter(name => !updatedSplitDetail.hasOwnProperty(name));
        if (missingInSplitDetail.length > 0) {
          console.error('错误：splitDetail中缺少成员:', missingInSplitDetail);
        } else {
          console.log('✓ splitDetail包含所有成员');
        }
      } else {
        // 创建账单
        const billResult = await dbCloud.collection('bills').add({
          data: {
            ...billData,
            payer: payer, // 使用修改后的付款人（如果是预存模式且付款人不是保管人，已修改为保管人）
            creator: userName,
            createdAt: new Date(),
            isPayerAutoModified: needCreateRecharge || false, // 标记付款人是否被自动修改
            originalPayer: needCreateRecharge ? originalPayer : null, // 保存原始付款人（如果被自动修改）
            billshow: billshow || null, // 用于显示的付款人（预存模式下，如果付款人被修改为保管人，保存原始付款人）
          }
        });
        
        // 如果是预存模式且付款人不是保管人，创建充值记录
        let relatedRechargeId = null;
        if (needCreateRecharge && originalPayer && this.data.keeper) {
          const dateStr = this.data.date; // 格式：yyyy-MM-dd
          const date = new Date(`${dateStr}T00:00:00`);
          
          const rechargeResult = await dbCloud.collection('recharges').add({
            data: {
              activityId: this.data.activityId,
              amount: amount,
              payer: originalPayer, // 原付款人（充值人）
              keeper: this.data.keeper, // 保管人员（收款人）
              recorder: userName, // 记录人（当前用户）
              date: date,
              creator: userName,
              createdAt: new Date(),
              isAuto: true // 标记为自动生成的充值记录
            }
          });
          
          relatedRechargeId = rechargeResult._id;
          
          // 更新账单，保存关联的充值记录ID
          await dbCloud.collection('bills').doc(billResult._id).update({
            data: {
              relatedRechargeId: relatedRechargeId
            }
          });
          
          // 弹出提示对话框
          wx.hideLoading();
          wx.showModal({
            title: '提示',
            content: `预存模式下，付款人和保管人员不同，已经自动创建充值记录：${originalPayer} 向 ${this.data.keeper} 充值 ¥${amount}`,
            showCancel: false,
            confirmText: '确定',
            success: () => {
              wx.showToast({
                title: '保存成功',
                icon: 'success'
              });
              // 等待提示显示后返回
              setTimeout(() => {
                wx.navigateBack();
              }, 1500);
            }
          });
          // 注意：返回操作在对话框的 success 回调中执行，这里不继续执行后续代码
          return;
        } else {
          wx.hideLoading();
          wx.showToast({
            title: '保存成功',
            icon: 'success'
          });
        }
      }
      
      // 返回上一页（只有在没有显示对话框的情况下才执行）
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (e) {
      wx.hideLoading();
      console.error('保存账单失败:', e);
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },
});
