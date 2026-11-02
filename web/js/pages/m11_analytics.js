/* ==========================================================================
   m11 智能分析 —— 趋势预测 / 效能成本 / 决策建议与数据架构
   布局走"数据驾驶舱"路子：折线是 canvas 手绘的（不引图表库），
   数据架构图用绝对定位节点 + SVG 外键连线，整库 15 张表一屏看全。
   ========================================================================== */
App.register('m11', {
  title: '智能分析', icon: '🔮', color: '#4f46e5',
  bg: 'linear-gradient(135deg,#6366f1,#4338ca)',
  bgImg: '/web/assets/img/login_bg.jpg',
  desc: '最小二乘趋势外推 · 人机效能透视 · 五路巡检建议引擎',
  subs: ['趋势预测', '效能与成本', '建议与数据架构'],

  render(host) {
    host.appendChild(App.el(`
      <div class="page-head">
        <div class="ph-icon" style="background:linear-gradient(135deg,#818cf8,#4f46e5)">🔮</div>
        <div><h2>智能分析</h2><div class="ph-sub">NumPy 最小二乘拟合 · 24h 历史 + 6h 外推 · 置信带随斜率张开</div></div>
        <div class="spacer"></div>
        <button class="btn btn-line" id="m11-back">⌂ 返回菜单中枢</button>
      </div>`));
    host.querySelector('#m11-back').onclick = () => App.goHub();
    const body = App.el(`<div class="page-body"></div>`);
    host.appendChild(body);
    App.tabs(body, [
      { label: '趋势预测', icon: '📈', render: el => this.tabTrend(el) },
      { label: '效能与成本', icon: '⚡', render: el => this.tabEff(el) },
      { label: '建议与数据架构', icon: '🧭', render: el => this.tabDecision(el) },
    ], { style: 'card', color: '#4f46e5' });
  },

  /* ---------------- 子页1：趋势预测 ---------------- */
  async tabTrend(el) {
    el.innerHTML = `
      <div style="display:flex;gap:14px;height:100%;min-height:0">
        <div class="panel" style="flex:1.6;min-width:0;display:flex;flex-direction:column">
          <div class="panel-head"><b>粒子浓度趋势</b><span class="tag">近 24h 实测 + 6h 预测</span>
            <div class="spacer"></div>
            <select class="ipt" id="m11-zone" style="width:210px"></select></div>
          <div class="panel-body" style="display:flex;flex-direction:column">
            <canvas id="m11-cv" style="flex:1;min-height:0;width:100%"></canvas>
            <div style="display:flex;gap:16px;font-size:11.5px;color:var(--ink-soft);margin-top:8px;justify-content:center">
              <span><i style="display:inline-block;width:16px;height:3px;background:#4f46e5;vertical-align:middle;margin-right:4px"></i>实测</span>
              <span><i style="display:inline-block;width:16px;height:3px;background:#f59e0b;vertical-align:middle;margin-right:4px"></i>预测均值</span>
              <span><i style="display:inline-block;width:16px;height:3px;background:#94a3b8;vertical-align:middle;margin-right:4px"></i>置信上下限</span>
              <span><i style="display:inline-block;width:16px;height:3px;background:#e11d48;vertical-align:middle;margin-right:4px"></i>ISO 限值</span>
            </div>
          </div>
        </div>
        <div style="width:320px;flex:none;display:flex;flex-direction:column;gap:12px">
          <div class="panel" style="flex:none" id="m11-risk"></div>
          <div class="panel" style="flex:none" id="m11-peak"></div>
          <div class="panel dark" style="flex:1;min-height:0">
            <div class="panel-head"><b>预测模型说明</b></div>
            <div class="panel-body" style="font-size:12px;line-height:2;overflow:visible">
              <b style="color:#a5b4fc">拟合</b>：NumPy polyfit 一阶最小二乘<br>
              <b style="color:#a5b4fc">置信带</b>：残差标准差 ±1σ，随外推距离张开<br>
              <b style="color:#a5b4fc">风险定级</b>：近 6h 均值 ÷ ISO 限值<br>
              <b style="color:#a5b4fc">联动</b>：风险升級 → 建议引擎生成处置建议
            </div>
          </div>
        </div>
      </div>`;

    const zones = await App.api('/monitor/zone-risk').then(j => j.data).catch(() => []);
    const zSel = el.querySelector('#m11-zone');
    zSel.innerHTML = zones.map(z => `<option value="${z.zone_id}">${App.esc(z.zone_name)}（ISO${z.iso_class}）</option>`).join('');

    async function draw() {
      let d;
      try { d = (await App.api('/analytics/trend?zone_id=' + zSel.value)).data; }
      catch (e) { App.toast(e.msg, false); return; }
      const cv = el.querySelector('#m11-cv');
      const hist = d.history;                    // [[时刻, 值]]
      const pts = d.prediction.points || [];     // [{t, value, upper, lower}]
      const labels = hist.map(h => h[0]).concat(pts.map(p => p.t));
      const pad = n => new Array(Math.max(0, n)).fill(null);
      /* 手绘折线支持 null 断点：实测段和预测段首尾相接，中间不串线 */
      App.chart.line(cv, {
        labels, limit: d.limit, unit: '个/m³',
        series: [
          { name: '实测', color: '#4f46e5', data: hist.map(h => h[1]).concat(pad(pts.length)) },
          { name: '预测', color: '#f59e0b', data: pad(hist.length - 1).concat([hist.length ? hist[hist.length - 1][1] : 0], pts.map(p => p.value)) },
          { name: '上限', color: '#94a3b8', data: pad(hist.length).concat(pts.map(p => p.upper)) },
          { name: '下限', color: '#94a3b8', data: pad(hist.length).concat(pts.map(p => p.lower)) },
        ],
      });
      // 风险卡：等级配色直接贴 ai_engine 的判定
      const rk = d.risk;
      const rkC = { normal: '#059669', warning: '#d97706', critical: '#e11d48' }[rk.level] || '#64748b';
      el.querySelector('#m11-risk').innerHTML = `
        <div class="panel-body" style="padding:14px;overflow:visible">
          <div style="display:flex;align-items:center;gap:8px">
            <b style="font-size:14px">${App.esc(d.zone_name)}</b>
            <span class="badge" style="background:${rkC};color:#fff">${{ normal: '正常', warning: '预警', critical: '超标' }[rk.level] || rk.level}</span>
          </div>
          <div style="margin-top:10px">
            <div style="display:flex;justify-content:space-between;font-size:11.5px">
              <span>近6h均值 / 限值</span><b>${(rk.ratio * 100).toFixed(1)}%</b></div>
            <div style="height:10px;border-radius:5px;background:#e2e8f0;margin-top:4px;overflow:hidden">
              <div style="height:100%;width:${Math.min(rk.ratio * 100, 100)}%;background:linear-gradient(90deg,#34d399,${rkC})"></div>
            </div>
          </div>
          <div style="font-size:12px;color:var(--ink-soft);margin-top:9px;line-height:1.7">${App.esc(rk.advice)}</div>
        </div>`;
      // 峰值预报卡
      const pk = d.prediction.peak;
      el.querySelector('#m11-peak').innerHTML = `
        <div class="panel-body" style="padding:14px;overflow:visible">
          <b style="font-size:14px">峰值预报</b>
          ${pk ? `<div style="font-size:12.5px;margin-top:8px;line-height:1.9">
            预测峰值 <b style="color:${pk.value > d.limit ? 'var(--bad)' : 'var(--ok)'};font-size:18px">${Math.round(pk.value)}</b> 个/m³<br>
            出现时刻 <b>${App.fmtT(pk.t)}</b><br>
            ${pk.value > d.limit
              ? `<span style="color:var(--bad);font-weight:700">⚠ 将越过 ISO 限值，建议提前安排保洁</span>`
              : `<span style="color:var(--ok)">✔ 预测期内不越限</span>`}
          </div>` : '<div style="font-size:12px;color:var(--ink-soft);margin-top:8px">历史数据不足，无法外推</div>'}
        </div>`;
    }
    zSel.onchange = draw;
    draw();
  },

  /* ---------------- 子页2：效能与成本 ---------------- */
  async tabEff(el) {
    el.innerHTML = `
      <div style="display:flex;gap:14px;height:100%;min-height:0">
        <div class="panel" style="flex:1.25;min-width:0">
          <div class="panel-head"><b>人员效能榜</b><span class="tag">完成任务 / 耗时 / 验收分</span></div>
          <div class="panel-body" id="m11e-staff" style="display:flex;flex-direction:column;gap:10px"></div>
        </div>
        <div class="panel" style="flex:1;min-width:0;display:flex;flex-direction:column">
          <div class="panel-head"><b>物料成本曲线</b><span class="tag">近 6 个月 · 已批准领用口径</span></div>
          <div class="panel-body" style="display:flex;flex-direction:column">
            <canvas id="m11e-cv" style="flex:1;min-height:0;width:100%"></canvas>
            <div id="m11e-cost-sum" style="text-align:center;font-size:12px;color:var(--ink-soft);margin-top:8px"></div>
          </div>
        </div>
      </div>`;

    try {
      const [eff, cost] = await Promise.all([App.api('/analytics/efficiency'), App.api('/analytics/cost')]);
      const d = eff.data, top = d.top;
      const sbox = el.querySelector('#m11e-staff');
      d.staff.forEach(s => {
        const isTop = top && s.name === top.name && s.done > 0;
        const maxDone = Math.max(...d.staff.map(x => x.done), 1);
        sbox.appendChild(App.el(`
          <div style="border:1.5px solid ${isTop ? '#f59e0b' : 'var(--line)'};border-radius:12px;padding:10px 14px;
               background:${isTop ? 'linear-gradient(90deg,rgba(245,158,11,.1),transparent)' : 'transparent'}">
            <div style="display:flex;align-items:center;gap:8px">
              <b style="font-size:13.5px">${App.esc(s.name)}</b>
              <span class="badge" style="background:${App.ROLE_TEXT[s.role] ? '#4f46e5' : '#64748b'}18;color:#4f46e5">${App.ROLE_TEXT[s.role] || s.role}</span>
              ${isTop ? '<span class="badge amber">🏆 单量王</span>' : ''}
              <div style="flex:1"></div>
              <span style="font-size:12px;color:var(--ink-soft)">均分 <b style="color:${s.avg_score >= 90 ? 'var(--ok)' : s.avg_score >= 75 ? 'var(--warn)' : 'var(--bad)'}">${s.avg_score || '—'}</b></span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
              <div style="flex:1;height:10px;border-radius:5px;background:#e2e8f0;overflow:hidden">
                <div style="height:100%;width:${s.done / maxDone * 100}%;background:linear-gradient(90deg,#818cf8,#4f46e5)"></div>
              </div>
              <span style="font-size:12px;width:130px;text-align:right">完成 <b>${s.done}</b> 单 · 均 <b>${s.avg_hours}</b> h</span>
            </div>
          </div>`));
      });
      const cd = cost.data;
      App.chart.line(el.querySelector('#m11e-cv'), {
        labels: cd.map(c => c.month), unit: '元',
        series: [{ name: '领用金额', color: '#4f46e5', data: cd.map(c => c.amount) }],
      });
      const sum = cd.reduce((a, b) => a + b.amount, 0);
      el.querySelector('#m11e-cost-sum').innerHTML =
        `6 个月累计 <b style="color:var(--ink)">¥${sum.toFixed(2)}</b> · 月均 <b style="color:var(--ink)">¥${(sum / 6).toFixed(2)}</b>`;
    } catch (e) { App.toast(e.msg, false); }
  },

  /* ---------------- 子页3：建议与数据架构 ---------------- */
  async tabDecision(el) {
    el.innerHTML = `
      <div style="display:flex;gap:14px;height:100%;min-height:0">
        <div class="panel" style="width:360px;flex:none">
          <div class="panel-head"><b>智能建议引擎</b><span class="tag">五路巡检</span>
            <div class="spacer"></div><button class="btn sm btn-line" id="m11d-reload">↻</button></div>
          <div class="panel-body" id="m11d-list" style="display:flex;flex-direction:column;gap:9px"></div>
        </div>
        <div class="panel" style="flex:1;min-width:0;display:flex;flex-direction:column">
          <div class="panel-head"><b>数据架构图</b><span class="tag">15 表 · 外键连线</span>
            <div class="spacer"></div><span style="font-size:11.5px;color:var(--ink-soft)">悬停节点看字段</span></div>
          <div class="panel-body" style="position:relative;overflow:hidden">
            <div id="m11d-map" style="position:relative;width:100%;height:100%"></div>
          </div>
        </div>
      </div>`;

    /* 建议列表：level 决定卡片左边条颜色 */
    const LV = { normal: '#059669', warning: '#d97706', minor: '#0891b2', critical: '#e11d48' };
    const KIND = { zone_risk: '☣', material: '📦', staffing: '👷', robot: '🤖', equipment: '🛠', all_clear: '✔' };
    async function loadSug() {
      let d;
      try { d = (await App.api('/analytics/decision')).data; } catch (e) { App.toast(e.msg, false); return; }
      const lb = el.querySelector('#m11d-list');
      lb.innerHTML = '';
      d.suggestions.forEach(s => {
        const c = LV[s.level] || '#64748b';
        lb.appendChild(App.el(`
          <div style="border-left:5px solid ${c};background:${c}10;border-radius:9px;padding:9px 12px;font-size:12.5px;line-height:1.7">
            <b>${KIND[s.kind] || '•'} ${{ zone_risk: '区域风险', material: '物料补货', staffing: '人力调配', robot: '机器人', equipment: '设备保养', all_clear: '全域正常' }[s.kind] || s.kind}</b>
            <div style="margin-top:2px">${App.esc(s.text)}</div>
          </div>`));
      });
    }
    el.querySelector('#m11d-reload').onclick = loadSug;
    loadSug();

    /* 数据架构：节点按网格布，SVG 画外键连线 */
    let tables;
    try { tables = (await App.api('/analytics/dbmap')).data; }
    catch (e) { App.toast(e.msg, false); return; }
    const map = el.querySelector('#m11d-map');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    map.appendChild(svg);
    const COLORS = ['#4f46e5', '#0891b2', '#d97706', '#059669', '#e11d48', '#8b5cf6'];
    const nodes = {};
    const cols = Math.max(4, Math.ceil(Math.sqrt(tables.length * 1.7)));
    tables.forEach((t, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const n = App.el(`<div class="db-node" style="background:linear-gradient(135deg,${COLORS[i % 6]},${COLORS[i % 6]}bb)">
        <b>${App.esc(t.name)}</b><i>${t.rows} 行 · ${t.columns.length} 列</i></div>`);
      n.style.left = `calc(${(col + .5) / cols * 100}% - 62px)`;
      n.style.top = `calc(${(row + .5) / Math.ceil(tables.length / cols) * 100}% - 24px)`;
      n.onmouseenter = () => {
        n.style.zIndex = 9;
        n.title = `字段：${t.columns.join(', ')}\n外键：${t.fks.join('；') || '无'}`;
      };
      map.appendChild(n);
      nodes[t.name] = { el: n, t };
    });
    // 等一帧布局完再量中心点画线
    requestAnimationFrame(() => {
      const boxR = map.getBoundingClientRect();
      const center = {};
      Object.entries(nodes).forEach(([name, rec]) => {
        const r = rec.el.getBoundingClientRect();
        center[name] = { x: r.left - boxR.left + r.width / 2, y: r.top - boxR.top + r.height / 2 };
      });
      tables.forEach(t => t.fks.forEach(fk => {
        const target = fk.split('→')[1]?.split('.')[0]?.trim();
        if (!target || !center[t.name] || !center[target]) return;
        const a = center[t.name], b = center[target];
        const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y);
        ln.setAttribute('x2', b.x); ln.setAttribute('y2', b.y);
        ln.setAttribute('stroke', 'rgba(79,70,229,.4)'); ln.setAttribute('stroke-width', '1.6');
        ln.setAttribute('stroke-dasharray', '5 4');
        svg.appendChild(ln);
        // 箭头点：目标表一侧画个小圆点
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', b.x); dot.setAttribute('cy', b.y); dot.setAttribute('r', '3.5');
        dot.setAttribute('fill', '#4f46e5');
        svg.appendChild(dot);
      }));
    });
  },
});
