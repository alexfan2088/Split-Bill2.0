/*
 * E2E runner + screenshot collector for WeChat Mini Program via miniprogram-automator.
 * Output screenshots + a Markdown manual which can be converted to DOCX via pandoc.
 */

const path = require('path');
const fs = require('fs-extra');
const dayjs = require('dayjs');
const automator = require('miniprogram-automator');

const DEVTOOLS_CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function screenshot(miniProgram, outPath) {
  await fs.ensureDir(path.dirname(outPath));
  await miniProgram.screenshot({ path: outPath });
}

async function main() {
  const projectPath = process.env.MINIAPP_PROJECT || '/Users/fwp-mac/dev/Split-Bill2.0/miniapp';
  const outRoot = process.env.MANUAL_OUT || '/Users/fwp-mac/Documents/操作手册/aa记账';
  const imagesDir = path.join(outRoot, 'images');
  const ts = dayjs().format('YYYYMMDD-HHmmss');
  const runDir = path.join(imagesDir, ts);

  await fs.ensureDir(runDir);

  const steps = []; // {title, imgRel, note}
  function addStep(title, imgPath, note = '') {
    steps.push({
      title,
      imgRel: path.relative(outRoot, imgPath).replaceAll('\\', '/'),
      note,
    });
  }

  // Launch Mini Program
  const miniProgram = await automator.launch({
    cliPath: DEVTOOLS_CLI,
    projectPath,
    port: process.env.WX_DEVTOOLS_PORT ? Number(process.env.WX_DEVTOOLS_PORT) : undefined,
  });

  const native = miniProgram.native();

  async function snap(title, fileName, note = '') {
    const imgPath = path.join(runDir, fileName);
    await screenshot(miniProgram, imgPath);
    addStep(title, imgPath, note);
    await sleep(300);
  }

  async function waitForSelector(page, selector, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = await page.$(selector);
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  async function ensureTap(selector, desc, timeoutMs = 10000) {
    const p = await miniProgram.currentPage();
    let el = await waitForSelector(p, selector, timeoutMs);
    if (!el) {
      const alt = selector.startsWith('button') ? selector.replace('button', '') : `button${selector}`;
      el = await waitForSelector(p, alt, 1500);
    }
    if (!el) throw new Error(`找不到元素：${desc}（selector=${selector}）`);
    await el.tap();
  }

  try {
    // ========== A. 登录 ========== 
    let page = await miniProgram.reLaunch('/pages/login/login');
    await page.waitFor(1000);
    await snap('打开小程序并进入登录页', '01-登录页.png', '输入你的用户名后点击“登录”。如果是第一次使用，可以切换到“注册”。');

    const loginInputs = await page.$$('input');
    if (loginInputs.length > 0) {
      await loginInputs[0].input('小蜜测试');
      await page.waitFor(300);
      await snap('输入用户名', '02-输入用户名.png');
    }

    const loginBtn = await page.$('.btn-full');
    if (loginBtn) {
      await loginBtn.tap();
      await page.waitFor(1500);
    }

    // 强制回到首页（避免因登录状态/重定向导致页面不一致）
    page = await miniProgram.reLaunch('/pages/home/home');
    await page.waitFor(1000);
    await snap('进入首页（活动列表）', '03-登录后-活动列表.png', '首页会展示你的活动列表。');

    // ========== B. 普通活动（非预存）主流程 ========== 
    await ensureTap('button.btn-add', '首页“+ 创建活动”按钮');
    page = await miniProgram.currentPage();
    await page.waitFor(800);
    await snap('点击“+ 创建活动”', '04-创建活动页.png', '这里用于创建一次 AA 记账活动，比如聚餐、旅行、合租等。');

    const createInputs = await page.$$('input');
    if (createInputs.length > 0) {
      await createInputs[0].input('普通活动（演示）');
      await snap('填写活动名称', '05-填写活动名称.png');
    }
    if (createInputs.length > 1) {
      await createInputs[1].input('聚餐');
      await snap('填写活动类型', '06-填写活动类型.png');
    }

    if (createInputs.length > 2) {
      await createInputs[2].input('张三');
      await ensureTap('button.member-add-btn', '创建活动页“添加成员”按钮');
      await page.waitFor(300);
      await snap('添加成员：张三', '07-添加成员-张三.png');

      await createInputs[2].input('李四');
      await ensureTap('button.member-add-btn', '创建活动页“添加成员”按钮');
      await page.waitFor(300);
      await snap('添加成员：李四', '08-添加成员-李四.png');
    }

    await ensureTap('button.btn-full', '创建活动页“创建/更新”按钮');

    // 创建页的逻辑是：成功后 navigateBack 回到首页（活动列表）
    const startNav = Date.now();
    while (Date.now() - startNav < 25000) {
      page = await miniProgram.currentPage();
      if (page.path.includes('pages/home/home')) break;
      await sleep(500);
    }

    page = await miniProgram.currentPage();
    if (!page.path.includes('pages/home/home')) {
      await snap('创建活动后未返回首页（可能是创建失败/网络慢）', '09-创建后未返回首页.png', '如果一直停留在创建页，请检查是否出现错误提示或云开发权限问题。');
      throw new Error(`预期回到首页，但当前在：${page.path}`);
    }

    await snap('创建成功后回到首页（活动列表）', '10-创建后-首页.png', '新创建的活动一般会出现在列表顶部。');

    // 打开刚创建的活动（默认点第一条）
    await ensureTap('.activity-item', '活动列表第一条活动');
    const startDetail = Date.now();
    while (Date.now() - startDetail < 15000) {
      page = await miniProgram.currentPage();
      if (page.path.includes('pages/activity/detail')) break;
      await sleep(400);
    }

    page = await miniProgram.currentPage();
    if (!page.path.includes('pages/activity/detail')) {
      throw new Error(`点击活动后未进入详情页，当前：${page.path}`);
    }

    await snap('进入活动详情页（账单 Tab）', '11-活动详情-账单tab.png', '活动详情页包含：账单 /（预存时才有）预存 / 结算。');

    // Add bill
    await ensureTap('.btn-add-inline', '活动详情页“+账单”按钮', 15000);
    await page.waitFor(1000);
    page = await miniProgram.currentPage();
    await snap('点击“+账单”进入添加账单页', '10-添加账单页.png', '填写金额、名称、付款人，并设置参与成员权重（0=不参与）。');

    const billInputs = await page.$$('input');
    if (billInputs.length > 0) {
      await billInputs[0].input('120');
      await snap('填写账单金额', '11-填写金额.png');
    }
    if (billInputs.length > 2) {
      await billInputs[2].input('晚餐');
      await snap('填写账单名称', '12-填写名称.png');
    }

    await ensureTap('button.btn-save', '账单页“保存/更新”按钮');
    await page.waitFor(1200);
    page = await miniProgram.currentPage();
    await snap('保存账单后回到列表', '13-账单列表-已新增.png');

    // View bill detail
    const firstBill = await page.$('.bill-item');
    if (firstBill) {
      await firstBill.tap();
      await page.waitFor(900);
      await snap('点击某条账单进入查看/编辑页', '14-账单详情页.png', '你可以在这里查看明细；若你是创建者通常可以删除账单。');
      await native.navigateLeft();
      await page.waitFor(900);
      page = await miniProgram.currentPage();
      await snap('返回账单列表', '15-返回账单列表.png');
    }

    // Summary tab
    const tabs = await page.$$('.tab');
    if (tabs && tabs.length >= 3) {
      await tabs[2].tap();
      await page.waitFor(1000);
      await snap('切换到“结算”Tab', '16-结算tab.png', '这里会显示每个人的实付/应付与余额（正=应收，负=应付）。');
    }

    // Back to home & cleanup by deleting demo activity (optional)
    await native.navigateLeft();
    await page.waitFor(900);
    page = await miniProgram.currentPage();
    await native.navigateLeft();
    await page.waitFor(900);
    page = await miniProgram.currentPage();
    await snap('回到首页（活动列表）', '17-首页-活动列表.png');

    // ========== C. 预存活动全流程 ========== 
    await ensureTap('.btn-add', '首页“+ 创建活动”按钮（预存活动）');
    page = await miniProgram.currentPage();
    await page.waitFor(800);
    await snap('开始创建“预存”活动', '18-创建预存活动-页面.png', '预存适合“先充值到一个保管人那里，然后统一消费结算”的场景。');

    const preInputs = await page.$$('input');
    if (preInputs.length > 0) {
      await preInputs[0].input('预存活动（演示）');
      await snap('填写预存活动名称', '19-预存-填写活动名称.png');
    }
    if (preInputs.length > 1) {
      await preInputs[1].input('旅行');
      await snap('填写预存活动类型', '20-预存-填写活动类型.png');
    }

    if (preInputs.length > 2) {
      await preInputs[2].input('王五');
      await (await page.$('.member-add-btn')).tap();
      await page.waitFor(300);
      await snap('预存-添加成员：王五', '21-预存-添加成员-王五.png');

      await preInputs[2].input('赵六');
      await (await page.$('.member-add-btn')).tap();
      await page.waitFor(300);
      await snap('预存-添加成员：赵六', '22-预存-添加成员-赵六.png');
    }

    // Toggle prepaid switch
    const sw = await page.$('switch');
    if (sw) {
      await sw.tap();
      await page.waitFor(600);
      await snap('打开“预存”开关', '23-预存-打开开关.png', '开启后需要选择“保管人员”（相当于资金保管/统一结算的人）。');
    }

    // Choose keeper (first keeper-tag)
    const keeperTag = await page.$('.keeper-tag');
    if (keeperTag) {
      await keeperTag.tap();
      await page.waitFor(300);
      await snap('选择保管人员', '24-预存-选择保管人员.png');
    }

    await ensureTap('button.btn-full', '创建活动页“创建/更新”按钮（预存）');

    // 等待返回首页
    const startNav2 = Date.now();
    while (Date.now() - startNav2 < 25000) {
      page = await miniProgram.currentPage();
      if (page.path.includes('pages/home/home')) break;
      await sleep(500);
    }
    page = await miniProgram.currentPage();
    await snap('预存活动创建完成，返回首页（活动列表）', '25-预存-创建后-首页.png');

    // 打开刚创建的预存活动（仍然点第一条）
    await ensureTap('.activity-item', '活动列表第一条活动（预存）');
    const startDetail2 = Date.now();
    while (Date.now() - startDetail2 < 15000) {
      page = await miniProgram.currentPage();
      if (page.path.includes('pages/activity/detail')) break;
      await sleep(400);
    }
    page = await miniProgram.currentPage();
    if (!page.path.includes('pages/activity/detail')) {
      throw new Error(`点击预存活动后未进入详情页，当前：${page.path}`);
    }

    await snap('进入预存活动详情（账单 Tab）', '26-预存-活动详情-账单tab.png');

    // Switch to recharge tab (tabs[1])
    const tabs2 = await page.$$('.tab');
    if (tabs2 && tabs2.length >= 3) {
      // index 1 should be 预存
      await tabs2[1].tap();
      await page.waitFor(1000);
      await snap('切换到“预存”Tab', '26-预存tab.png', '这里记录每个人的充值（预存）情况。');
    }

    // Add recharge
    const addRechargeBtn = await page.$('.btn-add');
    if (addRechargeBtn) {
      await addRechargeBtn.tap();
      await page.waitFor(1000);
      page = await miniProgram.currentPage();
      await snap('点击“+ 添加充值”进入充值页面', '27-添加充值页.png');

      const rechargeInputs = await page.$$('input');
      if (rechargeInputs.length > 0) {
        await rechargeInputs[0].input('200');
        await snap('填写充值金额', '28-填写充值金额.png');
      }

      // select payer: first payer-tag
      const payerTag = await page.$('.payer-tag');
      if (payerTag) {
        await payerTag.tap();
        await page.waitFor(300);
        await snap('选择预存人（谁充值）', '29-选择预存人.png');
      }

      await ensureTap('button.btn-full', '充值页“保存充值”按钮');
      await page.waitFor(1200);
      page = await miniProgram.currentPage();
      await snap('保存充值记录，回到预存列表', '30-预存列表-已新增.png');
    }

    // View recharge
    const rechargeItem = await page.$('.recharge-item');
    if (rechargeItem) {
      await rechargeItem.tap();
      await page.waitFor(900);
      await snap('点击某条充值记录进行查看', '31-查看充值记录.png');
      await native.navigateLeft();
      await page.waitFor(900);
      page = await miniProgram.currentPage();
      await snap('返回预存列表', '32-返回预存列表.png');
    }

    // Switch to bills tab and add a bill under prepaid
    const tabs3 = await page.$$('.tab');
    if (tabs3 && tabs3.length >= 3) {
      await tabs3[0].tap();
      await page.waitFor(900);
      await snap('回到“账单”Tab（预存活动）', '33-预存活动-账单tab.png');
    }

    await ensureTap('.btn-add-inline', '活动详情页“+账单”按钮（预存活动）');
    await page.waitFor(900);
    page = await miniProgram.currentPage();
    await snap('在预存活动中添加账单', '34-预存活动-添加账单页.png');

    const billInputs2 = await page.$$('input');
    if (billInputs2.length > 0) {
      await billInputs2[0].input('80');
      await snap('预存活动-填写账单金额', '35-预存活动-填写金额.png');
    }
    if (billInputs2.length > 2) {
      await billInputs2[2].input('打车');
      await snap('预存活动-填写账单名称', '36-预存活动-填写名称.png');
    }

    await ensureTap('button.btn-save', '账单页“保存/更新”按钮（预存活动）');
    await page.waitFor(1200);
    page = await miniProgram.currentPage();
    await snap('预存活动-保存账单并回到列表', '37-预存活动-账单列表.png');

    // Summary tab for prepaid
    const tabs4 = await page.$$('.tab');
    if (tabs4 && tabs4.length >= 3) {
      await tabs4[2].tap();
      await page.waitFor(900);
      await snap('预存活动-查看结算（含充值总额/消费/剩余）', '38-预存活动-结算tab.png');
    }

    // Back to home
    await native.navigateLeft();
    await page.waitFor(900);
    await native.navigateLeft();
    await page.waitFor(900);
    page = await miniProgram.currentPage();
    await snap('完成演示流程，回到活动列表首页', '39-完成-回到首页.png');

    // Build Markdown manual
    const mdPath = path.join(outRoot, `AA记账小程序_操作手册_${ts}.md`);
    let md = '';
    md += `# AA 记账小程序｜用户操作手册（一步一图）\n\n`;
    md += `> 自动生成时间：${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n\n`;
    md += `本手册面向普通用户，覆盖普通活动与“预存”活动两种使用方式。\n\n`;

    for (let i = 0; i < steps.length; i++) {
      const n = i + 1;
      const st = steps[i];
      md += `## ${n}. ${st.title}\n\n`;
      if (st.note) md += `${st.note}\n\n`;
      md += `![](${st.imgRel})\n\n`;
    }

    md += `---\n\n`;
    md += `## FAQ\n\n`;
    md += `- **看不到活动/账单？**：多半是网络或云开发环境权限/环境ID问题；可尝试重新编译、切换网络，或检查云开发权限设置。\n`;
    md += `- **权重怎么用？**：0=不参与；1/2/3=参与权重（人数/份数）。\n`;
    md += `- **预存活动里“保管人员”是什么？**：相当于资金统一保管的人；预存余额不足时会提示及时充值。\n\n`;

    await fs.writeFile(mdPath, md, 'utf8');

    console.log('OK');
    console.log('Markdown:', mdPath);
    console.log('Images:', runDir);

  } finally {
    await miniProgram.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
