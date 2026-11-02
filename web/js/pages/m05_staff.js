/* ==========================================================================
   m05 人员与排班 —— 技能矩阵 / 排班日历 / 人员档案
   布局走"矩阵+日历+卡片"三条路，跟看板页、3D 页彻底拉开差异。
   ========================================================================== */
App.register('m05', {
  title: '人员与排班', icon: '👷', color: '#2563eb',
  bg: 'linear-gradient(135deg,#2563eb,#1d4ed8)',
  bgImg: '/web/assets/img/worker_suit.jpg',
  desc: '技能矩阵透视 · 三班排班日历 · 人员洁净准入档案',
  subs: ['技能矩阵', '排班日历', '人员档案'],

  render(host) {
    host.appendChild(App.el(`
      <div class="page-head">
        <div class="ph-icon" style="background:linear-gradient(135deg,#3b82f6,#2563eb)">👷</div>
        <div><h2>人员与排班</h2><div class="ph-sub">技能等级 × 洁净准入认证 × 负荷 三维人员画像</div></div>
        <div class="spacer"></div>
        <button class="btn btn-line" id="m05-back">⌂ 返回菜单中枢</button>
      </div>`));
    host.querySelector('#m05-back').onclick = () => App.goHub();
    const body = App.el(`<div class="page-body"></div>`);
    host.appendChild(body);
    App.tabs(body, [
      { label: '技能矩阵', icon: '🧬', render: el => this.tabMatrix(el) },
      { label: '排班日历', icon: '📅', render: el => this.tabCalendar(el) },
      { label: '人员档案', icon: '🪪', render: el => this.tabCards(el) },
    ], { style: 'dot', color: '#2563eb' });
  },

  ROLE_COLOR: { cleaner: '#0d9488', leader: '#d97706', inspector: '#8b5cf6', dispatcher: '#06b6d4' },
  CERT_STYLE: { A: ['#b45309', 'linear-gradient(135deg,#fcd34d,#f59e0b)'], B: ['#475569', 'linear-gradient(135deg,#e2e8f0,#94a3b8)'], C: ['#7c2d12', 'linear-gradient(135deg,#fdba74,#ea580c)'] },

  /* ---------------- 子页1：技能矩阵 ---------------- */
  async tabMatrix(el) {
    el.innerHTML = `<div class="panel" style="height:100%"><div class="panel-head">
      <b>全员技能矩阵</b><span class="tag">调度算法取数依据</span>
      <div class="spacer"></div><button class="btn sm blue" id="m05-add">＋ 新增人员</button></div>
      <div class="panel-body"><div id="m05-mx"></div>
      <div style="display:flex;gap:18px;margin-top:12px;font-size:11.5px;color:var(--ink-soft)">
        <span>认证徽章：<span class="badge" style="background:linear-gradient(135deg,#fcd34d,#f59e0b);color:#7c2d12">A 级·可入 ISO5</span>
        <span class="badge" style="background:linear-gradient(135deg,#e2e8f0,#94a3b8);color:#334155">B 级·ISO7/8</span>
        <span class="badge" style="background:linear-gradient(135deg,#fdba74,#ea580c);color:#fff">C 级·外围</span></span>
        <span>负荷条越红越忙</span></div></div></div>`;
    let rows;
    try { rows = (await App.api('/staff/matrix')).data; } catch (e) { App.toast(e.msg, false); return; }
    const mx = el.querySelector('#m05-mx');
    mx.style.cssText = 'display:grid;grid-template-columns:130px 1fr 90px 1.2fr 80px 60px;gap:6px;align-items:center';
    // 表头行
    ['人员', '技能等级（1-5）', '准入认证', '当前负荷', '今日任务', ''].forEach(h =>
      mx.appendChild(App.el(`<div style="font-size:12px;font-weight:700;color:var(--ink-soft);padding:4px 6px">${h}</div>`)));
    rows.forEach((r, i) => {
      const rc = this.ROLE_COLOR[r.role] || '#0d9488';
      mx.appendChild(App.el(`<div style="font-size:13px;padding:4px 6px"><b>${r.name}</b>
        <span class="badge" style="background:${rc}18;color:${rc};margin-left:4px">${App.ROLE_TEXT[r.role]}</span></div>`));
      // 技能 5 段色块
      const seg = App.el(`<div style="display:flex;gap:4px;padding:4px 6px"></div>`);
      for (let k = 1; k <= 5; k++)
        seg.appendChild(App.el(`<div class="matrix-cell" style="flex:1;background:${k <= r.skill_level ? 'linear-gradient(135deg,#3b82f6,#06b6d4)' : '#e2e8f0'};color:#fff">${k <= r.skill_level ? '◆' : ''}</div>`));
      mx.appendChild(seg);
      const cs = this.CERT_STYLE[r.cert_level] || this.CERT_STYLE.C;
      mx.appendChild(App.el(`<div style="text-align:center"><span class="badge" style="background:${cs[1]};color:${cs[0]};font-size:13px;padding:4px 14px">${r.cert_level} 级</span></div>`));
      const wl = Math.round((r.workload || 0) * 100);
      mx.appendChild(App.el(`<div style="padding:4px 6px"><div style="height:10px;border-radius:6px;background:#e2e8f0;overflow:hidden">
        <div style="height:100%;width:${wl}%;background:linear-gradient(90deg,#34d399,#f59e0b,#e11d48);background-size:200px 100%;transition:width .6s"></div></div>
        <div style="font-size:10.5px;color:var(--ink-soft);margin-top:2px">${wl}%</div></div>`));
      mx.appendChild(App.el(`<div style="text-align:center"><span style="display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;
        background:${r.today_tasks > 0 ? '#2563eb' : '#cbd5e1'};color:#fff;font-weight:700;font-size:13px">${r.today_tasks ?? 0}</span></div>`));
      const op = App.el(`<div style="text-align:center"><button class="btn sm btn-line">档案</button></div>`);
      op.querySelector('button').onclick = () => this.profileModal(r);
      mx.appendChild(op);
    });
    el.querySelector('#m05-add').onclick = () => this.createStaff();
  },

  profileModal(r) {
    App.modal({
      title: `${r.name} · 人员档案`, width: 460, okText: '保存修改',
      body: `<div class="form-grid">
        <div class="field"><label>姓名</label><input id="pf-name" value="${App.esc(r.name)}"></div>
        <div class="field"><label>技能等级</label><select id="pf-skill">
          ${[1, 2, 3, 4, 5].map(k => `<option value="${k}" ${r.skill_level === k ? 'selected' : ''}>${k} 级</option>`).join('')}</select></div>
        <div class="field"><label>准入认证</label><select id="pf-cert">
          ${['A', 'B', 'C'].map(c => `<option ${r.cert_level === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label>班次</label><select id="pf-shift">
          <option value="1" ${r.shift_id === 1 ? 'selected' : ''}>早班</option>
          <option value="2" ${r.shift_id === 2 ? 'selected' : ''}>中班</option>
          <option value="3" ${r.shift_id === 3 ? 'selected' : ''}>晚班</option></select></div>
        <div class="field full"><label>当前状态：${App.badge(r.status)}</label>
          <div style="font-size:11.5px;color:var(--ink-soft)">A 级认证人员方可进入 ISO5/6 核心区，调度算法硬性拦截</div></div>
      </div>`,
      async onOk(box) {
        const j = await App.api(`/staff/${r.id}`, { method: 'PUT', body: {
          skill_level: +box.querySelector('#pf-skill').value,
          cert_level: box.querySelector('#pf-cert').value,
          shift_id: +box.querySelector('#pf-shift').value } });
        App.toast(j.msg || '档案已更新'); App.go('m05');
      },
    });
  },

  async createStaff() {
    App.modal({
      title: '新增人员档案', width: 460, okText: '建档',
      body: `<div class="form-grid">
        <div class="field"><label>姓名</label><input id="nc-name" placeholder="姓名"></div>
        <div class="field"><label>角色</label><select id="nc-role">
          <option value="cleaner">保洁员</option><option value="leader">洁净班长</option>
          <option value="inspector">质检员</option><option value="dispatcher">调度工程师</option></select></div>
        <div class="field"><label>技能等级</label><select id="nc-skill">${[1, 2, 3, 4, 5].map(k => `<option value="${k}">${k} 级</option>`).join('')}</select></div>
        <div class="field"><label>准入认证</label><select id="nc-cert"><option>A</option><option selected>B</option><option>C</option></select></div>
        <div class="field"><label>班次</label><select id="nc-shift"><option value="1">早班</option><option value="2">中班</option><option value="3">晚班</option></select></div>
      </div>`,
      async onOk(box) {
        const name = box.querySelector('#nc-name').value.trim();
        if (!name) { App.toast('姓名不能为空', false); return false; }
        const j = await App.api('/staff/create', { method: 'POST', body: {
          name, role: box.querySelector('#nc-role').value,
          skill_level: +box.querySelector('#nc-skill').value,
          cert_level: box.querySelector('#nc-cert').value,
          shift_id: +box.querySelector('#nc-shift').value } });
        App.toast(j.msg || '建档成功'); App.go('m05');
      },
    });
  },

  /* ---------------- 子页2：排班日历 ---------------- */
  async tabCalendar(el) {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;height:100%">
      <div class="panel" style="flex:none"><div style="display:flex;align-items:center;gap:12px">
        <b style="font-size:14px">排班日期：</b><input type="date" id="m05-date" style="padding:7px 12px;border-radius:9px;border:1.5px solid var(--line)">
        <button class="btn sm blue" id="m05-load">查询</button>
        <div class="spacer"></div>
        <button class="btn lg" id="m05-auto" style="background:linear-gradient(120deg,#2563eb,#06b6d4)">⚙ 执行自动排班</button>
      </div></div>
      <div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;min-height:0" id="m05-days"></div>
    </div>`;
    const dateInput = el.querySelector('#m05-date');
    dateInput.value = new Date().toISOString().slice(0, 10);

    const loadDay = async () => {
      const d = dateInput.value;
      const box = el.querySelector('#m05-days');
      box.innerHTML = '';
      let rows, shifts;
      try {
        [rows, shifts] = await Promise.all([
          App.api(`/staff/schedules?date=${d}`), App.api('/staff/shifts')]);
      } catch (e) { App.toast(e.msg, false); return; }
      shifts.data.forEach(sh => {
        const list = rows.data.filter(r => r.shift_id === sh.id);
        const col = App.el(`<div class="panel"><div class="panel-head">
          <span class="dot" style="background:${sh.color}"></span><b>${sh.name}</b>
          <span class="tag">${sh.start_time}-${sh.end_time}</span>
          <div class="spacer"></div><span class="badge blue">${list.length} 人</span></div>
          <div class="panel-body"></div></div>`);
        const bb = col.querySelector('.panel-body');
        if (!list.length) bb.innerHTML = '<div class="empty-tip">本班次暂无排班</div>';
        list.forEach(r => bb.appendChild(App.el(
          `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;background:#fff8;margin-bottom:7px;font-size:13px">
            <div style="width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:12px;font-weight:700;
              background:${this.ROLE_COLOR[r.role] || '#0d9488'}">${r.staff_name[0]}</div>
            <div><b>${r.staff_name}</b><div style="font-size:11px;color:var(--ink-soft)">${r.zone_name || '机动'}</div></div>
            <span style="flex:1"></span>${App.badge(r.status)}
          </div>`)));
        box.appendChild(col);
      });
    };
    el.querySelector('#m05-load').onclick = loadDay;
    el.querySelector('#m05-auto').onclick = async () => {
      if (!await App.confirm(`将对 ${dateInput.value} 执行自动排班（按技能×认证×任务密度匹配区域），已排记录会被覆盖，继续？`, false)) return;
      try {
        const j = await App.api('/staff/schedules/auto', { method: 'POST', body: { date: dateInput.value } });
        const list = (j.data || []).map(r => `${r.staff_name} → ${r.zone_name}（${r.shift_name}）`).join('<br>');
        App.modal({ title: '自动排班完成', width: 440, hideFoot: true,
          body: `<div style="font-size:13px;line-height:2;max-height:300px;overflow:auto">${list}</div>` });
        App.toast(j.msg);
        loadDay();
      } catch (e) { App.toast(e.msg, false); }
    };
    await loadDay();
  },

  /* ---------------- 子页3：人员档案卡片 ---------------- */
  async tabCards(el) {
    el.innerHTML = `<div class="panel" style="height:100%"><div class="panel-head">
      <b>人员档案库</b><span class="tag">洁净准入持证人员</span>
      <div class="spacer"></div><button class="btn sm blue" id="m05-add2">＋ 新增人员</button></div>
      <div class="panel-body"><div id="m05-cards" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px"></div></div></div>`;
    const box = el.querySelector('#m05-cards');
    const load = async () => {
      let rows;
      try { rows = (await App.api('/staff/list')).data; } catch (e) { App.toast(e.msg, false); return; }
      box.innerHTML = '';
      rows.forEach((r, i) => {
        const rc = this.ROLE_COLOR[r.role] || '#0d9488';
        const cs = this.CERT_STYLE[r.cert_level] || this.CERT_STYLE.C;
        const card = App.el(`<div style="border-radius:14px;background:#fff9;box-shadow:var(--shadow);overflow:hidden;animation:fadeUp .4s ${i * 40}ms both">
          <div style="height:64px;background:linear-gradient(120deg,${rc},${rc}88);position:relative">
            <div style="position:absolute;left:14px;bottom:-22px;width:48px;height:48px;border-radius:50%;background:#fff;
              display:grid;place-items:center;font-size:20px;font-weight:800;color:${rc};box-shadow:0 4px 10px rgba(0,0,0,.15)">${r.name[0]}</div>
            <span style="position:absolute;right:10px;top:10px">${App.badge(r.status)}</span></div>
          <div style="padding:28px 14px 12px">
            <b style="font-size:15px">${r.name}</b>
            <span class="badge" style="background:${rc}18;color:${rc};margin-left:6px">${App.ROLE_TEXT[r.role]}</span>
            <div style="font-size:11.5px;color:var(--ink-soft);margin:6px 0;line-height:1.9">
              工号 ${r.code} · ${r.shift_name || '未定'}班<br>技能 ${'◆'.repeat(r.skill_level)}${'◇'.repeat(5 - r.skill_level)}
              　<span class="badge" style="background:${cs[1]};color:${cs[0]}">${r.cert_level} 级准入</span></div>
            <div style="display:flex;gap:6px;margin-top:8px">
              <button class="btn sm btn-line act-pf">档案</button>
              <button class="btn sm ${r.status === 'leave' ? 'emerald' : 'amber'} act-lv">${r.status === 'leave' ? '销假' : '请假'}</button>
              <button class="btn sm rose act-del">删除</button>
            </div></div></div>`);
        card.querySelector('.act-pf').onclick = () => this.profileModal(r);
        card.querySelector('.act-lv').onclick = async () => {
          const to = r.status === 'leave' ? 'idle' : 'leave';
          try { const j = await App.api(`/staff/${r.id}`, { method: 'PUT', body: { status: to } });
            App.toast(j.msg || (to === 'leave' ? '已登记请假' : '已销假返岗')); load(); }
          catch (e) { App.toast(e.msg, false); }
        };
        card.querySelector('.act-del').onclick = async () => {
          if (!await App.confirm(`确定删除 ${r.name}（${r.code}）的档案？`)) return;
          try { const j = await App.api(`/staff/${r.id}`, { method: 'DELETE' }); App.toast(j.msg); load(); }
          catch (e) { App.toast(e.msg, false); }
        };
        box.appendChild(card);
      });
    };
    el.querySelector('#m05-add2').onclick = () => this.createStaff();
    await load();
  },
});
