// pages/activity/detail.js
const db = require('../../utils/db.js');
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
    selectedMemberBills: [], // 用户应付账单列表（收入）
    selectedMemberPaidBills: [], // 用户实付账单列表（支出）
    selectedMemberName: '',
    selectedMemberIncome: '0.00', // 收入总额
    selectedMemberExpense: '0.00', // 支出总额
    selectedMemberBalance: '0.00', // 余额
    pdfCanvasWidth: 750,
    pdfCanvasHeight: 1200,
    pdfReminderShown: false,
    showPdfGuideModal: false,
    pdfGuideText: ''
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
      const dbCloud = wx.cloud.database();
      const activityId = this.data.activityId;
      
      // 加载活动信息
      const actRes = await dbCloud.collection('activities').doc(activityId).get();
      const activity = actRes.data;
      
      // 调试：打印isPrepaid值
      console.log('活动 isPrepaid 值:', activity.isPrepaid, typeof activity.isPrepaid);
      
      // 加载活动的group（获取最新成员列表）
      const groupRes = await dbCloud.collection('groups')
        .where({ activityId: activityId })
        .limit(1)
        .get();
      
      if (groupRes.data && groupRes.data.length > 0) {
        activity.members = groupRes.data[0].members;
      }
      
      const activityMeta = (activity.type || '') + ' | 成员：' + (activity.members || []).map(m => m.name).join('、');
      
      // 加载账单列表（小程序云数据库默认限制20条，需要分页查询获取所有数据）
      let bills = [];
      const MAX_LIMIT = 20; // 小程序云数据库单次查询最大限制
      let hasMore = true;
      let skip = 0;
      
      // 尝试使用 time 字段排序，如果失败则使用 createdAt
      let orderByField = 'time';
      let useOrderBy = true;
      
      while (hasMore) {
        try {
          let billsRes;
          if (useOrderBy) {
            // 使用排序查询（skip需要配合orderBy使用）
            billsRes = await dbCloud.collection('bills')
              .where({ activityId: activityId })
              .orderBy(orderByField, 'desc')
              .skip(skip)
              .limit(MAX_LIMIT)
              .get();
          } else {
            // 如果不使用排序，直接查询（但只能获取前20条）
            if (skip === 0) {
              billsRes = await dbCloud.collection('bills')
                .where({ activityId: activityId })
                .get();
            } else {
              // 如果skip > 0但没有排序，无法继续查询
              hasMore = false;
              break;
            }
          }
          
          const currentBills = billsRes.data || [];
          bills = bills.concat(currentBills);
          
          // 如果返回的数据少于MAX_LIMIT，说明已经获取完所有数据
          if (currentBills.length < MAX_LIMIT) {
            hasMore = false;
          } else {
            skip += MAX_LIMIT;
          }
        } catch (e) {
          // 如果排序字段不存在或没有索引，尝试使用createdAt
          if (useOrderBy && orderByField === 'time') {
            console.log('time字段排序失败，尝试使用createdAt:', e);
            orderByField = 'createdAt';
            skip = 0; // 重置skip，重新开始查询
            bills = []; // 清空已获取的数据
            continue;
          } else if (useOrderBy && orderByField === 'createdAt') {
            // createdAt也失败，尝试不使用排序（但只能获取前20条）
            console.log('createdAt字段排序也失败，尝试不使用排序:', e);
            useOrderBy = false;
            skip = 0;
            bills = [];
            continue;
          } else {
            // 所有方式都失败，跳出循环
            console.error('获取账单列表失败:', e);
            hasMore = false;
          }
        }
      }
      
      // 如果使用了排序，数据已经按时间排序；如果没有使用排序，需要手动排序
      if (!useOrderBy || bills.length > 0) {
        bills = bills.sort((a, b) => {
          const getDate = (bill) => {
            if (bill.time) {
              return bill.time.getTime ? bill.time.getTime() : new Date(bill.time).getTime();
            }
            if (bill.createdAt) {
              return bill.createdAt.getTime ? bill.createdAt.getTime() : new Date(bill.createdAt).getTime();
            }
            return 0;
          };
          return getDate(b) - getDate(a); // 从最近到最远
        });
      }
      
      // 处理账单数据，生成圆圈和显示信息
      const userName = db.getCurrentUser();
      const isActivityCreator = activity.creator === userName;
      
      // 如果是预存活动，先加载充值记录，以便从关联的充值记录中获取原始付款人
      let rechargeMap = {}; // 用于快速查找充值记录
      if (activity.isPrepaid) {
        try {
          const dbCloud = wx.cloud.database();
          const rechargesRes = await dbCloud.collection('recharges')
            .where({ activityId: activityId })
            .get();
          const recharges = rechargesRes.data || [];
          // 建立账单ID到充值记录的映射（通过relatedRechargeId）
          recharges.forEach(r => {
            // 通过relatedRechargeId反向查找账单
            // 但这里我们需要在后续处理中通过relatedRechargeId查找
          });
          // 建立充值记录ID到充值记录的映射
          recharges.forEach(r => {
            if (r._id) {
              rechargeMap[r._id] = r;
            }
          });
        } catch (e) {
          console.error('加载充值记录失败（用于获取原始付款人）:', e);
        }
      }
      
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
      
      // 计算余额
      // 如果是预存活动，需要传入充值数据
      let balances = {};
      if (activity.isPrepaid) {
        // 先加载充值数据
        try {
          const dbCloud = wx.cloud.database();
          let rechargesRes;
          try {
            rechargesRes = await dbCloud.collection('recharges')
              .where({ activityId: activityId })
              .orderBy('date', 'desc')
              .get();
          } catch (e) {
            try {
              rechargesRes = await dbCloud.collection('recharges')
                .where({ activityId: activityId })
                .orderBy('createdAt', 'desc')
                .get();
            } catch (e2) {
              // 如果createdAt也没有索引，尝试不使用排序
              console.log('结算计算 - 尝试不使用排序:', e2);
              try {
                rechargesRes = await dbCloud.collection('recharges')
                  .where({ activityId: activityId })
                  .get();
              } catch (e3) {
                console.error('结算计算 - 加载充值记录失败（可能是权限问题）:', e3);
                rechargesRes = { data: [] };
              }
            }
          }
          const recharges = rechargesRes.data || [];
          console.log('结算计算使用的充值记录数量:', recharges.length);
          console.log('结算计算使用的充值记录:', recharges.map(r => ({ payer: r.payer, amount: r.amount })));
          balances = this.calcBalances(activity.members || [], bills, recharges, activity.keeper);
        } catch (e) {
          console.error('加载充值数据失败:', e);
          balances = this.calcBalances(activity.members || [], bills, [], activity.keeper);
        }
      } else {
        balances = this.calcBalances(activity.members || [], bills, [], '');
      }
      
      // 计算总支出和人均
      const total = bills.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
      
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
      
      // 如果是预存活动，加载充值数据
      let recharges = [];
      let totalRecharge = 0;
      let totalConsume = total;
      let remaining = 0;
      
      if (activity.isPrepaid) {
        try {
          const dbCloud = wx.cloud.database();
          console.log('🔍 开始查询充值记录，activityId:', activityId);
          
          let rechargesRes;
          let queryError = null;
          
          try {
            // 尝试使用date字段排序
            console.log('📅 尝试使用date字段排序查询...');
            rechargesRes = await dbCloud.collection('recharges')
              .where({ activityId: activityId })
              .orderBy('date', 'desc')
              .get();
            console.log('✅ 查询成功，返回数据:', rechargesRes);
          } catch (e) {
            queryError = e;
            console.log('⚠️ date字段排序失败，错误:', e);
            console.log('错误码:', e.errCode, '错误信息:', e.errMsg);
            
            // 如果date字段没有索引，使用createdAt排序
            try {
              console.log('📅 尝试使用createdAt排序查询...');
              rechargesRes = await dbCloud.collection('recharges')
                .where({ activityId: activityId })
                .orderBy('createdAt', 'desc')
                .get();
              console.log('✅ 查询成功，返回数据:', rechargesRes);
            } catch (e2) {
              queryError = e2;
              console.log('⚠️ createdAt排序也失败，错误:', e2);
              console.log('错误码:', e2.errCode, '错误信息:', e2.errMsg);
              
              // 如果createdAt也没有索引，尝试不使用排序
              try {
                console.log('📅 尝试不使用排序查询...');
                rechargesRes = await dbCloud.collection('recharges')
                  .where({ activityId: activityId })
                  .get();
                console.log('✅ 查询成功，返回数据:', rechargesRes);
              } catch (e3) {
                queryError = e3;
                console.error('❌ 所有查询方式都失败:', e3);
                console.error('错误码:', e3.errCode, '错误信息:', e3.errMsg);
                wx.showToast({
                  title: '加载充值记录失败，请检查数据库权限',
                  icon: 'none',
                  duration: 3000
                });
                rechargesRes = { data: [] };
              }
            }
          }
          
          recharges = rechargesRes.data || [];
          
          console.log('📊 查询结果统计:');
          console.log('  - 加载的充值记录数量:', recharges.length);
          console.log('  - 返回的原始数据:', rechargesRes);
          console.log('  - 充值记录详情:', recharges.map(r => ({ 
            _id: r._id, 
            payer: r.payer, 
            amount: r.amount, 
            creator: r.creator, 
            recorder: r.recorder,
            activityId: r.activityId
          })));
          
          // 如果充值记录数量为0，但活动是预存，可能是权限问题
          if (recharges.length === 0 && activity.isPrepaid) {
            console.warn('⚠️ 警告：预存活动但没有充值记录！');
            console.warn('可能的原因：');
            console.warn('  1. 数据库权限问题 - recharges集合可能设置为"仅创建者可读"');
            console.warn('  2. 确实没有充值记录');
            console.warn('  3. activityId不匹配');
            console.warn('当前查询的activityId:', activityId);
            
            // 尝试查询所有充值记录（不限制activityId）来测试权限
            try {
              console.log('🔍 测试：尝试查询所有充值记录（测试权限）...');
              const testRes = await dbCloud.collection('recharges').limit(1).get();
              console.log('✅ 权限测试结果 - 可以查询，返回:', testRes.data?.length || 0, '条记录');
            } catch (testErr) {
              console.error('❌ 权限测试失败:', testErr);
              console.error('这确认了是数据库权限问题！');
            }
          }
          
          // 如果没有排序，手动按日期倒序排序
          if (recharges.length > 0) {
            recharges.sort((a, b) => {
              const dateA = a.date ? (a.date.getTime ? a.date.getTime() : new Date(a.date).getTime()) : 
                           (a.createdAt ? (a.createdAt.getTime ? a.createdAt.getTime() : new Date(a.createdAt).getTime()) : 0);
              const dateB = b.date ? (b.date.getTime ? b.date.getTime() : new Date(b.date).getTime()) : 
                           (b.createdAt ? (b.createdAt.getTime ? b.createdAt.getTime() : new Date(b.createdAt).getTime()) : 0);
              return dateB - dateA; // 倒序
            });
          }
          
          // 计算充值总金额（所有充值记录的总和）
          totalRecharge = recharges.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
          console.log('充值总金额:', totalRecharge);
          
          // 计算剩余金额
          remaining = totalRecharge - totalConsume;
        } catch (e) {
          console.error('加载充值数据失败:', e);
          console.error('错误详情:', {
            message: e.message,
            errCode: e.errCode,
            errMsg: e.errMsg
          });
          
          // 如果是权限错误，提示用户
          if (e.errCode === -601034 || e.errMsg && e.errMsg.includes('权限')) {
            wx.showToast({
              title: '数据库权限不足，请检查recharges集合权限设置',
              icon: 'none',
              duration: 3000
            });
          }
        }
      }
      
      this.setData({
        activity,
        activityMeta,
        bills: processedBills,
        rawBills: bills, // 保存原始账单数据
        rawRecharges: recharges, // 保存原始充值数据
        members,
        total: this.formatAmount(total),
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
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
    }
    
    wx.hideLoading();
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
      const payerSurname = payer.charAt(0);
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
      const recorderSurname = recorder.charAt(0);
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
            surname: name.charAt(0),
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
    const map = {};
    members.forEach(m => {
      map[m.name] = { paid: 0, shouldPay: 0, balance: 0 };
    });
    
    // 如果是预存活动
    if (recharges.length > 0 && keeper) {
      console.log('计算实付 - 预存模式，保管人:', keeper);
      console.log('充值记录数量:', recharges.length);
      
      // 1. 预存人的实付 = 充值金额（充值记录中的payer）
      recharges.forEach(r => {
        const amount = Number(r.amount || 0);
        const payer = r.payer; // 预存人（充值的人）
        console.log(`充值记录 - 预存人: ${payer}, 金额: ${amount}`);
        if (payer && map[payer]) {
          map[payer].paid += amount;
          console.log(`更新预存人 ${payer} 的实付: ${map[payer].paid}`);
        }
      });
      
      // 2. 保管人的实付 = 账单付款金额（因为保管人实际支付了账单）
      bills.forEach(b => {
        const amount = Number(b.amount || 0);
        const billPayer = b.payer; // 账单付款人（通常是保管人）
        console.log(`账单 - 付款人: ${billPayer}, 金额: ${amount}`);
        if (billPayer && map[billPayer]) {
          map[billPayer].paid += amount;
          console.log(`更新付款人 ${billPayer} 的实付: ${map[billPayer].paid}`);
        }
      });
      
      // 3. 保管人的应付 = 收到的充值金额总和
      let keeperRechargeTotal = 0;
      recharges.forEach(r => {
        const amount = Number(r.amount || 0);
        if (r.keeper === keeper) {
          keeperRechargeTotal += amount;
        }
      });
      if (map[keeper]) {
        map[keeper].shouldPay = keeperRechargeTotal;
        console.log(`保管人 ${keeper} 的应付（充值总额）: ${keeperRechargeTotal}`);
      }
      
      // 4. 其他成员的应付按账单分摊计算（不包括保管人）
      bills.forEach(b => {
        if (b.splitDetail) {
          Object.keys(b.splitDetail).forEach(name => {
            if (!map[name] || name === keeper) return; // 跳过保管人
            // 只有权重大于0的成员才计算应付
            if (b.participants && b.participants[name] > 0) {
              map[name].shouldPay += Number(b.splitDetail[name] || 0);
            }
          });
        }
      });
    } else {
      // 非预存活动，实付为账单付款金额
      bills.forEach(b => {
        const amount = Number(b.amount || 0);
        if (b.payer && map[b.payer]) {
          map[b.payer].paid += amount;
        }
      });
      
      // 统计应付（所有活动都按账单分摊计算）
      bills.forEach(b => {
        if (b.splitDetail) {
          Object.keys(b.splitDetail).forEach(name => {
            if (!map[name]) return;
            // 只有权重大于0的成员才计算应付
            if (b.participants && b.participants[name] > 0) {
              map[name].shouldPay += Number(b.splitDetail[name] || 0);
            }
          });
        }
      });
    }
    
    // 余额：实付 - 应付
    Object.keys(map).forEach(name => {
      const v = map[name];
      v.balance = v.paid - v.shouldPay;
    });
    
    return map;
  },
  
  // 点击成员，展示该成员应付和实付账单列表
  onMemberTap(e) {
    const memberName = e.currentTarget.dataset.name;
    if (!memberName) return;
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
          return {
            _id: r._id,
            creator: r.creator,
            title: '充值',
            payer: r.payer || '未知', // 预存人（充值的人）
            totalAmount: this.formatAmount(r.amount || 0),
            userAmount: this.formatAmount(r.amount || 0), // 保管人收到的金额
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
          return {
            _id: b._id,
            creator: b.creator,
            isCreator: b.creator === userName, // 是否是账单创建者
            title: b.title || '未命名',
            payer: displayPayer, // 使用 billshow 或 payer 来显示
            totalAmount: this.formatAmount(b.amount || 0),
            userAmount: this.formatAmount(b.splitDetail[memberName] || 0),
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
          return {
            _id: r._id,
            creator: r.creator,
            title: '充值',
            payee: keeper || '保管人', // 收款人是保管人
            totalAmount: this.formatAmount(r.amount || 0),
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
          // 计算收款人（所有参与人中，除了付款人自己）
          const participants = b.participants ? Object.keys(b.participants).filter(name => 
            name !== memberName && b.participants[name] > 0
          ) : [];
          const payee = participants.length > 0 ? participants.join('、') : '无';
          const userName = db.getCurrentUser();
          
          return {
            _id: b._id,
            creator: b.creator,
            isCreator: b.creator === userName, // 是否是账单创建者
            title: b.title || '未命名',
            payee: payee,
            totalAmount: this.formatAmount(b.amount || 0),
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
          // 计算收款人（所有参与人中，除了付款人自己）
          const participants = b.participants ? Object.keys(b.participants).filter(name => 
            name !== memberName && b.participants[name] > 0
          ) : [];
          const payee = participants.length > 0 ? participants.join('、') : '无';
          const userName = db.getCurrentUser();
          
          return {
            _id: b._id,
            creator: b.creator,
            isCreator: b.creator === userName, // 是否是账单创建者
            title: b.title || '未命名',
            payee: payee,
            totalAmount: this.formatAmount(b.amount || 0),
            date: this.formatBillDate(b),
          };
        });
    }
    
    // 计算收入总额
    let incomeTotal = 0;
    if (isPrepaid && memberName === keeper) {
      // 预存模式下，保管人的收入 = 收到的充值金额
      rawRecharges.forEach(r => {
        const amount = Number(r.amount || 0);
        if (r.keeper === keeper) {
          incomeTotal += amount;
        }
      });
    } else {
      // 非预存模式或非保管人，收入 = 用户应付金额的总和
      incomeTotal = memberBills.reduce((sum, bill) => {
        // 解析格式化后的金额字符串
        const amount = Number(bill.userAmount || 0);
        return sum + amount;
      }, 0);
    }
    
    // 计算支出总额
    let expenseTotal = 0;
    if (isPrepaid && memberName === keeper) {
      // 预存模式下，保管人的支出 = 支付的账单总金额
      expenseTotal = memberPaidBills.reduce((sum, bill) => {
        // 解析格式化后的金额字符串
        const amount = Number(bill.totalAmount || 0);
        return sum + amount;
      }, 0);
    } else if (isPrepaid) {
      // 预存模式下，预存人的支出 = 充值金额
      rawRecharges.forEach(r => {
        const amount = Number(r.amount || 0);
        if (r.payer === memberName) {
          expenseTotal += amount;
        }
      });
    } else {
      // 非预存模式，支出 = 用户付款的账单总金额
      expenseTotal = memberPaidBills.reduce((sum, bill) => {
        // 解析格式化后的金额字符串
        const amount = Number(bill.totalAmount || 0);
        return sum + amount;
      }, 0);
    }
    
    // 计算余额（支出 - 收入）
    const balance = expenseTotal - incomeTotal;

    this.setData({
      selectedMemberBills: memberBills,
      selectedMemberPaidBills: memberPaidBills,
      selectedMemberName: memberName,
      selectedMemberIncome: this.formatAmount(incomeTotal), // 收入总额
      selectedMemberExpense: this.formatAmount(expenseTotal), // 支出总额
      selectedMemberBalance: this.formatAmount(balance), // 余额
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
        url: `/pages/bill/edit?activityId=${this.data.activityId}&billId=${bill._id}&readOnly=${!isCreator}`
      });
    }
  },

  // 计算日期范围
  calculateDateRange(bills) {
    if (bills.length === 0) return '至今';
    
    let earliestDate = null;
    bills.forEach(b => {
      const billDate = b.time ? (b.time.getTime ? b.time : new Date(b.time)) : 
                      (b.createdAt ? (b.createdAt.getTime ? b.createdAt : new Date(b.createdAt)) : null);
      if (billDate) {
        if (!earliestDate || billDate < earliestDate) {
          earliestDate = billDate;
        }
      }
    });
    
    if (!earliestDate) return '至今';
    
    const formatDate = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    const today = new Date();
    return `${formatDate(earliestDate)} 至 ${formatDate(today)}`;
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
    wx.navigateTo({
      url: `/pages/bill/edit?activityId=${this.data.activityId}`
    });
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
            const dbCloud = wx.cloud.database();
            
            // 如果是预存模式，先检查账单是否有关联的充值记录
            if (this.data.isPrepaid) {
              try {
                const billDoc = await dbCloud.collection('bills').doc(billId).get();
                const bill = billDoc.data;
                
                // 如果账单有关联的充值记录ID，删除对应的充值记录
                if (bill && bill.relatedRechargeId) {
                  try {
                    await dbCloud.collection('recharges').doc(bill.relatedRechargeId).remove();
                    console.log('已同步删除关联的充值记录:', bill.relatedRechargeId);
                  } catch (rechargeErr) {
                    console.error('删除关联充值记录失败:', rechargeErr);
                    // 继续删除账单，不因为充值记录删除失败而阻止
                  }
                }
              } catch (billErr) {
                console.error('获取账单信息失败:', billErr);
                // 继续删除账单
              }
            }
            
            // 删除账单
            const result = await db.deleteBill(billId);
            if (result.success) {
              wx.hideLoading();
              wx.showToast({
                title: '删除成功',
                icon: 'success'
              });
              this.loadActivityData();
            } else {
              throw new Error(result.error);
            }
          } catch (e) {
            wx.hideLoading();
            console.error('删除账单失败:', e);
            wx.showToast({
              title: '删除失败',
              icon: 'none'
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

    const lastDownloadAt = this.getLastPdfDownloadAt(activity);
    if (!lastDownloadAt) return;

    const now = Date.now();
    const diffDays = Math.floor((now - lastDownloadAt) / (24 * 60 * 60 * 1000));
    if (diffDays < 7) return;

    this.setData({ pdfReminderShown: true });
    wx.showModal({
      title: '下载提醒',
      content: `已${diffDays}天未下载活动信息，是否现在下载？`,
      success: (res) => {
        if (res.confirm) {
          this.downloadActivityPdf();
        }
      }
    });
  },

  getPdfDownloadKey() {
    const userName = db.getCurrentUser() || 'guest';
    return `aa_activity_pdf_last_download_${userName}_${this.data.activityId}`;
  },

  getLastPdfDownloadAt(activity) {
    const key = this.getPdfDownloadKey();
    const stored = wx.getStorageSync(key);
    if (stored) return stored;

    const activityDate = activity.updatedAt || activity.createdAt;
    if (!activityDate) return 0;
    const date = activityDate.getTime ? activityDate : new Date(activityDate);
    const time = date.getTime();
    return Number.isNaN(time) ? 0 : time;
  },

  setLastPdfDownloadAt(timestamp) {
    const key = this.getPdfDownloadKey();
    wx.setStorageSync(key, timestamp);
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
      const chunkCount = Math.ceil(pageData.pages.length / 30);
      progressTotal = chunkCount * 3 + 1;
      updateTargetBySteps(progressDone, progressTotal);
      if (pageData.pages.length > 30) {
        await new Promise((resolve) => {
          wx.showModal({
            title: '提示',
            content: `当前共 ${pageData.pages.length} 页，将按每30页自动分卷导出。`,
            confirmText: '知道了',
            showCancel: false,
            success: () => resolve()
          });
        });
      }
      const savedPaths = [];
      const savedNames = [];
      for (let i = 0; i < chunkCount; i++) {
        const start = i * 30;
        const end = start + 30;
        const chunkPages = pageData.pages.slice(start, end);
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

        startDrift(82, 1, 180);
        let tempUrlRes;
        try {
          tempUrlRes = await wx.cloud.getTempFileURL({ fileList: [fileID] });
          console.log('[PDF] tempUrlRes:', tempUrlRes);
        } catch (e) {
          console.error('[PDF] getTempFileURL failed:', e);
          throw e;
        }
        const tempUrl = tempUrlRes && tempUrlRes.fileList && tempUrlRes.fileList[0] && tempUrlRes.fileList[0].tempFileURL;
        if (!tempUrl) {
          throw new Error('获取下载链接失败');
        }

        startDrift(88, 1, 180);
        let downloadRes;
        try {
          downloadRes = await new Promise((resolve, reject) => {
            wx.downloadFile({
              url: tempUrl,
              success: resolve,
              fail: reject
            });
          });
          console.log('[PDF] download status:', downloadRes && downloadRes.statusCode);
          console.log('[PDF] download path:', downloadRes && downloadRes.tempFilePath);
        } catch (e) {
          console.error('[PDF] downloadFile failed:', e);
          throw e;
        }
        progressDone += 1;
        updateTargetBySteps(progressDone, progressTotal);

        const partName = chunkCount > 1 ? `${baseName}-${String(i + 1).padStart(2, '0')}.pdf` : fileName;
        startDrift(93, 1, 200);
        const savedPath = await this.savePdfFile(downloadRes.tempFilePath, partName);
        savedPaths.push(savedPath);
        savedNames.push(partName);
        progressDone += 1;
        updateTargetBySteps(progressDone, progressTotal);
        setTarget(96);

        wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
      }

      this.setLastPdfDownloadAt(Date.now());
      this.setData({ pdfReminderShown: true });

      progressDone += 1;
      updateTargetBySteps(progressDone, progressTotal);
      setTarget(100);
      stopProgress();
      wx.hideLoading();
      const nameLine = savedNames.length > 1 ? `文件名：\n${savedNames.join('\n')}` : `文件名：${savedNames[0] || fileName}`;
      const guideText = `${nameLine}\n如需保存在本地：\n1) 在预览页右上角点击“...”\n2) 选择“转发给朋友”或“保存到手机”`;
      this._pendingPdfPath = savedPaths[0] || '';
      this.setData({
        showPdfGuideModal: true,
        pdfGuideText: guideText
      });

      // 云端文件已在下载后删除
    } catch (e) {
      console.error('导出PDF失败:', e);
      stopProgress();
      wx.hideLoading();
      wx.showToast({ title: '生成失败', icon: 'none' });
    }
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

  buildPdfPages(fileName) {
    const activity = this.data.activity || {};
    const bills = this.data.rawBills || [];
    const members = this.data.members || [];
    const rawRecharges = this.data.rawRecharges || [];
    const isPrepaid = this.data.isPrepaid || false;
    const keeper = this.data.keeper || '';
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

    const detailMap = {};
    const noIncomeExpenseMembers = [];
    members.forEach((m) => {
      const name = m.name || '';
      if (!name) return;
      const details = this.buildMemberBillDetails(name, bills, rawRecharges, isPrepaid, keeper);
      detailMap[name] = details;
      if (details.incomeBills.length === 0 && details.expenseBills.length === 0) {
        noIncomeExpenseMembers.push(name);
      }
    });

    // 活动信息
    addTitle('活动信息');
    const activityName = activity.name || '未命名活动';
    const creator = activity.creator || '';
    const memberNames = (activity.members || []).map(m => m.name || m).join('、');
    const prepaidInfo = activity.isPrepaid ? `预存活动（保管人：${activity.keeper || '未设置'}）` : '非预存活动';
    const exportTime = this.formatExportTime(new Date());

    addText(`活动名称：${activityName}`);
    addText(`活动类型：${activity.type || '未设置'}`);
    addText(`创建者：${creator}`);
    addText(`成员：${memberNames || '无'}`);
    addText(`活动属性：${prepaidInfo}`);
    addText(`账单范围：${this.data.dateRange || '至今'}，账单数量：${bills.length} 条`);
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
          ? Object.keys(bill.participants).filter(name => bill.participants[name] > 0).join('、')
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
    addText(`总支出：¥${this.data.total}，人均：¥${this.data.avg}`);
    const memberColName = 140;
    const memberColPaid = 160;
    const memberColShould = 160;
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
        { text: name, x: 0, width: memberColName },
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
      const details = detailMap[memberName] || this.buildMemberBillDetails(memberName, bills, rawRecharges, isPrepaid, keeper);

      addMemberTitle(`${memberName} 结算信息`);

      const incomeTotal = details.incomeBills.reduce((sum, b) => sum + Number(b.amount || 0), 0);
      const expenseTotal = details.expenseBills.reduce((sum, b) => sum + Number(b.amount || 0), 0);
      const balance = this.formatAmount(Number(m.bal ? m.bal.balance : 0));
      pushLine({ type: 'text', text: `收入：¥${this.formatAmount(incomeTotal)}  支出：¥${this.formatAmount(expenseTotal)}  余额：¥${balance}`, fontSize: 20, color: '#111111', bold: false });

      addBoldText(`${memberName} 收入信息`);
      const incomeColTitle = 260;
      const incomeColCounter = 200;
      const incomeColAmount = 110;
      const incomeColDate = pageWidth - padding * 2 - incomeColTitle - incomeColCounter - incomeColAmount;
      addRow([
        { text: '名称', x: 0, width: incomeColTitle },
        { text: '付款人', x: incomeColTitle, width: incomeColCounter },
        { text: '金额', x: incomeColTitle + incomeColCounter, width: incomeColAmount },
        { text: '日期', x: incomeColTitle + incomeColCounter + incomeColAmount, width: incomeColDate }
      ], 18);
      if (details.incomeBills.length === 0) {
        addText('暂无记录');
      } else {
        details.incomeBills.forEach((row) => {
          addRow([
            { text: row.title || '未命名', x: 0, width: incomeColTitle },
            { text: row.payer || '', x: incomeColTitle, width: incomeColCounter, wrap: true },
            { text: `¥${row.amount || '0.0'}`, x: incomeColTitle + incomeColCounter, width: incomeColAmount },
            { text: row.date || '', x: incomeColTitle + incomeColCounter + incomeColAmount, width: incomeColDate }
          ], 18);
        });
      }

      addBoldText(`${memberName} 支出信息`);
      const expenseColTitle = 260;
      const expenseColCounter = 200;
      const expenseColAmount = 110;
      const expenseColDate = pageWidth - padding * 2 - expenseColTitle - expenseColCounter - expenseColAmount;
      addRow([
        { text: '名称', x: 0, width: expenseColTitle },
        { text: '收款人', x: expenseColTitle, width: expenseColCounter },
        { text: '金额', x: expenseColTitle + expenseColCounter, width: expenseColAmount },
        { text: '日期', x: expenseColTitle + expenseColCounter + expenseColAmount, width: expenseColDate }
      ], 18);
      if (details.expenseBills.length === 0) {
        addText('暂无记录');
      } else {
        details.expenseBills.forEach((row) => {
          addRow([
            { text: row.title || '未命名', x: 0, width: expenseColTitle },
            { text: row.payee || '', x: expenseColTitle, width: expenseColCounter, wrap: true },
            { text: `¥${row.amount || '0.0'}`, x: expenseColTitle + expenseColCounter, width: expenseColAmount },
            { text: row.date || '', x: expenseColTitle + expenseColCounter + expenseColAmount, width: expenseColDate }
          ], 18);
        });
      }

      pushBlank();
    });

    if (noIncomeExpenseMembers.length > 0) {
      addGreenNote(`${noIncomeExpenseMembers.join('、')} 没有产生收入和支出`);
    }

    return { pages, pageWidth, pageHeight, padding, lineHeight };
  },

  renderPdfPage(ctx, lines, padding, lineHeight) {
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


  buildMemberBillDetails(memberName, rawBills, rawRecharges, isPrepaid, keeper) {
    let incomeBills = [];
    let expenseBills = [];

    if (isPrepaid && memberName === keeper) {
      incomeBills = rawRecharges
        .filter(r => r.keeper === keeper)
        .map(r => ({
          title: '充值',
          payer: r.payer || '未知',
          amount: this.formatAmount(r.amount || 0),
          date: this.formatRechargeDate(r),
          isRecharge: true
        }));
    } else {
      incomeBills = rawBills
        .filter(b => b && b.splitDetail && b.participants && b.participants[memberName] !== undefined && b.participants[memberName] > 0 && b.splitDetail[memberName] !== undefined)
        .map(b => {
          const displayPayer = (b.billshow || b.payer) || '未知';
          return {
            title: b.title || '未命名',
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
        .map(r => ({
          title: '充值',
          payee: r.keeper || keeper || '未知',
          amount: this.formatAmount(r.amount || 0),
          date: this.formatRechargeDate(r),
          isRecharge: true
        }));
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
            if (b.participants[name] > 0) {
              payeeList.push(name);
            }
          });
        }
        return {
          title: b.title || '未命名',
          payee: payeeList.length > 0 ? payeeList.join('、') : '未知',
          amount: this.formatAmount(b.amount || 0),
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
            await db.deleteActivity(this.data.activityId);
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
            console.log('🗑️ 开始删除充值记录，rechargeId:', rechargeId);
            console.log('当前用户:', userName, '创建者:', recharge.creator);
            
            const dbCloud = wx.cloud.database();
            await dbCloud.collection('recharges').doc(rechargeId).remove();
            
            console.log('✅ 删除成功');
            wx.hideLoading();
            wx.showToast({
              title: '删除成功',
              icon: 'success'
            });
            this.loadActivityData();
          } catch (e) {
            console.error('❌ 删除失败:', e);
            console.error('错误码:', e.errCode, '错误信息:', e.errMsg);
            wx.hideLoading();
            
            // 根据错误类型显示不同的提示
            let errorMsg = '删除失败';
            if (e.errCode === -601034 || (e.errMsg && e.errMsg.includes('权限'))) {
              errorMsg = '删除失败：数据库权限不足，请检查recharges集合的删除权限设置';
            } else if (e.errMsg) {
              errorMsg = `删除失败：${e.errMsg}`;
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
