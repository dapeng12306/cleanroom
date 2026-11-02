/* ==========================================================================
   m02 洁净度监测 —— 传感网络 / 区域风险墙 / 历史曲线
   风格：bar 页签 + 左侧 SVG 平面图右侧风险栏的双栏布局
   ========================================================================== */
App.register('m02', {
  title: '洁净度监测', icon: '📡', color: '#0d9488',
  bg: 'linear-gradient(135deg,#0d9488,#0f766e)',
  bgImg: '/web/assets/img/particle_sensor.jpg',
  desc: '传感网络平面图 · 区域风险墙 · 粒子浓度历史曲线',
  subs: ['传感网络图', '区域风险墙', '历史曲线'],

  render(host) {
    host.appendChild(App.el(`
      <div class="page-head">
        <div class="ph-icon" style="background:linear-gradient(135deg,#14b8a6,#0d9488)">📡</div>
        <div><h2>洁净度监测</h2><div class="ph-sub">粒子 / 温湿度 / 压差 / VOC 五类传感网络实时监控</div></div>
        <div class="spacer"></div>
        <button class="btn btn-line" id="m02-back">⌂ 返回菜单中枢</button>
      </div>`));
    host.querySelector('#m02-back').onclick = () => App.goHub();
    const body = App.el(`<div class="page-body"></div>`);
    host.appendChild(body);
    App.tabs(body, [
      { label: '传感网络图', icon: '🕸', render: el => this.tabMap(el) },
      { label: '区域风险墙', icon: '🧱', render: el => this.tabRisk(el) },
      { label: '历史曲线', icon: '📈', render: el => this.tabHistory(el) },
    ], { style: 'bar', color: '#0d9488' });
  },

  /* ---------------- 子页1：传感网络 SVG 平面图 ---------------- */
  async tabMap(el) {
    el.innerHTML = `<div style="display:grid;grid-template-columns:1.7fr 1fr;gap:12px;height:100%">
      <div class="panel"><div class="panel-head"><b>车间传感器平面分布</b><span class="tag">点击圆点查看详情</span>
        <div class="spacer"></div><button class="btn sm emerald" id="m02-add">＋ 注册传感器</button></div>
        <div class="panel-body" style="overflow:hidden"><svg id="m02-svg" width="100%" height="100%" viewBox="-26 -18 58 32" preserveAspectRatio="xMidYMid meet"></svg></div></div>
      <div class="panel alt"><div class="panel-head"><b>区域风险速览</b><span class="tag">24h 粒子均值</span></div>
        <div class="panel-body" id="m02-risk-side"></div></div>
    </div>`;

    const svg = el.querySelector('#m02-svg');
    const NS = 'http://www.w3.org/2000/svg';
    const ST_COLOR = { online: '#059669', offline: '#94a3b8', calibrating: '#f59e0b' };
    const TYPE_ICON = { particle: 'P', temp: 'T', humidity: 'H', pressure: 'Δ', voc: 'V' };

    const [scene, sensors, risks] = await Promise.all([
      App.api('/dashboard/scene'), App.api('/monitor/sensors'), App.api('/monitor/zone-risk'),
    ]).catch(e => { App.toast(e.msg, false); return [null, null, null]; });
    if (!scene) return;

    // 区域块：状态着色 + ISO 标签
    scene.data.zones.forEach(z => {
      const rc = { normal: 'rgba(45,212,191,.18)', warning: 'rgba(245,158,11,.22)', critical: 'rgba(244,63,94,.25)', cleaning: 'rgba(56,189,248,.2)' }[z.status] || 'rgba(45,212,191,.18)';
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', z.x - z.w / 2); rect.setAttribute('y', z.y - z.h / 2);
      rect.setAttribute('width', z.w); rect.setAttribute('height', z.h);
      rect.setAttribute('rx', .8); rect.setAttribute('fill', rc);
      rect.setAttribute('stroke', App.ISO_COLOR[z.iso_class]); rect.setAttribute('stroke-width', .18);
      svg.appendChild(rect);
      const tx = document.createElementNS(NS, 'text');
      tx.setAttribute('x', z.x); tx.setAttribute('y', z.y - z.h / 2 + 1.6);
      tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('font-size', '1.1');
      tx.setAttribute('fill', '#0e3442'); tx.setAttribute('font-weight', '700');
      tx.textContent = `${z.name} ISO${z.iso_class}`;
      svg.appendChild(tx);
    });

    // 传感器圆点
    sensors.data.forEach(s => {
      const g = document.createElementNS(NS, 'g');
      g.style.cursor = 'pointer';
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', s.x); c.setAttribute('cy', s.y); c.setAttribute('r', .55);
      c.setAttribute('fill', ST_COLOR[s.status] || '#94a3b8');
      c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', .12);
      const tt = document.createElementNS(NS, 'text');
      tt.setAttribute('x', s.x); tt.setAttribute('y', s.y + .38);
      tt.setAttribute('text-anchor', 'middle'); tt.setAttribute('font-size', '.5');
      tt.setAttribute('fill', '#fff'); tt.setAttribute('font-weight', '800');
      tt.textContent = TYPE_ICON[s.stype] || '?';
      g.appendChild(c); g.appendChild(tt);
      g.onclick = () => this.sensorDetail(s);
      svg.appendChild(g);
    });

    // 右侧风险栏
    const side = el.querySelector('#m02-risk-side');
    risks.data.forEach(r => {
      const lv = { normal: ['#059669', '正常'], warning: ['#d97706', '预警'], critical: ['#e11d48', '超标'] }[r.risk.level] || ['#64748b', '?'];
      side.appendChild(App.el(`<div style="background:#fff8;border-radius:10px;padding:10px 12px;margin-bottom:9px;border-left:5px solid ${lv[0]}">
        <div style="display:flex;align-items:center;gap:8px"><b style="font-size:13.5px">${r.zone_name}</b>
          <span class="badge" style="background:${App.ISO_COLOR[r.iso_class]}22;color:${App.ISO_COLOR[r.iso_class]}">ISO${r.iso_class}</span>
          <span style="flex:1"></span><span class="badge" style="background:${lv[0]}22;color:${lv[0]}">${lv[1]}</span></div>
        <div style="height:7px;border-radius:6px;background:#e2e8f0;margin:8px 0 5px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100, r.risk.ratio * 100)}%;background:${lv[0]};border-radius:6px;transition:width .6s"></div></div>
        <div style="font-size:11.5px;color:var(--ink-soft)">均值 ${Math.round(r.mean)} / 限值 ${r.limit}（${(r.risk.ratio * 100).toFixed(0)}%）</div>
      </div>`));
    });

    el.querySelector('#m02-add').onclick = () => this.addSensor(scene.data.zones);
  },

  /* 传感器详情弹窗：读数 + 状态变更 + 模拟超标 + 删除 */
  async sensorDetail(s) {
    let readings = [];
    try { readings = (await App.api(`/monitor/readings?sensor_id=${s.id}&hours=6`)).data; } catch (e) { App.toast(e.msg, false); }
    const latest = readings.length ? readings[readings.length - 1] : null;
    App.modal({
      title: `${s.code} · 传感器档案`, width: 460, hideFoot: true,
      body: `<div style="line-height:2;font-size:13.5px">
        <div>类型：<b>${{ particle: '粒子计数', temp: '温度', humidity: '湿度', pressure: '压差', voc: 'VOC' }[s.stype] || s.stype}</b>
          　状态：${App.badge(s.status)}</div>
        <div>所属区域：<b>${s.zone_name || ''}</b>　坐标 (${s.x.toFixed(1)}, ${s.y.toFixed(1)})</div>
        <div style="background:rgba(6,182,212,.08);border-radius:10px;padding:10px 14px;margin:10px 0;font-size:15px">
          最新读数：<b style="color:var(--c-teal);font-size:20px">${latest ? latest.value : '—'}</b> ${latest ? latest.unit : ''}
          <span style="font-size:11px;color:var(--ink-soft)">${latest ? App.fmtT(latest.recorded_at) : ''}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button class="btn sm cyan" id="sd-cal">校准</button>
          <button class="btn sm slate" id="sd-off">${s.status === 'offline' ? '上线' : '下线'}</button>
          ${s.stype === 'particle' ? '<button class="btn sm orange" id="sd-sim">⚡ 模拟一次超标</button>' : ''}
          <button class="btn sm rose" id="sd-del">删除</button>
        </div></div>`,
    });
    const closeAll = () => document.querySelector('.modal-scrim')?.remove();
    document.getElementById('sd-cal').onclick = async () => {
      try { const j = await App.api(`/monitor/sensors/${s.id}`, { method: 'PUT', body: { status: 'calibrating' } });
        App.toast(j.msg || '已转入校准'); closeAll(); } catch (e) { App.toast(e.msg, false); }
    };
    document.getElementById('sd-off').onclick = async () => {
      try { const j = await App.api(`/monitor/sensors/${s.id}`, { method: 'PUT', body: { status: s.status === 'offline' ? 'online' : 'offline' } });
        App.toast(j.msg || '状态已切换'); closeAll(); } catch (e) { App.toast(e.msg, false); }
    };
    const simBtn = document.getElementById('sd-sim');
    if (simBtn) simBtn.onclick = async () => {
      try { const j = await App.api('/monitor/simulate', { method: 'POST', body: { zone_id: s.zone_id } });
        App.toast(j.msg || '已注入超标读数并生成报警'); closeAll(); App.go('m02'); }
      catch (e) { App.toast(e.msg, false); }
    };
    document.getElementById('sd-del').onclick = async () => {
      if (!await App.confirm(`确定删除传感器 ${s.code}？其历史读数将一并清除`)) return;
      try { const j = await App.api(`/monitor/sensors/${s.id}`, { method: 'DELETE' });
        App.toast(j.msg || '已删除'); closeAll(); App.go('m02'); } catch (e) { App.toast(e.msg, false); }
    };
  },

  addSensor(zones) {
    App.modal({
      title: '注册新传感器', width: 460, okText: '注册',
      body: `<div class="form-grid">
        <div class="field"><label>编号</label><input id="ns-code" placeholder="如 SN-PA-099"></div>
        <div class="field"><label>类型</label><select id="ns-type">
          <option value="particle">粒子计数</option><option value="temp">温度</option>
          <option value="humidity">湿度</option><option value="pressure">压差</option><option value="voc">VOC</option></select></div>
        <div class="field full"><label>所属区域</label><select id="ns-zone">
          ${zones.map(z => `<option value="${z.id}">${z.name}（ISO${z.iso_class}）</option>`).join('')}</select></div>
        <div class="field"><label>坐标 X</label><input id="ns-x" type="number" value="0" step="0.5"></div>
        <div class="field"><label>坐标 Y</label><input id="ns-y" type="number" value="0" step="0.5"></div>
      </div>`,
      async onOk(box) {
        const body = {
          code: box.querySelector('#ns-code').value.trim(),
          stype: box.querySelector('#ns-type').value,
          zone_id: +box.querySelector('#ns-zone').value,
          x: +box.querySelector('#ns-x').value, y: +box.querySelector('#ns-y').value,
        };
        if (!body.code) { App.toast('编号不能为空', false); return false; }
        const j = await App.api('/monitor/sensors', { method: 'POST', body });
        App.toast(j.msg || '传感器注册成功'); App.go('m02');
      },
    });
  },

  /* ---------------- 子页2：区域风险墙 ---------------- */
  async tabRisk(el) {
    el.innerHTML = `<div class="panel" style="height:100%"><div class="panel-head">
      <b>区域洁净风险墙</b><span class="tag">破限自动预警</span>
      <div class="spacer"></div><button class="btn sm btn-line" id="m02-rf">⟳ 刷新</button></div>
      <div class="panel-body"><div id="m02-riskwall" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px"></div></div></div>`;
    const wall = el.querySelector('#m02-riskwall');
    const load = async () => {
      wall.innerHTML = '';
      let risks;
      try { risks = (await App.api('/monitor/zone-risk')).data; } catch (e) { return App.toast(e.msg, false); }
      risks.forEach((r, i) => {
        const lv = { normal: ['#059669', '正常', 'linear-gradient(135deg,#059669,#0d9488)'],
                     warning: ['#d97706', '预警', 'linear-gradient(135deg,#f59e0b,#d97706)'],
                     critical: ['#e11d48', '超标', 'linear-gradient(135deg,#f43f5e,#be123c)'] }[r.risk.level];
        const card = App.el(`<div style="border-radius:14px;overflow:hidden;box-shadow:var(--shadow);animation:fadeUp .4s ${i * 60}ms both;background:var(--panel)">
          <div style="height:56px;background:${lv[2]};display:flex;align-items:center;padding:0 16px;color:#fff">
            <b style="font-size:16px">${r.zone_name}</b>
            <span style="flex:1"></span>
            <span style="font-size:26px;font-weight:900">${(r.risk.ratio * 100).toFixed(0)}<span style="font-size:12px">%</span></span></div>
          <div style="padding:12px 16px">
            <div style="font-size:12px;color:var(--ink-soft);margin-bottom:8px">ISO${r.iso_class} · 24h均值 <b>${Math.round(r.mean)}</b> · 限值 ${r.limit}</div>
            <div style="height:9px;border-radius:6px;background:#e2e8f0;overflow:hidden;margin-bottom:8px">
              <div style="height:100%;width:${Math.min(100, r.risk.ratio * 100)}%;background:${lv[0]}"></div></div>
            <div style="font-size:12.5px;background:rgba(13,148,136,.07);border-radius:8px;padding:8px 10px">${r.risk.advice}</div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn sm amber act-task">🧹 发起保洁任务</button>
              <button class="btn sm btn-line act-sim">模拟超标</button>
            </div></div></div>`);
        card.querySelector('.act-task').onclick = () => this.quickTask(r);
        card.querySelector('.act-sim').onclick = async () => {
          try { const j = await App.api('/monitor/simulate', { method: 'POST', body: { zone_id: r.zone_id } });
            App.toast(j.msg); load(); } catch (e) { App.toast(e.msg, false); }
        };
        wall.appendChild(card);
      });
    };
    el.querySelector('#m02-rf').onclick = load;
    await load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  },

  quickTask(r) {
    App.modal({
      title: `为「${r.zone_name}」发起保洁任务`, width: 460, okText: '创建任务',
      body: `<div class="form-grid">
        <div class="field full"><label>任务标题</label><input id="qt-title" value="${r.zone_name} 应急保洁"></div>
        <div class="field"><label>类型</label><select id="qt-type">
          <option value="routine">例行保洁</option><option value="deep">深度保洁</option>
          <option value="emergency" selected>紧急处置</option><option value="disinfection">消杀作业</option></select></div>
        <div class="field"><label>优先级</label><select id="qt-pri">
          <option value="1">P1 最高</option><option value="2" selected>P2 高</option>
          <option value="3">P3 常规</option><option value="4">P4 低</option></select></div>
        <div class="field"><label>计划开始</label><input id="qt-s" type="datetime-local"></div>
        <div class="field"><label>计划结束</label><input id="qt-e" type="datetime-local"></div>
      </div>`,
      async onOk(box) {
        const f = v => v ? v.replace('T', ' ') + ':00' : null;
        const j = await App.api('/tasks/create', { method: 'POST', body: {
          title: box.querySelector('#qt-title').value.trim(), task_type: box.querySelector('#qt-type').value,
          zone_id: r.zone_id, priority: +box.querySelector('#qt-pri').value,
          planned_start: f(box.querySelector('#qt-s').value), planned_end: f(box.querySelector('#qt-e').value),
        }});
        App.toast(j.msg || '任务已创建，去任务中心派单');
      },
    });
  },

  /* ---------------- 子页3：历史曲线 ---------------- */
  async tabHistory(el) {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;height:100%">
      <div class="panel" style="flex:none"><div style="display:flex;gap:10px;align-items:center">
        <b style="font-size:14px">传感器：</b><select id="m02-sel" style="padding:7px 12px;border-radius:9px;border:1.5px solid var(--line);min-width:260px"></select>
        <div class="spacer"></div>
        <div class="tabs-seg tabs" style="margin:0">
          <button class="tab" data-h="6">6 小时</button><button class="tab active" data-h="24">24 小时</button><button class="tab" data-h="48">48 小时</button>
        </div></div></div>
      <div class="panel" style="flex:1;min-height:0"><div class="panel-head"><b id="m02-chart-title">粒子浓度曲线</b>
        <span class="tag" id="m02-chart-limit"></span></div>
        <div class="panel-body" style="overflow:hidden"><canvas id="m02-cv" style="width:100%;height:100%"></canvas></div></div>
    </div>`;

    const sel = el.querySelector('#m02-sel');
    let sensors;
    try { sensors = (await App.api('/monitor/sensors')).data; } catch (e) { App.toast(e.msg, false); return; }
    sensors.forEach(s => sel.appendChild(App.el(
      `<option value="${s.id}" data-zone="${s.zone_id}" data-type="${s.stype}">${s.code} · ${s.zone_name || ''}（${{ particle: '粒子', temp: '温度', humidity: '湿度', pressure: '压差', voc: 'VOC' }[s.stype]}）</option>`)));
    // 默认选中第一个粒子传感器
    const pi = sensors.findIndex(s => s.stype === 'particle');
    if (pi >= 0) sel.selectedIndex = pi;

    let hours = 24;
    const draw = async () => {
      const sid = sel.value;
      const opt = sel.selectedOptions[0];
      let rows;
      try { rows = (await App.api(`/monitor/readings?sensor_id=${sid}&hours=${hours}`)).data; }
      catch (e) { return App.toast(e.msg, false); }
      if (!rows.length) return;
      // 粒子传感器叠加所属区域限值线
      let limit = null;
      if (opt.dataset.type === 'particle') {
        try { limit = (await App.api(`/analytics/trend?zone_id=${opt.dataset.zone}`)).data.limit; } catch (e) { }
      }
      el.querySelector('#m02-chart-title').textContent = sel.selectedOptions[0].textContent;
      el.querySelector('#m02-chart-limit').textContent = limit ? `ISO限值 ${limit}` : '';
      App.chart.line(el.querySelector('#m02-cv'), {
        labels: rows.map(r => r.recorded_at),
        series: [{ data: rows.map(r => r.value), color: '#0d9488' }],
        limit,
      });
    };
    sel.onchange = draw;
    el.querySelectorAll('[data-h]').forEach(b => b.onclick = () => {
      el.querySelectorAll('[data-h]').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); hours = +b.dataset.h; draw();
    });
    await draw();
    const ro = new ResizeObserver(draw); ro.observe(el.querySelector('#m02-cv'));
    return () => ro.disconnect();
  },
});
