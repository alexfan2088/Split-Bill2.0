// pages/login/login.js
const db = require('../../utils/db.js');
const app = getApp();

Page({
  data: {
    userName: '',
    password: '',
    confirmPassword: '',
    showPassword: false,
    showConfirmPassword: false,
    showPasswordText: false, // true: 明文显示输入框, false: 密码输入框
    statusText: '',
    statusTextColor: '',
    passwordErrorCount: {}, // 记录每个用户名的密码错误次数
    lastUserName: '', // 记录上次输入的用户名
    isRegisterMode: false, // false: 登录模式, true: 注册模式
    hasSavedUser: false, // 是否有保存的用户信息
    userNameChecking: false,
    userNameAvailable: null,
    userNameCheckText: '',
    suggestedUserNames: [],
    hasAgreed: false,
    policyVersion: '2026-08-10',
  },
  
  onShareAppMessage() {
    return {
      title: 'AA 记账 - 登录/注册',
      path: '/pages/login/login',
      imageUrl: '' // 可选：分享图片
    };
  },
  
  onShareTimeline() {
    return {
      title: 'AA 记账 - 登录/注册',
      imageUrl: '' // 可选：分享图片
    };
  },
  
  onLoad() {
    const policyVersion = this.data.policyVersion;
    this.setData({ hasAgreed: wx.getStorageSync('aa_policy_agreed_version') === policyVersion });
    // 检查是否已保存用户信息
    const userName = wx.getStorageSync('aa_user_name');
    const savedPasswordHashed = wx.getStorageSync('aa_user_password');
    const savedPassword = db.getSavedLoginPassword();
    
    if (userName && savedPasswordHashed) {
      // 有保存的登录凭据，默认隐藏回填的密码。
      this.setData({ 
        userName: userName,
        password: savedPassword,
        showPassword: true,
        showConfirmPassword: false,
        showPasswordText: false,
        isRegisterMode: false, // 登录模式
        hasSavedUser: true,
        statusText: savedPassword ? '已自动填入保存的密码' : '已保存用户名，请输入密码登录',
        statusTextColor: 'blue'
      });
    } else {
      // 没有保存的用户信息，进入注册模式
      this.setData({
        isRegisterMode: true,
        hasSavedUser: false,
        showPassword: true,
        showConfirmPassword: true,
        statusText: '首次使用，请注册新账号',
        statusTextColor: 'orange'
      });
    }
  },

  onUnload() {
    if (this._userNameCheckTimer) {
      clearTimeout(this._userNameCheckTimer);
      this._userNameCheckTimer = null;
    }
    this._userNameCheckRequestId = (this._userNameCheckRequestId || 0) + 1;
  },
  
  // 切换到注册模式
  switchToRegister() {
    if (this._userNameCheckTimer) {
      clearTimeout(this._userNameCheckTimer);
      this._userNameCheckTimer = null;
    }
    this._userNameCheckRequestId = (this._userNameCheckRequestId || 0) + 1;
    this.setData({
      isRegisterMode: true,
      userName: '',
      password: '',
      confirmPassword: '',
      showPassword: true,
      showConfirmPassword: true,
      showPasswordText: false,
      statusText: '注册新账号',
      statusTextColor: 'orange',
      userNameChecking: false,
      userNameAvailable: null,
      userNameCheckText: '',
      suggestedUserNames: []
    });
  },
  
  // 切换到登录模式
  switchToLogin() {
    if (this._userNameCheckTimer) {
      clearTimeout(this._userNameCheckTimer);
      this._userNameCheckTimer = null;
    }
    this._userNameCheckRequestId = (this._userNameCheckRequestId || 0) + 1;
    const userName = wx.getStorageSync('aa_user_name');
    const savedPassword = db.getSavedLoginPassword();
    
    this.setData({
      isRegisterMode: false,
      userName: userName || '',
      password: userName ? savedPassword : '',
      showPassword: true,
      showConfirmPassword: false,
      showPasswordText: false,
      statusText: userName && savedPassword ? '已自动填入保存的密码' : (userName ? '已保存用户名，请输入密码登录' : '请输入用户名和密码登录'),
      statusTextColor: 'blue',
      userNameChecking: false,
      userNameAvailable: null,
      userNameCheckText: '',
      suggestedUserNames: []
    });
  },
  
  onUserNameInput(e) {
    const userName = e.detail.value.trim();
    this.setData({
      userName,
      userNameChecking: false,
      userNameAvailable: null,
      userNameCheckText: '',
      suggestedUserNames: []
    });
    
    // 如果用户名改变，重置错误计数
    if (userName !== this.data.lastUserName && this.data.passwordErrorCount[userName]) {
      const passwordErrorCount = { ...this.data.passwordErrorCount };
      passwordErrorCount[userName] = 0;
      this.setData({ passwordErrorCount });
    }
    this.setData({ lastUserName: userName });
    
    // 清空状态文本
    this.setData({ statusText: '', statusTextColor: '' });

    if (this._userNameCheckTimer) {
      clearTimeout(this._userNameCheckTimer);
      this._userNameCheckTimer = null;
    }
    if (this.data.isRegisterMode && userName) {
      this._userNameCheckTimer = setTimeout(() => {
        this.checkUserNameAvailability(userName);
      }, 400);
    }
  },

  validateUserName(userName) {
    const value = String(userName || '').trim();
    if (!value) return '请输入用户名';
    if (value.length < 2 || value.length > 20) return '用户名长度应为2至20个字符';
    if (!/^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(value)) {
      return '用户名仅支持中文、字母、数字和下划线';
    }
    return '';
  },

  buildUserNameCandidates(userName) {
    const suffixes = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, '0'));
    return suffixes.map((suffix) => {
      const base = userName.slice(0, Math.max(1, 20 - suffix.length));
      return `${base}${suffix}`;
    });
  },

  async checkUserNameAvailability(inputName) {
    const userName = String(inputName !== undefined ? inputName : this.data.userName).trim();
    const validationError = this.validateUserName(userName);
    const requestId = (this._userNameCheckRequestId || 0) + 1;
    this._userNameCheckRequestId = requestId;

    if (validationError) {
      this.setData({
        userNameChecking: false,
        userNameAvailable: false,
        userNameCheckText: validationError,
        suggestedUserNames: []
      });
      return { checked: true, available: false, error: validationError };
    }

    this.setData({
      userNameChecking: true,
      userNameAvailable: null,
      userNameCheckText: '正在检查用户名...',
      suggestedUserNames: []
    });

    try {
      const dbCloud = wx.cloud.database();
      const userRes = await dbCloud.collection('users')
        .where({ name: userName })
        .limit(1)
        .get();
      if (requestId !== this._userNameCheckRequestId || userName !== this.data.userName.trim()) {
        return { checked: false, available: false };
      }

      if (!userRes.data || userRes.data.length === 0) {
        this.setData({
          userNameChecking: false,
          userNameAvailable: true,
          userNameCheckText: `用户名“${userName}”可用`,
          suggestedUserNames: []
        });
        return { checked: true, available: true };
      }

      const candidates = this.buildUserNameCandidates(userName);
      const candidateRes = await dbCloud.collection('users')
        .where({ name: dbCloud.command.in(candidates) })
        .get();
      if (requestId !== this._userNameCheckRequestId || userName !== this.data.userName.trim()) {
        return { checked: false, available: false };
      }
      const occupied = new Set((candidateRes.data || []).map(item => item.name));
      const suggestions = candidates.filter(name => !occupied.has(name)).slice(0, 3);
      this.setData({
        userNameChecking: false,
        userNameAvailable: false,
        userNameCheckText: `用户名“${userName}”已被占用`,
        suggestedUserNames: suggestions
      });
      return { checked: true, available: false, suggestions };
    } catch (e) {
      console.error('检查用户名失败:', e);
      if (requestId === this._userNameCheckRequestId) {
        this.setData({
          userNameChecking: false,
          userNameAvailable: null,
          userNameCheckText: '暂时无法检查用户名，请稍后重试',
          suggestedUserNames: []
        });
      }
      return { checked: false, available: false, error: e.message || '检查失败' };
    }
  },

  onSuggestedUserNameTap(e) {
    const userName = String(e.currentTarget.dataset.name || '').trim();
    if (!userName) return;
    this.setData({
      userName,
      userNameAvailable: null,
      userNameCheckText: '',
      suggestedUserNames: []
    });
    this.checkUserNameAvailability(userName);
  },
  
  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },
  
  onConfirmPasswordInput(e) {
    this.setData({ confirmPassword: e.detail.value });
  },
  
  togglePassword() {
    this.setData({
      showPasswordText: !this.data.showPasswordText
    });
  },

  onAgreementChange(e) {
    const hasAgreed = !!e.detail.value.length;
    this.setData({ hasAgreed });
    if (hasAgreed) {
      wx.setStorageSync('aa_policy_agreed_version', this.data.policyVersion);
    } else {
      wx.removeStorageSync('aa_policy_agreed_version');
    }
  },

  openLegal(e) {
    const type = e.currentTarget.dataset.type || 'privacy';
    wx.navigateTo({ url: `/pages/legal/legal?type=${type}` });
  },

  ensureAgreement() {
    if (this.data.hasAgreed) return true;
    wx.showToast({ title: '请先阅读并同意服务协议和隐私政策', icon: 'none', duration: 2500 });
    return false;
  },
  
  // 处理登录
  async handleLogin() {
    if (!this.ensureAgreement()) return;
    const userName = this.data.userName.trim();
    const password = this.data.password;
    
    if (!userName) {
      wx.showToast({
        title: '请输入用户名',
        icon: 'none'
      });
      return;
    }
    
    if (!password) {
      wx.showToast({
        title: '请输入密码',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({
      title: '登录中...'
    });
    
    try {
      const result = await db.login(userName, password);
      wx.hideLoading();
      
      if (result.success) {
        // 重置错误计数
        const passwordErrorCount = { ...this.data.passwordErrorCount };
        passwordErrorCount[userName] = 0;
        this.setData({ passwordErrorCount });
        
        // 更新全局数据
        app.globalData.currentUserName = userName;
        
        wx.showToast({
          title: '登录成功',
          icon: 'success'
        });
        
        // 跳转到首页
        setTimeout(() => {
          wx.redirectTo({
            url: '/pages/home/home'
          });
        }, 1500);
      } else {
        // 密码错误
        const passwordErrorCount = { ...this.data.passwordErrorCount };
        if (!passwordErrorCount[userName]) {
          passwordErrorCount[userName] = 0;
        }
        passwordErrorCount[userName]++;
        
        const errorCount = passwordErrorCount[userName];
        this.setData({ passwordErrorCount });
        
        if (errorCount >= 3) {
          wx.showModal({
            title: '提示',
            content: `密码错误3次。该用户名可能已被他人使用，请更换用户名后重新注册`,
            showCancel: false,
            confirmText: '确定',
            success: () => {
              passwordErrorCount[userName] = 0;
              this.setData({
                passwordErrorCount,
                password: '',
                statusText: '密码错误3次，请检查用户名是否正确',
                statusTextColor: 'red'
              });
            }
          });
        } else {
          const remaining = 3 - errorCount;
          wx.showToast({
            title: `密码错误，还可尝试 ${remaining} 次`,
            icon: 'none',
            duration: 2000
          });
          this.setData({
            password: '',
            statusText: `密码错误，还可尝试 ${remaining} 次`,
            statusTextColor: 'red'
          });
        }
      }
    } catch (e) {
      wx.hideLoading();
      console.error('登录失败:', e);
      wx.showToast({
        title: '登录失败，请重试',
        icon: 'none'
      });
    }
  },
  
  // 处理注册
  async handleRegister() {
    if (!this.ensureAgreement()) return;
    const userName = this.data.userName.trim();
    const password = this.data.password;
    const confirmPassword = this.data.confirmPassword;
    
    if (!userName) {
      wx.showToast({
        title: '请输入用户名',
        icon: 'none'
      });
      return;
    }
    
    try {
      const checkResult = await this.checkUserNameAvailability(userName);
      if (!checkResult.checked) {
        wx.showToast({ title: '用户名检查失败，请重试', icon: 'none' });
        return;
      }
      if (!checkResult.available) {
        wx.showToast({ title: checkResult.error || '该用户名已被占用', icon: 'none' });
        return;
      }

      if (!password) {
        wx.showToast({
          title: '请设置密码（至少6位）',
          icon: 'none'
        });
        return;
      }
      
      if (password.length < 6) {
        wx.showToast({
          title: '密码长度至少6位',
          icon: 'none'
        });
        return;
      }
      
      if (!confirmPassword) {
        wx.showToast({
          title: '请确认密码',
          icon: 'none'
        });
        return;
      }
      
      if (password !== confirmPassword) {
        wx.showToast({
          title: '两次输入的密码不一致',
          icon: 'none'
        });
        this.setData({ confirmPassword: '' });
        return;
      }
      
      wx.showLoading({
        title: '注册中...'
      });
      
      const result = await db.register(userName, password, confirmPassword);
      wx.hideLoading();
      
      if (result.success) {
        // 更新全局数据
        app.globalData.currentUserName = userName;
        
        wx.showToast({
          title: '注册成功',
          icon: 'success'
        });
        
        // 跳转到首页
        setTimeout(() => {
          wx.redirectTo({
            url: '/pages/home/home'
          });
        }, 1500);
      } else {
        wx.showToast({
          title: result.error || '注册失败',
          icon: 'none',
          duration: 2000
        });
      }
    } catch (e) {
      wx.hideLoading();
      console.error('注册失败:', e);
      wx.showToast({
        title: '注册失败，请重试',
        icon: 'none'
      });
    }
  },
  
  // 统一处理按钮点击（根据模式调用不同函数）
  handleLoginOrRegister() {
    if (this.data.isRegisterMode) {
      this.handleRegister();
    } else {
      this.handleLogin();
    }
  },
  
  // 旧的handleLoginOrRegister函数（已废弃，保留以防万一）
  async handleLoginOrRegisterOld() {
    const userName = this.data.userName.trim();
    const password = this.data.password;
    const confirmPassword = this.data.confirmPassword;
    
    if (!userName) {
      wx.showToast({
        title: '请输入用户名',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({
      title: '处理中...'
    });
    
    try {
      // 直接使用数据库查询（新环境应该已经授权）
      const dbCloud = wx.cloud.database();
      const userRes = await dbCloud.collection('users')
        .where({ name: userName })
        .limit(1)
        .get();
      
      const userExists = userRes.data && userRes.data.length > 0;
      
      if (userExists) {
        // 用户已存在，执行登录流程
        if (!this.data.showPassword) {
          // 显示密码输入框
          this.setData({
            showPassword: true,
            showConfirmPassword: false,
            statusText: '该用户名已注册，请输入密码登录',
            statusTextColor: 'blue'
          });
          wx.hideLoading();
          return;
        }
        
        if (!password) {
          wx.hideLoading();
          wx.showToast({
            title: '请输入密码',
            icon: 'none'
          });
          return;
        }
        
        // 直接使用数据库执行登录
        const result = await db.login(userName, password);
        wx.hideLoading();
        
        if (result.success) {
          // 重置错误计数
          const passwordErrorCount = { ...this.data.passwordErrorCount };
          passwordErrorCount[userName] = 0;
          this.setData({ passwordErrorCount });
          
          // 更新全局数据
          app.globalData.currentUserName = userName;
          
          wx.showToast({
            title: '登录成功',
            icon: 'success'
          });
          
          // 跳转到首页
          setTimeout(() => {
            wx.redirectTo({
              url: '/pages/home/home'
            });
          }, 1500);
        } else {
          // 密码错误
          const passwordErrorCount = { ...this.data.passwordErrorCount };
          if (!passwordErrorCount[userName]) {
            passwordErrorCount[userName] = 0;
          }
          passwordErrorCount[userName]++;
          
          const errorCount = passwordErrorCount[userName];
          this.setData({ passwordErrorCount });
          
          if (errorCount >= 3) {
            // 错误3次，提示用户更换用户名
            wx.showModal({
              title: '提示',
              content: `密码错误3次。该用户名可能已被他人使用，请更换用户名（如：${userName}123）后重新注册`,
              showCancel: false,
              confirmText: '确定',
              success: () => {
                // 重置错误计数
                passwordErrorCount[userName] = 0;
                this.setData({
                  passwordErrorCount,
                  userName: '',
                  password: '',
                  showPassword: false,
                  statusText: '',
                  statusTextColor: ''
                });
              }
            });
          } else {
            const remaining = 3 - errorCount;
            wx.showToast({
              title: `密码错误，还可尝试 ${remaining} 次`,
              icon: 'none',
              duration: 2000
            });
            this.setData({
              password: '',
              statusText: `密码错误，还可尝试 ${remaining} 次`,
              statusTextColor: 'red'
            });
          }
        }
      } else {
        // 用户不存在，执行注册流程
        if (!this.data.showPassword) {
          // 显示密码和确认密码输入框
          this.setData({
            showPassword: true,
            showConfirmPassword: true,
            statusText: '该用户名未注册，请设置密码完成注册',
            statusTextColor: 'green'
          });
          wx.hideLoading();
          wx.showToast({
            title: '欢迎注册！请设置密码（至少6位）',
            icon: 'success'
          });
          return;
        }
        
        if (!password) {
          wx.hideLoading();
          wx.showToast({
            title: '请设置密码（至少6位）',
            icon: 'none'
          });
          return;
        }
        
        if (password.length < 6) {
          wx.hideLoading();
          wx.showToast({
            title: '密码长度至少6位',
            icon: 'none'
          });
          return;
        }
        
        if (!confirmPassword) {
          wx.hideLoading();
          wx.showToast({
            title: '请确认密码',
            icon: 'none'
          });
          return;
        }
        
        if (password !== confirmPassword) {
          wx.hideLoading();
          wx.showToast({
            title: '两次输入的密码不一致',
            icon: 'none'
          });
          this.setData({ confirmPassword: '' });
          return;
        }
        
        // 直接使用数据库执行注册
        const result = await db.register(userName, password, confirmPassword);
        wx.hideLoading();
        
        if (result.success) {
          // 重置错误计数
          const passwordErrorCount = { ...this.data.passwordErrorCount };
          passwordErrorCount[userName] = 0;
          this.setData({ passwordErrorCount });
          
          // 更新全局数据
          app.globalData.currentUserName = userName;
          
          wx.showToast({
            title: '注册成功',
            icon: 'success'
          });
          
          // 跳转到首页
          setTimeout(() => {
            wx.redirectTo({
              url: '/pages/home/home'
            });
          }, 1500);
        } else {
          wx.showModal({
            title: '注册失败',
            content: result.error || '未知错误，请检查网络连接和云开发配置',
            showCancel: false,
            confirmText: '确定'
          });
        }
      }
    } catch (e) {
      wx.hideLoading();
      console.error('登录/注册异常:', e);
      wx.showModal({
        title: '操作失败',
        content: `发生错误：${e.message || '未知错误'}\n\n请检查：\n1. 云开发环境ID是否正确\n2. 数据库权限是否已设置\n3. 网络连接是否正常`,
        showCancel: false,
        confirmText: '确定'
      });
    }
  },
});
