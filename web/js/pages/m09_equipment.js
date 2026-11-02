/* ==========================================================================
   m09 设备设施 —— 3D 设备层 / 设备台账 / 保养计划
   布局走"竖排页签 + 全息机房"路子：FFU 吊顶阵列里风扇真的会转，
   故障机组闪红光。台账卡片带四态状态机弹窗，ISO6 冗余拦截
   是演示时最能打的一条业务规则，弹窗里特意把话说明白。
   ========================================================================== */
App.register('m09', {
  title: '设备设施', icon: '🌬️', color: '#0d9488',
  bg: 'linear-gradient(135deg,#14b8a6,#0f766e)',
  bgImg: '/web/assets/img/ffu_ceiling.jpg',
  desc: 'FFU 吊顶阵列 · 四态状态机 · 保养周期双阈值',
  subs: ['3D 设备层', '设备台账', '保养计划'],

  ETYPE: {
    ffu: ['风机过滤单元', '#06b6d4'], air_shower: ['风淋室', '#8b5cf6'],
    pass_box: ['传递窗', '#d97706'], ahu: ['空调机组', '#0d9488'], hepa: ['高效过滤器', '#e11d48'],
  },
  /* 状态机镜像后端 FLOW：fault 不能直接回 running，必须先保养维修 */
  FLOW: {
    running: ['stopped', 'maintenance', 'fault'],
    stopped: ['running', 'maintenance', 'fault'],
    maintenance: ['running', 'stopped'],
    fault: ['maintenance', 'stopped'],
  },
  ST_COLOR: { running: '#059669', stopped: '#64748b', maintenance: '#d97706', fault: '#e11d48' },
  MAINT_HOURS: 8000, MAINT_DAYS: 45,

  render(host) {
    host.appendChild(App.el(`
      <div class="page-head">
        <div class="ph-icon" style="background:linear-gradient(135deg,#2dd4bf,#0d9488)">🌬️</div>
        <div><h2>设备设施</h2><div class="ph-sub">ISO6 及以上区域 FFU 至少 2 台在线 · 故障必须先修后投 · 保养复投时长清零</div></div>
        <div class="spacer"></div>
        <button class="btn btn-line" id="m09-back">⌂ 返回菜单中枢</button>
      </div>`));
    host.querySelector('#m09-back').onclick = () => App.goHub();
    const body = App.el(`<div class="page-body"></div>`);
    host.appendChild(body);
    /* 竖排页签要一个横向容器，左侧轨道右侧页面 */
    const row = App.el(`<div style="display:flex;gap:14px;height:100%;min-height:0"></div>`);
    body.appendChild(row);
    App.tabs(row, [
      { label: '3D 设备层', icon: '🧊', render: el => this.tab3d(el) },
      { label: '设备台账', icon: '📇', render: el => this.tabLedger(el) },
      { label: '保养计划', icon: '🛠', render: el => this.tabMaint(el) },
    ], { style: 'vertical', color: '#0d9488' });
    row.querySelector('.tab-page').style.flex = '1';
  },

  /* ---------------- 子页1：3D 设备层 ---------------- */
  tab3d(el) {
    el.appendChild(App.el(`<div class="three-box" style="flex:1;min-height:0"></div>`));
    const box = el.querySelector('.three-box');
    const T = App.three(box, { bg: 0x0d2b33 });

    // 机房地板：深色环氧 + 青网格，走"全息机房"风格
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 50),
      new THREE.MeshStandardMaterial({ color: 0x9fb8b2, roughness: .8 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    T.scene.add(floor);
    T.scene.add(new THREE.GridHelper(70, 35, 0x2dd4bf, 0x1d4d46));
    T.scene.add(new THREE.AmbientLight(0xffffff, .5));
    const sun = new THREE.DirectionalLight(0xffffff, .85);
    sun.position.set(15, 28, 14); sun.castShadow = true; T.scene.add(sun);
    // 吊顶钢架：一根横贯的梁，FFU 阵列就有了"吊在顶上"的参照
    const beam = new THREE.Mesh(new THREE.BoxGeometry(64, .5, .8),
      new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: .6, roughness: .4 }));
    beam.position.set(0, 3.6, 0); T.scene.add(beam);

    const eqGroups = {};   // id -> {grp, fan, base}
    let tick = 0;
    const self = this;

    /* 按类型建模：FFU 带可转风扇，风淋室带门框，传递窗双门，AHU 大箱体+风管 */
    function buildEq(eq) {
      const grp = new THREE.Group();
      const col = self.ST_COLOR[eq.status] || 0x64748b;
      let fan = null;
      if (eq.etype === 'ffu') {
        // 箱体 + 散流板 + 三叶风扇（运行时旋转）
        const box1 = new THREE.Mesh(new THREE.BoxGeometry(1.5, .55, 1.5),
          new THREE.MeshStandardMaterial({ color: 0xd7e4e1, metalness: .5, roughness: .35 }));
        box1.castShadow = true;
        const grille = new THREE.Mesh(new THREE.CylinderGeometry(.62, .62, .06, 24),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: .35 }));
        grille.position.y = -.32;
        fan = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(.52, .03, .13),
            new THREE.MeshStandardMaterial({ color: 0x334155 }));
          blade.position.x = .28;
          const pivot = new THREE.Group(); pivot.rotation.y = i * Math.PI * 2 / 3; pivot.add(blade);
          fan.add(pivot);
        }
        fan.position.y = -.28;
        grp.add(box1, grille, fan);
        // 吊杆
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .8, 8),
          new THREE.MeshStandardMaterial({ color: 0x94a3b8 }));
        rod.position.y = .65; grp.add(rod);
      } else if (eq.etype === 'air_shower') {
        // 风淋室：双门小间，两侧喷嘴柱
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.6, 1.8),
          new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: .3, roughness: .5, transparent: true, opacity: .92 }));
        cab.position.y = 0; cab.castShadow = true;
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.1, .08),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: .25 }));
        door.position.set(0, 0, .94);
        grp.add(cab, door);
        [-0.95, 0.95].forEach(x => {
          const jet = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 2.0, 8),
            new THREE.MeshStandardMaterial({ color: 0x8b5cf6 }));
          jet.position.set(x, 0, 0); grp.add(jet);
        });
      } else if (eq.etype === 'pass_box') {
        // 传递窗：嵌墙方箱 + 两面门缝
        const bx = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.2),
          new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: .4, roughness: .4 }));
        bx.castShadow = true;
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, .7, .06),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: .3 }));
        win.position.z = .63;
        grp.add(bx, win);
      } else if (eq.etype === 'ahu') {
        // 空调机组：卧式大箱 + 离心风机段 + 出风管
        const cab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.7, 1.6),
          new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: .55, roughness: .35 }));
        cab.castShadow = true;
        const coil = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, 1.5, 20),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: .3 }));
        coil.rotation.z = Math.PI / 2; coil.position.set(-1.1, .1, 0);
        const duct = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, 3.2, 14),
          new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: .6, roughness: .3 }));
        duct.rotation.x = Math.PI / 2; duct.position.set(1.6, .45, -1.4);
        grp.add(cab, coil, duct);
      } else {
        // hepa：吊装平板 + 检测口
        const plate = new THREE.Mesh(new THREE.BoxGeometry(1.3, .3, 1.3),
          new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: .3, roughness: .5 }));
        plate.castShadow = true;
        const port = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .2, 12),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: .4 }));
        port.position.y = -.25;
        grp.add(plate, port);
      }
      return { grp, fan };
    }

    function colorOf(eq) { return self.ST_COLOR[eq.status] || '#64748b'; }

    async function rebuild() {
      let eqs, zones;
      try {
        [eqs, zones] = await Promise.all([
          App.api('/equipment/scene').then(j => j.data),
          App.api('/dashboard/scene').then(j => j.data.zones),
        ]);
      } catch (e) { App.toast(e.msg, false); return; }
      // 区域半透明地面块，给个空间参照
      zones.forEach(z => {
        const key = 'zone' + z.id;
        if (eqGroups[key]) return;
        const m = new THREE.Mesh(new THREE.BoxGeometry(z.w, .12, z.h),
          new THREE.MeshStandardMaterial({ color: 0x2dd4bf, transparent: true, opacity: .12 }));
        m.position.set(z.x, .06, z.y); T.scene.add(m); eqGroups[key] = { grp: m };
        const lb = App.three.label(z.name, '#5eead4');
        lb.position.set(z.x, .9, z.y - z.h / 2 - .5); T.scene.add(lb);
        eqGroups[key + 'lb'] = { grp: lb };
      });
      const seen = new Set();
      eqs.forEach(eq => {
        seen.add(eq.id);
        let rec = eqGroups[eq.id];
        if (!rec) {
          rec = buildEq(eq);
          rec.grp.position.set(eq.x, eq.etype === 'ffu' || eq.etype === 'hepa' ? (eq.z || 2.8) : (eq.etype === 'ahu' ? 1.0 : 1.35), eq.y);
          rec.grp.userData.eq = eq;
          T.scene.add(rec.grp);
          const lb = App.three.label(eq.code, '#' + new THREE.Color(colorOf(eq)).getHexString());
          lb.position.set(eq.x, rec.grp.position.y + 1.6, eq.y);
          T.scene.add(lb); rec.lb = lb;
          eqGroups[eq.id] = rec;
        }
        rec.grp.userData.eq = eq;
        // 状态变色：遍历子件里带 emissive 的换色
        const c = new THREE.Color(colorOf(eq));
        rec.grp.traverse(o => { if (o.material && o.material.emissiveIntensity) o.material.color.copy(c), o.material.emissive.copy(c); });
        rec.lb.material.map = App.three.label(eq.code, '#' + c.getHexString()).material.map;
        rec.lb.material.needsUpdate = true;   // 换贴图必须标脏，否则颜色不刷新
      });
      // 删掉的设备从场景里摘除
      Object.keys(eqGroups).forEach(k => {
        if (String(k).startsWith('zone')) return;
        if (!seen.has(+k)) { T.scene.remove(eqGroups[k].grp); eqGroups[k].lb && T.scene.remove(eqGroups[k].lb); delete eqGroups[k]; }
      });
      // HUD 统计
      const cnt = { running: 0, stopped: 0, maintenance: 0, fault: 0 };
      eqs.forEach(e => cnt[e.status] = (cnt[e.status] || 0) + 1);
      box.querySelector('#m09-hud').innerHTML =
        `<b>设备态势</b><br>运行 ${cnt.running} · 停机 ${cnt.stopped} · 保养 ${cnt.maintenance} · 故障 ${cnt.fault}<br>点击设备模型可查看详情与切换状态`;
    }

    box.appendChild(App.el(`<div class="three-hud"><div class="hud-chip" id="m09-hud">载入中…</div></div>
      <div class="three-legend">🟢 运行　⚫ 停机　🟠 保养　🔴 故障<br>FFU 风扇转动 = 运行中<br>左键旋转 / 右键平移 / 滚轮缩放 / 点击设备</div>`));

    rebuild();
    const timer = setInterval(rebuild, 9000);

    T.onTick(() => {
      tick += .016;
      Object.values(eqGroups).forEach(rec => {
        if (!rec.grp || !rec.grp.userData || !rec.grp.userData.eq) return;
        const eq = rec.grp.userData.eq;
        if (rec.fan && eq.status === 'running') rec.fan.rotation.y += .35;   // 运行中的 FFU 风扇常转
        if (eq.status === 'fault') {                                          // 故障整机呼吸闪红
          const s = .55 + Math.sin(tick * 6) * .45;
          rec.grp.traverse(o => { if (o.material && o.material.emissiveIntensity) o.material.emissiveIntensity = s; });
        }
      });
    });

    // 点击设备 → 详情弹窗（含状态切换）
    T.onClick(ray => {
      const hits = ray.intersectObjects(Object.values(eqGroups).filter(r => r.grp && r.grp.userData && r.grp.userData.eq).map(r => r.grp), true);
      if (!hits.length) return;
      let g = hits[0].object; while (g && !(g.userData && g.userData.eq)) g = g.parent;
      if (g) this.eqDetail(g.userData.eq, rebuild);
    });

    return () => { clearInterval(timer); T.dispose(); };
  },

  /* 设备详情 + 状态机切换弹窗（3D 页与台账页共用） */
  eqDetail(eq, onChanged) {
    const targets = this.FLOW[eq.status] || [];
    App.modal({
      title: `${eq.name} · ${eq.code}`, width: 460, hideFoot: true,
      body: `<div style="font-size:13px">
        <div style="display:flex;gap:10px;margin-bottom:12px">
          <div class="kpi" style="flex:1;background:linear-gradient(135deg,${this.ST_COLOR[eq.status]},${this.ST_COLOR[eq.status]}bb)">
            <i>当前状态</i><b style="font-size:20px">${App.stText(eq.status)}</b></div>
          <div class="kpi" style="flex:1;background:linear-gradient(135deg,#0891b2,#155e75)">
            <i>设备类型</i><b style="font-size:17px">${(this.ETYPE[eq.etype] || [])[0] || eq.etype}</b></div>
        </div>
        <div style="font-size:12px;color:var(--ink-soft);margin-bottom:8px">
          状态机约束：故障设备不能直接复投，必须先经「保养中」维修复位；
          ISO6 及以上区域 FFU 至少保持 2 台运行，冗余不足时停机/保养会被拦截。
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px" id="eq-sw">
          ${['running', 'stopped', 'maintenance', 'fault'].map(s => `
            <button class="btn ${s === 'running' ? 'emerald' : s === 'stopped' ? 'slate' : s === 'maintenance' ? 'amber' : 'rose'}"
              data-to="${s}" ${targets.includes(s) ? '' : 'disabled'}
              style="${s === eq.status ? 'outline:3px solid var(--ink);outline-offset:2px;' : ''}">
              ${{ running: '▶ 运行', stopped: '⏸ 停机', maintenance: '🛠 保养', fault: '⚠ 故障' }[s]}
              ${targets.includes(s) ? '' : '<div style="font-size:10px;opacity:.8">不可达</div>'}
            </button>`).join('')}
        </div>
      </div>`,
    });
    document.querySelectorAll('#eq-sw button[data-to]').forEach(b => b.onclick = async () => {
      try {
        const j = await App.api(`/equipment/${eq.id}/switch`, { method: 'POST', body: { to: b.dataset.to } });
        App.toast(j.msg, true);
        document.querySelector('.modal-scrim')?.remove();
        onChanged && onChanged();
      } catch (e) { App.toast(e.msg, false); }   // 冗余拦截等错误红 toast 原样呈现
    });
  },

  /* ---------------- 子页2：设备台账 ---------------- */
  async tabLedger(el) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;height:100%;min-height:0">
        <div class="panel" style="flex:none">
          <div class="panel-body" style="display:flex;gap:8px;align-items:center;padding:10px 14px;overflow:visible;flex-wrap:wrap">
            <b style="font-size:13.5px;margin-right:4px">类型</b>
            <button class="btn sm btn-line m09-tf" data-t="">全部</button>
            ${Object.entries(this.ETYPE).map(([k, v]) =>
              `<button class="btn sm btn-line m09-tf" data-t="${k}" style="border-color:${v[1]}66;color:${v[1]}">${v[0]}</button>`).join('')}
            <select class="ipt" id="m09-zone" style="width:190px;margin-left:8px"></select>
            <div style="flex:1"></div>
            <button class="btn emerald" id="m09-new">＋ 登记新设备</button>
          </div>
        </div>
        <div class="panel" style="flex:1;min-height:0">
          <div class="panel-body"><div id="m09-list" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px"></div></div>
        </div>
      </div>`;

    const zones = await App.api('/dashboard/scene').then(j => j.data.zones).catch(() => []);
    const zoneSel = el.querySelector('#m09-zone');
    zoneSel.innerHTML = '<option value="">全部区域</option>' +
      zones.map(z => `<option value="${z.id}">${App.esc(z.name)}</option>`).join('');

    let etype = '';
    const listBox = el.querySelector('#m09-list');
    const self = this;

    async function reload() {
      const qs = [];
      if (etype) qs.push('etype=' + etype);
      if (zoneSel.value) qs.push('zone_id=' + zoneSel.value);
      let rows;
      try { rows = (await App.api('/equipment/list' + (qs.length ? '?' + qs.join('&') : ''))).data; }
      catch (e) { App.toast(e.msg, false); return; }
      listBox.innerHTML = '';
      if (!rows.length) {
        listBox.appendChild(App.el(`<div style="grid-column:1/4;text-align:center;color:var(--ink-soft);padding:50px 0">
          <div style="font-size:44px;opacity:.35">🌬️</div><div style="margin-top:6px;font-size:13px">该筛选下没有设备</div></div>`));
        return;
      }
      rows.forEach(r => listBox.appendChild(self.ledgerCard(r, reload, zones)));
    }

    el.querySelectorAll('.m09-tf').forEach(b => b.onclick = () => {
      etype = b.dataset.t;
      el.querySelectorAll('.m09-tf').forEach(x => x.style.background = '');
      b.style.background = 'rgba(13,148,136,.12)';
      reload();
    });
    zoneSel.onchange = reload;
    el.querySelector('#m09-new').onclick = () => this.createForm(zones, reload);
    reload();
  },

  ledgerCard(r, reload, zones) {
    const sc = this.ST_COLOR[r.status];
    const ec = (this.ETYPE[r.etype] || ['', '#64748b'])[1];
    const card = App.el(`<div class="panel ${r.need_maint ? 'panel-flash' : ''}" style="margin:0;border-top:4px solid ${sc}">
      <div class="panel-body" style="padding:12px 14px;overflow:visible"></div></div>`);
    const body = card.querySelector('.panel-body');
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <b style="font-size:14.5px">${App.esc(r.code)}</b>
        <span class="badge" style="background:${ec}18;color:${ec}">${App.esc(r.etype_name)}</span>
        ${r.need_maint ? '<span class="badge red">待保养</span>' : ''}
        <div style="flex:1"></div>${App.badge(r.status)}
      </div>
      <div style="font-size:13px;font-weight:600;margin-top:5px">${App.esc(r.name)}</div>
      <div style="font-size:11.5px;color:var(--ink-soft);margin-top:3px">
        📍 ${App.esc(r.zone_name || '未分配区域')} · 位 (${r.x}, ${r.y})</div>
      <div style="margin-top:9px">
        <div style="display:flex;justify-content:space-between;font-size:11.5px">
          <span>运行 <b>${Math.round(r.run_hours || 0)}</b> h</span>
          <span style="color:${(r.run_hours || 0) > this.MAINT_HOURS ? 'var(--bad)' : 'var(--ink-soft)'}">保养线 ${this.MAINT_HOURS} h</span>
        </div>
        <div style="height:8px;border-radius:4px;background:#e2e8f0;margin-top:4px;overflow:hidden">
          <div style="height:100%;width:${Math.min((r.run_hours || 0) / this.MAINT_HOURS * 100, 100)}%;
               background:linear-gradient(90deg,#2dd4bf,${(r.run_hours || 0) > this.MAINT_HOURS ? '#e11d48' : '#0d9488'})"></div>
        </div>
        <div style="font-size:11px;color:var(--ink-soft);margin-top:4px">上次保养：${r.last_maint ? App.fmtT(r.last_maint) : '从未保养 ⚠'}</div>
      </div>
      <div style="display:flex;gap:7px;margin-top:11px">
        <button class="btn sm teal" data-act="sw" style="background:#0d9488">🔁 状态切换</button>
        <button class="btn sm btn-line" data-act="edit">✏️ 编辑</button>
        <div style="flex:1"></div>
        <button class="btn sm btn-line" data-act="del" ${r.status === 'running' ? 'disabled title="运行中设备禁止删除"' : ''}>🗑</button>
      </div>`;
    body.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => {
      if (b.dataset.act === 'sw') this.eqDetail(r, reload);
      else if (b.dataset.act === 'edit') this.editForm(r, zones, reload);
      else if (b.dataset.act === 'del') this.removeEq(r, reload);
    });
    return card;
  },

  createForm(zones, onSaved) {
    App.modal({
      title: '登记新设备', width: 460, okText: '登 记',
      body: `<div class="form-grid" style="font-size:13px">
        <div class="field full"><label>设备名称</label><input id="ec-name" placeholder="如：A1 区 FFU-09 机组"></div>
        <div class="field"><label>设备类型</label><select id="ec-etype">
          ${Object.entries(this.ETYPE).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></div>
        <div class="field"><label>所属区域</label><select id="ec-zone">
          <option value="">暂不分配</option>
          ${zones.map(z => `<option value="${z.id}">${App.esc(z.name)}（ISO${z.iso_class}）</option>`).join('')}</select></div>
        <div class="field"><label>平面坐标 X</label><input id="ec-x" type="number" value="0"></div>
        <div class="field"><label>平面坐标 Y</label><input id="ec-y" type="number" value="0"></div>
        <div class="field full" style="margin-bottom:0"><label>编号按类型自动续号（FFU-xxx / AS-xxx…），新设备默认停机态，需手动投运</label></div>
      </div>`,
      onOk: async (body) => {
        const name = body.querySelector('#ec-name').value.trim();
        if (!name) { App.toast('设备名称不能为空', false); return false; }
        const d = { name, etype: body.querySelector('#ec-etype').value,
          x: +body.querySelector('#ec-x').value, y: +body.querySelector('#ec-y').value };
        const z = body.querySelector('#ec-zone').value; if (z) d.zone_id = +z;
        const j = await App.api('/equipment/create', { method: 'POST', body: d });
        App.toast(j.msg); onSaved();
      },
    });
  },

  editForm(r, zones, onSaved) {
    App.modal({
      title: `编辑设备 · ${r.code}`, width: 460, okText: '保 存',
      body: `<div class="form-grid" style="font-size:13px">
        <div class="field full"><label>设备名称</label><input id="ee-name" value="${App.esc(r.name)}"></div>
        <div class="field"><label>所属区域</label><select id="ee-zone">
          <option value="">不分配</option>
          ${zones.map(z => `<option value="${z.id}" ${r.zone_id === z.id ? 'selected' : ''}>${App.esc(z.name)}</option>`).join('')}</select></div>
        <div class="field"><label>吊装/安装高度 Z</label><input id="ee-z" type="number" step="0.1" value="${r.z ?? 2.8}"></div>
        <div class="field"><label>平面坐标 X</label><input id="ee-x" type="number" value="${r.x}"></div>
        <div class="field"><label>平面坐标 Y</label><input id="ee-y" type="number" value="${r.y}"></div>
      </div>`,
      onOk: async (body) => {
        const name = body.querySelector('#ee-name').value.trim();
        if (!name) { App.toast('设备名称不能为空', false); return false; }
        const d = { name, x: +body.querySelector('#ee-x').value,
          y: +body.querySelector('#ee-y').value, z: +body.querySelector('#ee-z').value };
        const z = body.querySelector('#ee-zone').value; d.zone_id = z ? +z : null;
        const j = await App.api(`/equipment/${r.id}`, { method: 'PUT', body: d });
        App.toast(j.msg); onSaved();
      },
    });
  },

  async removeEq(r, onSaved) {
    if (!await App.confirm(`删除设备 ${r.code}（${r.name}）？台账删除后 3D 场景同步摘除。`)) return;
    try {
      const j = await App.api(`/equipment/${r.id}`, { method: 'DELETE' });
      App.toast(j.msg); onSaved();
    } catch (e) { App.toast(e.msg, false); }
  },

  /* ---------------- 子页3：保养计划 ---------------- */
  async tabMaint(el) {
    el.innerHTML = `
      <div style="display:flex;gap:14px;height:100%;min-height:0">
        <div class="panel" style="width:300px;flex:none">
          <div class="panel-head"><b>类型运行概览</b></div>
          <div class="panel-body" id="m09m-types" style="display:flex;flex-direction:column;gap:10px"></div>
        </div>
        <div class="panel" style="flex:1;min-width:0">
          <div class="panel-head"><b>待保养队列</b><span class="tag">双阈值：8000h 或 45 天</span>
            <div class="spacer"></div><button class="btn sm btn-line" id="m09m-reload">↻ 刷新</button></div>
          <div class="panel-body" id="m09m-list" style="display:flex;flex-direction:column;gap:10px"></div>
        </div>
        <div class="panel dark" style="width:270px;flex:none">
          <div class="panel-head"><b>保养规则卡</b></div>
          <div class="panel-body" style="font-size:12.5px;line-height:2;overflow:visible">
            <b style="color:#5eead4">① 时长阈值</b><br>累计运行超 <b>8000 h</b> 强制保养<br>
            <b style="color:#5eead4">② 周期阈值</b><br>距上次保养超 <b>45 天</b> 强制保养<br>
            <b style="color:#5eead4">③ 复投复位</b><br>保养中 → 运行中：保养日期刷为今天、运行时长清零<br>
            <b style="color:#5eead4">④ 冗余约束</b><br>ISO6 及以上区域 FFU 至少 2 台在线，保养前先启动备用机组
          </div>
        </div>
      </div>`;

    const self = this;
    async function reload() {
      let d;
      try { d = (await App.api('/equipment/stats')).data; } catch (e) { App.toast(e.msg, false); return; }
      const tbox = el.querySelector('#m09m-types');
      tbox.innerHTML = '';
      Object.entries(d.by_type).forEach(([k, v]) => {
        const c = self.ETYPE[k][1];
        const pct = v.total ? Math.round(v.running / v.total * 100) : 0;
        tbox.appendChild(App.el(`
          <div style="border:1px solid ${c}44;border-radius:11px;padding:10px 12px;background:linear-gradient(90deg,${c}10,transparent)">
            <div style="display:flex;justify-content:space-between;font-size:12.5px">
              <b style="color:${c}">${v.name}</b><span>${v.running}/${v.total} 运行</span></div>
            <div style="height:8px;border-radius:4px;background:#e2e8f0;margin-top:6px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${c}88,${c})"></div></div>
          </div>`));
      });
      const lbox = el.querySelector('#m09m-list');
      lbox.innerHTML = '';
      if (!d.maint_due.length) {
        lbox.appendChild(App.el(`<div style="text-align:center;color:var(--ink-soft);padding:50px 0">
          <div style="font-size:44px;opacity:.4">🎉</div><div style="margin-top:8px;font-size:13px">没有到达保养阈值的设备</div></div>`));
        return;
      }
      d.maint_due.forEach(r => {
        const overH = (r.run_hours || 0) > self.MAINT_HOURS;
        const row = App.el(`
          <div style="display:flex;align-items:center;gap:12px;border:1.5px solid rgba(217,119,6,.4);
               border-radius:12px;padding:10px 14px;background:linear-gradient(90deg,rgba(217,119,6,.08),transparent)">
            <div style="font-size:24px">🛠</div>
            <div style="flex:1;min-width:0">
              <b style="font-size:13.5px">${App.esc(r.code)} · ${App.esc(r.name)}</b>
              <div style="font-size:11.5px;color:var(--ink-soft);margin-top:2px">
                ${overH ? `运行 ${Math.round(r.run_hours)}h 超 ${self.MAINT_HOURS}h 线` : ''}
                ${overH && r.last_maint ? '　' : ''}
                ${r.last_maint ? `上次保养 ${App.fmtT(r.last_maint)}` : (overH ? '' : '从未保养')}</div>
            </div>
            <button class="btn sm amber">转入保养</button>
          </div>`);
        row.querySelector('button').onclick = async () => {
          try {
            const j = await App.api(`/equipment/${r.id}/switch`, { method: 'POST', body: { to: 'maintenance' } });
            App.toast(j.msg); reload();
          } catch (e) { App.toast(e.msg, false); }
        };
        lbox.appendChild(row);
      });
    }
    el.querySelector('#m09m-reload').onclick = reload;
    reload();
  },
});
