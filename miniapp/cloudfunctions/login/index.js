// 云函数：处理用户登录/注册
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 密码哈希函数（与Web版本保持一致）
function hashPassword(password) {
  try {
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

function normalizeSecurityAnswer(answer) {
  return String(answer || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hashSecurityAnswer(answer) {
  return hashPassword(`security-answer:${normalizeSecurityAnswer(answer)}`);
}

function validateSecurityInfo(question, answer) {
  const safeQuestion = String(question || '').trim();
  const safeAnswer = String(answer || '').trim();
  if (safeQuestion.length < 2 || safeQuestion.length > 60) return '密保问题长度应为2至60个字符';
  if (safeAnswer.length < 2 || safeAnswer.length > 60) return '密保答案长度应为2至60个字符';
  return '';
}

exports.main = async (event, context) => {
  const { action, userName, password, confirmPassword, securityQuestion, securityAnswer } = event;
  
  try {
    if (action === 'checkUser') {
      // 检查用户是否存在
      const userRes = await db.collection('users')
        .where({ name: userName })
        .limit(1)
        .get();
      
      return {
        success: true,
        userExists: userRes.data.length > 0
      };
    }
    
    if (action === 'login') {
      // 登录：验证密码
      if (!password) {
        return {
          success: false,
          error: '请输入密码',
          needPassword: true
        };
      }

      const userRes = await db.collection('users')
        .where({ name: userName })
        .limit(1)
        .get();
      
      if (userRes.data.length === 0) {
        return {
          success: false,
          error: '用户不存在',
          needRegister: true
        };
      }
      
      const existingUser = userRes.data[0];
      const hashedPassword = hashPassword(password);
      
      if (existingUser.password === hashedPassword) {
        // 记录最近一次登录时间（仅用于后台查看）
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

        return {
          success: true,
          userName: userName,
          needsSecuritySetup: !existingUser.securityQuestion || !existingUser.securityAnswerHash
        };
      } else {
        return {
          success: false,
          error: '密码错误',
          wrongPassword: true
        };
      }
    }
    
    if (action === 'register') {
      // 注册：创建新用户
      const userNameError = validateUserName(userName);
      if (userNameError) {
        return {
          success: false,
          error: userNameError,
          invalidUserName: true
        };
      }

      // 检查用户是否已存在
      const userRes = await db.collection('users')
        .where({ name: userName })
        .limit(1)
        .get();
      
      if (userRes.data.length > 0) {
        return {
          success: false,
          error: '用户名已存在，请登录',
          userExists: true
        };
      }
      
      // 验证密码
      if (!password || password.length < 6) {
        return {
          success: false,
          error: '密码长度至少6位'
        };
      }
      
      if (password !== confirmPassword) {
        return {
          success: false,
          error: '两次输入的密码不一致'
        };
      }

      const securityError = validateSecurityInfo(securityQuestion, securityAnswer);
      if (securityError) return { success: false, error: securityError };
      
      // 创建新用户
      const hashedPassword = hashPassword(password);
      await db.collection('users').add({
        data: {
          name: userName,
          password: hashedPassword,
          securityQuestion: String(securityQuestion).trim(),
          securityAnswerHash: hashSecurityAnswer(securityAnswer),
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: new Date()
        }
      });
      
      return {
        success: true,
        userName: userName
      };
    }

    if (action === 'getSecurityQuestion') {
      const userRes = await db.collection('users').where({ name: userName }).limit(1).get();
      if (!userRes.data.length) return { success: false, error: '用户不存在' };
      const user = userRes.data[0];
      if (!user.securityQuestion || !user.securityAnswerHash) {
        return { success: false, error: '该账号尚未设置密保，请联系管理员重置密码' };
      }
      return { success: true, securityQuestion: user.securityQuestion };
    }

    if (action === 'setupSecurity') {
      const userRes = await db.collection('users').where({ name: userName }).limit(1).get();
      if (!userRes.data.length) return { success: false, error: '用户不存在' };
      const user = userRes.data[0];
      if (!password || user.password !== hashPassword(password)) return { success: false, error: '登录凭据已失效，请重新登录' };
      const securityError = validateSecurityInfo(securityQuestion, securityAnswer);
      if (securityError) return { success: false, error: securityError };
      await db.collection('users').doc(user._id).update({
        data: {
          securityQuestion: String(securityQuestion).trim(),
          securityAnswerHash: hashSecurityAnswer(securityAnswer),
          securityUpdatedAt: new Date(),
          updatedAt: new Date()
        }
      });
      return { success: true };
    }

    if (action === 'resetPassword') {
      const userRes = await db.collection('users').where({ name: userName }).limit(1).get();
      if (!userRes.data.length) return { success: false, error: '用户不存在' };
      const user = userRes.data[0];
      if (!user.securityAnswerHash || user.securityAnswerHash !== hashSecurityAnswer(securityAnswer)) {
        return { success: false, error: '密保答案不正确' };
      }
      if (!password || password.length < 6) return { success: false, error: '密码长度至少6位' };
      if (password !== confirmPassword) return { success: false, error: '两次输入的密码不一致' };
      await db.collection('users').doc(user._id).update({
        data: { password: hashPassword(password), passwordUpdatedAt: new Date(), updatedAt: new Date() }
      });
      return { success: true, userName };
    }
    
    return {
      success: false,
      error: '未知操作'
    };
  } catch (e) {
    console.error('云函数执行失败:', e);
    return {
      success: false,
      error: e.message || '操作失败'
    };
  }
};
