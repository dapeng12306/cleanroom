/* ==========================================================================
   m01 工作台总览 —— 车间数字孪生驾驶舱
   三个子页：3D车间孪生 / 实时战况 / 今日作战墙
   本页是全系统门面：Three.js 场景 + 浮动 KPI，评审第一眼就落在这里。
   ========================================================================== */
App.register('m01', {
  title: '工作台总览', icon: '⬢', color: '#0891b2',
  bg: 'linear-gradient(135deg,#0e7490,#155e75)',
  bgImg: '/web/assets/img/cleanroom_wide.jpg',
  desc: '3D 车间数字孪生 · 实时战况一屏尽览 · 今日作战指挥墙',
  subs: ['3D车间孪生', '实时战况', '今日作战墙'],

  render(host) {
    host.appendChild(App.el(`
      <div class="page-head">
        <div class="ph-icon" style="background:linear-gradient(135deg,#06b6d4,#0e7490)">⬢</div>
        <div><h2>工作台总览</h2><div class="ph-sub">车间数字孪生 · 人机协同态势一屏总览</div></div>
        <div class="spacer"></div>
        <button class="btn btn-line" id="m01-back">⌂ 返回菜单中枢</button>
      </div>`));
    host.querySelector('#m01-back').onclick = () => App.goHub();
    const body = App.el(`<div class="page-body"></div>`);
    host.appendChild(body);

    const tabs = App.tabs(body, [
      { label: '3D车间孪生', icon: '🌐', render: el => this.tabTwin(el) },
      { label: '实时战况', icon: '📡', render: el => this.tabLive(el) },
      { label: '今日作战墙', icon: '🎯', render: el => this.tabToday(el) },
    ], { style: 'pill', color: '#0891b2' });
    return () => { };
  },

  /* ---------------- 子页1：3D 车间数字孪生 ---------------- */
  tabTwin(el) {
    el.appendChild(App.el(`<div class="three-box" id="m01-3d" style="flex:1;min-height:0"></div>`));
    const box = el.querySelector('#m01-3d');
    const T = App.three(box, { bg: 0x0a2e3a });

    // 地面 + 网格，洁净室环氧地坪的浅灰绿
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 50),
      new THREE.MeshStandardMaterial({ color: 0xcfd8d4, roughness: .85 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    T.scene.add(floor);
    T.scene.add(new THREE.GridHelper(70, 35, 0x7de8dc, 0x2a5560));
    T.scene.add(new THREE.AmbientLight(0xffffff, .55));
    const sun = new THREE.DirectionalLight(0xffffff, .9);
    sun.position.set(18, 30, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    T.scene.add(sun);

    // 状态 → 颜色。报警中的区域用呼吸红，一眼定位
    const zoneColor = { normal: 0x2dd4bf, warning: 0xf59e0b, critical: 0xf43f5e, cleaning: 0x38bdf8 };
    const zoneMeshes = {}, robotMeshes = {}, alarmMarkers = [];
    let robotData = [];

    function rebuild(data) {
      // 区域块：半透墙体 + 顶面 FFU 网格纹理块
      data.zones.forEach(z => {
        if (zoneMeshes[z.id]) { zoneMeshes[z.id].material.color.setHex(zoneColor[z.status] || 0x2dd4bf); zoneMeshes[z.id].userData.z = z; return; }
        const g = new THREE.BoxGeometry(z.w, 2.6, z.h);
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
          color: zoneColor[z.status] || 0x2dd4bf, transparent: true, opacity: .34, roughness: .4,
        }));
        m.position.set(z.x, 1.3, z.y); m.userData.z = z; m.castShadow = true;
        T.scene.add(m); zoneMeshes[z.id] = m;
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g),
          new THREE.LineBasicMaterial({ color: 0xe8fffb, transparent: true, opacity: .8 }));
        edge.position.copy(m.position); T.scene.add(edge);
        const label = App.three.label(`${z.name} ISO${z.iso_class}`, '#7de8dc');
        label.position.set(z.x, 4.3, z.y); T.scene.add(label);
      });

      // 机器人：圆柱机身 + 顶盖，颜色按类型；工作中头顶加旋转光环
      const rColor = { scrubber: 0x06b6d4, vacuum: 0x8b5cf6, uv: 0xf43f5e, mop: 0xf59e0b };
      data.robots.forEach(r => {
        robotData = data.robots;
        let grp = robotMeshes[r.id];
        if (!grp) {
          grp = new THREE.Group();
          const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(.9, 1.05, .8, 24),
            new THREE.MeshStandardMaterial({ color: rColor[r.robot_type] || 0x06b6d4, roughness: .3, metalness: .5 }));
          bodyM.position.y = .45; bodyM.castShadow = true;
          const cap = new THREE.Mesh(new THREE.SphereGeometry(.42, 16, 12),
            new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: .2 }));
          cap.position.y = 1.05;
          const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, .06, 8, 40),
            new THREE.MeshBasicMaterial({ color: 0x7de8dc, transparent: true, opacity: .8 }));
          ring.rotation.x = Math.PI / 2; ring.position.y = .2; ring.name = 'halo';
          grp.add(bodyM, cap, ring);
          grp.userData.r = r;
          T.scene.add(grp); robotMeshes[r.id] = grp;
        }
        grp.userData.r = r;
        grp.position.set(r.x, 0, r.y);
      });

      // 报警标记：悬浮红色四面体，不停旋转 + 上下浮动
      alarmMarkers.forEach(m => T.scene.remove(m)); alarmMarkers.length = 0;
      data.alarms.forEach(a => {
        const z = data.zones.find(z => z.id === a.zone_id); if (!z) return;
        const mk = new THREE.Mesh(new THREE.OctahedronGeometry(.8),
          new THREE.MeshBasicMaterial({ color: a.level === 'critical' ? 0xff2d55 : 0xffb020 }));
        mk.position.set(z.x, 6.2, z.y); mk.userData.a = a;
        T.scene.add(mk); alarmMarkers.push(mk);
        const lb = App.three.label('⚠ ' + a.title, a.level === 'critical' ? '#ff8fa3' : '#ffd166', true);
        lb.position.set(z.x, 8.2, z.y); T.scene.add(lb); alarmMarkers.push(lb);
      });

      // 设备小立柱（FFU 用细高柱，风淋室用方墩）
      (data.equipment || []).forEach(eq => {
        const key = 'eq' + eq.id;
        if (zoneMeshes[key]) return;
        const isFFU = eq.etype === 'ffu';
        const geo = isFFU ? new THREE.CylinderGeometry(.28, .28, 1.1, 10) : new THREE.BoxGeometry(1.4, 1.6, 1.4);
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: eq.status === 'fault' ? 0xff2d55 : eq.status === 'maintenance' ? 0xffb020 : 0x94d2bd, roughness: .5,
        }));
        mesh.position.set(eq.x, (eq.z || 1), eq.y);
        T.scene.add(mesh); zoneMeshes[key] = mesh;
      });
    }

    // HUD：KPI 浮动芯片，叠在 3D 上，不挡操作
    const hud = App.el(`<div class="three-hud">
      <div class="hud-chip" id="m01-hud1">载入中…</div>
      <div class="hud-chip" id="m01-hud2"></div>
    </div>
    <div class="three-legend">🟢 正常区　🟡 预警区　🔴 超标区　🔵 保洁中<br>▲ 报警标记　◉ 机器人　▮ 设备<br>左键旋转 / 右键平移 / 滚轮缩放 / 点击区域查详情</div>`);
    box.appendChild(hud);

    async function refresh() {
      try {
        const [scene, ov] = await Promise.all([
          App.api('/dashboard/scene'), App.api('/dashboard/overview')]);
        rebuild(scene.data);
        const d = ov.data;
        box.querySelector('#m01-hud1').innerHTML =
          `<b>任务态势</b><br>作业中 ${d.task_stat.in_progress || 0} 单 · 待验收 ${d.task_stat.awaiting_inspection || 0} 单<br>今日通过 ${d.today_done} 单`;
        box.querySelector('#m01-hud2').innerHTML =
          `<b>资源态势</b><br>机器人作业 ${d.robot_stat.working || 0}/${Object.values(d.robot_stat).reduce((a, b) => a + b, 0)} 台 · 在岗 ${d.staff_online} 人<br>未结报警 ${d.alarm_open} 条 · 缺货物料 ${d.materials_low} 项`;
      } catch (e) { App.toast(e.msg, false); }
    }
    refresh();
    const timer = setInterval(refresh, 8000);

    // 机器人巡航动画：工作中机器人的光环转动 + 轻微游走
    let t0 = 0;
    T.onTick(() => {
      t0 += 0.016;
      Object.values(robotMeshes).forEach(g => {
        const r = g.userData.r;
        const halo = g.getObjectByName('halo');
        if (halo) halo.rotation.z += r.status === 'working' ? 0.06 : 0.008;
        if (r.status === 'working') {
          g.position.x = r.x + Math.sin(t0 * .7 + r.id) * .8;
          g.position.z = r.y + Math.cos(t0 * .5 + r.id) * .8;
        }
      });
      alarmMarkers.forEach((m, i) => {
        if (m.isMesh) { m.rotation.y += .04; m.position.y = 6.2 + Math.sin(t0 * 2 + i) * .35; }
      });
    });

    // 点击区域块 → 弹详情窗（弹窗不模糊背景，3D 依然清晰）
    T.onClick(ray => {
      const hits = ray.intersectObjects(Object.values(zoneMeshes).filter(m => m.userData.z));
      if (!hits.length) return;
      const z = hits[0].object.userData.z;
      App.modal({
        title: `${z.name} · 区域档案`, width: 440, hideFoot: true,
        body: `<div style="line-height:2.1;font-size:14px">
          <div>区域编号：<b>${z.code}</b>　洁净等级：<span class="badge" style="background:${App.ISO_COLOR[z.iso_class]}22;color:${App.ISO_COLOR[z.iso_class]}">ISO ${z.iso_class}</span></div>
          <div>面积：${z.area} ㎡　粒子上限：${z.target_particles} 个/m³</div>
          <div>当前状态：${App.badge(z.status)}</div>
          <div style="margin-top:10px;display:flex;gap:8px">
            <button class="btn cyan sm" onclick="App.go('m02')">去看监测</button>
            <button class="btn amber sm" onclick="App.go('m03')">去派任务</button>
          </div></div>`,
      });
    });

    return () => { clearInterval(timer); T.dispose(); };
  },

  /* ---------------- 子页2：实时战况 ---------------- */
  tabLive(el) {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;height:100%;overflow:hidden">
      <div class="kpi-grid" style="grid-template-columns:repeat(6,1fr);flex:none" id="m01-kpis"></div>
      <div style="flex:1;display:grid;grid-template-columns:1.4fr 1fr;gap:12px;min-height:0">
        <div class="panel"><div class="panel-head"><b>区域洁净状态墙</b><span class="tag">ISO 等级联动</span></div>
          <div class="panel-body"><div id="m01-zones" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"></div></div></div>
        <div class="panel alt"><div class="panel-head"><b>最新任务动态</b><span class="tag">滚动刷新</span></div>
          <div class="panel-body" id="m01-tasks"></div></div>
      </div></div>`;

    async function refresh() {
      try {
        const ov = (await App.api('/dashboard/overview')).data;
        const ts = ov.task_stat;
        const kpis = [
          ['作业中任务', ts.in_progress || 0, '单', 'linear-gradient(135deg,#06b6d4,#0891b2)'],
          ['待验收', ts.awaiting_inspection || 0, '单', 'linear-gradient(135deg,#8b5cf6,#6d28d9)'],
          ['未结报警', ov.alarm_open, '条', 'linear-gradient(135deg,#f43f5e,#be123c)'],
          ['机器人出勤', ov.robot_stat.working || 0, '台', 'linear-gradient(135deg,#f59e0b,#d97706)'],
          ['在岗人员', ov.staff_online, '人', 'linear-gradient(135deg,#0d9488,#0f766e)'],
          ['缺货物料', ov.materials_low, '项', 'linear-gradient(135deg,#ea580c,#c2410c)'],
        ];
        const kbox = el.querySelector('#m01-kpis');
        kbox.innerHTML = '';
        kpis.forEach(([label, v, unit, bg], i) => {
          kbox.appendChild(App.el(`<div class="kpi" style="background:${bg};animation-delay:${i * 60}ms">
            <i>${label}</i><b class="flash-num">${v}</b><s>${unit}</s></div>`));
        });

        const zbox = el.querySelector('#m01-zones'); zbox.innerHTML = '';
        ov.zones.forEach(z => {
          zbox.appendChild(App.el(`<div class="panel" style="padding:12px;box-shadow:none;border-left:5px solid ${App.ISO_COLOR[z.iso_class]}">
            <div style="display:flex;align-items:center;gap:8px">
              <b style="font-size:14.5px">${z.name}</b>
              <span class="badge" style="background:${App.ISO_COLOR[z.iso_class]}22;color:${App.ISO_COLOR[z.iso_class]}">ISO${z.iso_class}</span>
              <span style="flex:1"></span>${App.badge(z.status)}
            </div>
            <div style="font-size:12px;color:var(--ink-soft);margin-top:8px">
              ${z.code} · ${z.area}㎡ · 未结报警 <b style="color:${z.open_alarms ? 'var(--bad)' : 'var(--ok)'}">${z.open_alarms}</b> 条
            </div></div>`));
        });

        const tasks = (await App.api('/tasks/list')).data.slice(0, 7);
        const tbox = el.querySelector('#m01-tasks'); tbox.innerHTML = '';
        tbox.className = 'timeline panel-body';
        tasks.forEach(t => {
          tbox.appendChild(App.el(`<div class="tl-item">
            <b>${t.title}</b> ${App.badge(t.status)}<br>
            <i>${t.code} · ${t.zone_name || ''} · ${t.assignee_name ? '执行 ' + t.assignee_name : '未派单'}${t.robot_name ? ' + ' + t.robot_name : ''}</i>
          </div>`));
        });
      } catch (e) { App.toast(e.msg, false); }
    }
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  },

  /* ---------------- 子页3：今日作战墙 ---------------- */
  tabToday(el) {
    el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;height:100%">
      <div class="panel"><div class="panel-head"><b>今日排班出勤</b><span class="tag">早晚中三班</span></div>
        <div class="panel-body" id="m01-sched"></div></div>
      <div class="panel dark"><div class="panel-head"><b style="color:#ffd166">紧急报警待办</b><span class="tag">需立即处置</span></div>
        <div class="panel-body" id="m01-urgent"></div></div>
      <div class="panel alt"><div class="panel-head"><b>快捷作战指令</b><span class="tag">一键直达</span></div>
        <div class="panel-body" id="m01-quick" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start"></div></div>
    </div>`;

    (async () => {
      try {
        const sch = (await App.api('/staff/schedules')).data;
        const sbox = el.querySelector('#m01-sched');
        if (!sch.length) sbox.innerHTML = `<div class="empty-tip">今日暂无排班<br>可去「人员排班」执行自动排班</div>`;
        sch.slice(0, 12).forEach(s => sbox.appendChild(App.el(
          `<div style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px dashed var(--line);font-size:13px">
            <span class="dot" style="background:${s.color || '#06b6d4'}"></span>
            <b>${s.staff_name}</b><span class="badge grey">${s.shift_name}</span>
            <span style="flex:1"></span><span style="color:var(--ink-soft)">${s.zone_name || '机动'}</span>
          </div>`)));
      } catch (e) { App.toast(e.msg, false); }

      try {
        const als = (await App.api('/alarms/list?status=open')).data
          .concat((await App.api('/alarms/list?status=processing')).data)
          .filter(a => a.level !== 'minor').slice(0, 8);
        const abox = el.querySelector('#m01-urgent');
        if (!als.length) abox.innerHTML = `<div class="empty-tip" style="color:#7de8dc">✔ 当前无紧急报警<br>车间运行平稳</div>`;
        als.forEach(a => abox.appendChild(App.el(
          `<div style="padding:9px;border-radius:10px;background:rgba(244,63,94,.12);border:1px solid rgba(244,63,94,.35);margin-bottom:8px">
            <b style="font-size:13px;color:#ffd9de">${a.level === 'critical' ? '🔴' : '🟠'} ${a.title}</b>
            <div style="font-size:11.5px;color:#9fd4cf;margin-top:4px">${a.code} · ${a.zone_name || '全厂'} · ${App.fmtT(a.created_at)}</div>
          </div>`)));
      } catch (e) { App.toast(e.msg, false); }

      const quick = [
        ['⬢ 进入 3D 孪生', 'm01', '#0891b2'], ['📡 洁净度监测', 'm02', '#0d9488'],
        ['🧹 派发保洁任务', 'm03', '#d97706'], ['🤖 机器人指挥', 'm04', '#7c3aed'],
        ['📷 AI 污渍识别', 'm06', '#e11d48'], ['🚨 报警处置', 'm10', '#ea580c'],
        ['🧪 质量验收', 'm08', '#4f46e5'], ['📊 决策分析', 'm11', '#c026d3'],
      ];
      const qbox = el.querySelector('#m01-quick');
      quick.forEach(([label, target, color]) => {
        const b = App.el(`<button class="btn" style="background:${color};padding:16px 8px;font-size:13.5px">${label}</button>`);
        b.onclick = () => App.go(target);
        qbox.appendChild(b);
      });
    })();
  },
});
