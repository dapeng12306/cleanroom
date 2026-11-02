/* ==========================================================================
   main.js —— 启动引导：登录/注册、菜单中枢、悬浮 Dock、登录页粒子动画
   ========================================================================== */
(function () {
  /* ---------- 登录页背景粒子：模拟洁净室悬浮微粒被层流压向下 ---------- */
  function startParticles() {
    const cv = document.getElementById('loginParticles');
    const ctx = cv.getContext('2d');
    let W, H, dots = [];
    function resize() {
      W = cv.width = innerWidth; H = cv.height = innerHeight;
      dots = Array.from({ length: 90 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 2.2 + .6, v: Math.random() * .5 + .18,
        a: Math.random() * .5 + .2,
      }));
    }
    resize(); addEventListener('resize', resize);
    (function loop() {
      if (document.getElementById('loginView').style.display === 'none') return;
      ctx.clearRect(0, 0, W, H);
      dots.forEach(d => {
        d.y += d.v;                      // 层流向下压粒子
        if (d.y > H) { d.y = -4; d.x = Math.random() * W; }
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7);
        ctx.fillStyle = `rgba(125,232,220,${d.a})`; ctx.fill();
      });
      requestAnimationFrame(loop);
    })();
  }

  /* ---------- 角色快捷卡：点一下自动填账号，评审演示省得记 ---------- */
  const DEMO_ROLES = [
    { u: 'chenjing', n: '陈静', r: '洁净班长', c: '#f59e0b' },
    { u: 'sunmei', n: '孙梅', r: '质检员', c: '#8b5cf6' },
    { u: 'zhouyang', n: '周扬', r: '调度工程师', c: '#06b6d4' },
    { u: 'liqiang', n: '李强', r: '保洁员', c: '#0d9488' },
  ];
  function renderRoleQuick() {
    const box = document.getElementById('loginRoles');
    box.innerHTML = '';
    DEMO_ROLES.forEach(r => {
      const b = App.el(`<button class="role-quick"><b style="color:${r.c}">${r.n} · ${r.r}</b><i>${r.u} / 123456</i></button>`);
      b.onclick = () => {
        document.getElementById('loginUser').value = r.u;
        document.getElementById('loginPass').value = '123456';
      };
      box.appendChild(b);
    });
  }

  /* ---------- 登录 / 注册 ---------- */
  async function doLogin() {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value.trim();
    if (!username || !password) return App.toast('请输入账号与口令', false);
    try {
      const j = await App.api('/auth/login', { method: 'POST', body: { username, password } });
      App.token = j.data.token;
      localStorage.setItem('cr_token', App.token);
      App.user = j.data;
      enterApp();
      App.toast(j.msg || '登录成功');
    } catch (e) { App.toast(e.msg, false); }
  }

  function openRegister() {
    App.modal({
      title: '新人员建档注册', width: 460, okText: '提交建档',
      body: `<div class="form-grid">
        <div class="field"><label>登录账号</label><input id="rgUser" placeholder="拼音工号，如 hanmeimei"></div>
        <div class="field"><label>真实姓名</label><input id="rgName" placeholder="姓名"></div>
        <div class="field"><label>通行口令</label><input id="rgPass" type="password" placeholder="至少 6 位"></div>
        <div class="field"><label>手机号</label><input id="rgPhone" placeholder="选填"></div>
        <div class="field full"><label>岗位角色</label><select id="rgRole">
          <option value="cleaner">保洁员 —— 一线作业执行</option>
          <option value="leader">洁净班长 —— 派单与审批</option>
          <option value="inspector">质检员 —— 验收判定</option>
          <option value="dispatcher">调度工程师 —— 人机资源调度</option>
        </select></div>
      </div>`,
      async onOk(box) {
        const body = {
          username: box.querySelector('#rgUser').value.trim(),
          real_name: box.querySelector('#rgName').value.trim(),
          password: box.querySelector('#rgPass').value.trim(),
          phone: box.querySelector('#rgPhone').value.trim(),
          role: box.querySelector('#rgRole').value,
        };
        const j = await App.api('/auth/register', { method: 'POST', body });
        App.toast(j.msg);
      },
    });
  }

  /* ---------- 进入主界面 ---------- */
  function enterApp() {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('appView').style.display = 'flex';
    renderUserChip(); renderTopChips(); renderHub(); renderDock();
    App.goHub();
  }

  function renderUserChip() {
    const u = App.user;
    const box = document.getElementById('userChip');
    box.innerHTML = '';
    box.appendChild(App.el(`<div class="user-ava">${App.esc(u.real_name[0])}</div>`));
    box.appendChild(App.el(`<div class="user-meta"><b>${App.esc(u.real_name)}</b><i>${App.ROLE_TEXT[u.role] || u.role}</i></div>`));
    const out = App.el(`<button class="btn-ghost">退出</button>`);
    out.onclick = async () => {
      try { await App.api('/auth/logout', { method: 'POST' }); } catch (e) { }
      App.logout(); App.toast('已安全退出车间系统');
    };
    box.appendChild(out);
  }

  /* ---------- 顶部分布式菜单条 ---------- */
  function renderTopChips() {
    const bar = document.getElementById('topChips');
    bar.innerHTML = '';
    App.order.forEach(name => {
      const p = App.pages[name];
      const b = App.el(`<button class="chip-btn" data-name="${name}">${p.icon} ${p.title}</button>`);
      b.onclick = () => App.go(name);
      bar.appendChild(b);
    });
  }

  /* ---------- 菜单中枢：不对称马赛克 ---------- */
  const HUB_SPAN = { m01: 'span2 row2', m03: 'span2', m04: 'span2', m06: 'span2', m10: 'span2', m11: 'span2' };
  function renderHub() {
    const hub = document.getElementById('hubView');
    hub.innerHTML = '';
    App.order.forEach((name, i) => {
      const p = App.pages[name];
      const bg = p.bgImg ? `<div class="hc-bg" style="background-image:url('${p.bgImg}')"></div><div class="hc-shade"></div>` : '';
      const card = App.el(`<div class="hub-card ${HUB_SPAN[name] || ''}" style="background:${p.bg || p.color};animation-delay:${i * 40}ms">
        ${bg}<span class="hc-icon">${p.icon}</span>
        <span class="hc-badge">${p.subs.length} 个子页</span>
        <h3>${p.title}</h3><p>${p.desc}</p></div>`);
      card.onclick = () => App.go(name);
      hub.appendChild(card);
    });
  }

  /* ---------- 悬浮环形 Dock ---------- */
  function renderDock() {
    const dock = document.getElementById('dock');
    const ring = document.getElementById('dockRing');
    ring.innerHTML = '';
    const main = document.getElementById('dockMain');
    main.onclick = () => dock.classList.toggle('open');
    // 环形展开：把 11 个菜单排在以按钮为圆心的半圆弧上
    const R = 120, n = App.order.length;
    App.order.forEach((name, i) => {
      const p = App.pages[name];
      const ang = Math.PI * (0.05 + 0.9 * i / (n - 1));   // 左上半圆展开
      const dx = -Math.cos(ang) * R, dy = -Math.sin(ang) * R;
      const b = App.el(`<button class="dock-item" style="--dx:${dx}px;--dy:${dy}px;background:${p.color};transition-delay:${i * 18}ms">${p.icon}<span class="dock-tip">${p.title}</span></button>`);
      b.onclick = () => { dock.classList.remove('open'); App.go(name); };
      ring.appendChild(b);
    });
  }

  /* ---------- 启动 ---------- */
  document.getElementById('btnLogin').onclick = doLogin;
  document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('linkRegister').onclick = openRegister;
  document.getElementById('logoHome').onclick = () => App.goHub();
  renderRoleQuick();
  startParticles();

  // 已有 token 直接进，评审刷新页面不用重登
  (async function boot() {
    if (!App.token) return;
    try {
      const j = await App.api('/auth/me');
      App.user = j.data;
      enterApp();
      const m = (location.hash || '').match(/^#\/(m\d+)/);
      if (m) App.go(m[1]);
    } catch (e) { App.logout(); }
  })();
})();
