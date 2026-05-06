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

exports.main = async (event, context) => {
  const { action, userName, password, confirmPassword } = event;
  
  try {
    if (action === 'checkUser') {
      // 检查用户是否存在
      const userRes = await db.collection('users')
        .where({ name: userName })
        .limit(1)
        .get();
      
      return {
        success: true,
        userExists: userRes.data.length > 0,
        user: userRes.data.length > 0 ? userRes.data[0] : null
      };
    }
    
    if (action === 'login') {
      // 登录：验证密码
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
          userName: userName
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
      
      return {
        success: true,
        userName: userName
      };
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

