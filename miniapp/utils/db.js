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

function validateUserName(userName) {
  const value = String(userName || '').trim();
  if (!value) return '请输入用户名';
  if (value.length < 2 || value.length > 20) return '用户名长度应为2至20个字符';
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(value)) {
    return '用户名仅支持中文、字母、数字和下划线';
  }
  return '';
}

// 获取当前用户信息
function getCurrentUser() {
  return wx.getStorageSync('aa_user_name') || '';
}

// 获取当前用户密码哈希（用于跨设备鉴权）
function getCurrentUserPasswordHash() {
  return wx.getStorageSync('aa_user_password') || '';
}

// 历史密码值使用可逆 Base64 编码保存，供登录页回填已有凭据。
function decodeStoredPassword(encodedPassword) {
  if (!encodedPassword) {
    return '';
  }

  try {
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = [];
    let bitmap = 0;
    let bits = 0;

    for (let i = 0; i < encodedPassword.length; i++) {
      const char = encodedPassword.charAt(i);
      if (char === '=') {
        break;
      }

      const value = base64Chars.indexOf(char);
      if (value < 0) {
        return '';
      }

      bitmap = (bitmap << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((bitmap >> bits) & 0xff);
      }
    }

    const encodedUtf8 = bytes.map(byte => `%${byte.toString(16).padStart(2, '0')}`).join('');
    return decodeURIComponent(encodedUtf8);
  } catch (e) {
    return '';
  }
}

function getSavedLoginPassword() {
  const savedPlainPassword = wx.getStorageSync('aa_user_password_plain') || '';
  return savedPlainPassword || decodeStoredPassword(getCurrentUserPasswordHash());
}

async function fetchAll(collection, query, options = {}) {
  const limit = options.limit || 20;
  let all = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    let request = collection.where(query);
    if (options.orderBy && options.orderBy.field) {
      request = request.orderBy(options.orderBy.field, options.orderBy.direction || 'desc');
    }

    const res = await request.skip(skip).limit(limit).get();
    const data = res.data || [];
    all = all.concat(data);

    if (data.length < limit) {
      hasMore = false;
    } else {
      skip += limit;
    }
  }

  return all;
}

async function deleteManyByActivityId(collectionName, activityId) {
  const records = await fetchAll(db.collection(collectionName), { activityId });
  if (records.length === 0) {
    return 0;
  }

  await Promise.all(records.map(record => (
    db.collection(collectionName).doc(record._id).remove()
  )));

  return records.length;
}

// 用户登录（验证密码）
async function login(userName, password) {
  try {
    if (!wx.cloud) {
      throw new Error('云开发未初始化，请检查 app.js 中的云开发配置');
    }

    if (!password) {
      return { success: false, error: '请输入密码', needPassword: true };
    }
    
    const res = await wx.cloud.callFunction({ name: 'login', data: { action: 'login', userName, password } });
    const result = (res && res.result) || {};
    if (result.success) {
      const passwordToUse = hashPassword(password);
      // 保存到本地存储
      wx.setStorageSync('aa_user_name', userName);
      wx.setStorageSync('aa_user_password', passwordToUse);
      wx.setStorageSync('aa_user_password_plain', password);

      return { success: true, userName, needsSecuritySetup: !!result.needsSecuritySetup };
    }
    return result;
  } catch (e) {
    console.error('登录失败:', e);
    return { 
      success: false, 
      error: e.message || '登录失败，请检查云开发配置和数据库权限'
    };
  }
}

// 用户注册
async function register(userName, password, confirmPassword, securityQuestion, securityAnswer) {
  try {
    if (!wx.cloud) {
      throw new Error('云开发未初始化，请检查 app.js 中的云开发配置');
    }

    const res = await wx.cloud.callFunction({
      name: 'login',
      data: { action: 'register', userName, password, confirmPassword, securityQuestion, securityAnswer }
    });
    const result = (res && res.result) || {};
    if (!result.success) return result;
    const hashedPassword = hashPassword(password);
    
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

async function getSecurityQuestion(userName) {
  const res = await wx.cloud.callFunction({ name: 'login', data: { action: 'getSecurityQuestion', userName } });
  return (res && res.result) || { success: false, error: '获取密保问题失败' };
}

async function setupSecurity(userName, password, securityQuestion, securityAnswer) {
  const res = await wx.cloud.callFunction({ name: 'login', data: { action: 'setupSecurity', userName, password, securityQuestion, securityAnswer } });
  return (res && res.result) || { success: false, error: '保存密保失败' };
}

async function resetPassword(userName, securityAnswer, password, confirmPassword) {
  const res = await wx.cloud.callFunction({ name: 'login', data: { action: 'resetPassword', userName, securityAnswer, password, confirmPassword } });
  const result = (res && res.result) || { success: false, error: '重置密码失败' };
  if (result.success) {
    wx.setStorageSync('aa_user_name', userName);
    wx.setStorageSync('aa_user_password', hashPassword(password));
    wx.setStorageSync('aa_user_password_plain', password);
  }
  return result;
}

// 获取活动列表
async function getActivities() {
  const userName = getCurrentUser();
  if (!userName) {
    return [];
  }
  
  try {
    return await fetchAll(db.collection('activities'), {
      memberNames: db.command.in([userName])
    });
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
    return await fetchAll(db.collection('bills'), { activityId }, {
      orderBy: { field: 'time', direction: 'desc' }
    });
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

// 删除活动（同时删除关联的账单、充值记录和group）
async function deleteActivity(activityId) {
  try {
    const deletedBills = await deleteManyByActivityId('bills', activityId);
    console.log(`删除活动 ${activityId} 下的 ${deletedBills} 个账单`);

    const deletedRecharges = await deleteManyByActivityId('recharges', activityId);
    console.log(`删除活动 ${activityId} 下的 ${deletedRecharges} 条充值记录`);

    const deletedGroups = await deleteManyByActivityId('groups', activityId);
    console.log(`删除活动 ${activityId} 下的 ${deletedGroups} 个group`);
    
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
    return await fetchAll(db.collection('recharges'), { activityId }, {
      orderBy: { field: 'date', direction: 'desc' }
    });
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
  getSavedLoginPassword,
  hashPassword,
  login,
  register,
  getSecurityQuestion,
  setupSecurity,
  resetPassword,
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
