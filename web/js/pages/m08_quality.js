/* ==========================================================================
   m08 质量验收 —— 验收工作台 / 判定规则台 / 合格率透视
   布局走"筛选轨 + 单据卡片流"，刻意不用表格：验收单带结论印章和
   实测/标准对照条，比行式表格更有实验室的味道。判定试算器纯前端
   复刻 rules.judge_inspection，演示时不用开单也能现场玩判定。
   ========================================================================== */
App.register('m08', {
  title: '质量验收', icon: '⚖️', color: '#e11d48',
  bg: 'linear-gradient(135deg,#f43f5e,#be123c)',
  bgImg: '/web/assets/img/lab_quality.jpg',
  desc: '四种验收方法 · 实测自动判定 · 复核联动任务',
  subs: ['验收工作台', '判定规则台', '合格率透视'],

  /* 方法配色：和判定规则台、试算器共用一套，全页统一 */
  MC: { particle: '#06b6d4', atp: '#8b5cf6', settle_plate: '#d97706', surface: '#e11d48' },
  /* 方法档案镜像（后端 /quality/methods 同源）：列表接口不带名称单位，前端自己翻 */
  MNAME: { particle: '粒子计数', atp: 'ATP荧光', settle_plate: '沉降菌', surface: '表面残留' },
  MUNIT: { particle: '个/m³', atp: 'RLU', settle_plate: 'CFU/皿', surface: 'μg/cm²' },
  /* 非粒子方法的兜底标准，镜像后端 DEFAULT_STANDARD，只用于表单预填与试算 */
  DEFAULT_STD: { atp: 50.0, settle_plate: 1.0, surface: 2.5 },

  render(host) {
    host.appendChild(App.el(`
      <div class="page-head">
        <div class="ph-icon" style="background:linear-gradient(135deg,#fb7185,#e11d48)">⚖️</div>
        <div><h2>质量验收</h2><div class="ph-sub">实测值 ≤ 标准即合格 · 复核通过任务自动闭环 · 不合格打回返工</div></div>
        <div class="spacer"></div>
        <button class="btn btn-line" id="m08-back">⌂ 返回菜单中枢</button>
      </div>`));
    host.querySelector('#m08-back').onclick = () => App.goHub();
    const body = App.el(`<div class="page-body"></div>`);
    host.appendChild(body);
    App.tabs(body, [
      { label: '验收工作台', icon: '🧾', render: el => this.tabBench(el) },
      { label: '判定规则台', icon: '📐', render: el => this.tabRules(el) },
      { label: '合格率透视', icon: '📈', render: el => this.tabStats(el) },
    ], { style: 'seg', color: '#e11d48' });
  },

  /* 区域清单（带粒子限值）：新建单和试算器都要用 */
  async zoneList() {
    const j = await App.api('/monitor/zone-risk');
    return j.data;   // [{zone_id, zone_name, iso_class, limit, mean, risk}]
  },

  /* ---------------- 子页1：验收工作台 ---------------- */
  async tabBench(el) {
    el.innerHTML = `
      <div style="display:flex;gap:14px;height:100%;min-height:0">
        <div class="panel" style="width:236px;flex:none">
          <div class="panel-head"><b>结论筛选</b></div>
          <div class="panel-body" style="display:flex;flex-direction:column;gap:8px;overflow:visible">
            ${[['', '全部单据', '#475569'], ['pass', '仅看合格', '#059669'], ['fail', '仅看不合格', '#e11d48'], ['pending', '待检草稿', '#d97706']]
              .map(([k, t, c]) => `<button class="btn btn-line m08-filter" data-k="${k}"
                style="text-align:left;border-left-width:5px;border-left-color:${c}">${t}</button>`).join('')}
            <div style="border-top:1.5px dashed var(--line);margin:6px 0"></div>
            <button class="btn rose lg btn-block" id="m08-new">＋ 开验收单</button>
            <div style="font-size:11.5px;color:var(--ink-soft);line-height:1.8">
              草稿 → 提交实测值（自动判定）→ 班长复核。<br>
              复核通过且合格：关联任务转「验收通过」；不合格：任务打回返工。
            </div>
            <div class="kpi" style="background:linear-gradient(135deg,#f43f5e,#9f1239);margin-top:auto">
              <i>待复核</i><b id="m08-pending-cnt">—</b><s>单</s></div>
          </div>
        </div>
        <div class="panel" style="flex:1;min-width:0">
          <div class="panel-head"><b>验收单队列</b><span class="tag" id="m08-cnt"></span>
            <div class="spacer"></div>
            <button class="btn sm btn-line" id="m08-reload">↻ 刷新</button></div>
          <div class="panel-body"><div id="m08-list" style="display:grid;grid-template-columns:1fr 1fr;gap:12px"></div></div>
        </div>
      </div>`;

    const listBox = el.querySelector('#m08-list');
    let filter = '';
    const self = this;

    async function reload() {
      let rows;
      try {
        rows = (await App.api('/quality/list' + (filter ? '?conclusion=' + filter : ''))).data;
      } catch (e) { App.toast(e.msg, false); return; }
      el.querySelector('#m08-cnt').textContent = `共 ${rows.length} 单`;
      el.querySelector('#m08-pending-cnt').textContent = rows.filter(r => r.status === 'submitted').length;
      listBox.innerHTML = '';
      if (!rows.length) {
        listBox.appendChild(App.el(`<div style="grid-column:1/3;text-align:center;color:var(--ink-soft);padding:60px 0">
          <div style="font-size:46px;opacity:.35">🧾</div><div style="margin-top:8px;font-size:13px">当前筛选下没有验收单，点左侧「开验收单」建一张</div></div>`));
        return;
      }
      rows.forEach(r => listBox.appendChild(self.inspCard(r, reload)));
    }

    el.querySelectorAll('.m08-filter').forEach(b => b.onclick = () => {
      filter = b.dataset.k;
      el.querySelectorAll('.m08-filter').forEach(x => x.style.background = '');
      b.style.background = 'rgba(225,29,72,.1)';
      reload();
    });
    el.querySelector('.m08-filter').style.background = 'rgba(225,29,72,.1)';
    el.querySelector('#m08-reload').onclick = reload;
    el.querySelector('#m08-new').onclick = () => this.createForm(reload);
    reload();
  },

  /* 单张验收单卡片：结论印章 + 实测/标准对照条 + 按状态出操作 */
  inspCard(r, reload) {
    const mc = this.MC[r.method] || '#06b6d4';
    const card = App.el(`<div class="panel" style="margin:0;position:relative;overflow:hidden">
      <div style="position:absolute;left:0;top:0;bottom:0;width:5px;background:${mc}"></div>
      <div class="panel-body" style="padding:12px 14px 12px 18px;overflow:visible"></div>
    </div>`);
    const body = card.querySelector('.panel-body');

    const conclMap = { pass: ['合格', 'var(--ok)'], fail: ['不合格', 'var(--bad)'], pending: ['待检', 'var(--warn)'] };
    const cc = conclMap[r.conclusion] || conclMap.pending;
    const ratio = r.result_value != null && r.standard ? Math.min(r.result_value / r.standard, 1.6) : 0;
    const canSubmit = r.status === 'draft' || r.status === 'rejected';
    const canReview = r.status === 'submitted';
    const roleOk = ['inspector', 'leader'].includes(App.user?.role);

    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <b style="font-size:15px">${App.esc(r.code)}</b>
        <span class="badge" style="background:${mc}18;color:${mc}">${this.MNAME[r.method] || App.esc(r.method)}</span>
        <div style="flex:1"></div>
        ${App.badge(r.status)}
        <span class="grade-stamp" style="position:static;transform:none;font-size:15px;padding:2px 10px;
              border-color:${cc[1].replace('var(--ok)', '#059669').replace('var(--bad)', '#e11d48').replace('var(--warn)', '#d97706')};
              color:${cc[1].replace('var(--ok)', '#059669').replace('var(--bad)', '#e11d48').replace('var(--warn)', '#d97706')}">${cc[0]}</span>
      </div>
      <div style="font-size:12px;color:var(--ink-soft);margin-top:6px">
        📍 ${App.esc(r.zone_name)}　${r.task_code ? '🔗 关联任务 <b>' + App.esc(r.task_code) + '</b>' : '◎ 抽检单（不挂任务）'}
      </div>
      <div style="margin-top:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px">
          <span>实测 <b style="color:${r.conclusion === 'fail' ? 'var(--bad)' : 'var(--ink)'};font-size:15px">${r.result_value ?? '—'}</b> ${this.MUNIT[r.method] || ''}</span>
          <span style="color:var(--ink-soft)">标准 ≤ <b>${r.standard ?? '—'}</b></span>
        </div>
        <div style="height:9px;border-radius:5px;background:#e2e8f0;margin-top:5px;position:relative;overflow:hidden">
          <div style="height:100%;width:${ratio * 62.5}%;max-width:100%;border-radius:5px;transition:width .6s;
               background:${r.conclusion === 'fail' ? 'linear-gradient(90deg,#f59e0b,#e11d48)' : 'linear-gradient(90deg,#34d399,#059669)'}"></div>
          <div style="position:absolute;left:62.5%;top:-2px;bottom:-2px;width:2px;background:var(--bad)"></div>
        </div>
      </div>
      ${r.note ? `<div style="font-size:11.5px;color:var(--ink-soft);margin-top:8px;font-style:italic">备注：${App.esc(r.note)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
        <span style="font-size:11px;color:var(--ink-soft)">${App.esc(r.inspector_name || '未指派')} · ${App.fmtT(r.created_at)}</span>
        <div style="flex:1"></div>
        ${canSubmit ? `<button class="btn sm rose" data-act="submit" ${roleOk ? '' : 'disabled title="仅质检员/洁净班长可提交"'}>📤 ${r.status === 'rejected' ? '重新提交' : '提交实测值'}</button>` : ''}
        ${canReview ? `<button class="btn sm violet" data-act="review" ${roleOk ? '' : 'disabled title="仅质检员/洁净班长可复核"'}>🔍 复核审批</button>` : ''}
        ${r.status === 'draft' ? `<button class="btn sm btn-line" data-act="del">🗑</button>` : ''}
      </div>`;

    body.querySelectorAll('button[data-act]').forEach(btn => btn.onclick = () => {
      const act = btn.dataset.act;
      if (act === 'submit') this.submitForm(r, reload);
      else if (act === 'review') this.reviewForm(r, reload);
      else if (act === 'del') this.removeDraft(r, reload);
    });
    return card;
  },

  /* 新建验收单弹窗：任务下拉只列待验收，标准留空由后端按方法/区域自动定 */
  async createForm(onSaved) {
    let zones, tasks, methods;
    try {
      [zones, tasks, methods] = await Promise.all([
        this.zoneList(),
        App.api('/quality/pending-tasks').then(j => j.data),
        App.api('/quality/methods').then(j => j.data),
      ]);
    } catch (e) { App.toast(e.msg, false); return; }

    App.modal({
      title: '开验收单（草稿）', width: 470, okText: '开 单',
      body: `<div style="display:flex;flex-direction:column;gap:12px;font-size:13px">
        <label>验收方法<select class="ipt" id="qf-method">
          ${methods.map(m => `<option value="${m.key}">${m.name}（${m.unit}）</option>`).join('')}
        </select></label>
        <label>洁净区域<select class="ipt" id="qf-zone">
          ${zones.map(z => `<option value="${z.zone_id}">${App.esc(z.zone_name)}（ISO${z.iso_class}）</option>`).join('')}
        </select></label>
        <label>关联保洁任务<select class="ipt" id="qf-task">
          <option value="">不关联（抽检单）</option>
          ${tasks.map(t => `<option value="${t.id}">${App.esc(t.code)} · ${App.esc(t.title)}</option>`).join('')}
        </select></label>
        <div id="qf-std-tip" style="background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.3);
             border-radius:9px;padding:8px 12px;font-size:12px;color:var(--ink-soft)"></div>
      </div>`,
      onOk: async (body) => {
        const d = {
          method: body.querySelector('#qf-method').value,
          zone_id: +body.querySelector('#qf-zone').value,
        };
        const t = body.querySelector('#qf-task').value;
        if (t) d.task_id = +t;   // 标准故意不传：后端按方法自动取 ISO 限值或默认标准
        const j = await App.api('/quality/create', { method: 'POST', body: d });
        App.toast(j.msg);
        onSaved();
      },
    });
    // 标准提示跟着方法/区域联动，开单前就把判定线亮出来
    const tip = document.querySelector('#qf-std-tip');
    const updTip = () => {
      const m = document.querySelector('#qf-method').value;
      const zid = +document.querySelector('#qf-zone').value;
      const z = zones.find(x => x.zone_id === zid);
      const mm = { particle: '粒子计数', atp: 'ATP荧光', settle_plate: '沉降菌', surface: '表面残留' }[m];
      const std = m === 'particle' ? (z ? z.limit : '—') : this.DEFAULT_STD[m];
      tip.innerHTML = `判定标准：<b style="color:var(--ink)">${mm} ≤ ${std}</b>（${m === 'particle' ? `随区域 ISO${z?.iso_class} 等级自动取值` : '方法默认标准'}），实测值 ≤ 标准即判合格`;
    };
    document.querySelector('#qf-method').onchange = updTip;
    document.querySelector('#qf-zone').onchange = updTip;
    updTip();
  },

  /* 提交实测值弹窗：边输边预判，合格绿、超标红，还没提交就知道结果 */
  submitForm(r, onSaved) {
    const unit = this.MUNIT[r.method] || '';
    App.modal({
      title: `提交实测值 · ${r.code}`, width: 430, okText: '提交并判定',
      body: `<div style="display:flex;flex-direction:column;gap:12px;font-size:13px">
        <div style="display:flex;gap:10px;align-items:center">
          <div class="kpi" style="flex:1;background:linear-gradient(135deg,#64748b,#334155);padding:10px">
            <i>判定标准</i><b style="font-size:20px">≤ ${r.standard}</b><s>${unit}</s></div>
          <div style="font-size:20px;color:var(--ink-soft)">→</div>
          <div id="sf-pre" style="flex:1;text-align:center;border-radius:12px;padding:12px;font-weight:700;
               border:2px dashed var(--line);color:var(--ink-soft)">输入实测值预判</div>
        </div>
        <label>实测值（${unit}）<input class="ipt" id="sf-val" type="number" step="0.01" autofocus></label>
        <label>检验备注<textarea class="ipt" id="sf-note" rows="2" placeholder="采样点位 / 仪器编号 / 环境条件等"></textarea></label>
      </div>`,
      onOk: async (body) => {
        const v = body.querySelector('#sf-val').value;
        if (v === '') { App.toast('实测值不能为空', false); return false; }
        const j = await App.api(`/quality/${r.id}/submit`, { method: 'POST', body: {
          result_value: +v, note: body.querySelector('#sf-note').value.trim() } });
        App.toast(j.msg, j.data.conclusion === 'pass');
        onSaved();
      },
    });
    // 本地预判复刻 judge_inspection：value <= standard → pass
    const valIn = document.querySelector('#sf-val');
    const pre = document.querySelector('#sf-pre');
    valIn.oninput = () => {
      if (valIn.value === '') { pre.style.cssText += ''; pre.textContent = '输入实测值预判';
        pre.style.borderColor = 'var(--line)'; pre.style.color = 'var(--ink-soft)'; return; }
      const pass = +valIn.value <= r.standard;
      pre.textContent = pass ? '✔ 预判：合格' : '✖ 预判：不合格';
      pre.style.borderColor = pass ? '#059669' : '#e11d48';
      pre.style.color = pass ? '#059669' : '#e11d48';
      pre.style.background = pass ? 'rgba(5,150,105,.08)' : 'rgba(225,29,72,.08)';
    };
  },

  /* 复核弹窗：批准/驳回双按钮。批准且合格 → 任务 passed；不合格 → 任务 failed */
  reviewForm(r, onSaved) {
    const pass = r.conclusion === 'pass';
    App.modal({
      title: `复核审批 · ${r.code}`, width: 460, hideFoot: true,
      body: `<div style="font-size:13px;line-height:2">
        <div style="display:flex;gap:10px">
          <div class="kpi" style="flex:1;background:linear-gradient(135deg,${pass ? '#059669,#0d9488' : '#e11d48,#9f1239'})">
            <i>自动判定</i><b style="font-size:22px">${pass ? '合格' : '不合格'}</b></div>
          <div class="kpi" style="flex:1;background:linear-gradient(135deg,#0891b2,#155e75)">
            <i>实测 / 标准</i><b style="font-size:20px">${r.result_value} / ≤${r.standard}</b><s>${this.MUNIT[r.method] || ''}</s></div>
        </div>
        <div style="margin:12px 0;padding:10px 12px;border-radius:10px;background:rgba(100,116,139,.08);font-size:12.5px">
          ${r.task_code ? `关联任务 <b>${App.esc(r.task_code)}</b>：批准后将自动转为
            「${pass ? '验收通过' : '验收不合格（返工）'}」` : '抽检单无关联任务，复核仅归档质量记录'}
          ${r.note ? `<br>检验备注：${App.esc(r.note)}` : ''}
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn rose btn-block" id="rv-reject">✖ 驳 回</button>
          <button class="btn emerald btn-block" id="rv-approve">✔ 批 准</button>
        </div>
      </div>`,
    });
    document.getElementById('rv-approve').onclick = async () => {
      try {
        const j = await App.api(`/quality/${r.id}/review`, { method: 'POST', body: { approve: true } });
        App.toast(j.msg, true);
        document.querySelector('.modal-scrim')?.remove();
        onSaved();
      } catch (e) { App.toast(e.msg, false); }
    };
    document.getElementById('rv-reject').onclick = async () => {
      if (!await App.confirm('驳回后验收单打回「已驳回」，需质检员重新提交实测值。确认驳回？')) return;
      try {
        const j = await App.api(`/quality/${r.id}/review`, { method: 'POST', body: { approve: false } });
        App.toast(j.msg, true);
        document.querySelector('.modal-scrim')?.remove();
        onSaved();
      } catch (e) { App.toast(e.msg, false); }
    };
  },

  async removeDraft(r, onSaved) {
    if (!await App.confirm(`删除验收单草稿 ${r.code}？仅草稿可删，删除后不可恢复。`)) return;
    try {
      const j = await App.api(`/quality/${r.id}`, { method: 'DELETE' });
      App.toast(j.msg);
      onSaved();
    } catch (e) { App.toast(e.msg, false); }
  },

  /* ---------------- 子页2：判定规则台 ---------------- */
  async tabRules(el) {
    let methods, zones;
    try {
      [methods, zones] = await Promise.all([
        App.api('/quality/methods').then(j => j.data), this.zoneList()]);
    } catch (e) { App.toast(e.msg, false); return; }

    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;height:100%;min-height:0">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;flex:none">
          ${methods.map(m => `
            <div class="panel" style="margin:0;border-top:4px solid ${this.MC[m.key]}">
              <div class="panel-body" style="padding:12px 14px;overflow:visible">
                <b style="font-size:14.5px">${m.name}</b>
                <span class="badge" style="background:${this.MC[m.key]}18;color:${this.MC[m.key]};margin-left:6px">${m.unit}</span>
                <div style="font-size:11.5px;color:var(--ink-soft);margin-top:6px;line-height:1.7">${m.desc}</div>
                <div style="margin-top:8px;font-size:12px">判定线：<b style="color:${this.MC[m.key]}">
                  ${m.key === 'particle' ? '随区域 ISO 限值' : '≤ ' + this.DEFAULT_STD[m.key] + ' ' + m.unit}</b></div>
              </div>
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:14px;flex:1;min-height:0">
          <div class="panel" style="width:340px;flex:none">
            <div class="panel-head"><b>区域粒子限值</b><span class="tag">ISO 14644-1</span></div>
            <div class="panel-body" style="display:flex;flex-direction:column;gap:8px">
              ${zones.map(z => `
                <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;
                     background:linear-gradient(90deg,${App.ISO_COLOR[z.iso_class]}14,transparent);
                     border:1px solid ${App.ISO_COLOR[z.iso_class]}44">
                  <span class="badge" style="background:${App.ISO_COLOR[z.iso_class]};color:#fff">ISO ${z.iso_class}</span>
                  <b style="font-size:13px">${App.esc(z.zone_name)}</b>
                  <div style="flex:1"></div>
                  <span style="font-size:12.5px">≤ <b style="color:${App.ISO_COLOR[z.iso_class]};font-size:15px">${z.limit}</b> 个/m³</span>
                </div>`).join('')}
              <div style="font-size:11px;color:var(--ink-soft);line-height:1.7;margin-top:4px">
                等级数字越小洁净度越高。ISO5 为核心灌装区，限值最严。
              </div>
            </div>
          </div>
          <div class="panel dark" style="flex:1;min-width:0">
            <div class="panel-head"><b>判定试算器</b><span class="tag">不动数据库，现场演规则</span></div>
            <div class="panel-body" style="display:flex;gap:16px;align-items:center;overflow:visible">
              <div style="display:flex;flex-direction:column;gap:12px;width:280px;flex:none">
                <label style="font-size:12px">验收方法
                  <select class="ipt" id="m08r-method">${methods.map(m => `<option value="${m.key}">${m.name}</option>`).join('')}</select></label>
                <label style="font-size:12px">洁净区域（粒子法生效）
                  <select class="ipt" id="m08r-zone">${zones.map(z => `<option value="${z.zone_id}">${App.esc(z.zone_name)} ISO${z.iso_class}</option>`).join('')}</select></label>
                <label style="font-size:12px">模拟实测值
                  <input class="ipt" id="m08r-val" type="number" step="0.01" value="0"></label>
                <button class="btn rose lg btn-block" id="m08r-run">⚖️ 执行判定</button>
              </div>
              <div style="flex:1;display:grid;place-items:center">
                <div id="m08r-out" style="text-align:center;color:#9dc9c2">
                  <div style="font-size:54px;opacity:.4">⚖️</div>
                  <div style="font-size:13px;margin-top:6px">选好方法与实测值，点「执行判定」看结论与余量分析</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    const self = this;
    el.querySelector('#m08r-run').onclick = () => {
      const m = el.querySelector('#m08r-method').value;
      const zid = +el.querySelector('#m08r-zone').value;
      const z = zones.find(x => x.zone_id === zid);
      const std = m === 'particle' ? z.limit : self.DEFAULT_STD[m];
      const v = +el.querySelector('#m08r-val').value;
      const pass = v <= std;   // 与后端 judge_inspection 同一句话
      const diff = +(std - v).toFixed(2);
      const unit = { particle: '个/m³', atp: 'RLU', settle_plate: 'CFU/皿', surface: 'μg/cm²' }[m];
      el.querySelector('#m08r-out').innerHTML = `
        <div class="grade-stamp" style="position:static;transform:rotate(-8deg);font-size:44px;padding:8px 26px;margin:0 auto 14px;
             border-color:${pass ? '#34d399' : '#fb7185'};color:${pass ? '#34d399' : '#fb7185'}">${pass ? 'PASS' : 'FAIL'}</div>
        <div style="font-size:15px;font-weight:700;color:${pass ? '#a7f3d0' : '#fecdd3'}">
          实测 ${v} ${unit} ${pass ? '≤' : '>'} 标准 ${std} ${unit}，判定${pass ? '合格' : '不合格'}</div>
        <div style="font-size:12px;color:#9dc9c2;margin-top:8px">
          ${pass ? `距限值还有 ${diff} ${unit} 余量（${(diff / std * 100).toFixed(1)}%）`
                 : `超出限值 ${-diff} ${unit}（${(-diff / std * 100).toFixed(1)}%），需安排返工复洁`}</div>`;
    };
  },

  /* ---------------- 子页3：合格率透视 ---------------- */
  async tabStats(el) {
    el.innerHTML = `
      <div style="display:flex;gap:14px;height:100%;min-height:0">
        <div class="panel" style="width:300px;flex:none;display:flex;flex-direction:column">
          <div class="panel-head"><b>总体合格率</b><span class="tag">已出结论单</span>
            <div class="spacer"></div><button class="btn sm btn-line" id="m08s-reload">↻</button></div>
          <div class="panel-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
            <div id="m08s-ring" style="width:170px;height:170px;border-radius:50%;display:grid;place-items:center;position:relative">
              <div style="width:126px;height:126px;border-radius:50%;background:var(--panel);display:grid;place-items:center;box-shadow:inset 0 2px 8px rgba(14,52,66,.12)">
                <div style="text-align:center"><b id="m08s-rate" style="font-size:34px">—</b>
                <div style="font-size:11px;color:var(--ink-soft)">一次验收合格率</div></div>
              </div>
            </div>
            <div id="m08s-total" style="font-size:12.5px;color:var(--ink-soft)"></div>
          </div>
        </div>
        <div class="panel" style="flex:1;min-width:0">
          <div class="panel-head"><b>分方法合格率</b></div>
          <div class="panel-body" id="m08s-methods" style="display:flex;flex-direction:column;gap:14px;justify-content:center"></div>
        </div>
        <div class="panel" style="width:330px;flex:none">
          <div class="panel-head"><b>近期不合格单</b><span class="tag">返工追溯</span></div>
          <div class="panel-body"><div class="timeline" id="m08s-fails"></div></div>
        </div>
      </div>`;

    const self = this;
    async function reload() {
      let d;
      try { d = (await App.api('/quality/stats')).data; } catch (e) { App.toast(e.msg, false); return; }
      // 合格率圆环：conic-gradient 直接画，不引图表库
      const rate = d.pass_rate;
      const ring = el.querySelector('#m08s-ring');
      ring.style.background = `conic-gradient(${rate >= 90 ? '#059669' : rate >= 75 ? '#d97706' : '#e11d48'} ${rate * 3.6}deg, #e2e8f0 0deg)`;
      const rateEl = el.querySelector('#m08s-rate');
      rateEl.textContent = rate + '%';
      rateEl.classList.remove('flash-num'); void rateEl.offsetWidth; rateEl.classList.add('flash-num');
      const totSent = Object.values(d.by_method).reduce((a, b) => a + b['送检数'], 0);
      const totPass = Object.values(d.by_method).reduce((a, b) => a + b['合格数'], 0);
      el.querySelector('#m08s-total').innerHTML = `已判定 <b>${totSent}</b> 单 · 合格 <b style="color:var(--ok)">${totPass}</b> 单 · 不合格 <b style="color:var(--bad)">${totSent - totPass}</b> 单`;

      const mbox = el.querySelector('#m08s-methods');
      mbox.innerHTML = '';
      Object.entries(d.by_method).forEach(([k, v]) => {
        const name = { particle: '粒子计数', atp: 'ATP荧光', settle_plate: '沉降菌', surface: '表面残留' }[k] || k;
        const rate2 = v['送检数'] ? Math.round(v['合格数'] / v['送检数'] * 100) : 0;
        mbox.appendChild(App.el(`
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">
              <b>${name}</b>
              <span style="color:var(--ink-soft)">${v['合格数']}/${v['送检数']} 合格 · <b style="color:${self.MC[k]}">${rate2}%</b></span>
            </div>
            <div style="height:13px;border-radius:7px;background:#e2e8f0;overflow:hidden">
              <div style="height:100%;width:${rate2}%;border-radius:7px;transition:width .8s;
                   background:linear-gradient(90deg,${self.MC[k]}88,${self.MC[k]})"></div>
            </div>
          </div>`));
      });

      const fb = el.querySelector('#m08s-fails');
      fb.innerHTML = '';
      if (!d.recent_fail.length) {
        fb.appendChild(App.el(`<div style="color:var(--ink-soft);font-size:12.5px;padding:20px 0">🎉 暂无不合格记录</div>`));
      }
      d.recent_fail.forEach(f => {
        fb.appendChild(App.el(`<div class="tl-item">
          <b>${App.esc(f.code)} <span class="badge red">不合格</span></b>
          <i>${App.esc(f.zone_name)} · ${{ particle: '粒子计数', atp: 'ATP荧光', settle_plate: '沉降菌', surface: '表面残留' }[f.method] || f.method}
             实测 ${f.result_value}（超 ${(f.result_value - f.standard).toFixed(2)}）<br>${App.fmtT(f.created_at)}</i>
        </div>`));
      });
    }
    el.querySelector('#m08s-reload').onclick = reload;
    reload();
  },
});
