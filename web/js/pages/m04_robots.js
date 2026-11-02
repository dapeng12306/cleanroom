/* ==========================================================================
   m04 机器人协同 —— 3D 机群指挥 / 编队台账 / 指令控制台
   机器人模型自己拼：底盘 + 顶盖 + 双刷盘 + 状态灯，工作中的机器人刷盘会转。
   ========================================================================== */
App.register('m04', {
  title: '机器人协同', icon: '🤖', color: '#7c3aed',
  bg: 'linear-gradient(135deg,#7c3aed,#5b21b6)',
  bgImg: '/web/assets/img/robot_scrubber.jpg',
  desc: '3D 机群实时指挥 · 编队台账 · 人机房协同指令台',
  subs: ['3D机群指挥', '编队台账', '指令控制台'],

  render(host) {
    host.appendChild(App.el(`
      <div class="page-head">
        <div class="ph-icon" style="background:linear-gradient(135deg,#8b5cf6,#7c3aed)">🤖</div>
        <div><h2>机器人协同</h2><div class="ph-sub">人机协同编队 · 洗地/吸尘/紫外/拖洗四型混编</div></div>
        <div class="spacer"></div>
        <button class="btn btn-line" id="m04-back">⌂ 返回菜单中枢</button>
      </div>`));
    host.querySelector('#m04-back').onclick = () => App.goHub();
    const body = App.el(`<div class="page-body"></div>`);
    host.appendChild(body);
    App.tabs(body, [
      { label: '3D机群指挥', icon: '🎮', render: el => this.tab3D(el) },
      { label: '编队台账', icon: '🗂', render: el => this.tabFleet(el) },
      { label: '指令控制台', icon: '🕹', render: el => this.tabConsole(el) },
    ], { style: 'pill', color: '#7c3aed' });
  },

  TYPE_COLOR: { scrubber: 0x06b6d4, vacuum: 0x8b5cf6, uv: 0xf43f5e, mop: 0xf59e0b },
  TYPE_TEXT: { scrubber: '洗地型', vacuum: '吸尘型', uv: '紫外消杀', mop: '拖洗型' },
  STATUS_COLOR: { idle: 0x38bdf8, working: 0x34d399, charging: 0xfbbf24, fault: 0xff2d55, maintenance: 0xfb923c },

  /* 拼一台机器人模型：底盘+顶盖+双刷盘+状态灯+（工作中的）旋转光环 */
  buildRobot(r) {
    const g = new THREE.Group();
    const bodyColor = this.TYPE_COLOR[r.robot_type] || 0x06b6d4;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.95, 1.1, .55, 28),
      new THREE.MeshStandardMaterial({ color: bodyColor, roughness: .35, metalness: .45 }));
    base.position.y = .35; base.castShadow = true;
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(.7, .9, .35, 28),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: .4 }));
    deck.position.y = .78;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(.4, 18, 12),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: .2, metalness: .3 }));
    dome.position.y = 1.1;
    // 双刷盘：洗地机的标志性部件
    const brushMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: .8 });
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, .12, 16), brushMat);
    b1.position.set(.5, .08, .7); b1.name = 'brush';
    const b2 = b1.clone(); b2.position.set(-.5, .08, .7); b2.name = 'brush';
    // 顶部状态灯
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(.14, 10, 8),
      new THREE.MeshBasicMaterial({ color: this.STATUS_COLOR[r.status] || 0x38bdf8 }));
    lamp.position.y = 1.5; lamp.name = 'lamp';
    // 紫外消杀型加一根灯管
    if (r.robot_type === 'uv') {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 1.2, 8),
        new THREE.MeshBasicMaterial({ color: 0xc084fc }));
      tube.position.y = 1.6; g.add(tube);
    }
    g.add(base, deck, dome, b1, b2, lamp);
    g.userData.r = r;
    return g;
  },

  /* ---------------- 子页1：3D 机群指挥 ---------------- */
  tab3D(el) {
    el.appendChild(App.el(`<div class="three-box" id="m04-3d" style="flex:1;min-height:0"></div>`));
    const box = el.querySelector('#m04-3d');
    const T = App.three(box, { bg: 0x14082e });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 50),
      new THREE.MeshStandardMaterial({ color: 0x2d2140, roughness: .9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    T.scene.add(floor, new THREE.GridHelper(70, 35, 0x8b5cf6, 0x3b2d5c), new THREE.AmbientLight(0xffffff, .5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(15, 28, 14); sun.castShadow = true; T.scene.add(sun);

    const robots = {}; let zones = [];
    async function refresh() {
      try {
        const [scene, fleet] = await Promise.all([App.api('/dashboard/scene'), App.api('/robots/fleet')]);
        // 区域轮廓只画一次
        if (!zones.length) {
          zones = scene.data.zones;
          zones.forEach(z => {
            const geo = new THREE.BoxGeometry(z.w, .5, z.h);
            const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
              color: parseInt((App.ISO_COLOR[z.iso_class] || '#06b6d4').slice(1), 16), transparent: true, opacity: .22 }));
            m.position.set(z.x, .25, z.y); T.scene.add(m);
            const lb = App.three.label(z.name, '#c4b5fd');
            lb.position.set(z.x, 2.6, z.y); T.scene.add(lb);
          });
        }
        // 机器人模型随数据增量挂载，已存在的只更新状态灯和位置
        scene.data.robots.forEach(r => {
          let grp = robots[r.id];
          if (!grp) { grp = App.pages.m04.buildRobot(r); T.scene.add(grp); robots[r.id] = grp; }
          grp.userData.r = r;
          grp.position.set(r.x, 0, r.y);
          const lamp = grp.getObjectByName('lamp');
          if (lamp) lamp.material.color.setHex(App.pages.m04.STATUS_COLOR[r.status] || 0x38bdf8);
        });
        const f = fleet.data;
        box.querySelector('#m04-hud').innerHTML =
          `<b>机群态势</b><br>作业 ${f.by_status.working || 0} · 空闲 ${f.by_status.idle || 0} · 充电 ${f.by_status.charging || 0} · 故障 ${f.by_status.fault || 0}<br>平均电量 ${f.avg_battery}% · 累计工时 ${f.total_hours}h`;
      } catch (e) { App.toast(e.msg, false); }
    }
    box.appendChild(App.el(`<div class="three-hud"><div class="hud-chip" id="m04-hud">载入中…</div></div>
      <div class="three-legend">🔵空闲 🟢作业 🟡充电 🔴故障<br>点击机器人下指令 · 左键旋转 / 滚轮缩放</div>`));
    refresh();
    const timer = setInterval(refresh, 8000);

    let t0 = 0;
    T.onTick(() => {
      t0 += .016;
      Object.values(robots).forEach(g => {
        const r = g.userData.r;
        if (r.status === 'working') {
          g.children.filter(c => c.name === 'brush').forEach(b => b.rotation.y += .35);
          g.position.x = r.x + Math.sin(t0 * .6 + r.id * 2) * .9;
          g.position.z = r.y + Math.cos(t0 * .45 + r.id * 2) * .9;
          g.rotation.y = Math.sin(t0 * .3) * .4;
        }
        const lamp = g.getObjectByName('lamp');
        if (lamp && (r.status === 'fault' || r.status === 'charging'))
          lamp.material.opacity = .5 + Math.sin(t0 * 6) * .5, lamp.material.transparent = true;
      });
    });

    T.onClick(ray => {
      const hits = ray.intersectObjects(Object.values(robots), true);
      if (!hits.length) return;
      let g = hits[0].object; while (g.parent && !g.userData.r) g = g.parent;
      const r = g.userData.r; if (!r) return;
      App.pages.m04.robotCmdModal(r, () => { refresh(); });
    });
    return () => { clearInterval(timer); T.dispose(); };
  },

  /* 机器人指令弹窗（3D 页和台账页共用） */
  robotCmdModal(r, after) {
    App.modal({
      title: `${r.name} · ${r.code}`, width: 460, hideFoot: true,
      body: `<div style="line-height:2;font-size:13.5px">
        <div>机型：<b>${this.TYPE_TEXT[r.robot_type] || r.robot_type}</b>（${r.model || 'CR-X'}）　状态：${App.badge(r.status)}</div>
        <div>电量：<b style="color:${r.battery > 50 ? 'var(--ok)' : r.battery > 20 ? 'var(--warn)' : 'var(--bad)'}">${r.battery}%</b>
          　模式：${{ auto: '全自动', manual: '人工遥控', collaborative: '人机协同' }[r.mode]}</div>
        <div>位置：(${r.x.toFixed(1)}, ${r.y.toFixed(1)})　累计工时：${r.total_hours}h</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">
          <button class="btn sm emerald" data-cmd="start">▶ 启动作业</button>
          <button class="btn sm slate" data-cmd="pause">⏸ 暂停</button>
          <button class="btn sm amber" data-cmd="charge">⚡ 回充</button>
          <button class="btn sm violet" id="rc-mode">⟳ 切换模式</button>
        </div></div>`,
    });
    document.querySelectorAll('[data-cmd]').forEach(b => b.onclick = async () => {
      try {
        const j = await App.api(`/robots/${r.id}/command`, { method: 'POST', body: { action: b.dataset.cmd } });
        App.toast(j.msg || '指令已执行');
        document.querySelector('.modal-scrim')?.remove(); after && after();
      } catch (e) { App.toast(e.msg, false); }
    });
    document.getElementById('rc-mode').onclick = async () => {
      const next = { auto: 'collaborative', collaborative: 'manual', manual: 'auto' }[r.mode];
      try {
        const j = await App.api(`/robots/${r.id}/command`, { method: 'POST', body: { action: 'mode', mode: next } });
        App.toast(j.msg || '模式已切换');
        document.querySelector('.modal-scrim')?.remove(); after && after();
      } catch (e) { App.toast(e.msg, false); }
    };
  },

  /* ---------------- 子页2：编队台账（卡片式，无表格） ---------------- */
  async tabFleet(el) {
    el.innerHTML = `<div class="panel" style="height:100%"><div class="panel-head">
      <b>机器人编队台账</b><span class="tag">六机混编</span>
      <div class="spacer"></div><button class="btn sm violet" id="m04-add">＋ 登记新机器人</button></div>
      <div class="panel-body" id="m04-list" style="display:flex;flex-direction:column;gap:10px"></div></div>`;
    const box = el.querySelector('#m04-list');
    const load = async () => {
      let robots;
      try { robots = (await App.api('/robots/list')).data; } catch (e) { App.toast(e.msg, false); return; }
      box.innerHTML = '';
      robots.forEach((r, i) => {
        const batColor = r.battery > 50 ? '#059669' : r.battery > 20 ? '#d97706' : '#e11d48';
        const c = 2 * Math.PI * 20, off = c * (1 - r.battery / 100);
        const card = App.el(`<div style="display:flex;align-items:center;gap:16px;background:#fff9;border-radius:13px;
          padding:12px 18px;box-shadow:var(--shadow);animation:fadeUp .35s ${i * 50}ms both">
          <div style="width:46px;height:46px;border-radius:12px;display:grid;place-items:center;font-size:24px;color:#fff;
            background:#${(this.TYPE_COLOR[r.robot_type] || 0x06b6d4).toString(16).padStart(6, '0')}">🤖</div>
          <div style="min-width:150px"><b style="font-size:14.5px">${r.name}</b>
            <div style="font-size:11.5px;color:var(--ink-soft)">${r.code} · ${this.TYPE_TEXT[r.robot_type]}</div></div>
          <div class="ring-wrap" style="position:relative;width:48px;height:48px">
            <svg width="48" height="48"><circle cx="24" cy="24" r="20" fill="none" stroke="#e2e8f0" stroke-width="5"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="${batColor}" stroke-width="5" stroke-linecap="round"
                stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 24 24)"/></svg>
            <span style="position:absolute;font-size:10.5px;font-weight:700">${Math.round(r.battery)}%</span></div>
          <div>${App.badge(r.status)}</div>
          <div style="font-size:11.5px;color:var(--ink-soft)">${{ auto: '全自动', manual: '人工遥控', collaborative: '人机协同' }[r.mode]}<br>工时 ${r.total_hours}h</div>
          <div style="font-size:11.5px;color:var(--ink-soft)">所属区域<br><b style="color:var(--ink)">${r.zone_name || '机动'}</b></div>
          <div style="flex:1"></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn sm emerald" data-cmd="start">启动</button>
            <button class="btn sm slate" data-cmd="pause">暂停</button>
            <button class="btn sm amber" data-cmd="charge">充电</button>
            <button class="btn sm blue act-edit">编辑</button>
            <button class="btn sm rose act-del">删除</button>
          </div></div>`);
        card.querySelectorAll('[data-cmd]').forEach(b => b.onclick = async () => {
          try { const j = await App.api(`/robots/${r.id}/command`, { method: 'POST', body: { action: b.dataset.cmd } });
            App.toast(j.msg); load(); } catch (e) { App.toast(e.msg, false); }
        });
        card.querySelector('.act-edit').onclick = () => this.editRobot(r, load);
        card.querySelector('.act-del').onclick = async () => {
          if (!await App.confirm(`确定将 ${r.name}（${r.code}）移出编队？`)) return;
          try { const j = await App.api(`/robots/${r.id}`, { method: 'DELETE' }); App.toast(j.msg); load(); }
          catch (e) { App.toast(e.msg, false); }
        };
        box.appendChild(card);
      });
    };
    el.querySelector('#m04-add').onclick = async () => {
      let zones;
      try { zones = (await App.api('/dashboard/scene')).data.zones; } catch (e) { App.toast(e.msg, false); return; }
      App.modal({
        title: '登记新机器人', width: 460, okText: '登记入库',
        body: `<div class="form-grid">
          <div class="field"><label>名称</label><input id="nr-name" placeholder="如 净行者四号"></div>
          <div class="field"><label>类型</label><select id="nr-type">
            <option value="scrubber">洗地型</option><option value="vacuum">吸尘型</option>
            <option value="uv">紫外消杀</option><option value="mop">拖洗型</option></select></div>
          <div class="field"><label>型号</label><input id="nr-model" value="CR-Scrubber X2"></div>
          <div class="field"><label>所属区域</label><select id="nr-zone">
            ${zones.map(z => `<option value="${z.id}">${z.name}</option>`).join('')}</select></div>
        </div>`,
        async onOk(bx) {
          const name = bx.querySelector('#nr-name').value.trim();
          if (!name) { App.toast('名称不能为空', false); return false; }
          const j = await App.api('/robots/create', { method: 'POST', body: {
            name, robot_type: bx.querySelector('#nr-type').value,
            model: bx.querySelector('#nr-model').value.trim(),
            zone_id: +bx.querySelector('#nr-zone').value } });
          App.toast(j.msg); load();
        },
      });
    };
    await load();
  },

  editRobot(r, reload) {
    App.modal({
      title: `编辑 ${r.name}`, width: 440, okText: '保存',
      body: `<div class="form-grid">
        <div class="field"><label>名称</label><input id="er-name" value="${App.esc(r.name)}"></div>
        <div class="field"><label>类型</label><select id="er-type">
          ${['scrubber', 'vacuum', 'uv', 'mop'].map(tp =>
            `<option value="${tp}" ${r.robot_type === tp ? 'selected' : ''}>${this.TYPE_TEXT[tp]}</option>`).join('')}</select></div>
        <div class="field full"><label>模式</label><select id="er-mode">
          ${[['auto', '全自动'], ['manual', '人工遥控'], ['collaborative', '人机协同']].map(([v, t]) =>
            `<option value="${v}" ${r.mode === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>`,
      async onOk(bx) {
        const j = await App.api(`/robots/${r.id}`, { method: 'PUT', body: {
          name: bx.querySelector('#er-name').value.trim(),
          robot_type: bx.querySelector('#er-type').value,
          mode: bx.querySelector('#er-mode').value } });
        App.toast(j.msg || '已保存'); reload();
      },
    });
  },

  /* ---------------- 子页3：指令控制台（深色终端风） ---------------- */
  async tabConsole(el) {
    el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1.6fr;gap:12px;height:100%">
      <div class="panel dark"><div class="panel-head"><b style="color:#7de8dc">在线机体</b></div>
        <div class="panel-body" id="m04-units"></div></div>
      <div style="display:flex;flex-direction:column;gap:12px;min-height:0">
        <div class="panel dark" style="flex:none"><div class="panel-head"><b style="color:#7de8dc">指令面板</b>
          <span class="tag" id="m04-cur">未选定机体</span></div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:4px 2px 10px">
            <button class="btn emerald" data-cmd="start" style="padding:16px 0">▶<br>启动作业</button>
            <button class="btn slate" data-cmd="pause" style="padding:16px 0">⏸<br>暂停待命</button>
            <button class="btn amber" data-cmd="charge" style="padding:16px 0">⚡<br>返回充电</button>
            <button class="btn violet" id="m04-mode" style="padding:16px 0">⟳<br>切换模式</button>
          </div>
          <div style="display:flex;gap:8px;padding:0 2px 6px">
            <select id="m04-zone-sel" style="flex:1;padding:8px;border-radius:9px;border:1px solid #2a5560;background:#0c2b36;color:#cdf3ee"></select>
            <button class="btn cyan" id="m04-move">➤ 移动到该区域</button>
          </div></div>
        <div class="panel dark" style="flex:1;min-height:0"><div class="panel-head"><b style="color:#7de8dc">指令回执</b></div>
          <div class="panel-body" id="m04-log" style="font-family:Consolas,monospace;font-size:12px;line-height:1.9"></div></div>
      </div></div>`;

    let cur = null;
    const log = (msg, ok) => {
      const box = el.querySelector('#m04-log');
      box.insertAdjacentHTML('afterbegin',
        `<div style="color:${ok ? '#4ade80' : '#fb7185'}">[${new Date().toLocaleTimeString()}] ${ok ? '✔' : '✖'} ${App.esc(msg)}</div>`);
    };

    let robots, zones;
    try {
      [robots, zones] = await Promise.all([App.api('/robots/list'), App.api('/dashboard/scene')]);
    } catch (e) { App.toast(e.msg, false); return; }
    zones.data.zones.forEach(z =>
      el.querySelector('#m04-zone-sel').appendChild(App.el(`<option value="${z.id}" data-x="${z.x}" data-y="${z.y}">${z.name}（${z.x},${z.y}）</option>`)));

    const units = el.querySelector('#m04-units');
    robots.data.forEach(r => {
      const u = App.el(`<div style="padding:10px 12px;border-radius:10px;border:1px solid #2a5560;margin-bottom:8px;cursor:pointer;transition:all .15s">
        <b style="font-size:13.5px;color:#e8fcfa">${r.name}</b> ${App.badge(r.status)}
        <div style="font-size:11px;color:#7fb3ad;margin-top:3px">${r.code} · 电量 ${Math.round(r.battery)}% · ${this.TYPE_TEXT[r.robot_type]}</div></div>`);
      u.onclick = () => {
        units.querySelectorAll('div[style]').forEach(x => x.style.borderColor = '#2a5560');
        u.style.borderColor = '#14e0c8';
        cur = r;
        el.querySelector('#m04-cur').textContent = `当前：${r.name}（${r.code}）`;
        log(`选定机体 ${r.name}`, true);
      };
      units.appendChild(u);
    });

    el.querySelectorAll('[data-cmd]').forEach(b => b.onclick = async () => {
      if (!cur) { App.toast('请先在左侧选定一台机体', false); log('未选定机体，指令被拒绝', false); return; }
      try {
        const j = await App.api(`/robots/${cur.id}/command`, { method: 'POST', body: { action: b.dataset.cmd } });
        App.toast(j.msg); log(`${cur.name} ← ${b.dataset.cmd.toUpperCase()}：${j.msg}`, true);
        cur = (await App.api('/robots/list')).data.find(x => x.id === cur.id);
      } catch (e) { App.toast(e.msg, false); log(`${cur.name} ← ${b.dataset.cmd.toUpperCase()}：${e.msg}`, false); }
    });
    el.querySelector('#m04-mode').onclick = async () => {
      if (!cur) return App.toast('请先选定机体', false);
      const next = { auto: 'collaborative', collaborative: 'manual', manual: 'auto' }[cur.mode];
      try {
        const j = await App.api(`/robots/${cur.id}/command`, { method: 'POST', body: { action: 'mode', mode: next } });
        App.toast(j.msg); log(`${cur.name} 模式切换：${j.msg}`, true);
        cur = (await App.api('/robots/list')).data.find(x => x.id === cur.id);
      } catch (e) { App.toast(e.msg, false); log(e.msg, false); }
    };
    el.querySelector('#m04-move').onclick = async () => {
      if (!cur) return App.toast('请先选定机体', false);
      const opt = el.querySelector('#m04-zone-sel').selectedOptions[0];
      try {
        const j = await App.api(`/robots/${cur.id}/command`, { method: 'POST',
          body: { action: 'move', x: +opt.dataset.x, y: +opt.dataset.y } });
        App.toast(j.msg); log(`${cur.name} 移动至 ${opt.textContent}：${j.msg}`, true);
      } catch (e) { App.toast(e.msg, false); log(e.msg, false); }
    };
    log('控制台就绪，等待指令…', true);
  },
});
