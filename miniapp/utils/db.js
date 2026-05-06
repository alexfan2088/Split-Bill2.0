// utils/db.js
// 初始化云开发数据库
let db;
try {
  db = wx.cloud.database({
    env: 'cloud1-2gmpataie7b260ad' // 小程序专用云开发环境ID
  });
} catch (e) {
  console.error('数据库初始化失败:', e);
  db = wx.cloud.database();
}

// 密码哈希函数（与Web版本保持一致）
function hashPassword(password) {
  // 简单的 base64 编码（与Web版本保持一致）
  // Web版本使用: btoa(unescape(encodeURIComponent(password)))
  // 小程序环境需要手动实现 base64 编码
  try {
    // 将字符串转换为 UTF-8 字节数组
    const utf8Bytes = [];
    for (let i = 0; i < password.length; i++) {
      const charCode = password.charCodeAt(i);
      if (charCode < 0x80) {
        utf8Bytes.push(charCode);
      } else if (charCode < 0x800) {
        utf8Bytes.push(0xc0 | (charCode >> 6));
        utf8Bytes.push(0x80 | (charCode & 0x3f));
      } else {
        utf8Bytes.push(0xe0 | (charCode >> 12));
        utf8Bytes.push(0x80 | ((charCode >> 6) & 0x3f));
        utf8Bytes.push(0x80 | (charCode & 0x3f));
      }
    }
    
    // Base64 编码
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;
    
    while (i < utf8Bytes.length) {
      const a = utf8Bytes[i++];
      const b = i < utf8Bytes.length ? utf8Bytes[i++] : 0;
      const c = i < utf8Bytes.length ? utf8Bytes[i++] : 0;
      
      const bitmap = (a << 16) | (b << 8) | c;
      
      result += base64Chars.charAt((bitmap >> 18) & 63);
      result += base64Chars.charAt((bitmap >> 12) & 63);
      result += i - 2 < utf8Bytes.length ? base64Chars.charAt((bitmap >> 6) & 63) : '=';
      result += i - 1 < utf8Bytes.length ? base64Chars.charAt(bitmap & 63) : '=';
    }
    
    return result;
  } catch (e) {
    console.error('密码哈希失败:', e);
    // 如果出错，返回原密码（不应该发生）
    return password;
  }
}

// 获取当前用户信息
function getCurrentUser() {
  return wx.getStorageSync('aa_user_name') || '';
}

// 获取当前用户密码哈希（用于跨设备鉴权）
function getCurrentUserPasswordHash() {
  return wx.getStorageSync('aa_user_password') || '';
}

// 用户登录（验证密码）
async function login(userName, password) {
  try {
    if (!wx.cloud) {
      throw new Error('云开发未初始化，请检查 app.js 中的云开发配置');
    }
    
    // 检查用户是否存在
    // 添加更详细的错误处理
    let userRes;
    try {
      userRes = await db.collection('users')
        .where({ name: userName })
        .limit(1)
        .get();
    } catch (dbError) {
      console.error('数据库查询失败:', dbError);
      // 如果是权限错误，提供更详细的提示
      if (dbError.errCode === -601034) {
        throw new Error('数据库权限错误：小程序AppID未在云开发环境中授权。\n\n解决方法：\n1. 在云开发控制台的环境设置中授权小程序AppID\n2. 或在微信开发者工具中开通云开发');
      }
      throw dbError;
    }
    
    if (userRes.data.length === 0) {
      return { success: false, error: '用户不存在', needRegister: true };
    }
    
    const existingUser = userRes.data[0];
    
    // 处理密码：检查本地存储的密码或使用输入的密码
    const savedPasswordHashed = wx.getStorageSync('aa_user_password') || '';
    const savedPasswordPlain = wx.getStorageSync('aa_user_password_plain') || '';
    const savedUserName = wx.getStorageSync('aa_user_name') || '';
    
    let passwordToUse = null;
    let plainPasswordToSave = null;
    
    if (!password && savedPasswordHashed && savedUserName === userName) {
      // 使用本地保存的哈希密码
      passwordToUse = savedPasswordHashed;
      plainPasswordToSave = savedPasswordPlain;
    } else if (password === savedPasswordPlain && savedPasswordPlain) {
      // 用户输入的是保存的原始密码
      passwordToUse = savedPasswordHashed;
      plainPasswordToSave = savedPasswordPlain;
    } else if (password) {
      // 用户输入了新密码，需要哈希
      passwordToUse = hashPassword(password);
      plainPasswordToSave = password;
    } else {
      return { success: false, error: '请输入密码', needPassword: true };
    }
    
    // 验证密码
    if (existingUser.password === passwordToUse) {
      // 密码正确，登录成功
      
      // 保存到本地存储
      wx.setStorageSync('aa_user_name', userName);
      wx.setStorageSync('aa_user_password', passwordToUse);
      if (plainPasswordToSave) {
        wx.setStorageSync('aa_user_password_plain', plainPasswordToSave);
      }

      // 记录最近一次登录时间（仅用于后台查看，不影响界面）
      try {
        await db.collection('users').doc(existingUser._id).update({
          data: {
            lastLoginAt: new Date(),
            updatedAt: new Date()
          }
        });
      } catch (e) {
        console.log('更新 lastLoginAt 失败（可忽略）:', e);
      }
      
      return { success: true, userName };
    } else {
      // 密码错误
      return { success: false, error: '密码错误', wrongPassword: true };
    }
  } catch (e) {
    console.error('登录失败:', e);
    return { 
      success: false, 
      error: e.message || '登录失败，请检查云开发配置和数据库权限'
    };
  }
}

