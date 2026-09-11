// pages/activity/detail.js
const db = require('../../utils/db.js');
const settlement = require('../../utils/settlement.js');
const XLSX = require('../../miniprogram_npm/xlsx-js-style/index.js');
const app = getApp();

Page({
  data: {
    activityId: '',
    activity: null,
    activityMeta: '',
    currentTab: 'bills',
    bills: [],
    members: [],
    total: 0,
    avg: 0,
    dateRange: '',
    suggestionMember: null,
    isCreator: false, // 是否是活动创建者
    isPrepaid: false, // 是否预存
    keeper: '', // 保管人员
    recharges: [], // 充值列表
    totalRecharge: 0, // 充值总金额
    totalConsume: 0, // 消费总金额
    remaining: 0, // 剩余金额
    rawBills: [], // 原始账单数据，含分摊详情
    rawRecharges: [], // 原始充值数据
    showMemberBills: false,
    selectedMemberBills: [], // 用户应付账单列表（消费）
    selectedMemberPaidBills: [], // 用户实付账单列表（支出）
    selectedMemberName: '',
    selectedMemberIncome: '0.00', // 消费总额
    selectedMemberExpense: '0.00', // 支出总额
    selectedMemberBalance: '0.00', // 余额
    pdfCanvasWidth: 750,
    pdfCanvasHeight: 1200,
    pdfReminderShown: false,
    showPdfReminderModal: false,
    pdfReminderDiffDays: 0,
    showPdfGuideModal: false,
    pdfGuideText: ''
    ,isParent: false
    ,childActivities: []
    ,childCount: 0
    ,pdfChildDetails: []
    ,familyExpense: '0.00'
    ,hasCustomFamilyExpense: false
  },
  
  onShareAppMessage() {
    return {
      title: this.data.activity ? `${this.data.activity.name} - 账单活动` : '账单活动',
      path: `/pages/activity/detail?id=${this.data.activityId || ''}`,
      imageUrl: '' // 可选：分享图片
    };
  },
  
  onShareTimeline() {
    return {
      title: this.data.activity ? `${this.data.activity.name} - 账单活动` : '账单活动',
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
    
    if (options.id) {
      this.setData({ activityId: options.id });
      this.loadActivityData();
    }
  },
  
  onShow() {
    // 每次显示页面时刷新数据
    if (this._pendingTempCleanup) {
      this._pendingTempCleanup = false;
      this._cleanupOpenedPdfTemp();
    }
    if (this.data.activityId) {
      this.loadActivityData();
    }
  },
  
  async loadActivityData() {
    wx.showLoading({ title: '加载中...' });
    
    try {
      const activityId = this.data.activityId;
      const userName = db.getCurrentUser();
      const passwordHash = db.getCurrentUserPasswordHash();
      if (!userName || !passwordHash) {
        throw new Error('请先登录');
      }

      const detailRes = await wx.cloud.callFunction({
        name: 'activityOps',
        data: {
          action: 'getActivityDetail',
          activityId,
          userName,
          passwordHash
        }
      });
      const detail = (detailRes && detailRes.result) || {};
      if (!detail.success) {
        throw new Error(detail.error || '加载活动数据失败');
      }

      const activity = detail.activity;
      if (activity.isParent) {
        await this.loadParentActivityData(activityId, userName, passwordHash);
        return;
      }
      const bills = detail.bills || [];
      const recharges = activity.isPrepaid ? (detail.recharges || []) : [];
      const activityMeta = (activity.type || '') + ' | 成员：' + (activity.members || []).map(m => m.name).join('、');
      const isActivityCreator = activity.creator === userName;
      const rechargeMap = {};
      recharges.forEach(r => {
        if (r._id) {
          rechargeMap[r._id] = r;
        }
      });
      
      const processedBills = bills.map((bill, billIndex) => {
        const circles = this.generateCircles(bill);
        const totalCount = this.calculateTotalCount(bill);
        const date = this.formatBillDate(bill);
        const isBillCreator = bill.creator === userName;
        // 金额格式化为2位小数
        const amount = this.formatAmount(bill.amount || 0);
        
        // 获取原始付款人：优先使用账单中的originalPayer，如果没有则从关联的充值记录中获取
        let originalPayer = bill.originalPayer || '';
        if (!originalPayer && bill.isPayerAutoModified && bill.relatedRechargeId) {
          const relatedRecharge = rechargeMap[bill.relatedRechargeId];
          if (relatedRecharge && relatedRecharge.payer) {
            originalPayer = relatedRecharge.payer;
            console.log(`从充值记录获取原始付款人: 账单 ${bill.title}, 原始付款人: ${originalPayer}`);
          }
        }
        
        console.log(`账单 ${bill.title} - participants:`, bill.participants);
        console.log(`账单 ${bill.title} - totalCount:`, totalCount);
        console.log(`账单 ${bill.title} - isPayerAutoModified:`, bill.isPayerAutoModified);
        console.log(`账单 ${bill.title} - originalPayer:`, originalPayer);
        
        return {
          ...bill,
          circles,
          totalCount,
          date,
          isCreator: isBillCreator,
          amount, // 格式化的金额字符串
          billIndex, // 添加索引用于 canvas ID
          isPayerAutoModified: bill.isPayerAutoModified || false, // 付款人是否被自动修改
          originalPayer: originalPayer, // 原始付款人（如果被自动修改）
          billshow: bill.billshow || null, // 用于显示的付款人（预存模式下，如果付款人被修改为保管人，保存原始付款人）
          isKeeper: activity.isPrepaid && activity.keeper === bill.payer, // 是否是保管人（用于结算页面显示）
        };
      });
      
      const balances = this.calcBalances(
        activity.members || [],
        bills,
        recharges,
        activity.isPrepaid ? activity.keeper : ''
      );
      
      // 计算总支出和人均
      const total = bills.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
      const familyExpense = this.getFamilyExpense(activity, total);
      
      // 计算总权重：基于所有账单的participants权重之和
      // 如果账单有participants，使用账单的权重；否则使用活动成员的默认权重
      let totalWeight = 0;
      if (bills.length > 0) {
        // 使用最近一次账单的participants权重来计算人均
        // 找到最近一次账单（按时间排序，取第一个）
        const latestBill = bills[0]; // bills已经按时间倒序排序
        if (latestBill.participants) {
          // 计算最近一次账单的participants权重之和
          Object.keys(latestBill.participants).forEach(name => {
            const weight = Number(latestBill.participants[name]) || 0;
            if (weight > 0) {
              totalWeight += weight;
            }
          });
        }
      }
      
      // 如果没有账单或账单没有participants，使用活动成员的默认权重
      if (totalWeight === 0) {
        totalWeight = (activity.members || []).reduce((sum, m) => sum + (Number(m.weight) || 2), 0) || 1;
      }
      
      const avg = total / totalWeight;
      
      // 计算日期范围
      const dateRange = this.calculateDateRange(bills);
      
      // 生成成员列表（带余额），所有金额精确到小数点后2位（格式化为字符串以便显示）
      const members = (activity.members || []).map(m => {
        const bal = balances[m.name] || { paid: 0, shouldPay: 0, balance: 0 };
        const isKeeper = activity.isPrepaid && activity.keeper === m.name;
        return {
          name: m.name,
          bal: {
            paid: this.formatAmount(bal.paid),
            shouldPay: this.formatAmount(bal.shouldPay),
            balance: this.formatAmount(bal.balance)
          },
          // 保存原始余额值用于排序
          _balanceValue: bal.balance,
          // 在预存模式下，标记是否是保管人（用于结算页面显示）
          isKeeper: isKeeper
        };
      });
      
      // 对成员列表进行排序：
      // 1. 先排负值，按照绝对值最大降序（余额最小的在最前面）
      // 2. 然后排正值，按照绝对值最大降序（余额最大的在前面）
      // 3. 最后排0值
      members.sort((a, b) => {
        const balanceA = a._balanceValue || 0;
        const balanceB = b._balanceValue || 0;
        
        // 负值
        if (balanceA < 0 && balanceB < 0) {
          // 按绝对值降序（余额最小的在最前面，如 -100, -50, -10）
          return Math.abs(balanceB) - Math.abs(balanceA);
        }
        if (balanceA < 0) return -1; // 负值在前
        if (balanceB < 0) return 1;
        
        // 正值
        if (balanceA > 0 && balanceB > 0) {
          // 按绝对值降序（余额最大的在前面）
          return Math.abs(balanceB) - Math.abs(balanceA);
        }
        if (balanceA > 0) return -1; // 正值在负值之后，但在0值之前
        if (balanceB > 0) return 1;
        
        // 0值
        return 0;
      });
      
      // 移除临时排序字段
      members.forEach(m => {
        delete m._balanceValue;
      });
      
      // 建议下一次买单人员（余额最小的成员）
      const suggestionMember = this.getSuggestionMember(balances);
      
      let totalRecharge = recharges.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      let totalConsume = total;
      let remaining = activity.isPrepaid ? totalRecharge - totalConsume : 0;
      
      this.setData({
        activity,
        activityMeta,
        bills: processedBills,
        rawBills: bills, // 保存原始账单数据
        rawRecharges: recharges, // 保存原始充值数据
        members,
        total: this.formatAmount(total),
        familyExpense: this.formatAmount(familyExpense),
        hasCustomFamilyExpense: this.hasCustomFamilyExpense(activity),
        avg: this.formatAmount(avg),
        dateRange,
        suggestionMember,
        isCreator: isActivityCreator, // 保存是否是活动创建者
        isPrepaid: activity.isPrepaid || false,
        keeper: activity.keeper || '', // 保管人员
        recharges: recharges.map(r => ({
          ...r,
          date: this.formatRechargeDate(r),
          amount: this.formatAmount(r.amount || 0),
          recorder: r.recorder || r.creator, // 记录人，如果没有recorder字段则使用creator
          isCreator: r.creator === db.getCurrentUser(),
          isRecorder: (r.recorder || r.creator) === db.getCurrentUser(), // 是否是记录人
          isAuto: r.isAuto || false, // 是否是自动生成的充值记录
        })),
        totalRecharge: this.formatAmount(totalRecharge),
        totalConsume: this.formatAmount(totalConsume),
        remaining: this.formatAmount(remaining),
      });

      // 如果当前在成员账单弹窗中，刷新明细
      if (this.data.showMemberBills && this.data.selectedMemberName) {
        this.showMemberBillsForName(this.data.selectedMemberName);
      }

      // 检查是否需要提示下载PDF
      this.checkPdfDownloadReminder(activity);
      
      // 保存到全局数据
      app.globalData.currentActivity = activity;
      app.globalData.currentActivityBills = bills;
      app.globalData.currentActivityBalances = balances;
      
      // 等待 DOM 更新后绘制 canvas（在 setData 之后）
      // 使用较短的延迟，drawPieCharts 内部会智能重试
      setTimeout(() => {
        this.drawPieCharts(processedBills);
      }, 200); // 减少延迟到 200ms，内部会智能重试
      
    } catch (e) {
      console.error('加载活动数据失败:', e);
      const message = (e && e.message) || '';
      if (message.includes('仅一级活动创建者可查看一级活动')) {
        wx.showToast({
          title: '仅可查看参与的二级活动',
          icon: 'none'
        });
        setTimeout(() => {
          if (getCurrentPages().length > 1) {
            wx.navigateBack();
          } else {
            wx.reLaunch({ url: '/pages/home/home' });
          }
        }, 1200);
      } else {
        wx.showToast({
          title: '加载失败',
          icon: 'none'
        });
      }
    }
    
    wx.hideLoading();
  },

  async loadParentActivityData(activityId, userName, passwordHash) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'activityOps',
        data: { action: 'getParentActivityDetail', activityId, userName, passwordHash }
      });
      const detail = (res && res.result) || {};
      if (!detail.success) throw new Error(detail.error || '加载一级活动失败');

      const activity = detail.activity;
      const children = detail.children || [];
      const balancesByMember = {};
      const allBills = [];
      const childActivities = children.map(({ activity: child, bills = [], recharges = [] }) => {
        const childBalances = this.calcBalances(child.members || [], bills, recharges, child.isPrepaid ? child.keeper : '');
        Object.keys(childBalances).forEach(name => {
          const source = childBalances[name];
          const target = balancesByMember[name] || { paid: 0, shouldPay: 0, balance: 0 };
          target.paid += Number(source.paid) || 0;
          target.shouldPay += Number(source.shouldPay) || 0;
          target.balance += Number(source.balance) || 0;
          balancesByMember[name] = target;
        });
        (child.members || []).forEach(member => {
          const name = typeof member === 'string' ? member : member.name;
          if (name && !balancesByMember[name]) balancesByMember[name] = { paid: 0, shouldPay: 0, balance: 0 };
        });
        allBills.push(...bills.map(bill => ({ ...bill, childActivityName: child.name })));
        const billTotal = bills.reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);
        const total = this.getFamilyExpense(child, billTotal);
        const memberNames = (child.members || [])
          .map(member => typeof member === 'string' ? member : member.name)
          .filter(Boolean);
        return {
          _id: child._id,
          name: child.name,
          type: child.type || '',
          memberNames: memberNames.join('、') || '暂无成员',
          dateRange: this.calculateDateRange(bills),
          total: this.formatAmount(total),
          billTotal: this.formatAmount(billTotal),
          hasCustomFamilyExpense: this.hasCustomFamilyExpense(child)
        };
      });
      const total = children.reduce((sum, item) => {
        const billTotal = (item.bills || []).reduce((childSum, bill) => childSum + (Number(bill.amount) || 0), 0);
        return sum + this.getFamilyExpense(item.activity || {}, billTotal);
      }, 0);
      const members = Object.keys(balancesByMember).map(name => {
        const bal = balancesByMember[name];
        return {
          name,
          bal: { paid: this.formatAmount(bal.paid), shouldPay: this.formatAmount(bal.shouldPay), balance: this.formatAmount(bal.balance) },
          _balanceValue: bal.balance
        };
      }).sort((a, b) => a._balanceValue - b._balanceValue);
      members.forEach(member => delete member._balanceValue);
      const memberNames = members.map(member => member.name);
      const displayActivity = { ...activity, members: memberNames.map(name => ({ name })) };
      this.setData({
        activity: displayActivity,
        activityMeta: `一级活动 | 参与成员：${memberNames.join('、') || '暂无成员'}`,
        currentTab: 'summary',
        isParent: true,
        isCreator: activity.creator === userName,
        isPrepaid: false,
        bills: [],
        rawBills: allBills,
        rawRecharges: [],
        recharges: [],
        members,
        total: this.formatAmount(total),
        familyExpense: this.formatAmount(total),
        hasCustomFamilyExpense: false,
        avg: '0.00',
        dateRange: '',
        childActivities,
        childCount: childActivities.length,
        // 保留导出所需的完整子活动数据，生成一级活动导出文件时逐个复用子活动内容。
        pdfChildDetails: children,
        totalRecharge: '0.00',
        totalConsume: this.formatAmount(total),
        remaining: '0.00'
      });
    } catch (e) {
      console.error('加载一级活动失败:', e);
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  hasCustomFamilyExpense(activity) {
    const value = activity && activity.familyExpense;
    return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
  },

  getFamilyExpense(activity, billTotal) {
    return this.hasCustomFamilyExpense(activity) ? Number(activity.familyExpense) : (Number(billTotal) || 0);
  },
  
  // 生成圆圈数据
  generateCircles(bill) {
    const circles = [];
    
    // 获取付款人和记录人
    // 预存模式下，如果有 billshow 字段，使用它来显示付款人（用于保持账务平衡显示）
    // 但实际保存的 payer 是保管人
    const payer = (bill.billshow || bill.payer) || '';
    const recorder = bill.recorder || bill.creator || '';
    
    // 获取所有权重大于0的参与人员
    const participantsWithWeight = bill.participants ? Object.keys(bill.participants).filter(name => {
      const weight = bill.participants[name] || 0;
      return weight > 0;
    }) : [];
    
    // 定义颜色数组（用于第三个圆的扇形）
    const colors = [
      '#FF6B6B', // 红色
      '#4ECDC4', // 青色
      '#45B7D1', // 蓝色
      '#FFA07A', // 浅橙色
      '#98D8C8', // 薄荷绿
      '#F7DC6F', // 黄色
      '#BB8FCE', // 紫色
      '#85C1E2', // 浅蓝色
      '#F8B88B', // 浅粉色
      '#82E0AA', // 浅绿色
    ];
    
    // 第一个圆：付款人（蓝色）
    if (payer) {
      const payerSurname = payer.slice(-1);
      circles.push({
        type: 'solid',
        surname: payerSurname,
        color: '#007bff', // 蓝色
        marginLeft: '0',
      });
    } else {
      // 如果没有付款人，用虚线圆
      circles.push({
        type: 'dashed',
        marginLeft: '0',
      });
    }
    
    // 第二个圆：记录人（绿色）
    if (recorder) {
      const recorderSurname = recorder.slice(-1);
      circles.push({
        type: 'solid',
        surname: recorderSurname,
        color: '#28a745', // 绿色
        marginLeft: '-7px',
      });
    } else {
      // 如果没有记录人，用虚线圆
      circles.push({
        type: 'dashed',
        marginLeft: '-7px',
      });
    }
    
    // 第三个圆：彩色扇形图（根据参与人权重分配）
    if (participantsWithWeight.length > 0) {
      // 计算总权重
      const totalWeight = participantsWithWeight.reduce((sum, name) => {
        return sum + (bill.participants[name] || 0);
      }, 0);
      
      if (totalWeight > 0) {
        // 生成扇形数据
        const sectors = [];
        let currentAngle = 0; // 当前角度（从0度开始）
        
        let currentAngleRad = 0; // 当前弧度（从0开始）
        
        participantsWithWeight.forEach((name, index) => {
          const weight = bill.participants[name] || 0;
          const proportion = weight / totalWeight; // 占比
          const angleRad = proportion * 2 * Math.PI; // 弧度角
          
          sectors.push({
            name: name,
            surname: name.slice(-1),
            weight: weight,
            proportion: proportion, // 占比
            startAngleRad: currentAngleRad, // 起始弧度
            endAngleRad: currentAngleRad + angleRad, // 结束弧度
            angleRad: angleRad, // 弧度大小
            color: colors[index % colors.length], // 分配颜色
          });
          
          currentAngleRad += angleRad; // 更新当前弧度
        });
        
        // 确保最后一个扇形的结束角度正好是 2π，避免间隙
        if (sectors.length > 0) {
          const lastSector = sectors[sectors.length - 1];
          // 重新计算总弧度，确保精确到 2π
          const calculatedTotal = sectors.slice(0, -1).reduce((sum, s) => sum + s.angleRad, 0);
          lastSector.angleRad = 2 * Math.PI - calculatedTotal; // 最后一个扇形填充剩余弧度
          lastSector.endAngleRad = 2 * Math.PI;
        }
        
        circles.push({
          type: 'pie', // 扇形图类型
          sectors: sectors, // 扇形数据
          marginLeft: '-7px',
        });
      } else {
        // 如果总权重为0，用虚线圆
        circles.push({
          type: 'dashed',
          marginLeft: '-7px',
        });
      }
    } else {
      // 如果没有参与人员，用虚线圆
      circles.push({
        type: 'dashed',
        marginLeft: '-7px',
      });
    }
    
    return circles;
  },
  
  // 计算总权重
  calculateTotalCount(bill) {
    if (!bill.participants) return 0;
    let total = 0;
    Object.keys(bill.participants).forEach(name => {
      const weight = bill.participants[name] || 0;
      if (weight > 0) {
        total += weight;
      }
    });
    return total;
  },
  
  // 格式化金额（>=1000保留到个位数，<1000保留一位小数）
  formatAmount(amount) {
    const num = Number(amount || 0);
    if (num >= 1000) {
      return num.toFixed(0);
    } else {
      return num.toFixed(1);
    }
  },
  
  // 格式化账单日期
  formatBillDate(bill) {
    const date = bill.time ? (bill.time.getTime ? bill.time : new Date(bill.time)) :
                 (bill.createdAt ? (bill.createdAt.getTime ? bill.createdAt : new Date(bill.createdAt)) : new Date());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  },
  
  // 格式化充值日期
  formatRechargeDate(recharge) {
    const date = recharge.date ? (recharge.date.getTime ? recharge.date : new Date(recharge.date)) :
                 (recharge.createdAt ? (recharge.createdAt.getTime ? recharge.createdAt : new Date(recharge.createdAt)) : new Date());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  },
  
  // 计算余额
  calcBalances(members, bills, recharges = [], keeper = '') {
    return settlement.calcBalances(members, bills, recharges, keeper);
  },
  
  // 点击成员，展示该成员应付和实付账单列表
  onMemberTap(e) {
    const memberName = e.currentTarget.dataset.name;
    if (!memberName) return;
    this.showMemberBillsForName(memberName);
  },

  showMemberBillsForName(memberName) {
    const rawBills = this.data.rawBills || [];
    const isPrepaid = this.data.isPrepaid || false;
    const keeper = this.data.keeper || '';
    const rawRecharges = this.data.rawRecharges || [];
    
    // 用户应付的账单列表（该用户参与的账单）
    // 预存模式下，如果是保管人，收入账单列表应该是充值记录
    let memberBills = [];
    if (isPrepaid && memberName === keeper) {
      // 预存模式下，保管人的收入 = 充值记录
      memberBills = rawRecharges
        .filter(r => r.keeper === keeper)
        .map(r => {
          const totalAmount = this.formatAmount(r.amount || 0);
          return {
            _id: r._id,
            creator: r.creator,
            title: '充值',
            payer: r.payer || '未知', // 预存人（充值的人）
            totalAmount: totalAmount,
            userAmount: totalAmount, // 保管人收到的金额
            displayTitle: `充值 ${totalAmount}￥`,
            date: this.formatRechargeDate(r),
            paid: true, // 充值记录视为已付
            isRecharge: true // 标记为充值记录
          };
        });
    } else {
      // 非预存模式或非保管人，收入 = 参与的账单
      memberBills = rawBills
        .filter(b => b && b.splitDetail && b.participants && b.participants[memberName] !== undefined && b.participants[memberName] > 0 && b.splitDetail[memberName] !== undefined)
        .map(b => {
          // 预存模式下，如果有 billshow 字段，使用它来显示付款人（用于保持账务平衡显示）
          const displayPayer = (b.billshow || b.payer) || '未知';
          const userName = db.getCurrentUser();
          const totalAmount = this.formatAmount(b.amount || 0);
          return {
            _id: b._id,
            creator: b.creator,
            isCreator: b.creator === userName, // 是否是账单创建者
            title: b.title || '未命名',
            payer: displayPayer, // 使用 billshow 或 payer 来显示
            totalAmount: totalAmount,
            userAmount: this.formatAmount(b.splitDetail[memberName] || 0),
            displayTitle: `${b.title || '未命名'} ${totalAmount}￥`,
            date: this.formatBillDate(b),
            paid: displayPayer === memberName, // 付款人为本人视为已付（使用显示付款人）
          };
        });
    }
    
    // 用户实付的账单列表（该用户付款的账单）
    // 预存模式下，需要检查 billshow 字段，如果 billshow 是当前用户，也应该显示
    let memberPaidBills = [];
    
    // 预存模式下，如果是充值人员（非保管人），充值记录应该显示在支出列表中
    if (isPrepaid && memberName !== keeper) {
      // 先添加充值记录到支出列表
      const rechargeBills = rawRecharges
        .filter(r => r.payer === memberName)
        .map(r => {
          const totalAmount = this.formatAmount(r.amount || 0);
          return {
            _id: r._id,
            creator: r.creator,
            title: '充值',
            payee: keeper || '保管人', // 收款人是保管人
            totalAmount: totalAmount,
            displayTitle: `充值 ${totalAmount}￥`,
            date: this.formatRechargeDate(r),
            isRecharge: true // 标记为充值记录
          };
        });
      
      // 再添加账单记录
      // 注意：在预存模式下，如果账单的付款人不是保管人，系统会创建充值记录
      // 此时账单的 billshow 是原付款人，但实际付款人是保管人
      // 为了避免重复显示，如果账单有 relatedRechargeId（说明已创建充值记录），则不显示该账单
      const billBills = rawBills
        .filter(b => {
          // 如果账单的 billshow 是当前用户，或者账单的 payer 是当前用户，都算作实付
          const displayPayer = (b.billshow || b.payer) || '';
          // 在预存模式下，如果账单有 relatedRechargeId，说明已创建充值记录，不应该再显示账单
          if (isPrepaid && b.relatedRechargeId) {
            // 如果账单的 billshow 是当前用户，说明该账单已通过充值记录体现，不显示账单
            return false;
          }
          return displayPayer === memberName;
        })
        .map(b => {
          // 计算收款人（所有参与人，付款人如果参与也要显示）
          const participants = b.participants ? Object.keys(b.participants).filter(name =>
            b.participants[name] > 0
          ) : [];
          const payee = participants.length > 0 ? participants.join('、') : '无';
          const userName = db.getCurrentUser();
          
          const totalAmount = this.formatAmount(b.amount || 0);
          return {
            _id: b._id,
            creator: b.creator,
            isCreator: b.creator === userName, // 是否是账单创建者
            title: b.title || '未命名',
            payee: payee,
            totalAmount: totalAmount,
            displayTitle: `${b.title || '未命名'} ${totalAmount}￥`,
            date: this.formatBillDate(b),
          };
        });
      
      // 合并充值记录和账单记录
      memberPaidBills = [...rechargeBills, ...billBills];
    } else {
      // 非预存模式或保管人，只显示账单
      memberPaidBills = rawBills
        .filter(b => {
          // 如果账单的 billshow 是当前用户，或者账单的 payer 是当前用户，都算作实付
          const displayPayer = (b.billshow || b.payer) || '';
          return displayPayer === memberName;
        })
        .map(b => {
          // 计算收款人（所有参与人，付款人如果参与也要显示）
          const participants = b.participants ? Object.keys(b.participants).filter(name =>
            b.participants[name] > 0
          ) : [];
          const payee = participants.length > 0 ? participants.join('、') : '无';
          const userName = db.getCurrentUser();
          
          const totalAmount = this.formatAmount(b.amount || 0);
          return {
            _id: b._id,
            creator: b.creator,
            isCreator: b.creator === userName, // 是否是账单创建者
            title: b.title || '未命名',
            payee: payee,
            totalAmount: totalAmount,
            displayTitle: `${b.title || '未命名'} ${totalAmount}￥`,
            date: this.formatBillDate(b),
          };
        });
    }

    
    const totals = settlement.computeMemberTotals({
      memberName,
      isPrepaid,
      keeper,
      rawRecharges,
      memberBills,
      memberPaidBills
    });

    const showSelectedMemberConsume = (memberBills || []).length > 0;
    const showSelectedMemberExpense = (memberPaidBills || []).length > 0;

    this.setData({
      selectedMemberBills: memberBills,
      selectedMemberPaidBills: memberPaidBills,
      selectedMemberName: memberName,
      selectedMemberIncome: this.formatAmount(totals.incomeTotal), // 收入总额
      selectedMemberExpense: this.formatAmount(totals.expenseTotal), // 支出总额
      selectedMemberBalance: this.formatAmount(totals.balance), // 余额
      showSelectedMemberConsume,
      showSelectedMemberExpense,
      showMemberBills: true,
    });
  },

  // 关闭成员账单列表
  closeMemberBills() {
    this.setData({
      showMemberBills: false,
      selectedMemberBills: [],
      selectedMemberPaidBills: [],
      selectedMemberName: '',
      selectedMemberIncome: '0.00',
      selectedMemberExpense: '0.00',
      selectedMemberBalance: '0.00',
      showSelectedMemberConsume: false,
      showSelectedMemberExpense: false,
    });
  },

  // 从弹窗跳转到原始账单
  openBillFromModal(e) {
    const billId = e.currentTarget.dataset.id;
    const isRecharge = e.currentTarget.dataset.isRecharge === 'true';
    if (!billId) return;

    if (isRecharge) {
      // 如果是充值记录，跳转到充值详情页
      wx.navigateTo({
        url: `/pages/recharge/add?activityId=${this.data.activityId}&rechargeId=${billId}`
      });
    } else {
      // 如果是账单，跳转到账单详情页
      const bill = (this.data.rawBills || []).find(b => b._id === billId);
      if (!bill) {
        wx.showToast({
          title: '未找到账单',
          icon: 'none'
        });
        return;
      }

      const userName = db.getCurrentUser();
      const isCreator = bill.creator === userName;

      wx.navigateTo({
        url: `/pages/bill/edit?activityId=${bill.activityId || this.data.activityId}&billId=${bill._id}&readOnly=${!isCreator}`
      });
    }
  },

  // 计算日期范围
  calculateDateRange(bills) {
    if (bills.length === 0) return '至今';

    let firstBillDate = null;
    let lastBillDate = null;
    bills.forEach(b => {
      const billDate = b.time ? (b.time.getTime ? b.time : new Date(b.time)) :
                      (b.createdAt ? (b.createdAt.getTime ? b.createdAt : new Date(b.createdAt)) : null);
      if (billDate && !Number.isNaN(billDate.getTime())) {
        if (!firstBillDate || billDate < firstBillDate) {
          firstBillDate = billDate;
        }
        if (!lastBillDate || billDate > lastBillDate) {
          lastBillDate = billDate;
        }
      }
    });

    if (!firstBillDate || !lastBillDate) return '至今';

    const formatDate = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    return `${formatDate(firstBillDate)} 至 ${formatDate(lastBillDate)}`;
  },
  
  // 获取建议买单人员（余额最小的成员）
  getSuggestionMember(balances) {
    let minBalanceMember = null;
    let minBalance = Infinity;
    
    Object.keys(balances).forEach(name => {
      const bal = balances[name];
      if (bal.balance < minBalance) {
        minBalance = bal.balance;
        minBalanceMember = {
          name: name,
          shouldPay: this.formatAmount(bal.shouldPay),
          paid: this.formatAmount(bal.paid),
        };
      }
    });
    
    return minBalanceMember;
  },
  
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
    
    // 如果切换到账单页面，需要重新绘制饼图
    if (tab === 'bills' && this.data.bills && this.data.bills.length > 0) {
      // 延迟绘制，等待DOM更新和 Canvas 2D 初始化
      // 使用较短的延迟，drawPieCharts 内部会智能重试
      setTimeout(() => {
        this.drawPieCharts(this.data.bills);
      }, 200); // 减少延迟到 200ms，内部会智能重试
    }
  },
  
  addBill() {
    if (this.data.isParent) {
      wx.showToast({ title: '一级活动不能直接记账，请新增二级活动', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/bill/edit?activityId=${this.data.activityId}`
    });
  },

  addChildActivity() {
    wx.navigateTo({
      url: `/pages/activity/create?parentId=${this.data.activityId}&parentName=${encodeURIComponent(this.data.activity.name || '')}`
    });
  },

  openChildActivity(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/activity/detail?id=${id}` });
  },
  
  viewBill(e) {
    const bill = e.currentTarget.dataset.bill;
    const userName = db.getCurrentUser();
    const isCreator = bill.creator === userName;
    
    // 创建者可以编辑，其他人只能查看（只读模式）
    wx.navigateTo({
      url: `/pages/bill/edit?activityId=${this.data.activityId}&billId=${bill._id}&readOnly=${!isCreator}`
    });
  },
  
  deleteBill(e) {
    const billId = e.currentTarget.dataset.id;
    const billTitle = e.currentTarget.dataset.title;
    
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
                billId,
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
              this.loadActivityData();
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
  
  // 绘制扇形图
  async drawPieCharts(bills) {
    const pieBills = bills.filter(bill => {
      const pieCircle = bill.circles && bill.circles.find(c => c.type === 'pie');
      return pieCircle && pieCircle.sectors && pieCircle.sectors.length > 0;
    });

    if (pieBills.length === 0) return;

    // 并行处理所有账单的绘制
    const drawPromises = pieBills.map(async (bill) => {
      const pieCircle = bill.circles.find(c => c.type === 'pie');
      if (!pieCircle || !pieCircle.sectors) return;

      // 获取Canvas节点，使用智能重试机制
      let retryCount = 0;
      const maxRetries = 8; // 增加重试次数，但使用更短的间隔
      let canvasNode = null;
      
      while (retryCount < maxRetries && !canvasNode) {
        try {
          const query = wx.createSelectorQuery().in(this);
          canvasNode = await new Promise((resolve, reject) => {
            query.select(`#pieCanvas_${bill._id}`)
              .fields({ node: true, size: true })
              .exec((res) => {
                if (res[0] && res[0].node) {
                  resolve(res[0]);
                } else {
                  reject(new Error('Canvas not found'));
                }
              });
          });
          break; // 成功获取Canvas，退出循环
        } catch (e) {
          retryCount++;
          if (retryCount < maxRetries) {
            // 使用递增的延迟：前几次快速重试，后面逐渐增加
            const delay = retryCount <= 2 ? 50 : (retryCount <= 4 ? 100 : 150);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.warn(`无法获取Canvas: pieCanvas_${bill._id}，跳过绘制`);
            return;
          }
        }
      }
      
      if (!canvasNode) {
        return;
      }

      try {
        const canvas = canvasNode.node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getWindowInfo().pixelRatio;
        const width = canvasNode.width || 54.8;
        const height = canvasNode.height || 54.8;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) / 2;

        // 绘制每个扇形
        pieCircle.sectors.forEach((sector) => {
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          
          // 起始点（从顶部开始，所以减去 π/2）
          const startX = centerX + radius * Math.cos(sector.startAngleRad - Math.PI / 2);
          const startY = centerY + radius * Math.sin(sector.startAngleRad - Math.PI / 2);
          ctx.lineTo(startX, startY);
          
          // 绘制弧线
          ctx.arc(centerX, centerY, radius, sector.startAngleRad - Math.PI / 2, sector.endAngleRad - Math.PI / 2, false);
          
          // 闭合路径
          ctx.closePath();
          
          // 填充颜色
          ctx.fillStyle = sector.color;
          ctx.fill();
          
          // 在扇形中心位置绘制姓氏
          // 如果只有一个扇形（整个圆），文字放在圆心
          let textX, textY;
          let fontSize;
          
          if (pieCircle.sectors.length === 1) {
            // 单个参与人：文字放在圆心
            textX = centerX;
            textY = centerY;
            // 字体大小：20rpx 转换为 px（假设 1rpx = 0.5px，实际需要根据设备调整）
            fontSize = 10; // 约等于 20rpx
          } else {
            // 多个参与人：文字放在扇形中心
            // 计算扇形的中心角度
            const centerAngleRad = (sector.startAngleRad + sector.endAngleRad) / 2 - Math.PI / 2;
            // 计算文字位置（在半径的中间位置）
            const textRadius = radius * 0.5; // 在半径的50%位置
            textX = centerX + textRadius * Math.cos(centerAngleRad);
            textY = centerY + textRadius * Math.sin(centerAngleRad);
            
            // 根据扇形角度调整字体大小（角度越大，字体越大）
            // 最小字体：6px，最大字体：10px（不超过蓝色和绿色圆的20rpx）
            const minFontSize = 6;
            const maxFontSize = 10;
            fontSize = minFontSize + (sector.angleRad / (2 * Math.PI)) * (maxFontSize - minFontSize);
          }
          
          // 绘制文字
          ctx.save();
          ctx.fillStyle = '#fff'; // 白色文字
          ctx.font = `bold ${fontSize}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(sector.surname, textX, textY);
          ctx.restore();
        });
      } catch (e) {
        console.error(`绘制扇形图失败（账单 ${bill._id}）:`, e);
      }
    });

    // 等待所有绘制完成
    await Promise.all(drawPromises);
  },

  // 检查PDF下载提醒
  checkPdfDownloadReminder(activity) {
    if (this.data.pdfReminderShown) return;
    const userName = db.getCurrentUser();
    if (!userName || !activity) return;

    if (this.getPdfReminderNever()) return;
    const nextRemindAt = this.getPdfReminderNextAt();
    if (nextRemindAt && Date.now() < nextRemindAt) return;

    const lastDownloadAt = this.getLastPdfDownloadAt();
    if (!lastDownloadAt) return;

    const latestChangeAt = this.getLatestActivityChangeAt(
      activity,
      this.data.rawBills || [],
      this.data.rawRecharges || []
    );
    if (!latestChangeAt || latestChangeAt <= lastDownloadAt) return;

    const now = Date.now();
    const diffDays = Math.floor((now - lastDownloadAt) / (24 * 60 * 60 * 1000));
    if (diffDays < 30) return;

    this.setData({
      pdfReminderShown: true,
      showPdfReminderModal: true,
      pdfReminderDiffDays: diffDays
    });
  },

  getPdfDownloadKey() {
    const userName = db.getCurrentUser() || 'guest';
    return `aa_activity_pdf_last_download_${userName}_${this.data.activityId}`;
  },

  getLastPdfDownloadAt() {
    const key = this.getPdfDownloadKey();
    const stored = wx.getStorageSync(key);
    return stored || 0;
  },

  setLastPdfDownloadAt(timestamp) {
    const key = this.getPdfDownloadKey();
    wx.setStorageSync(key, timestamp);
  },

  getPdfReminderNeverKey() {
    const userName = db.getCurrentUser() || 'guest';
    return `aa_activity_pdf_never_remind_${userName}_${this.data.activityId}`;
  },

  getPdfReminderNextAtKey() {
    const userName = db.getCurrentUser() || 'guest';
    return `aa_activity_pdf_next_remind_${userName}_${this.data.activityId}`;
  },

  getPdfReminderNever() {
    const key = this.getPdfReminderNeverKey();
    return Boolean(wx.getStorageSync(key));
  },

  setPdfReminderNever(value) {
    const key = this.getPdfReminderNeverKey();
    wx.setStorageSync(key, value ? 1 : 0);
  },

  getPdfReminderNextAt() {
    const key = this.getPdfReminderNextAtKey();
    return Number(wx.getStorageSync(key) || 0);
  },

  setPdfReminderNextAt(timestamp) {
    const key = this.getPdfReminderNextAtKey();
    wx.setStorageSync(key, timestamp || 0);
  },

  getLatestActivityChangeAt(activity, bills, recharges) {
    let latest = 0;
    const activityDate = activity && (activity.updatedAt || activity.createdAt);
    if (activityDate) {
      const time = activityDate.getTime ? activityDate.getTime() : new Date(activityDate).getTime();
      if (!Number.isNaN(time)) latest = Math.max(latest, time);
    }

    (bills || []).forEach((bill) => {
      const dateVal = bill.updatedAt || bill.createdAt || bill.time;
      if (!dateVal) return;
      const time = dateVal.getTime ? dateVal.getTime() : new Date(dateVal).getTime();
      if (!Number.isNaN(time)) latest = Math.max(latest, time);
    });

    (recharges || []).forEach((recharge) => {
      const dateVal = recharge.updatedAt || recharge.createdAt || recharge.time;
      if (!dateVal) return;
      const time = dateVal.getTime ? dateVal.getTime() : new Date(dateVal).getTime();
      if (!Number.isNaN(time)) latest = Math.max(latest, time);
    });

    return latest;
  },

  onPdfReminderNever() {
    this.setPdfReminderNever(true);
    this.setPdfReminderNextAt(0);
    this.setData({ showPdfReminderModal: false });
  },

  onPdfReminderLater() {
    const nextAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    this.setPdfReminderNextAt(nextAt);
    this.setData({ showPdfReminderModal: false });
  },

  onPdfReminderDownload() {
    this.setPdfReminderNextAt(0);
    this.setData({ showPdfReminderModal: false });
    this.downloadActivityXlsx();
  },

  formatYymmdd(dateObj) {
    const date = dateObj || new Date();
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  },

  formatHhmmss(dateObj) {
    const date = dateObj || new Date();
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${hour}${minute}${second}`;
  },

  normalizeAsciiDigits(text) {
    return String(text || '').replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  },

  sanitizeFileName(name) {
    const base = String(name || '')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '') // strip emoji surrogate pairs
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[^\w\u4E00-\u9FFF·\-\.\s]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    const trimmed = base.length > 60 ? base.slice(0, 60).trim() : base;
    if (!trimmed) return '活动信息.pdf';
    return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
  },

  sanitizeCsvFileName(name) {
    const base = String(name || '')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[^\w\u4E00-\u9FFF·\-\.\s]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    const trimmed = base.length > 60 ? base.slice(0, 60).trim() : base;
    if (!trimmed) return '活动信息.csv';
    return trimmed.toLowerCase().endsWith('.csv') ? trimmed : `${trimmed}.csv`;
  },

  sanitizeXlsxFileName(name) {
    const base = String(name || '')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[^\w\u4E00-\u9FFF·\-\.\s]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    const trimmed = base.length > 60 ? base.slice(0, 60).trim() : base;
    if (!trimmed) return '活动信息.xlsx';
    return trimmed.toLowerCase().endsWith('.xlsx') ? trimmed : `${trimmed}.xlsx`;
  },

  escapeCsvCell(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  },

  formatCsvAmount(amount) {
    const value = Number(amount);
    return Number.isFinite(value) ? value.toFixed(2) : '';
  },

  getCsvMemberNames(activity) {
    return (activity && activity.members || [])
      .map(member => typeof member === 'string' ? member : member && member.name)
      .filter(Boolean)
      .join('、');
  },

  getCsvDateRange(activity, bills) {
    return (activity && activity.dateRange) || this.calculateDateRange(bills || []) || '';
  },

  getCsvKeyValue(value) {
    if (!value || typeof value !== 'object') return '';
    return Object.keys(value)
      .filter(key => value[key] !== undefined && value[key] !== null && value[key] !== '')
      .map(key => `${key}:${value[key]}`)
      .join('; ');
  },

  getCsvAttachments(attachments) {
    return (Array.isArray(attachments) ? attachments : [])
      .map(item => typeof item === 'string' ? item : item && item.fileID)
      .filter(Boolean)
      .join('; ');
  },

  getCsvParticipants(activity, bill) {
    const memberNames = new Set((activity.members || [])
      .map(member => typeof member === 'string' ? member : member && member.name)
      .filter(Boolean));
    return Object.keys(bill.participants || {})
      .filter(name => Number(bill.participants[name]) > 0 && memberNames.has(name))
      .join('、');
  },

  getCsvAverage(activity, bills) {
    const total = (bills || []).reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);
    const latestBill = (bills || [])[0] || {};
    let totalWeight = Object.keys(latestBill.participants || {})
      .reduce((sum, name) => sum + Math.max(0, Number(latestBill.participants[name]) || 0), 0);
    if (!totalWeight) {
      totalWeight = (activity.members || []).reduce((sum, member) => {
        return sum + (Number(typeof member === 'string' ? 2 : member.weight) || 2);
      }, 0) || 1;
    }
    return total / totalWeight;
  },

  buildCsvActivitySection(activity, bills, recharges) {
    const sourceBills = bills || [];
    const sourceRecharges = recharges || [];
    const billTotal = sourceBills.reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);
    const dateRange = this.getCsvDateRange(activity, sourceBills) || '至今';
    const familyExpense = this.getFamilyExpense(activity, billTotal);
    const balances = this.calcBalances(activity.members || [], sourceBills, sourceRecharges, activity.isPrepaid ? activity.keeper : '');
    const rows = [
      ['活动信息'],
      ['项目', '内容'],
      ['活动名称', activity.name || '未命名活动'],
      ['活动类型', activity.type || '未设置'],
      ['创建者', activity.creator || '未设置'],
      ['成员', this.getCsvMemberNames(activity) || '无'],
      ['活动属性', activity.isPrepaid ? `预存活动（保管人：${activity.keeper || '未设置'}）` : '非预存活动'],
      ['家庭支出', `¥${this.formatAmount(familyExpense)}`],
      ['账单范围', `${dateRange}，账单数量：${sourceBills.length} 条`],
      ['导出时间', this.formatExportTime(new Date())]
    ];

    rows.push([], ['结算信息'], ['成员', '实付', '应付', '余额']);
    const memberNames = (activity.members || [])
      .map(member => typeof member === 'string' ? member : member && member.name)
      .filter(Boolean);
    if (memberNames.length === 0) {
      rows.push(['暂无成员']);
    } else {
      memberNames.forEach((name) => {
        const balance = balances[name] || { paid: 0, shouldPay: 0, balance: 0 };
        rows.push([name, `¥${this.formatAmount(balance.paid)}`, `¥${this.formatAmount(balance.shouldPay)}`, `¥${this.formatAmount(balance.balance)}`]);
      });
      rows.push(['总支出 / 人均', `¥${this.formatAmount(billTotal)} / ¥${this.formatAmount(this.getCsvAverage(activity, sourceBills))}`]);
    }

    rows.push([], ['账单信息'], ['日期', '名称', '付款人', '参与人', '金额']);
    if (sourceBills.length === 0) {
      rows.push(['暂无账单记录']);
    } else {
      sourceBills.forEach((bill) => {
        rows.push([
          this.formatBillDate(bill),
          bill.title || '未命名',
          (bill.billshow || bill.payer) || '',
          this.getCsvParticipants(activity, bill),
          `¥${this.formatAmount(bill.amount || 0)}`
        ]);
      });
    }

    if (sourceRecharges.length > 0) {
      rows.push([], ['预存记录'], ['日期', '充值人', '金额', '记录人', '备注']);
      sourceRecharges.forEach((recharge) => {
        rows.push([
          this.formatRechargeDate(recharge), recharge.payer || '', `¥${this.formatAmount(recharge.amount || 0)}`,
          recharge.recorder || recharge.creator || '', recharge.remark || recharge.note || ''
        ]);
      });
    }

    return rows;
  },

  buildActivityCsvRows() {
    return this.buildCsvActivitySection(this.data.activity || {}, this.data.rawBills || [], this.data.rawRecharges || []);
  },

  buildParentCsvRows() {
    const parent = this.data.activity || {};
    const children = this.data.pdfChildDetails || [];
    const allBills = children.reduce((all, item) => all.concat(item.bills || []), []);
    const total = children.reduce((sum, item) => {
      const bills = item.bills || [];
      const billTotal = bills.reduce((childSum, bill) => childSum + (Number(bill.amount) || 0), 0);
      return sum + this.getFamilyExpense(item.activity || {}, billTotal);
    }, 0);
    const rows = [
      ['一级活动信息'],
      ['项目', '内容'],
      ['一级活动名称', parent.name || '未命名一级活动'],
      ['创建者', parent.creator || '未设置'],
      ['活动属性', '一级活动'],
      ['总支出', `¥${this.formatAmount(total)}`],
      ['起止日期', this.getCsvDateRange(parent, allBills) || '至今'],
      ['包含二级活动', `${children.length} 个`],
      ['导出时间', this.formatExportTime(new Date())],
      [],
      ['二级活动清单'],
      ['序号', '二级活动名称', '创建者', '参与成员', '家庭支出', '起止时间']
    ];
    if (children.length === 0) {
      rows.push(['暂无二级活动']);
    } else {
      children.forEach((item, index) => {
        const child = item.activity || {};
        const bills = item.bills || [];
        const billTotal = bills.reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);
        rows.push([
          index + 1, child.name || '未命名活动', child.creator || '未设置', this.getCsvMemberNames(child) || '无',
          `¥${this.formatAmount(this.getFamilyExpense(child, billTotal))}`, this.getCsvDateRange(child, bills) || '至今'
        ]);
      });
    }
    children.forEach((item, index) => {
      const child = item.activity || {};
      rows.push([], [`二级活动 ${index + 1}/${children.length}：${child.name || '未命名活动'}`], []);
      rows.push(...this.buildCsvActivitySection(child, item.bills || [], item.recharges || []));
    });
    return rows;
  },

  async saveCsvFile(content, fileName) {
    const fs = wx.getFileSystemManager();
    const safeName = this.sanitizeCsvFileName(fileName);
    const filePath = `${wx.env.USER_DATA_PATH}/${safeName}`;
    await new Promise((resolve, reject) => {
      fs.writeFile({ filePath, data: `\uFEFF${content}`, encoding: 'utf8', success: resolve, fail: reject });
    });
    return filePath;
  },

  async buildCsvContentWithProgress(rows, updateProgress) {
    const sourceRows = rows || [];
    const total = Math.max(sourceRows.length, 1);
    const chunkSize = Math.max(10, Math.ceil(total / 12));
    const lines = [];
    for (let start = 0; start < sourceRows.length; start += chunkSize) {
      const chunk = sourceRows.slice(start, start + chunkSize);
      lines.push(...chunk.map(row => row.map(value => this.escapeCsvCell(value)).join(',')));
      const completed = Math.min(start + chunk.length, total);
      updateProgress(Math.min(88, 8 + Math.floor(completed / total * 80)));
      // 主动让出一次渲染机会，真机上能看到平滑且与行数对应的实际进度。
      await new Promise(resolve => setTimeout(resolve, 45));
    }
    return lines.join('\r\n');
  },

  isXlsxSectionTitle(row) {
    const value = row && row[0];
    return Array.isArray(row) && row.length === 1 && typeof value === 'string' && (
      value === '活动信息' || value === '结算信息' || value === '账单信息' || value === '预存记录' ||
      value === '一级活动信息' || value === '二级活动清单' || value.indexOf('二级活动 ') === 0
    );
  },

  isXlsxTableHeader(row) {
    return Array.isArray(row) && ['项目', '成员', '日期', '序号'].includes(row[0]);
  },

  estimateXlsxLineCount(value, columnWidth) {
    return String(value === undefined || value === null ? '' : value)
      .split(/\r?\n/)
      .reduce((total, line) => {
        const displayWidth = Array.from(line).reduce((width, char) => width + (char.charCodeAt(0) > 0x7f ? 1 : 0.5), 0);
        return total + Math.max(1, Math.ceil(displayWidth / columnWidth));
      }, 0) || 1;
  },

  async buildXlsxFileData(rows, updateProgress) {
    const sourceRows = rows || [];
    const total = Math.max(sourceRows.length, 1);
    const maxColumns = Math.max(1, ...sourceRows.map(row => Array.isArray(row) ? row.length : 0));
    const chunkSize = Math.max(10, Math.ceil(total / 12));
    const sheet = {};
    const cellBorder = {
      top: { style: 'thin', color: { rgb: 'D9E2F3' } },
      bottom: { style: 'thin', color: { rgb: 'D9E2F3' } },
      left: { style: 'thin', color: { rgb: 'D9E2F3' } },
      right: { style: 'thin', color: { rgb: 'D9E2F3' } }
    };
    const titleStyle = {
      font: { name: 'Microsoft YaHei', sz: 14, bold: true, color: { rgb: '1D4ED8' } },
      fill: { patternType: 'solid', fgColor: { rgb: 'EAF2FF' } },
      alignment: { vertical: 'center', wrapText: true },
      border: cellBorder
    };
    const headerStyle = {
      font: { name: 'Microsoft YaHei', sz: 11, bold: true, color: { rgb: '1D4ED8' } },
      fill: { patternType: 'solid', fgColor: { rgb: 'F3F7FF' } },
      alignment: { vertical: 'center', wrapText: true },
      border: cellBorder
    };
    const bodyStyle = {
      font: { name: 'Microsoft YaHei', sz: 10 },
      alignment: { vertical: 'center', wrapText: true },
      border: cellBorder
    };
    const merges = [];
    const rowSettings = [];

    for (let start = 0; start < sourceRows.length; start += chunkSize) {
      const chunk = sourceRows.slice(start, start + chunkSize);
      chunk.forEach((row, offset) => {
        const rowIndex = start + offset;
        const values = Array.isArray(row) ? row : [row];
        const isTitle = this.isXlsxSectionTitle(values);
        const isHeader = this.isXlsxTableHeader(values);
        const isTwoColumnRow = values.length === 2;
        const lineCount = values.reduce((max, value, columnIndex) => {
          const lineCapacity = isTitle
            ? maxColumns * 6
            : (isTwoColumnRow && columnIndex === 1 ? 4 * 6 : 6);
          return Math.max(max, this.estimateXlsxLineCount(value, lineCapacity));
        }, 1);
        if (isTitle) {
          merges.push({ s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: maxColumns - 1 } });
        }
        if (isTwoColumnRow && maxColumns >= 5) {
          merges.push({ s: { r: rowIndex, c: 1 }, e: { r: rowIndex, c: 4 } });
        }
        if (values.some(value => value !== undefined && value !== null && value !== '')) {
          rowSettings[rowIndex] = { hpt: (isTitle ? 24 : 18) * lineCount };
        }
        values.forEach((value, columnIndex) => {
          if (value === undefined || value === null || value === '') return;
          const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
          sheet[address] = {
            t: typeof value === 'number' ? 'n' : 's',
            v: value,
            s: isTitle ? titleStyle : (isHeader ? headerStyle : bodyStyle)
          };
        });
      });
      const completed = Math.min(start + chunk.length, total);
      updateProgress(Math.min(88, 8 + Math.floor(completed / total * 80)));
      // 让真机渲染每一个批次的实际处理进度。
      await new Promise(resolve => setTimeout(resolve, 45));
    }

    sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, sourceRows.length - 1), c: maxColumns - 1 } });
    sheet['!merges'] = merges;
    sheet['!rows'] = rowSettings;
    sheet['!cols'] = Array.from({ length: maxColumns }, () => ({ wch: 6 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, this.data.isParent ? '一级活动导出' : '活动导出');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
  },

  disableXlsxGridlines(fileData) {
    try {
      const archive = XLSX.CFB.read(new Uint8Array(fileData), { type: 'buffer' });
      const sheetXml = XLSX.CFB.find(archive, '/xl/worksheets/sheet1.xml');
      if (!sheetXml || !sheetXml.content) return fileData;
      const xml = typeof TextDecoder !== 'undefined'
        ? new TextDecoder().decode(sheetXml.content)
        : Array.prototype.map.call(sheetXml.content, byte => String.fromCharCode(byte)).join('');
      const updatedXml = xml.replace(/<sheetView\b([^>]*?)(\/?)>/, (match, attributes, closing) => {
        if (/showGridLines=/.test(attributes)) return match;
        return `<sheetView${attributes} showGridLines="0"${closing}>`;
      });
      if (updatedXml === xml) return fileData;
      const bytes = typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(updatedXml)
        : Uint8Array.from(updatedXml, char => char.charCodeAt(0));
      sheetXml.content = bytes;
      sheetXml.size = bytes.length;
      const output = XLSX.CFB.write(archive, { type: 'array', fileType: 'zip', compression: true });
      if (output instanceof ArrayBuffer) return output;
      return output.buffer.slice(output.byteOffset || 0, (output.byteOffset || 0) + output.byteLength);
    } catch (error) {
      console.warn('隐藏XLSX网格线失败，仍将导出文件:', error);
      return fileData;
    }
  },

  async saveXlsxFile(data, fileName) {
    const fs = wx.getFileSystemManager();
    const safeName = this.sanitizeXlsxFileName(fileName);
    const filePath = `${wx.env.USER_DATA_PATH}/${safeName}`;
    await new Promise((resolve, reject) => {
      fs.writeFile({ filePath, data, success: resolve, fail: reject });
    });
    return filePath;
  },

  async downloadActivityXlsx() {
    if (!this.data.activity) {
      wx.showToast({ title: '活动数据未加载', icon: 'none' });
      return;
    }
    const now = new Date();
    const activityName = this.normalizeAsciiDigits(this.data.activity.name || '活动');
    const fileName = this.sanitizeXlsxFileName(`${activityName}-${this.formatYymmdd(now)}${this.formatHhmmss(now)}.xlsx`);
    const showProgress = (title, progress) => {
      wx.showLoading({ title: `${title} ${progress}%`, mask: true });
    };
    showProgress('正在生成XLSX...', 5);
    try {
      const rows = this.data.isParent ? this.buildParentCsvRows() : this.buildActivityCsvRows();
      let fileData = await this.buildXlsxFileData(rows, progress => showProgress('正在生成XLSX...', progress));
      fileData = this.disableXlsxGridlines(fileData);
      showProgress('正在保存XLSX...', 92);
      const filePath = await this.saveXlsxFile(fileData, fileName);
      this.setLastPdfDownloadAt(Date.now());
      wx.hideLoading();
      wx.openDocument({
        filePath,
        fileType: 'xlsx',
        showMenu: true,
        fail: (error) => {
          console.error('打开XLSX失败:', error);
          wx.showToast({ title: 'XLSX已保存，请在文件管理中打开', icon: 'none', duration: 3000 });
        }
      });
    } catch (error) {
      console.error('导出XLSX失败:', error);
      wx.hideLoading();
      wx.showToast({ title: error.message || '导出XLSX失败', icon: 'none', duration: 3000 });
    }
  },

  async downloadActivityCsv() {
    if (!this.data.activity) {
      wx.showToast({ title: '活动数据未加载', icon: 'none' });
      return;
    }
    const now = new Date();
    const activityName = this.normalizeAsciiDigits(this.data.activity.name || '活动');
    const fileName = this.sanitizeCsvFileName(`${activityName}-${this.formatYymmdd(now)}${this.formatHhmmss(now)}.csv`);
    const showProgress = (title, progress) => {
      wx.showLoading({ title: `${title} ${progress}%`, mask: true });
    };
    showProgress('正在整理CSV...', 5);
    try {
      const rows = this.data.isParent ? this.buildParentCsvRows() : this.buildActivityCsvRows();
      const content = await this.buildCsvContentWithProgress(rows, progress => showProgress('正在整理CSV...', progress));
      showProgress('正在保存CSV...', 92);
      const filePath = await this.saveCsvFile(content, fileName);
      this.setLastPdfDownloadAt(Date.now());
      showProgress('正在打开CSV...', 100);
      wx.hideLoading();
      wx.openDocument({
        filePath,
        fileType: 'csv',
        showMenu: true,
        fail: (error) => {
          console.error('打开CSV失败:', error);
          wx.showToast({ title: 'CSV已保存，请在文件管理中打开', icon: 'none', duration: 3000 });
        }
      });
    } catch (error) {
      console.error('导出CSV失败:', error);
      wx.hideLoading();
      wx.showToast({ title: error.message || '导出CSV失败', icon: 'none', duration: 3000 });
    }
  },

  async downloadActivityPdf() {
    if (!this.data.activity) {
      wx.showToast({ title: '活动数据未加载', icon: 'none' });
      return;
    }

    const now = new Date();
    const activityName = this.normalizeAsciiDigits(this.data.activity.name || '活动');
    const defaultName = `${activityName}-${this.formatYymmdd(now)}${this.formatHhmmss(now)}.pdf`;
    const fileName = this.sanitizeFileName(this.normalizeAsciiDigits(defaultName));
    const baseName = fileName.replace(/\.pdf$/i, '');

    let progress = 1;
    let target = 1;
    let progressDone = 0;
    let progressTotal = 1;
    let driftTimer = null;
    let progressTimer = null;
    const startProgress = () => {
      if (progressTimer) return;
      progressTimer = setInterval(() => {
        if (progress < target) {
          progress += 1;
          wx.showLoading({ title: `文件正在生成...${progress}%` });
        }
      }, 80);
    };
    const setTarget = (pct) => {
      const next = Math.min(99, Math.max(progress, Math.floor(pct)));
      target = next;
    };
    const startDrift = (endPct, step = 1, interval = 180) => {
      if (driftTimer) {
        clearInterval(driftTimer);
        driftTimer = null;
      }
      const cap = Math.min(99, Math.max(progress, Math.floor(endPct)));
      driftTimer = setInterval(() => {
        if (target < cap) {
          target = Math.min(cap, target + step);
        } else {
          clearInterval(driftTimer);
          driftTimer = null;
        }
      }, interval);
    };
    const stopProgress = () => {
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      if (driftTimer) {
        clearInterval(driftTimer);
        driftTimer = null;
      }
    };
    const updateTargetBySteps = (done, total) => {
      if (!total) return;
      const pct = Math.floor((done / total) * 100);
      setTarget(pct);
    };
    wx.showLoading({ title: '文件正在生成...1%' });
    startProgress();
    try {
      await this.cleanupOldPdfFiles(200);
      const pageData = this.buildPdfPages(fileName);
      setTarget(8);
      startDrift(18, 1, 160);
      // 云函数需要在单次调用中嵌入中文字体和附件图片。大活动的成员明细会
      // 反复引用账单，30 页在真机上可能超过调用时限或请求体限制；附件页的
      // 图片体积也远大于普通文字页，因此按负载而非固定页数分卷。
      const pageChunks = this.splitPdfPagesForExport(pageData.pages);
      const chunkCount = pageChunks.length;
      // 每个分卷一次生成；完成后再生成、下载并保存最终合并文件。
      progressTotal = chunkCount + 3;
      updateTargetBySteps(progressDone, progressTotal);
      if (chunkCount > 1) {
        await new Promise((resolve) => {
          wx.showModal({
            title: '提示',
            content: `当前共 ${pageData.pages.length} 页，将分为 ${chunkCount} 个文件导出。`,
            confirmText: '知道了',
            showCancel: false,
            success: () => resolve()
          });
        });
      }
      const partFileIDs = [];
      for (let i = 0; i < chunkCount; i++) {
        const chunkPages = pageChunks[i];
        if (chunkPages.length === 0) continue;

        startDrift(70, 1, 160);
        const pdfRes = await wx.cloud.callFunction({
          name: 'exportActivityPdf',
          data: {
            pages: chunkPages,
            pageWidth: pageData.pageWidth,
            pageHeight: pageData.pageHeight,
            padding: pageData.padding,
            lineHeight: pageData.lineHeight
          }
        });
        progressDone += 1;
        updateTargetBySteps(progressDone, progressTotal);
        setTarget(72);

        const result = pdfRes && pdfRes.result ? pdfRes.result : null;
        if (!result || result.success === false) {
          const errMsg = (result && result.error) ? result.error : 'PDF生成失败';
          console.error('导出PDF失败:', errMsg, result);
          throw new Error(errMsg);
        }

        const fileID = result.fileID;
        if (!fileID) {
          throw new Error('PDF生成失败');
        }
        partFileIDs.push(fileID);
      }

      // 分卷仅用于降低生成压力。全部分卷生成后在云端合并，用户只会得到一个 PDF。
      startDrift(82, 1, 180);
      const mergeRes = await wx.cloud.callFunction({
        name: 'exportActivityPdf',
        data: { mergeFileIDs: partFileIDs }
      });
      progressDone += 1;
      updateTargetBySteps(progressDone, progressTotal);
      const mergeResult = mergeRes && mergeRes.result ? mergeRes.result : null;
      if (!mergeResult || mergeResult.success === false || !mergeResult.fileID) {
        const errMsg = (mergeResult && mergeResult.error) ? mergeResult.error : 'PDF合并失败';
        throw new Error(errMsg);
      }

      let tempUrlRes;
      try {
        tempUrlRes = await wx.cloud.getTempFileURL({ fileList: [mergeResult.fileID] });
      } catch (e) {
        console.error('[PDF] getTempFileURL failed:', e);
        throw e;
      }
      const tempUrl = tempUrlRes && tempUrlRes.fileList && tempUrlRes.fileList[0] && tempUrlRes.fileList[0].tempFileURL;
      if (!tempUrl) throw new Error('获取下载链接失败');

      startDrift(88, 1, 180);
      let downloadRes;
      let downloadTarget = '';
      try {
        downloadRes = await new Promise((resolve, reject) => {
          wx.downloadFile({ url: tempUrl, success: resolve, fail: reject });
        });
        const maybePath = (downloadRes && (downloadRes.tempFilePath || downloadRes.filePath)) || '';
        if (typeof maybePath === 'string' && /^https?:\/\//i.test(maybePath)) {
          downloadTarget = `${wx.env.USER_DATA_PATH}/__pdf_download_${Date.now()}.pdf`;
          downloadRes = await new Promise((resolve, reject) => {
            wx.downloadFile({ url: tempUrl, filePath: downloadTarget, success: resolve, fail: reject });
          });
        }
      } catch (e) {
        console.error('[PDF] downloadFile failed:', e);
        throw e;
      }
      const localPdfPath = (downloadRes && (downloadRes.filePath || downloadRes.tempFilePath)) || downloadTarget;
      progressDone += 1;
      updateTargetBySteps(progressDone, progressTotal);

      startDrift(93, 1, 200);
      const savedPath = await this.savePdfFile(localPdfPath, fileName);
      progressDone += 1;
      updateTargetBySteps(progressDone, progressTotal);
      setTarget(96);
      wx.cloud.deleteFile({ fileList: [...partFileIDs, mergeResult.fileID] }).catch(() => {});

      this.setLastPdfDownloadAt(Date.now());
      this.setPdfReminderNextAt(0);
      this.setData({ pdfReminderShown: true });

      progressDone += 1;
      updateTargetBySteps(progressDone, progressTotal);
      setTarget(100);
      stopProgress();
      wx.hideLoading();
      const guideText = `文件名：${fileName}\n如需保存在本地：\n1) 在预览页右上角点击“...”\n2) 选择“转发给朋友”或“保存到手机”`;
      this._pendingPdfPath = savedPath || '';
      this.setData({
        showPdfGuideModal: true,
        pdfGuideText: guideText
      });

      // 云端文件已在下载后删除
    } catch (e) {
      console.error('导出PDF失败:', e);
      stopProgress();
      wx.hideLoading();
      const message = String((e && e.message) || '生成失败').replace(/[\r\n]+/g, ' ');
      wx.showToast({ title: `生成失败：${message.slice(0, 14)}`, icon: 'none' });
    }
  },

  splitPdfPagesForExport(pages) {
    const result = [];
    let current = [];
    let weight = 0;
    // 真机端对单次 wx.cloud.callFunction 的轮询上限约为 15 秒。
    // PDF 生成还需嵌入中文字体，20 个文字页在部分设备上会超过该上限；
    // 因此按更小的负载分卷。附件仍独占一个分卷，最终再合成为一个 PDF。
    const maxWeight = 4;
    (pages || []).forEach((page) => {
      const pageWeight = page && !Array.isArray(page) && page.type === 'attachment' ? 6 : 1;
      if (current.length > 0 && weight + pageWeight > maxWeight) {
        result.push(current);
        current = [];
        weight = 0;
      }
      current.push(page);
      weight += pageWeight;
    });
    if (current.length > 0) result.push(current);
    return result;
  },

  async savePdfFile(tempFilePath, fileName) {
    const fs = wx.getFileSystemManager();
    const safeName = this.sanitizeFileName(fileName);
    const targetPath = `${wx.env.USER_DATA_PATH}/${safeName}`;
    try {
      try {
        const exists = await new Promise((resolve) => {
          fs.readdir({
            dirPath: wx.env.USER_DATA_PATH,
            success: res => resolve((res.files || []).includes(safeName)),
            fail: () => resolve(false)
          });
        });
        if (exists) {
          try {
            fs.unlinkSync(targetPath);
          } catch (e) {}
        }
      } catch (e) {}
      const res = await new Promise((resolve, reject) => {
        fs.saveFile({
          tempFilePath,
          filePath: targetPath,
          success: resolve,
          fail: reject
        });
      });
      return res.savedFilePath || targetPath;
    } catch (e) {
      if (e && e.errno === 1300202) {
        await this.cleanupOldPdfFiles(20);
        try {
          const res = await new Promise((resolve, reject) => {
            fs.saveFile({
              tempFilePath,
              filePath: targetPath,
              success: resolve,
              fail: reject
            });
          });
          return res.savedFilePath || targetPath;
        } catch (retryErr) {
          console.error('[PDF] saveFile retry failed:', retryErr);
          throw retryErr;
        }
      }
      console.error('[PDF] saveFile failed:', e);
      const fallbackName = this.sanitizeFileName(`活动信息-${this.formatYymmdd(new Date())}${this.formatHhmmss(new Date())}.pdf`);
      const fallbackPath = `${wx.env.USER_DATA_PATH}/${fallbackName}`;
      try {
        const res = await new Promise((resolve, reject) => {
          fs.saveFile({
            tempFilePath,
            filePath: fallbackPath,
            success: resolve,
            fail: reject
          });
        });
        return res.savedFilePath || fallbackPath;
      } catch (err) {
        console.error('[PDF] saveFile fallback failed:', err);
        const res = await new Promise((resolve, reject) => {
          wx.saveFile({
            tempFilePath,
            success: resolve,
            fail: reject
          });
        });
        const savedPath = res.savedFilePath;
        if (savedPath) {
          try {
            try {
              fs.unlinkSync(targetPath);
            } catch (e2) {}
            await new Promise((resolve, reject) => {
              fs.rename({
                oldPath: savedPath,
                newPath: targetPath,
                success: resolve,
                fail: reject
              });
            });
            return targetPath;
          } catch (renameErr) {
            console.error('[PDF] rename failed:', renameErr);
          }
        }
        return savedPath;
      }
    }
  },

  async cleanupOldPdfFiles(maxDelete = 10) {
    const fs = wx.getFileSystemManager();
    let files = [];
    try {
      files = await new Promise((resolve, reject) => {
        fs.readdir({
          dirPath: wx.env.USER_DATA_PATH,
          success: res => resolve(res.files || []),
          fail: reject
        });
      });
    } catch (e) {
      console.error('[PDF] readdir failed:', e);
      return;
    }
    const pdfs = files.filter(name => /\.pdf$/i.test(name));
    if (pdfs.length === 0) return;
    const stats = [];
    for (const name of pdfs) {
      const path = `${wx.env.USER_DATA_PATH}/${name}`;
      try {
        const statRes = await new Promise((resolve, reject) => {
          fs.stat({
            path,
            success: resolve,
            fail: reject
          });
        });
        const mtime = statRes && statRes.stats ? statRes.stats.lastModifiedTime || 0 : 0;
        stats.push({ path, mtime });
      } catch (e) {
        stats.push({ path, mtime: 0 });
      }
    }
    stats.sort((a, b) => a.mtime - b.mtime);
    const toDelete = stats.slice(0, Math.min(maxDelete, stats.length));
    for (const item of toDelete) {
      try {
        fs.unlinkSync(item.path);
      } catch (e) {}
    }
  },

  async renderPdfCanvasToImages(pageData, onPageRendered) {
    const { pages, pageWidth, pageHeight, padding, lineHeight } = pageData || this.buildPdfPages();
    const results = [];

    for (let i = 0; i < pages.length; i++) {
      this.setData({
        pdfCanvasWidth: pageWidth,
        pdfCanvasHeight: pageHeight
      });

      await new Promise(resolve => setTimeout(resolve, 30));

      const ctx = wx.createCanvasContext('pdfCanvas', this);
      ctx.setFillStyle('#ffffff');
      ctx.fillRect(0, 0, pageWidth, pageHeight);
      ctx.setTextBaseline('top');

      this.renderPdfPage(ctx, pages[i], padding, lineHeight);
      await new Promise(resolve => ctx.draw(false, resolve));

      const tempRes = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvasId: 'pdfCanvas',
          fileType: 'jpg',
          quality: 0.8,
          success: resolve,
          fail: reject
        }, this);
      });

      results.push({
        tempFilePath: tempRes.tempFilePath,
        fileType: 'jpg'
      });
      if (onPageRendered) {
        onPageRendered(i);
      }
    }

    return results;
  },

  buildPdfPages(fileName, source) {
    if (!source && this.data.isParent) {
      return this.buildParentPdfPages(fileName);
    }

    const activity = (source && source.activity) || this.data.activity || {};
    const bills = (source && source.bills) || this.data.rawBills || [];
    const members = (source && source.members) || this.data.members || [];
    const rawRecharges = (source && source.recharges) || this.data.rawRecharges || [];
    const isPrepaid = source ? !!activity.isPrepaid : (this.data.isPrepaid || false);
    const keeper = source ? (activity.keeper || '') : (this.data.keeper || '');
    const activityDateRange = (source && source.dateRange) || this.data.dateRange || '';
    const activityTotal = source && source.total !== undefined ? this.formatAmount(source.total) : this.data.total;
    const activityAvg = source && source.avg !== undefined ? this.formatAmount(source.avg) : this.data.avg;
    const activityFamilyExpense = source && source.familyExpense !== undefined
      ? this.formatAmount(source.familyExpense)
      : this.data.familyExpense;
    const defaultFileName = fileName || `${activity.name || '活动'}-${this.formatYymmdd(new Date())}.pdf`;

    const pageWidth = 820;
    const pageHeight = 1200;
    const padding = 32;
    const lineHeight = 32;
    const maxLines = Math.floor((pageHeight - padding * 2) / lineHeight);

    const pages = [[]];
    let lineCount = 0;

    const pushLine = (line) => {
      if (lineCount >= maxLines) {
        pages.push([]);
        lineCount = 0;
      }
      pages[pages.length - 1].push(line);
      lineCount += 1;
    };

    const pushBlank = () => {
      pushLine({ type: 'text', text: '', fontSize: 20, color: '#111111' });
    };

    const addTitle = (text) => {
      pushLine({ type: 'text', text, fontSize: 26, color: '#1d4ed8', bold: true, role: 'title' });
    };

    const addMemberTitle = (text) => {
      pushLine({ type: 'text', text, fontSize: 24, color: '#15803d', bold: true, role: 'title' });
    };


    const addGreenNote = (text) => {
      pushLine({ type: 'text', text, fontSize: 20, color: '#15803d', bold: false, role: 'title' });
    };

    const addText = (text) => {
      pushLine({ type: 'text', text, fontSize: 20, color: '#111111', role: 'body' });
    };

    const addBoldText = (text) => {
      pushLine({ type: 'text', text, fontSize: 20, color: '#111111', role: 'body', bold: true, boldNoScale: true });
    };

    const wrapTextToLines = (text, width, fontSize) => {
      const raw = String(text || '');
      if (!raw) return [''];
      const unitWidth = fontSize * 0.95;
      const maxUnits = Math.max(1, Math.floor(width / unitWidth));
      const lines = [];
      let current = '';
      let units = 0;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        const isAscii = ch.charCodeAt(0) <= 0x7f;
        const chUnits = isAscii ? 0.5 : 1;
        if (units + chUnits > maxUnits && current) {
          lines.push(current);
          current = ch;
          units = chUnits;
        } else {
          current += ch;
          units += chUnits;
        }
      }
      if (current) lines.push(current);
      return lines;
    };

    const addRow = (columns, fontSize = 18) => {
      const wrappedCols = columns.map(col => {
        if (col.wrap) {
          return wrapTextToLines(col.text, col.width - 6, fontSize);
        }
        return [String(col.text || '')];
      });
      const maxLines = wrappedCols.reduce((max, lines) => Math.max(max, lines.length), 1);
      for (let i = 0; i < maxLines; i++) {
        const lineCols = columns.map((col, idx) => ({
          ...col,
          text: wrappedCols[idx][i] || '',
          noTruncate: true
        }));
        pushLine({ type: 'row', columns: lineCols, fontSize, color: '#111111' });
      }
    };

    const currentMemberNames = (activity.members || []).map(m => (typeof m === 'string' ? m : m.name)).filter(Boolean);
    const currentMemberSet = new Set(currentMemberNames);

    const detailMap = {};
    const noIncomeExpenseMembers = [];
    members.forEach((m) => {
      const name = m.name || '';
      if (!name) return;
      const details = this.buildMemberBillDetails(name, bills, rawRecharges, isPrepaid, keeper, currentMemberSet);
      detailMap[name] = details;
      if (details.incomeBills.length === 0 && details.expenseBills.length === 0) {
        noIncomeExpenseMembers.push(name);
      }
    });

    // 活动信息
    addTitle('活动信息');
    const activityName = activity.name || '未命名活动';
    const creator = activity.creator || '';
    const memberNames = currentMemberNames.join('、');
    const prepaidInfo = activity.isPrepaid ? `预存活动（保管人：${activity.keeper || '未设置'}）` : '非预存活动';
    const exportTime = this.formatExportTime(new Date());

    addText(`活动名称：${activityName}`);
    addText(`活动类型：${activity.type || '未设置'}`);
    addText(`创建者：${creator}`);
    addText(`成员：${memberNames || '无'}`);
    addText(`活动属性：${prepaidInfo}`);
    addText(`家庭支出：¥${activityFamilyExpense || activityTotal}`);
    addText(`账单范围：${activityDateRange || '至今'}，账单数量：${bills.length} 条`);
    addText(`导出时间：${exportTime}`);
    addText(`PDF文件：${this.normalizeAsciiDigits(defaultFileName)}`);

    pushBlank();

    // 账单信息
    addTitle('账单信息');
    const billColDate = 130;
    const billColAmount = 110;
    const billColPayer = 120;
    const billColParticipants = 260;
    const billColTitle = pageWidth - padding * 2 - billColDate - billColAmount - billColPayer - billColParticipants;
    addRow([
      { text: '日期', x: 0, width: billColDate },
      { text: '名称', x: billColDate, width: billColTitle },
      { text: '付款人', x: billColDate + billColTitle, width: billColPayer },
      { text: '参与人', x: billColDate + billColTitle + billColPayer, width: billColParticipants },
      { text: '金额', x: billColDate + billColTitle + billColPayer + billColParticipants, width: billColAmount }
    ], 18);

    if (bills.length === 0) {
      addText('暂无账单记录');
    } else {
      bills.forEach((bill) => {
        const date = this.formatBillDate(bill);
        const title = bill.title || '未命名';
        const payer = (bill.billshow || bill.payer) || '';
        const participants = bill.participants
          ? Object.keys(bill.participants)
            .filter(name => bill.participants[name] > 0 && currentMemberSet.has(name))
            .join('、')
          : '';
        const amount = `¥${this.formatAmount(bill.amount || 0)}`;
        addRow([
          { text: date, x: 0, width: billColDate },
          { text: title, x: billColDate, width: billColTitle, wrap: true },
          { text: payer, x: billColDate + billColTitle, width: billColPayer, wrap: true },
          { text: participants, x: billColDate + billColTitle + billColPayer, width: billColParticipants, wrap: true },
          { text: amount, x: billColDate + billColTitle + billColPayer + billColParticipants, width: billColAmount }
        ], 18);
      });
    }

    pushBlank();

    // 结算信息
    addTitle('结算信息');
    addText(`总支出：¥${activityTotal}，人均：¥${activityAvg}`);
    const memberColName = 180;
    const memberColPaid = 150;
    const memberColShould = 150;
    const memberColBalance = pageWidth - padding * 2 - memberColName - memberColPaid - memberColShould;
    addRow([
      { text: '成员', x: 0, width: memberColName },
      { text: '实付', x: memberColName, width: memberColPaid },
      { text: '应付', x: memberColName + memberColPaid, width: memberColShould },
      { text: '余额', x: memberColName + memberColPaid + memberColShould, width: memberColBalance }
    ], 18);

    members.forEach((m) => {
      const name = m.name || '';
      if (noIncomeExpenseMembers.indexOf(name) !== -1) return;
      addRow([
        { text: name, x: 0, width: memberColName, wrap: true },
        { text: `¥${m.bal ? m.bal.paid : '0.0'}`, x: memberColName, width: memberColPaid },
        { text: `¥${m.bal ? m.bal.shouldPay : '0.0'}`, x: memberColName + memberColPaid, width: memberColShould },
        { text: `¥${m.bal ? m.bal.balance : '0.0'}`, x: memberColName + memberColPaid + memberColShould, width: memberColBalance }
      ], 18);
    });

    pushBlank();

    members.forEach((m) => {
      const memberName = m.name || '';
      if (!memberName) return;
      if (noIncomeExpenseMembers.indexOf(memberName) !== -1) return;
      const details = detailMap[memberName] || this.buildMemberBillDetails(memberName, bills, rawRecharges, isPrepaid, keeper, currentMemberSet);

      addMemberTitle(`${memberName} 结算信息`);

      const incomeTotal = details.incomeBills.reduce((sum, b) => sum + Number(b.amount || 0), 0);
      const expenseTotal = details.expenseBills.reduce((sum, b) => sum + Number(b.amount || 0), 0);
      const balance = this.formatAmount(Number(m.bal ? m.bal.balance : 0));
      pushLine({ type: 'text', text: `消费：¥${this.formatAmount(incomeTotal)}  支出：¥${this.formatAmount(expenseTotal)}  余额：¥${balance}`, fontSize: 20, color: '#111111', bold: false });

      addBoldText(`${memberName} 消费信息`);
      const incomeColGap = 36;
      const incomeColTitle = 300;
      const incomeColCounter = 160;
      const incomeColAmount = 100;
      const incomeColDate = pageWidth - padding * 2 - incomeColTitle - incomeColCounter - incomeColAmount - incomeColGap;
      addRow([
        { text: '名称', x: 0, width: incomeColTitle },
        { text: '付款人', x: incomeColTitle + incomeColGap, width: incomeColCounter },
        { text: '金额', x: incomeColTitle + incomeColGap + incomeColCounter, width: incomeColAmount },
        { text: '日期', x: incomeColTitle + incomeColGap + incomeColCounter + incomeColAmount, width: incomeColDate }
      ], 18);
      if (details.incomeBills.length === 0) {
        addText('暂无记录');
      } else {
        details.incomeBills.forEach((row) => {
          addRow([
            { text: row.title || '未命名', x: 0, width: incomeColTitle, wrap: true },
            { text: row.payer || '', x: incomeColTitle + incomeColGap, width: incomeColCounter, wrap: true },
            { text: `¥${row.amount || '0.0'}`, x: incomeColTitle + incomeColGap + incomeColCounter, width: incomeColAmount },
            { text: row.date || '', x: incomeColTitle + incomeColGap + incomeColCounter + incomeColAmount, width: incomeColDate }
          ], 18);
        });
      }

      addBoldText(`${memberName} 支出信息`);
      const expenseColGap = 36;
      const expenseColTitle = 300;
      const expenseColCounter = 160;
      const expenseColAmount = 100;
      const expenseColDate = pageWidth - padding * 2 - expenseColTitle - expenseColCounter - expenseColAmount - expenseColGap;
      addRow([
        { text: '名称', x: 0, width: expenseColTitle },
        { text: '去向', x: expenseColTitle + expenseColGap, width: expenseColCounter },
        { text: '金额', x: expenseColTitle + expenseColGap + expenseColCounter, width: expenseColAmount },
        { text: '日期', x: expenseColTitle + expenseColGap + expenseColCounter + expenseColAmount, width: expenseColDate }
      ], 18);
      if (details.expenseBills.length === 0) {
        addText('暂无记录');
      } else {
        details.expenseBills.forEach((row) => {
          addRow([
            { text: row.title || '未命名', x: 0, width: expenseColTitle, wrap: true },
            { text: row.payee || '', x: expenseColTitle + expenseColGap, width: expenseColCounter, wrap: true },
            { text: `¥${row.amount || '0.0'}`, x: expenseColTitle + expenseColGap + expenseColCounter, width: expenseColAmount },
            { text: row.date || '', x: expenseColTitle + expenseColGap + expenseColCounter + expenseColAmount, width: expenseColDate }
          ], 18);
        });
      }

      pushBlank();
    });

    if (noIncomeExpenseMembers.length > 0) {
      addGreenNote(`${noIncomeExpenseMembers.join('、')} 没有产生消费和支出`);
    }

    const attachmentPages = [];
    bills.forEach((bill) => {
      const attachments = Array.isArray(bill.attachments) ? bill.attachments : [];
      const fileIDs = attachments.map(item => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        return item.fileID || '';
      }).filter(Boolean);
      if (!fileIDs.length) return;

      fileIDs.forEach((fileID) => {
        attachmentPages.push({
          type: 'attachment',
          fileID,
          billTitle: bill.title || '未命名',
          billDate: this.formatBillDate(bill),
          billAmount: `¥${this.formatAmount(bill.amount || 0)}`,
          payer: (bill.billshow || bill.payer) || ''
        });
      });
    });

    attachmentPages.forEach((page, index) => {
      pages.push({
        ...page,
        attachmentIndex: index + 1,
        attachmentTotal: attachmentPages.length
      });
    });

    return { pages, pageWidth, pageHeight, padding, lineHeight };
  },

  buildParentPdfPages(fileName) {
    const parent = this.data.activity || {};
    const children = this.data.pdfChildDetails || [];
    const pageWidth = 820;
    const pageHeight = 1200;
    const padding = 32;
    const lineHeight = 32;
    const maxLines = Math.floor((pageHeight - padding * 2) / lineHeight);
    const pages = [[]];
    let lineCount = 0;
    const pushLine = (line) => {
      if (lineCount >= maxLines) {
        pages.push([]);
        lineCount = 0;
      }
      pages[pages.length - 1].push(line);
      lineCount += 1;
    };
    const addText = (text, options = {}) => {
      const value = String(text || '');
      // PDF 使用固定字号；将超长成员名单换行，防止内容超出页面。
      const limit = options.title ? 30 : 36;
      for (let index = 0; index < value.length || index === 0; index += limit) {
        pushLine({
          type: 'text',
          text: value.slice(index, index + limit),
          fontSize: options.title ? 26 : 20,
          color: options.title ? '#1d4ed8' : '#111111',
          bold: !!options.title,
          role: options.title ? 'title' : 'body'
        });
        if (!value.length) break;
      }
    };
    const addBlank = () => pushLine({ type: 'text', text: '', fontSize: 20, color: '#111111' });
    const allBills = children.reduce((records, item) => records.concat(item.bills || []), []);
    const parentDateRange = this.calculateDateRange(allBills);
    const total = children.reduce((sum, item) => {
      const billTotal = (item.bills || []).reduce((childSum, bill) => childSum + (Number(bill.amount) || 0), 0);
      return sum + this.getFamilyExpense(item.activity || {}, billTotal);
    }, 0);

    addText('一级活动信息', { title: true });
    addText(`一级活动名称：${parent.name || '未命名一级活动'}`);
    addText(`创建者：${parent.creator || '未设置'}`);
    addText('活动属性：一级活动');
    addText(`总支出：¥${this.formatAmount(total)}`);
    addText(`起止日期：${parentDateRange || '至今'}`);
    addText(`包含二级活动：${children.length} 个`);
    addText(`导出时间：${this.formatExportTime(new Date())}`);
    addText(`PDF文件：${this.normalizeAsciiDigits(fileName || '')}`);
    addBlank();
    addText('二级活动清单', { title: true });

    if (children.length === 0) {
      addText('暂无二级活动');
    } else {
      children.forEach((item, index) => {
        const child = item.activity || {};
        const members = (child.members || [])
          .map(member => typeof member === 'string' ? member : member.name)
          .filter(Boolean)
          .join('、');
        const billTotal = (item.bills || []).reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);
        const childTotal = this.getFamilyExpense(child, billTotal);
        const childDateRange = this.calculateDateRange(item.bills || []);
        addText(`${index + 1}. 二级活动名称：${child.name || '未命名活动'}`);
        addText(`   创建者：${child.creator || '未设置'}`);
        addText(`   参与成员：${members || '无'}`);
        addText(`   家庭支出：¥${this.formatAmount(childTotal)}`);
        addText(`   起止时间：${childDateRange || '至今'}`);
        addBlank();
      });
    }

    children.forEach((item, index) => {
      const child = item.activity || {};
      const bills = item.bills || [];
      const recharges = item.recharges || [];
      const childMembers = (child.members || []).map(member => {
        const name = typeof member === 'string' ? member : member.name;
        return { name };
      }).filter(member => member.name);
      const balances = this.calcBalances(child.members || [], bills, recharges, child.isPrepaid ? child.keeper : '');
      const members = childMembers.map(member => {
        const balance = balances[member.name] || { paid: 0, shouldPay: 0, balance: 0 };
        return {
          name: member.name,
          bal: {
            paid: this.formatAmount(balance.paid),
            shouldPay: this.formatAmount(balance.shouldPay),
            balance: this.formatAmount(balance.balance)
          }
        };
      });
      const childTotal = bills.reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);
      const latestBill = bills[0] || {};
      const totalWeight = latestBill.participants
        ? Object.keys(latestBill.participants).reduce((sum, name) => sum + Math.max(0, Number(latestBill.participants[name]) || 0), 0)
        : 0;
      const fallbackWeight = (child.members || []).reduce((sum, member) => sum + (Number(typeof member === 'string' ? 2 : member.weight) || 2), 0) || 1;
      const childPages = this.buildPdfPages(fileName, {
        activity: child,
        bills,
        recharges,
        members,
        total: childTotal,
        avg: childTotal / (totalWeight || fallbackWeight),
        dateRange: this.calculateDateRange(bills),
        familyExpense: this.getFamilyExpense(child, childTotal)
      });
      // 标题直接写入子活动首页，避免单独生成只有标题的空白页。
      let carryLine = {
        type: 'text',
        text: `二级活动 ${index + 1}/${children.length}：${child.name || '未命名活动'}`,
        fontSize: 26,
        color: '#1d4ed8',
        bold: true,
        role: 'title'
      };
      childPages.pages.forEach((page) => {
        if (!carryLine || !Array.isArray(page)) return;
        page.unshift(carryLine);
        if (page.length <= maxLines) {
          carryLine = null;
        } else {
          carryLine = page.pop();
        }
      });
      if (carryLine) childPages.pages.push([carryLine]);
      pages.push(...childPages.pages);
    });

    return { pages, pageWidth, pageHeight, padding, lineHeight };
  },

  renderPdfPage(ctx, lines, padding, lineHeight) {
    if (!Array.isArray(lines)) {
      const page = lines || {};
      ctx.save();
      ctx.setTextAlign('left');
      ctx.setTextBaseline('top');
      ctx.setFontSize(26);
      ctx.setFillStyle('#1d4ed8');
      ctx.fillText(`附件图片 ${page.attachmentIndex || ''}`, padding, padding);
      ctx.setFontSize(20);
      ctx.setFillStyle('#111111');
      ctx.fillText(`账单：${page.billTitle || '未命名'}`, padding, padding + lineHeight * 2);
      ctx.fillText('图片将在 PDF 中嵌入显示', padding, padding + lineHeight * 3);
      ctx.restore();
      return;
    }
    lines.forEach((line, index) => {
      const y = padding + index * lineHeight;
      const fontSize = line.fontSize || 18;
      const color = line.color || '#111111';
      ctx.save();
      ctx.setTextAlign('left');
      ctx.setTextBaseline('top');
      ctx.setFontSize(fontSize);
      ctx.setFillStyle('#111111');
      if (line.type === 'row') {
        line.columns.forEach((col) => {
          ctx.setFontSize(fontSize);
          ctx.setFillStyle('#111111');
          const rawText = String(col.text || '');
          const text = col.noTruncate ? rawText : this.truncateText(ctx, rawText, col.width - 6);
          ctx.fillText(text, padding + col.x, y);
        });
      } else {
        const isTitle = line.role === 'title';
        const boldDelta = line.bold && !line.boldNoScale ? 1 : 0;
        ctx.setFontSize(fontSize + boldDelta);
        ctx.setFillStyle(isTitle ? color : '#111111');
        const text = String(line.text || '');
        ctx.fillText(text, padding, y);
      }
      ctx.restore();
    });
  },

  formatNameAbbrev(listOrString) {
    if (Array.isArray(listOrString)) {
      return listOrString
        .map(name => String(name || '').trim())
        .filter(Boolean)
        .map(name => name.charAt(name.length - 1))
        .join('，');
    }
    const raw = String(listOrString || '').trim();
    if (!raw) return '';
    const parts = raw.split(/[、，,]/).map(name => name.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    return parts.map(name => name.charAt(name.length - 1)).join('，');
  },

  formatNamesWithLimit(listOrString, limit) {
    const names = Array.isArray(listOrString)
      ? listOrString.map(name => String(name || '').trim()).filter(Boolean)
      : String(listOrString || '').split(/[、，,]/).map(name => name.trim()).filter(Boolean);
    if (names.length === 0) return '';
    const totalLen = names.reduce((sum, name) => sum + name.length, 0);
    if (totalLen <= limit) {
      return names.join('，');
    }
    return names.map(name => name.charAt(name.length - 1)).join('，');
  },

  truncateText(ctx, text, maxWidth) {
    let result = String(text || '');
    if (ctx.measureText(result).width <= maxWidth) return result;
    while (result.length > 0 && ctx.measureText(`${result}…`).width > maxWidth) {
      result = result.slice(0, -1);
    }
    return `${result}…`;
  },

  async uploadPdfImageToCloud(tempFilePath) {
    const cloudPath = `pdf_images/activity_${this.data.activityId}_${Date.now()}.jpg`;
    const res = await wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath
    });
    return res;
  },


  buildMemberBillDetails(memberName, rawBills, rawRecharges, isPrepaid, keeper, currentMemberSet = null) {
    let incomeBills = [];
    let expenseBills = [];

    if (isPrepaid && memberName === keeper) {
      incomeBills = rawRecharges
        .filter(r => r.keeper === keeper)
        .map(r => {
          const totalAmount = this.formatAmount(r.amount || 0);
          return {
            title: `充值 ${totalAmount}￥`,
            payer: r.payer || '未知',
            amount: totalAmount,
            date: this.formatRechargeDate(r),
            isRecharge: true
          };
        });
    } else {
      incomeBills = rawBills
        .filter(b => b && b.splitDetail && b.participants && b.participants[memberName] !== undefined && b.participants[memberName] > 0 && b.splitDetail[memberName] !== undefined)
        .map(b => {
          const displayPayer = (b.billshow || b.payer) || '未知';
          const totalAmount = this.formatAmount(b.amount || 0);
          return {
            title: `${b.title || '未命名'} ${totalAmount}￥`,
            payer: displayPayer,
            amount: this.formatAmount(b.splitDetail[memberName] || 0),
            date: this.formatBillDate(b),
            isRecharge: false
          };
        });
    }

    if (isPrepaid && memberName !== keeper) {
      const rechargeBills = rawRecharges
        .filter(r => r.payer === memberName)
        .map(r => {
          const totalAmount = this.formatAmount(r.amount || 0);
          return {
          title: `充值 ${totalAmount}￥`,
          payee: r.keeper || keeper || '未知',
          amount: totalAmount,
          date: this.formatRechargeDate(r),
          isRecharge: true
          };
        });
      expenseBills = expenseBills.concat(rechargeBills);
    }
    

    const billExpenses = rawBills
      .filter(b => {
        const displayPayer = (b.billshow || b.payer) || '';
        if (!displayPayer) return false;
        if (b.relatedRechargeId && b.billshow === memberName) return false;
        return displayPayer === memberName;
      })
      .map(b => {
        const payeeList = [];
        if (b.participants) {
          Object.keys(b.participants).forEach(name => {
            if (b.participants[name] > 0 && (!currentMemberSet || currentMemberSet.has(name))) {
              payeeList.push(name);
            }
          });
        }
        const totalAmount = this.formatAmount(b.amount || 0);
        return {
          title: `${b.title || '未命名'} ${totalAmount}￥`,
          payee: payeeList.length > 0 ? payeeList.join('、') : '未知',
          amount: totalAmount,
          date: this.formatBillDate(b),
          isRecharge: false
        };
      });

    expenseBills = expenseBills.concat(billExpenses);

    return { incomeBills, expenseBills };
  },


  formatExportTime(dateObj) {
    const date = dateObj || new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  },

  editActivity() {
    // 只有创建者才能编辑活动
    if (!this.data.isCreator) {
      wx.showToast({
        title: '只有创建者可以编辑活动',
        icon: 'none'
      });
      return;
    }

    // 准备活动数据
    const activityData = {
      ...this.data.activity,
      memberNames: this.data.activity.members ? this.data.activity.members.map(m => typeof m === 'string' ? m : m.name) : []
    };

    wx.navigateTo({
      url: `/pages/activity/create?id=${this.data.activityId}&data=${encodeURIComponent(JSON.stringify(activityData))}`
    });
  },
  
  deleteActivity() {
    // 只有创建者才能删除活动
    if (!this.data.isCreator) {
      wx.showToast({
        title: '只有创建者可以删除活动',
        icon: 'none'
      });
      return;
    }

    const activityName = this.data.activity.name || '该活动';
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除活动"${activityName}"吗？此操作不可恢复！`,
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
              name: 'activityOps',
              data: {
                action: 'deleteActivity',
                activityId: this.data.activityId,
                userName,
                passwordHash
              }
            });

            const result = (res && res.result) ? res.result : {};
            if (!result.success) {
              wx.hideLoading();
              wx.showToast({
                title: result.error || '删除失败',
                icon: 'none',
                duration: 3000
              });
              return;
            }
            wx.hideLoading();
            wx.showToast({
              title: '删除成功',
              icon: 'success'
            });
            // 返回活动列表页面
            setTimeout(() => {
              wx.navigateBack();
            }, 1500);
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
  
  // 添加充值
  addRecharge() {
    if (this.data.isParent) return;
    wx.navigateTo({
      url: `/pages/recharge/add?activityId=${this.data.activityId}`
    });
  },
  
  // 查看/编辑充值（点击充值记录）
  viewRecharge(e) {
    const rechargeId = e.currentTarget.dataset.id;
    
    // 检查是否是自动生成的充值记录
    const recharge = this.data.recharges.find(r => r._id === rechargeId);
    if (recharge && recharge.isAuto) {
      wx.showToast({
        title: '自动生成的充值记录不可编辑',
        icon: 'none'
      });
      return;
    }
    
    wx.navigateTo({
      url: `/pages/recharge/add?activityId=${this.data.activityId}&rechargeId=${rechargeId}`
    });
  },
  
  // 阻止事件冒泡
  noop() {
    // 空函数，用于阻止按钮点击事件冒泡
  },
  
  // 删除充值
  deleteRecharge(e) {
    const rechargeId = e.currentTarget.dataset.id;
    const payer = e.currentTarget.dataset.payer;
    const amount = e.currentTarget.dataset.amount;
    
    // 检查权限
    const userName = db.getCurrentUser();
    const recharge = this.data.recharges.find(r => r._id === rechargeId);
    if (!recharge) {
      wx.showToast({
        title: '找不到充值记录',
        icon: 'none'
      });
      return;
    }
    
    // 检查是否是自动生成的充值记录
    if (recharge.isAuto) {
      wx.showToast({
        title: '自动生成的充值记录不可删除',
        icon: 'none'
      });
      return;
    }
    
    const isCreator = recharge.creator === userName;
    if (!isCreator) {
      wx.showToast({
        title: '只有创建者可以删除',
        icon: 'none'
      });
      return;
    }
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除充值记录（${payer}，¥${amount}）吗？此操作不可恢复！`,
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            const passwordHash = db.getCurrentUserPasswordHash();
            if (!passwordHash) {
              throw new Error('请先登录');
            }
            const res = await wx.cloud.callFunction({
              name: 'activityOps',
              data: {
                action: 'deleteRecharge',
                rechargeId,
                userName,
                passwordHash
              }
            });
            const result = (res && res.result) || {};
            if (!result.success) {
              throw new Error(result.error || '删除失败');
            }

            wx.hideLoading();
            wx.showToast({
              title: '删除成功',
              icon: 'success'
            });
            this.loadActivityData();
          } catch (e) {
            console.error('删除充值记录失败:', e);
            wx.hideLoading();
            wx.showToast({
              title: e.message || '删除失败',
              icon: 'none',
              duration: 3000
            });
          }
        }
      }
    });
  },

  closePdfGuideModal() {
    const path = this._pendingPdfPath;
    this._pendingPdfPath = '';
    this.setData({ showPdfGuideModal: false });
    if (path) {
      wx.openDocument({
        filePath: path,
        fileType: 'pdf',
        showMenu: true,
        complete: () => {
          this._lastOpenedPdfPath = path;
          this._pendingTempCleanup = true;
        }
      });
    }
  },

  _cleanupOpenedPdfTemp() {
    const path = this._lastOpenedPdfPath;
    this._lastOpenedPdfPath = '';
    if (!path || !/^wxfile:\/\/tmp_/.test(path)) return;
    try {
      const fs = wx.getFileSystemManager();
      fs.unlink({
        filePath: path,
        success: () => {},
        fail: () => {}
      });
    } catch (e) {}
  }
});
