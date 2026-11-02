/* ==========================================================================
   common.js —— 前端公共骨架
   全系统的 API 通道、弹窗、Toast、页签、3D 场景脚手架、手绘图表都在这里。
   11 个菜单页只关心自己的业务，不重复造轮子。
   ========================================================================== */
(function () {
  const App = {
    user: null,
    token: localStorage.getItem('cr_token') || '',
    pages: {},          // name -> {title, icon, color, desc, render}
    order: [],          // 菜单注册顺序，Dock 和中枢按它排
    current: null,      // 当前页 {name, dispose}
  };
  window.App = App;

  /* ---------------- 小工具 ---------------- */
  App.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  App.el = function (html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  App.fmtT = s => s ? String(s).slice(5, 16) : '—';
  App.STATUS_TEXT = {
    created: '已创建', assigned: '已派发', in_progress: '作业中', awaiting_inspection: '待验收',
    passed: '验收通过', failed: '验收不合格', cancelled: '已取消', open: '待处理', processing: '处理中',
    resolved: '已解决', ignored: '已忽略', pending: '待审批', approved: '已批准', rejected: '已驳回',
    returned: '已归还', draft: '草稿', submitted: '已提交', idle: '空闲', busy: '作业中', leave: '请假',
    working: '作业中', charging: '充电中', fault: '故障', maintenance: '维护中', running: '运行中', stopped: '已停机',
    normal: '正常', warning: '预警', critical: '超标', cleaning: '保洁中', online: '在线', offline: '离线',
    calibrating: '校准中', planned: '已计划', confirmed: '已确认', done: '已完成', absent: '缺勤',
  };
  App.stText = s => App.STATUS_TEXT[s] || s || '—';
  App.stColor = s => ({
    passed: 'green', approved: 'green', resolved: 'green', normal: 'green', running: 'green', idle: 'green', online: 'green', done: 'green', pass: 'green',
    failed: 'red', rejected: 'red', critical: 'red', fault: 'red', cancelled: 'red', offline: 'red', absent: 'red', fail: 'red',
    warning: 'amber', pending: 'amber', charging: 'amber', maintenance: 'amber', processing: 'amber', calibrating: 'amber', leave: 'amber', planned: 'amber',
    in_progress: 'blue', working: 'blue', assigned: 'blue', submitted: 'blue', confirmed: 'blue', busy: 'blue', cleaning: 'blue',
    ignored: 'grey', stopped: 'grey', draft: 'grey', open: 'red',
  }[s] || 'grey');
  App.badge = s => `<span class="badge ${App.stColor(s)}">${App.stText(s)}</span>`;
  App.ROLE_TEXT = { cleaner: '保洁员', leader: '洁净班长', inspector: '质检员', dispatcher: '调度工程师' };
  App.ISO_COLOR = { 5: '#f43f5e', 6: '#f59e0b', 7: '#06b6d4', 8: '#0d9488' };

  /* ---------------- API 通道 ---------------- */
  App.api = async function (path, opt = {}) {
    const headers = { 'X-Token': App.token };
    let body = opt.body;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    let res;
    try {
      res = await fetch('/api' + path, { method: opt.method || 'GET', headers, body });
    } catch (e) {
      throw { msg: '网络异常：无法连接服务器' };
    }
    let j;
    try { j = await res.json(); } catch (e) { throw { msg: '服务器返回异常(' + res.status + ')' }; }
    if (!res.ok || j.ok === false) {
      if (res.status === 401) { App.logout(); }
      throw { msg: j.msg || ('请求失败(' + res.status + ')'), code: j.code || res.status };
    }
    return j;
  };

  /* ---------------- Toast：成绿败红，够大够醒目 ---------------- */
  App.toast = function (msg, ok = true) {
    const root = document.getElementById('toastRoot');
    const t = App.el(`<div class="toast ${ok ? 'ok' : 'bad'}">
      <span class="t-ico">${ok ? '✔' : '✖'}</span><span>${App.esc(msg)}</span></div>`);
    root.appendChild(t);
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 320); }, ok ? 2600 : 4200);
  };

  /* ---------------- 弹窗：不用 backdrop-filter，背景保持清晰 ---------------- */
  App.modal = function ({ title, body, okText = '确 定', onOk, width = 480, danger = false, hideFoot = false }) {
    const root = document.getElementById('modalRoot');
    const scrim = App.el(`<div class="modal-scrim"></div>`);
    const box = App.el(`<div class="modal" style="width:${width}px">
      <div class="modal-head"><b>${App.esc(title)}</b><button class="x">✕</button></div>
      <div class="modal-body"></div>
      ${hideFoot ? '' : `<div class="modal-foot">
        <button class="btn btn-line m-cancel">取 消</button>
        <button class="btn ${danger ? 'rose' : ''} m-ok">${okText}</button>
      </div>`}
    </div>`);
    scrim.appendChild(box);
    const bodyBox = box.querySelector('.modal-body');
    if (typeof body === 'string') bodyBox.innerHTML = body; else if (body) bodyBox.appendChild(body);
    root.appendChild(scrim);
    const close = () => scrim.remove();
    box.querySelector('.x').onclick = close;
    if (!hideFoot) {
      box.querySelector('.m-cancel').onclick = close;
      box.querySelector('.m-ok').onclick = async (ev) => {
        if (!onOk) return close();
        const btn = ev.target; btn.disabled = true; btn.textContent = '处理中…';
        try { const r = await onOk(bodyBox); if (r !== false) close(); }
        catch (e) { App.toast(e.msg || '操作失败', false); }
        finally { btn.disabled = false; btn.textContent = okText; }
      };
    }
    // 点遮罩空白处关闭，但点内容不穿透
    scrim.addEventListener('mousedown', e => { if (e.target === scrim) close(); });
    return { close, body: bodyBox };
  };

  App.confirm = function (msg, danger = true) {
    return new Promise(resolve => {
      App.modal({
        title: '操作确认', width: 400, danger, okText: danger ? '确认执行' : '确 定',
        body: `<div style="font-size:14px;line-height:1.8;padding:6px 2px">
                 <span style="font-size:22px;margin-right:8px">${danger ? '⚠' : 'ℹ'}</span>${App.esc(msg)}</div>`,
        onOk: () => { resolve(true); }, 
      });
      // 取消时返回 false：监听 scrim 移除
      const root = document.getElementById('modalRoot');
      const obs = new MutationObserver(() => { resolve(false); obs.disconnect(); });
      // 只有真正取消（没走 onOk）时才触发；onOk 内部 resolve(true) 后 close 也会触发，用标记防重入
      let done = false;
      const rawResolve = resolve;
      resolve = v => { if (!done) { done = true; rawResolve(v); } };
      obs.observe(root, { childList: true });
    });
  };

  /* ---------------- 页签：每个菜单选一个风格 ---------------- */
  App.tabs = function (host, defs, { style = 'pill', color = 'var(--c-teal)' } = {}) {
    const bar = App.el(`<div class="tabs tabs-${style}" style="--tab-c:${color}"></div>`);
    const pageBox = App.el(`<div class="tab-page"></div>`);
    host.appendChild(bar); host.appendChild(pageBox);
    let active = null, cleanup = null;
    defs.forEach((d, i) => {
      const b = App.el(`<button class="tab">${d.icon ? d.icon + ' ' : ''}${d.label}</button>`);
      b.onclick = () => show(i);
      bar.appendChild(b);
    });
    function show(i) {
      if (cleanup) { try { cleanup(); } catch (e) { } cleanup = null; }
      bar.querySelectorAll('.tab').forEach((t, k) => t.classList.toggle('active', k === i));
      pageBox.innerHTML = '';
      active = i;
      const r = defs[i].render(pageBox);
      if (typeof r === 'function') cleanup = r;
    }
    show(0);
    return { show, bar, pageBox };
  };

  /* ---------------- 3D 脚手架：Three.js 场景 + 手写轨道控制 ---------------- */
  App.three = function (container, { bg = 0x0b2f3c, fog = true } = {}) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bg);
    if (fog) scene.fog = new THREE.Fog(bg, 40, 120);
    const w = container.clientWidth || 800, h = container.clientHeight || 450;
    const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 500);
    camera.position.set(18, 20, 26);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 手写轨道控制：左键旋转、右键平移、滚轮缩放。不引 OrbitControls，
    // 一是 r149 之后官方不再发 UMD 版，二是自己的控制器行为可控。
    const tgt = new THREE.Vector3(0, 0, 0);
    let sph = { r: 40, theta: Math.PI / 4, phi: Math.PI / 3.2 };
    function applyCam() {
      camera.position.set(
        tgt.x + sph.r * Math.sin(sph.phi) * Math.cos(sph.theta),
        tgt.y + sph.r * Math.cos(sph.phi),
        tgt.z + sph.r * Math.sin(sph.phi) * Math.sin(sph.theta));
      camera.lookAt(tgt);
    }
    applyCam();
    let drag = null;
    const cvs = renderer.domElement;
    cvs.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 }; });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const k = sph.r / 600;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        tgt.addScaledVector(right, -dx * k); tgt.addScaledVector(up, dy * k);
      } else {
        sph.theta -= dx * 0.006;
        sph.phi = Math.min(Math.max(sph.phi - dy * 0.005, 0.15), 1.45);
      }
      applyCam();
    });
    window.addEventListener('mouseup', () => drag = null);
    cvs.addEventListener('contextmenu', e => e.preventDefault());
    cvs.addEventListener('wheel', e => {
      sph.r = Math.min(Math.max(sph.r + e.deltaY * 0.03, 10), 110); applyCam();
    }, { passive: true });

    // 拾取：给页面用来点 3D 物体
    const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
    let clickHandlers = [];
    cvs.addEventListener('click', e => {
      const rect = cvs.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
      clickHandlers.forEach(h => h(ray));
    });

    // 自适应 + 自清理
    const ro = new ResizeObserver(() => {
      const W = container.clientWidth, H = container.clientHeight;
      if (!W || !H) return;
      camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H);
    });
    ro.observe(container);
    let raf = null;
    const tickFns = [];
    (function loop() { raf = requestAnimationFrame(loop); tickFns.forEach(f => f()); renderer.render(scene, camera); })();

    return {
      scene, camera, renderer, target: tgt,
      onTick: f => tickFns.push(f),
      onClick: f => clickHandlers.push(f),
      dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.innerHTML = ''; },
    };
  };

  // 常用 3D 小件：发光文字精灵（CSS 画到 canvas 再贴纹理）
  App.three.label = function (text, color = '#7de8dc', big = false) {
    const c = document.createElement('canvas'); c.width = 256; c.height = big ? 96 : 64;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(9,38,48,0.75)'; x.fillRect(0, 0, 256, big ? 96 : 64);
    x.strokeStyle = color; x.lineWidth = 3; x.strokeRect(2, 2, 252, (big ? 96 : 64) - 4);
    x.fillStyle = color; x.font = `bold ${big ? 34 : 26}px Microsoft YaHei`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 128, (big ? 96 : 64) / 2);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.set(big ? 7 : 5, big ? 2.6 : 1.25, 1);
    return sp;
  };

  /* ---------------- 手绘折线图（不用任何图表库） ---------------- */
  App.chart = {
    line(canvas, { labels = [], series = [], limit = null, unit = '' }) {
      const ctx = canvas.getContext('2d');
      const dpr = Math.min(devicePixelRatio, 2);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr);
      const pad = { l: 52, r: 14, t: 16, b: 26 };
      const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      const all = series.flatMap(s => s.data).filter(v => v != null);
      let max = Math.max(...all, limit || 0) * 1.12, min = Math.min(...all, 0);
      if (max === min) max = min + 1;
      const X = i => pad.l + iw * (i / Math.max(1, labels.length - 1));
      const Y = v => pad.t + ih * (1 - (v - min) / (max - min));
      // 网格与刻度
      ctx.strokeStyle = 'rgba(14,52,66,.12)'; ctx.fillStyle = '#5a7a84'; ctx.font = '10.5px sans-serif';
      for (let g = 0; g <= 4; g++) {
        const v = min + (max - min) * g / 4, y = Y(v);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
        ctx.textAlign = 'right'; ctx.fillText(App.chart._fmtNum(v), pad.l - 6, y + 3);
      }
      // 限值虚线
      if (limit != null && limit < max && limit > min) {
        ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(pad.l, Y(limit)); ctx.lineTo(W - pad.r, Y(limit)); ctx.stroke();
        ctx.fillStyle = '#e11d48'; ctx.textAlign = 'left';
        ctx.fillText('ISO限值 ' + App.chart._fmtNum(limit), pad.l + 6, Y(limit) - 5); ctx.restore();
      }
      // 时间刻度
      ctx.fillStyle = '#5a7a84'; ctx.textAlign = 'center';
      const step = Math.ceil(labels.length / 6);
      labels.forEach((lb, i) => { if (i % step === 0) ctx.fillText(String(lb).slice(11, 16) || lb, X(i), H - 8); });
      // 数据线与渐变填充。null/undefined 视为断点：折线跳过、填充按连续段分别闭合，
      // 实测段与预测段拼在同一时间轴上时不会互相串线。
      series.forEach(s => {
        const runs = [];   // 连续有效段 [startIdx, endIdx]
        let start = -1;
        s.data.forEach((v, i) => {
          if (v != null && start < 0) start = i;
          if ((v == null || i === s.data.length - 1) && start >= 0) {
            runs.push([start, v != null && i === s.data.length - 1 ? i : i - 1]);
            start = -1;
          }
        });
        ctx.save();
        const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
        grad.addColorStop(0, s.color + '55'); grad.addColorStop(1, s.color + '00');
        ctx.fillStyle = grad;
        runs.forEach(([a, b]) => {
          ctx.beginPath();
          for (let i = a; i <= b; i++) i === a ? ctx.moveTo(X(i), Y(s.data[i])) : ctx.lineTo(X(i), Y(s.data[i]));
          ctx.lineTo(X(b), Y(min)); ctx.lineTo(X(a), Y(min)); ctx.closePath(); ctx.fill();
        });
        ctx.restore();
        ctx.beginPath(); ctx.lineWidth = 2.2; ctx.strokeStyle = s.color;
        runs.forEach(([a, b]) => {
          for (let i = a; i <= b; i++) i === a ? ctx.moveTo(X(i), Y(s.data[i])) : ctx.lineTo(X(i), Y(s.data[i]));
        });
        ctx.stroke();
      });
    },
    _fmtNum(v) { return v >= 10000 ? (v / 10000).toFixed(1) + 'w' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(v < 10 ? 1 : 0); },
  };

  /* ---------------- 页面注册与跳转 ---------------- */
  App.register = function (name, def) { App.pages[name] = def; App.order.push(name); };

  App.go = function (name) {
    const def = App.pages[name];
    if (!def) return;
    if (App.current && App.current.dispose) { try { App.current.dispose(); } catch (e) { } }
    document.getElementById('hubView').style.display = 'none';
    const host = document.getElementById('pageHost');
    host.style.display = 'flex';
    host.innerHTML = '';
    document.querySelectorAll('.chip-btn').forEach(c => c.classList.toggle('active', c.dataset.name === name));
    App.current = { name, dispose: null };
    const r = def.render(host);
    if (typeof r === 'function') App.current.dispose = r;
    location.hash = '/' + name;
  };

  App.goHub = function () {
    if (App.current && App.current.dispose) { try { App.current.dispose(); } catch (e) { } }
    App.current = null;
    document.getElementById('pageHost').style.display = 'none';
    document.getElementById('hubView').style.display = 'grid';
    document.querySelectorAll('.chip-btn').forEach(c => c.classList.remove('active'));
    location.hash = '/hub';
  };

  App.logout = function () {
    localStorage.removeItem('cr_token');
    App.token = ''; App.user = null;
    document.getElementById('appView').style.display = 'none';
    document.getElementById('loginView').style.display = 'flex';
  };
})();