// 用户注册
async function register(userName, password, confirmPassword) {
  try {
    if (!wx.cloud) {
      throw new Error('云开发未初始化，请检查 app.js 中的云开发配置');
    }
    
    // 检查用户是否已存在
    let userRes;
    try {
      userRes = await db.collection('users')
        .where({ name: userName })
        .limit(1)
        .get();
    } catch (dbError) {
      console.error('数据库查询失败:', dbError);
      if (dbError.errCode === -601034) {
        throw new Error('数据库权限错误：小程序AppID未在云开发环境中授权。\n\n解决方法：\n1. 在云开发控制台的环境设置中授权小程序AppID\n2. 或在微信开发者工具中开通云开发');
      }
      throw dbError;
    }
    
    if (userRes.data.length > 0) {
      return { success: false, error: '用户名已存在，请登录', userExists: true };
    }
    
    // 验证密码
    if (!password) {
      return { success: false, error: '请设置密码（至少6位）', needPassword: true };
    }
    
    if (password.length < 6) {
      return { success: false, error: '密码长度至少6位' };
    }
    
    if (!confirmPassword) {
      return { success: false, error: '请确认密码', needConfirmPassword: true };
    }
    
    if (password !== confirmPassword) {
      return { success: false, error: '两次输入的密码不一致' };
    }
    
    // 创建新用户
    const hashedPassword = hashPassword(password);
    await db.collection('users').add({
      data: {
        name: userName,
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: new Date()
      }
    });
    
    // 保存到本地存储
    wx.setStorageSync('aa_user_name', userName);
    wx.setStorageSync('aa_user_password', hashedPassword);
    wx.setStorageSync('aa_user_password_plain', password);
    
    return { success: true, userName };
  } catch (e) {
    console.error('注册失败:', e);
    return { 
      success: false, 
      error: e.message || '注册失败，请检查云开发配置和数据库权限'
    };
  }
}

// 获取活动列表
async function getActivities() {
  const userName = getCurrentUser();
  if (!userName) {
    return [];
  }
  
  try {
    const res = await db.collection('activities')
      .where({
        memberNames: db.command.in([userName])
      })
      .get();
    return res.data || [];
  } catch (e) {
    console.error('获取活动列表失败:', e);
    wx.showToast({
      title: '加载失败',
      icon: 'none'
    });
    return [];
  }
}

// 获取账单列表
async function getBills(activityId) {
  try {
    const res = await db.collection('bills')
      .where({ activityId })
      .orderBy('time', 'desc')
      .get();
    return res.data || [];
  } catch (e) {
    console.error('获取账单列表失败:', e);
    return [];
  }
}

// 保存账单
async function saveBill(billData) {
  try {
    const userName = getCurrentUser();
    const result = await db.collection('bills').add({
      data: {
        ...billData,
        creator: userName,
        createdAt: new Date(),
      }
    });
    return { success: true, id: result._id };
  } catch (e) {
    console.error('保存账单失败:', e);
    wx.showToast({
      title: '保存失败',
      icon: 'none'
    });
    return { success: false, error: e.message };
  }
}

