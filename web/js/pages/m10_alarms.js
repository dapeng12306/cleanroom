/* ==========================================================================
   m10 报警中心 —— 3D 报警沙盘 / 处置中心 / 处置分析
   布局走"作战沙盘"路子：报警不是列表里的一行字，是区域上空
   旋转的红八面体。处置动作全部弹窗留痕，解决后区域恢复常态。
   ========================================================================== */
App.register('m10', {
  title: '报警中心', icon: '🚨', color: '#ea580c',
  bg: 'linear-gradient(135deg,#f97316,#c2410c)',
  bgImg: '/web/assets/img/control_room.jpg',
  desc: '多源报警汇聚 · 状态机闭环处置 · 沙盘级定位',
  subs: ['3D 报警沙盘', '处置中心', '处置分析'],

  LEVEL: { critical: ['紧急', '#e11d48'], major: ['重要', '#f59e0b'], minor: ['一般', '#06b6d4'] },
  SOURCE: { sensor: ['传感器', '#06b6d4'], robot: ['机器人', '#8b5cf6'], manual: ['人工补录', '#d97706'], ai: ['AI 识别', '#e11d48'] },

  render(host) {
    host.appendChild(App.el(`
      <div class="page-head">
        <div class="ph-icon" style="background:linear-gradient(135deg,#fb923c,#ea580c)">🚨</div>
        <div><h2>报警中心</h2><div class="ph-sub">待处理 → 处理中 → 已解决 / 已忽略 · 解决后关联区域自动恢复常态</div></div>
        <div class="spacer"></div>
        <button class="btn btn-line" id="m10-back">⌂ 返回菜单中枢</button>
      </div>`));
    host.querySelector('#m10-back').onclick = () => App.goHub();
    const body = App.el(`<div class="page-body"></div>`);
    host.appendChild(body);
    App.tabs(body, [
      { label: '3D 报警沙盘', icon: '🗺', render: el => this.tabMap(el) },
      { label: '处置中心', icon: '🎛', render: el => this.tabHandle(el) },
      { label: '处置分析', icon: '📊', render: el => this.tabStats(el) },
    ], { style: 'dot', color: '#ea580c' });
  },

  /* ---------------- 子页1：3D 报警沙盘 ---------------- */
  tabMap(el) {
    el.appendChild(App.el(`<div class="three-box" style="flex:1;min-height:0"></div>`));
    const box = el.querySelector('.three-box');
    const T = App.three(box, { bg: 0x1a1d23 });

    // 沙盘底色压暗，让报警红光成为视觉焦点
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 50),
      new THREE.MeshStandardMaterial({ color: 0x3f4a52, roughness: .9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    T.scene.add(floor);
    T.scene.add(new THREE.GridHelper(70, 35, 0xfb923c, 0x4a5560));
    T.scene.add(new THREE.AmbientLight(0xffffff, .45));
    const sun = new THREE.DirectionalLight(0xfff4e0, .8);
    sun.position.set(-14, 26, 16); sun.castShadow = true; T.scene.add(sun);

    const zoneMeshes = {};   // zone_id -> mesh
    let markers = [];        // 报警标记组
    let tick = 0;
    const self = this;

    function rebuild(zones, alarms) {
      // 区域块：常态半透明灰蓝，有活跃报警的区染成等级色
      const alarmZoneLv = {};
      alarms.forEach(a => {
        const w = { critical: 2, major: 1, minor: 0 }[a.level] ?? 0;
        if (!(a.zone_id in alarmZoneLv) || w > alarmZoneLv[a.zone_id]) alarmZoneLv[a.zone_id] = w;
      });
      zones.forEach(z => {
        const lv = alarmZoneLv[z.id];
        const col = lv === 2 ? 0xe11d48 : lv === 1 ? 0xf59e0b : lv === 0 ? 0x38bdf8 : 0x5eead4;
        if (zoneMeshes[z.id]) { zoneMeshes[z.id].material.color.setHex(col); return; }
        const g = new THREE.BoxGeometry(z.w, 2.4, z.h);
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
          color: col, transparent: true, opacity: .3, roughness: .45 }));
        m.position.set(z.x, 1.2, z.y); m.userData.z = z; m.castShadow = true;
        T.scene.add(m); zoneMeshes[z.id] = m;
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g),
          new THREE.LineBasicMaterial({ color: 0xfef3c7, transparent: true, opacity: .55 }));
        edge.position.copy(m.position); T.scene.add(edge);
        const lb = App.three.label(z.name, '#fcd9a8');
        lb.position.set(z.x, 4.0, z.y); T.scene.add(lb);
      });

      // 报警标记：旋转八面体 + 光环 + 文字牌，紧急的红色，重要的橙色
      markers.forEach(m => T.scene.remove(m)); markers = [];
      alarms.forEach(a => {
        const z = zones.find(x => x.id === a.zone_id); if (!z) return;
        const lc = a.level === 'critical' ? 0xff2d55 : a.level === 'major' ? 0xffb020 : 0x22d3ee;
        const grp = new THREE.Group();
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(.75),
          new THREE.MeshBasicMaterial({ color: lc }));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, .07, 8, 40),
          new THREE.MeshBasicMaterial({ color: lc, transparent: true, opacity: .75 }));
        ring.rotation.x = Math.PI / 2; ring.position.y = -1.1; ring.name = 'ring';
        grp.add(core, ring); grp.position.set(z.x, 6.4, z.y); grp.userData.a = a;
        T.scene.add(grp); markers.push(grp);
        const lb = App.three.label('⚠ ' + a.title, a.level === 'critical' ? '#ff8fa3' : a.level === 'major' ? '#ffd166' : '#7dd3fc', true);
        lb.position.set(z.x, 8.6, z.y); lb.userData.a = a;
        T.scene.add(lb); markers.push(lb);
      });
      box.querySelector('#m10-hud').innerHTML =
        `<b>活跃报警 ${alarms.length} 条</b><br>` +
        (alarms.length
          ? `紧急 ${alarms.filter(a => a.level === 'critical').length} · 重要 ${alarms.filter(a => a.level === 'major').length} · 一般 ${alarms.filter(a => a.level === 'minor').length}<br>点击标记可直接处置`
          : '全域无活跃报警，车间运行平稳');
    }

    async function refresh() {
      try {
        const [sc, mp] = await Promise.all([
          App.api('/dashboard/scene'), App.api('/alarms/map')]);
        rebuild(sc.data.zones, mp.data);
      } catch (e) { App.toast(e.msg, false); }
    }
    box.appendChild(App.el(`<div class="three-hud"><div class="hud-chip" id="m10-hud">载入中…</div></div>
      <div class="three-legend">🔴 紧急报警区　🟠 重要　🔵 一般　🟢 无报警<br>◆ 旋转标记 = 活跃报警<br>左键旋转 / 右键平移 / 滚轮缩放 / 点击标记处置</div>`));
    refresh();
    const timer = setInterval(refresh, 8000);

    T.onTick(() => {
      tick += .016;
      markers.forEach(m => {
        if (!m.userData.a) return;
        if (m.type === 'Group') {
          m.rotation.y += .03;
          m.position.y = 6.4 + Math.sin(tick * 2.2 + m.position.x) * .3;   // 上下浮动
          const ring = m.children.find(c => c.name === 'ring');
          if (ring) { const s = 1 + Math.sin(tick * 4) * .18; ring.scale.set(s, s, 1); }
        }
      });
    });

    // 点标记 → 处置弹窗
    T.onClick(ray => {
      const hits = ray.intersectObjects(markers.filter(m => m.type === 'Group'), true);
      if (!hits.length) return;
      let g = hits[0].object; while (g && !(g.userData && g.userData.a)) g = g.parent;
      if (g && g.userData.a) self.handleModal(g.userData.a, refresh);
    });

    return () => { clearInterval(timer); T.dispose(); };
  },

  /* 处置弹窗：接手/解决/忽略三动作 + 处置备注。沙盘点标记和处置中心共用 */
  handleModal(a, onChanged) {
    const lv = this.LEVEL[a.level] || this.LEVEL.minor;
    App.modal({
      title: `处置报警 · ${a.code}`, width: 470, hideFoot: true,
      body: `<div style="font-size:13px">
        <div style="border-left:5px solid ${lv[1]};background:${lv[1]}12;border-radius:8px;padding:10px 12px;margin-bottom:12px">
          <b style="font-size:14.5px">${App.esc(a.title)}</b>
          <span class="badge" style="background:${lv[1]};color:#fff;margin-left:6px">${lv[0]}</span>
          <div style="font-size:12px;color:var(--ink-soft);margin-top:5px">
            ${a.zone_name ? '📍 ' + App.esc(a.zone_name) + ' · ' : ''}来源：${(this.SOURCE[a.source] || [a.source])[0]} · ${App.fmtT(a.created_at)}
            ${a.handler_name ? ' · 处理人：' + App.esc(a.handler_name) : ''}</div>
          ${a.detail ? `<div style="font-size:12.5px;margin-top:6px">${App.esc(a.detail)}</div>` : ''}
        </div>
        <div class="field"><label>处置备注</label>
          <textarea id="ah-note" rows="2" placeholder="处置措施 / 现场情况 / 忽略原因"></textarea></div>
        <div style="display:flex;gap:8px" id="ah-btns"></div>
      </div>`,
    });
    const btns = document.getElementById('ah-btns');
    // 状态机：open 可接手/忽略；processing 可解决/忽略；终态无动作
    const acts = [];
    if (a.status === 'open') acts.push(['process', '🔧 接手处理', 'blue'], ['ignore', '🚫 忽略', 'slate']);
    else if (a.status === 'processing') acts.push(['resolve', '✔ 标记解决', 'emerald'], ['ignore', '🚫 忽略', 'slate']);
    if (!acts.length) {
      btns.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft)">该报警已「${App.stText(a.status)}」，无可用处置动作</div>`;
      return;
    }
    acts.forEach(([act, text, color]) => {
      const b = App.el(`<button class="btn ${color}" style="flex:1">${text}</button>`);
      b.onclick = async () => {
        const note = document.getElementById('ah-note').value.trim();
        if (act === 'ignore' && !note) { App.toast('忽略报警必须填写原因备注', false); return; }
        try {
          const j = await App.api(`/alarms/${a.id}/handle`, { method: 'POST', body: { action: act, note } });
          App.toast(j.msg, act !== 'ignore');
          document.querySelector('.modal-scrim')?.remove();
          onChanged && onChanged();
        } catch (e) { App.toast(e.msg, false); }
      };
      btns.appendChild(b);
    });
  },

  /* ---------------- 子页2：处置中心 ---------------- */
  async tabHandle(el) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;height:100%;min-height:0">
        <div class="panel" style="flex:none">
          <div class="panel-body" style="display:flex;gap:8px;align-items:center;padding:10px 14px;overflow:visible;flex-wrap:wrap">
            <b style="font-size:13.5px">状态</b>
            ${[['', '全部'], ['open', '待处理'], ['processing', '处理中'], ['resolved', '已解决'], ['ignored', '已忽略']]
              .map(([k, t]) => `<button class="btn sm btn-line m10-sf" data-k="${k}">${t}</button>`).join('')}
            <b style="font-size:13.5px;margin-left:10px">等级</b>
            <select class="ipt" id="m10-lv" style="width:120px">
              <option value="">全部</option><option value="critical">紧急</option>
              <option value="major">重要</option><option value="minor">一般</option></select>
            <div style="flex:1"></div>
            <button class="btn orange" id="m10-new">＋ 人工补录报警</button>
          </div>
        </div>
        <div class="panel" style="flex:1;min-height:0">
          <div class="panel-body"><div id="m10-list" style="display:grid;grid-template-columns:1fr 1fr;gap:12px"></div></div>
        </div>
      </div>`;

    const zones = await App.api('/dashboard/scene').then(j => j.data.zones).catch(() => []);
    const listBox = el.querySelector('#m10-list');
    const lvSel = el.querySelector('#m10-lv');
    let stFilter = '';
    const self = this;

    async function reload() {
      const qs = [];
      if (stFilter) qs.push('status=' + stFilter);
      if (lvSel.value) qs.push('level=' + lvSel.value);
      let rows;
      try { rows = (await App.api('/alarms/list' + (qs.length ? '?' + qs.join('&') : ''))).data; }
      catch (e) { App.toast(e.msg, false); return; }
      listBox.innerHTML = '';
      if (!rows.length) {
        listBox.appendChild(App.el(`<div style="grid-column:1/3;text-align:center;color:var(--ink-soft);padding:50px 0">
          <div style="font-size:44px;opacity:.35">🛡️</div><div style="margin-top:6px;font-size:13px">当前筛选下没有报警</div></div>`));
        return;
      }
      rows.forEach(r => listBox.appendChild(self.alarmCard(r, reload)));
    }

    el.querySelectorAll('.m10-sf').forEach(b => b.onclick = () => {
      stFilter = b.dataset.k;
      el.querySelectorAll('.m10-sf').forEach(x => x.style.background = '');
      b.style.background = 'rgba(234,88,12,.13)';
      reload();
    });
    el.querySelector('.m10-sf').style.background = 'rgba(234,88,12,.13)';
    lvSel.onchange = reload;
    el.querySelector('#m10-new').onclick = () => this.createForm(zones, reload);
    reload();
  },

  alarmCard(r, reload) {
    const lv = this.LEVEL[r.level] || this.LEVEL.minor;
    const so = this.SOURCE[r.source] || [r.source, '#64748b'];
    const closed = r.status === 'resolved' || r.status === 'ignored';
    const card = App.el(`<div class="panel" style="margin:0;border-left:5px solid ${lv[1]}">
      <div class="panel-body" style="padding:12px 14px;overflow:visible"></div></div>`);
    const body = card.querySelector('.panel-body');
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <b style="font-size:14px">${App.esc(r.title)}</b>
        <span class="badge" style="background:${lv[1]};color:#fff">${lv[0]}</span>
        <span class="badge" style="background:${so[1]}18;color:${so[1]}">${so[0]}</span>
        <div style="flex:1"></div>${App.badge(r.status)}
      </div>
      <div style="font-size:11.5px;color:var(--ink-soft);margin-top:5px">
        ${App.esc(r.code)} · 📍 ${App.esc(r.zone_name || '未关联区域')} · ${App.fmtT(r.created_at)}
        ${r.handler_name ? ' · 处理人 ' + App.esc(r.handler_name) : ''}</div>
      ${r.detail ? `<div style="font-size:12.5px;margin-top:7px;background:rgba(100,116,139,.08);border-radius:8px;padding:7px 10px">${App.esc(r.detail)}</div>` : ''}
      <div style="display:flex;gap:7px;margin-top:11px;align-items:center">
        <span style="font-size:11px;color:var(--ink-soft)">${r.handled_at ? '处置于 ' + App.fmtT(r.handled_at) : ''}</span>
        <div style="flex:1"></div>
        ${!closed ? `<button class="btn sm orange" data-act="handle">🎛 处置</button>` : ''}
        ${closed ? `<button class="btn sm btn-line" data-act="del">🗑 删除记录</button>` : ''}
      </div>`;
    body.querySelectorAll('button[data-act]').forEach(b => b.onclick = async () => {
      if (b.dataset.act === 'handle') { this.handleModal(r, reload); return; }
      if (!await App.confirm(`删除报警 ${r.code} 的记录？仅已闭环的报警可删。`)) return;
      try {
        const j = await App.api(`/alarms/${r.id}`, { method: 'DELETE' });
        App.toast(j.msg); reload();
      } catch (e) { App.toast(e.msg, false); }
    });
    return card;
  },

  createForm(zones, onSaved) {
    App.modal({
      title: '人工补录报警', width: 450, okText: '上 报',
      body: `<div style="display:flex;flex-direction:column;gap:12px;font-size:13px">
        <label>报警标题<input class="ipt" id="ac-title" placeholder="如：B2 区传递窗密封条破损"></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label>等级<select class="ipt" id="ac-level">
            <option value="critical">紧急</option><option value="major">重要</option>
            <option value="minor" selected>一般</option></select></label>
          <label>所属区域<select class="ipt" id="ac-zone">
            <option value="">不关联</option>
            ${zones.map(z => `<option value="${z.id}">${App.esc(z.name)}</option>`).join('')}</select></label>
        </div>
        <label>详细描述<textarea class="ipt" id="ac-detail" rows="3" placeholder="现场情况、发现人、临时措施等"></textarea></label>
        <div style="font-size:11px;color:var(--ink-soft)">补录报警来源标记为「人工补录」，与传感器/机器人/AI 自动报警分开统计</div>
      </div>`,
      onOk: async (body) => {
        const title = body.querySelector('#ac-title').value.trim();
        if (!title) { App.toast('报警标题不能为空', false); return false; }
        const d = { title, level: body.querySelector('#ac-level').value,
          detail: body.querySelector('#ac-detail').value.trim() };
        const z = body.querySelector('#ac-zone').value; if (z) d.zone_id = +z;
        const j = await App.api('/alarms/create', { method: 'POST', body: d });
        App.toast(j.msg); onSaved();
      },
    });
  },

  /* ---------------- 子页3：处置分析 ---------------- */
  async tabStats(el) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;height:100%;min-height:0">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;flex:none" id="m10s-kpi"></div>
        <div style="display:flex;gap:14px;flex:1;min-height:0">
          <div class="panel" style="flex:1;min-width:0">
            <div class="panel-head"><b>等级 × 状态 交叉透视</b></div>
            <div class="panel-body" id="m10s-cross" style="display:flex;flex-direction:column;gap:12px;justify-content:center"></div>
          </div>
          <div class="panel" style="width:330px;flex:none">
            <div class="panel-head"><b>报警来源构成</b><span class="tag">自动 vs 人工</span></div>
            <div class="panel-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
              <div id="m10s-donut" style="width:150px;height:150px;border-radius:50%;display:grid;place-items:center">
                <div style="width:104px;height:104px;border-radius:50%;background:var(--panel);display:grid;place-items:center;
                     box-shadow:inset 0 2px 8px rgba(14,52,66,.12);text-align:center">
                  <b id="m10s-total" style="font-size:26px">—</b>
                  <div style="font-size:10.5px;color:var(--ink-soft)">报警总数</div>
                </div>
              </div>
              <div id="m10s-src" style="width:100%;display:flex;flex-direction:column;gap:7px"></div>
            </div>
          </div>
        </div>
      </div>`;

    async function reload() {
      let d;
      try { d = (await App.api('/alarms/stats')).data; } catch (e) { App.toast(e.msg, false); return; }
      const lv = { critical: ['紧急', '#e11d48'], major: ['重要', '#f59e0b'], minor: ['一般', '#06b6d4'] };
      const kbox = el.querySelector('#m10s-kpi');
      kbox.innerHTML = `
        <div class="kpi" style="background:linear-gradient(135deg,#e11d48,#9f1239)"><i>紧急报警</i><b>${d.by_level.critical || 0}</b><s>条</s></div>
        <div class="kpi" style="background:linear-gradient(135deg,#f59e0b,#b45309)"><i>待处理+处理中</i><b>${(d.by_status.open || 0) + (d.by_status.processing || 0)}</b><s>条</s></div>
        <div class="kpi" style="background:linear-gradient(135deg,#059669,#047857)"><i>已解决</i><b>${d.by_status.resolved || 0}</b><s>条</s></div>
        <div class="kpi" style="background:linear-gradient(135deg,#0891b2,#155e75)"><i>平均处置时长</i><b>${d.avg_resolve_minutes}</b><s>分钟</s></div>`;

      // 等级 × 状态交叉条：每个等级一行，行内 4 态分段
      const cross = el.querySelector('#m10s-cross');
      cross.innerHTML = '';
      // stats 没给交叉数据，用列表现算——演示量级，一次全取没问题
      const rows = (await App.api('/alarms/list')).data;
      ['critical', 'major', 'minor'].forEach(l => {
        const sub = rows.filter(r => r.level === l);
        const segs = [['open', '#e11d48', '待处理'], ['processing', '#d97706', '处理中'],
                      ['resolved', '#059669', '已解决'], ['ignored', '#94a3b8', '已忽略']]
          .map(([s, c, t]) => ({ n: sub.filter(r => r.status === s).length, c, t }));
        const total = sub.length || 1;
        cross.appendChild(App.el(`
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">
              <b style="color:${lv[l][1]}">${lv[l][0]}级</b><span style="color:var(--ink-soft)">${sub.length} 条</span></div>
            <div style="display:flex;height:16px;border-radius:8px;overflow:hidden;background:#e2e8f0">
              ${segs.map(s => `<div style="width:${s.n / total * 100}%;background:${s.c}" title="${s.t} ${s.n} 条"></div>`).join('')}
            </div>
            <div style="display:flex;gap:12px;font-size:10.5px;color:var(--ink-soft);margin-top:4px">
              ${segs.map(s => `<span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.c};margin-right:3px"></i>${s.t} ${s.n}</span>`).join('')}
            </div>
          </div>`));
      });

      // 来源甜甜圈：conic-gradient 四段
      const src = [['sensor', '#06b6d4', '传感器'], ['robot', '#8b5cf6', '机器人'],
                   ['ai', '#e11d48', 'AI 识别'], ['manual', '#d97706', '人工补录']]
        .map(([k, c, t]) => ({ k, c, t, n: d.by_source[k] || 0 })).filter(s => s.n > 0);
      const sum = src.reduce((a, b) => a + b.n, 0);
      el.querySelector('#m10s-total').textContent = sum;
      let acc = 0;
      const stops = src.map(s => { const a0 = acc / sum * 360; acc += s.n; return `${s.c} ${a0}deg ${acc / sum * 360}deg`; });
      el.querySelector('#m10s-donut').style.background = sum ? `conic-gradient(${stops.join(',')})` : '#e2e8f0';
      el.querySelector('#m10s-src').innerHTML = src.map(s => `
        <div style="display:flex;align-items:center;gap:8px;font-size:12.5px">
          <i style="width:10px;height:10px;border-radius:3px;background:${s.c}"></i>${s.t}
          <div style="flex:1"></div><b>${s.n}</b><span style="color:var(--ink-soft)">${(s.n / sum * 100).toFixed(0)}%</span>
        </div>`).join('');
    }
    reload();
  },
});