// 更新账单
async function updateBill(billId, billData) {
  try {
    await db.collection('bills').doc(billId).update({
      data: {
        ...billData,
        updatedAt: new Date(),
      }
    });
    return { success: true };
  } catch (e) {
    console.error('更新账单失败:', e);
    wx.showToast({
      title: '更新失败',
      icon: 'none'
    });
    return { success: false, error: e.message };
  }
}

// 删除账单
async function deleteBill(billId) {
  try {
    await db.collection('bills').doc(billId).remove();
    return { success: true };
  } catch (e) {
    console.error('删除账单失败:', e);
    return { success: false, error: e.message, errCode: e.errCode, errMsg: e.errMsg };
  }
}

// 删除活动（同时删除关联的账单和group）
async function deleteActivity(activityId) {
  try {
    // 1. 先删除该活动下的所有账单
    try {
      const billsRes = await db.collection('bills')
        .where({ activityId: activityId })
        .get();
      
      if (billsRes.data && billsRes.data.length > 0) {
        console.log(`删除活动 ${activityId} 下的 ${billsRes.data.length} 个账单`);
        // 批量删除账单
        const deletePromises = billsRes.data.map(bill => 
          db.collection('bills').doc(bill._id).remove()
        );
        await Promise.all(deletePromises);
        console.log('所有账单已删除');
      }
    } catch (e) {
      console.error('删除账单失败:', e);
      // 继续删除活动，不因为账单删除失败而中断
    }
    
    // 2. 删除关联的充值记录（预存记录）
    try {
      const rechargesRes = await db.collection('recharges')
        .where({ activityId: activityId })
        .get();
      
      if (rechargesRes.data && rechargesRes.data.length > 0) {
        console.log(`删除活动 ${activityId} 下的 ${rechargesRes.data.length} 条充值记录`);
        // 批量删除充值记录
        const deletePromises = rechargesRes.data.map(recharge => 
          db.collection('recharges').doc(recharge._id).remove()
        );
        await Promise.all(deletePromises);
        console.log('所有充值记录已删除');
      }
    } catch (e) {
      console.error('删除充值记录失败:', e);
      // 继续删除活动，不因为充值记录删除失败而中断
    }
    
    // 3. 删除关联的group
    try {
      const groupsRes = await db.collection('groups')
        .where({ activityId: activityId })
        .get();
      
      if (groupsRes.data && groupsRes.data.length > 0) {
        console.log(`删除活动 ${activityId} 下的 ${groupsRes.data.length} 个group`);
        const deletePromises = groupsRes.data.map(group => 
          db.collection('groups').doc(group._id).remove()
        );
        await Promise.all(deletePromises);
        console.log('所有group已删除');
      }
    } catch (e) {
      console.error('删除group失败:', e);
      // 继续删除活动，不因为group删除失败而中断
    }
    
    // 4. 最后删除活动本身
    await db.collection('activities').doc(activityId).remove();
    console.log('活动已删除');
    
    return { success: true };
  } catch (e) {
    console.error('删除活动失败:', e);
    return { success: false, error: e.message };
  }
}

// 获取充值列表
async function getRecharges(activityId) {
  try {
    const res = await db.collection('recharges')
      .where({ activityId })
      .orderBy('date', 'desc')
      .get();
    return res.data || [];
  } catch (e) {
    console.error('获取充值列表失败:', e);
    return [];
  }
}

// 保存充值
async function saveRecharge(rechargeData) {
  try {
    const userName = getCurrentUser();
    const result = await db.collection('recharges').add({
      data: {
        ...rechargeData,
        creator: userName,
        createdAt: new Date()
      }
    });
    return { success: true, id: result._id };
  } catch (e) {
    console.error('保存充值失败:', e);
    wx.showToast({
      title: '保存失败',
      icon: 'none'
    });
    return { success: false, error: e.message };
  }
}

// 删除充值
async function deleteRecharge(rechargeId) {
  try {
    await db.collection('recharges').doc(rechargeId).remove();
    return { success: true };
  } catch (e) {
    console.error('删除充值失败:', e);
    wx.showToast({
      title: '删除失败',
      icon: 'none'
    });
    return { success: false, error: e.message };
  }
}

module.exports = {
  getCurrentUser,
  getCurrentUserPasswordHash,
  hashPassword,
  login,
  register,
  getActivities,
  getBills,
  saveBill,
  updateBill,
  deleteBill,
  deleteActivity,
  getRecharges,
  saveRecharge,
  deleteRecharge,
};
