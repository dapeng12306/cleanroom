/* ==========================================================================
   m03 保洁任务中心 —— 看板拖拽流转 / 智能派发调度台 / 任务轨迹
   状态机是全系统的骨干，这页把它做成"看得见摸得着"的拖拽看板。
   ========================================================================== */
App.register('m03', {
  title: '保洁任务中心', icon: '🧹', color: '#d97706',
  bg: 'linear-gradient(135deg,#d97706,#b45309)',
  bgImg: '/web/assets/img/cleanroom_corridor.jpg',
  desc: '看板拖拽流转 · 人机智能派单 · 全生命周期轨迹追溯',
  subs: ['任务看板', '派发调度台', '任务轨迹'],

  render(host) {
    host.appendChild(App.el(`
      <div class="page-head">
        <div class="ph-icon" style="background:linear-gradient(135deg,#f59e0b,#d97706)">🧹</div>
        <div><h2>保洁任务中心</h2><div class="ph-sub">状态机驱动：创建→派发→作业→验收→归档</div></div>
        <div class="spacer"></div>
        <button class="btn btn-line" id="m03-back">⌂ 返回菜单中枢</button>
      </div>`));
    host.querySelector('#m03-back').onclick = () => App.goHub();
    const body = App.el(`<div class="page-body"></div>`);
    host.appendChild(body);
    App.tabs(body, [
      { label: '任务看板', icon: '📋', render: el => this.tabBoard(el) },
      { label: '派发调度台', icon: '🎯', render: el => this.tabDispatch(el) },
      { label: '任务轨迹', icon: '🛤', render: el => this.tabTrace(el) },
    ], { style: 'seg', color: '#d97706' });
  },

  /* 看板列定义：passed/failed 合并展示 */
  COLS: [
    { key: 'created', label: '已创建', color: '#64748b' },
    { key: 'assigned', label: '已派发', color: '#2563eb' },
    { key: 'in_progress', label: '作业中', color: '#06b6d4' },
    { key: 'awaiting_inspection', label: '待验收', color: '#8b5cf6' },
    { key: 'done', label: '验收归档', color: '#059669', match: ['passed', 'failed'] },
  ],

  /* ---------------- 子页1：任务看板（拖拽流转） ---------------- */
  async tabBoard(el) {
    el.innerHTML = `<div class="kanban" style="grid-template-columns:repeat(5,1fr)" id="m03-kb"></div>`;
    const kb = el.querySelector('#m03-kb');
    let tasks;
    try { tasks = (await App.api('/tasks/list')).data; } catch (e) { App.toast(e.msg, false); return; }

    this.COLS.forEach(col => {
      const list = tasks.filter(t => col.match ? col.match.includes(t.status) : t.status === col.key);
      const c = App.el(`<div class="kanban-col" data-col="${col.key}">
        <div class="kc-head"><span class="dot" style="background:${col.color}"></span><b>${col.label}</b>
          <span class="cnt">${list.length}</span></div>
        <div class="kc-body"></div></div>`);
      const bodyBox = c.querySelector('.kc-body');
      list.forEach(t => bodyBox.appendChild(this.taskCard(t)));
      // 拖放目标列
      c.addEventListener('dragover', e => { e.preventDefault(); c.classList.add('dragover'); });
      c.addEventListener('dragleave', () => c.classList.remove('dragover'));
      c.addEventListener('drop', async e => {
        e.preventDefault(); c.classList.remove('dragover');
        const tid = +e.dataTransfer.getData('text/plain');
        const task = tasks.find(x => x.id === tid);
        const target = col.key === 'done' ? 'awaiting_inspection' : col.key;  // 归档列只接受"待验收"交活
        if (col.key === 'done') {
          App.toast('验收结论只能由质检员在验收页下达，看板不能直接拖入归档', false);
          return;
        }
        try {
          const j = await App.api(`/tasks/${tid}/transit`, { method: 'POST', body: { to: target, note: '看板拖拽流转', version: task.version } });
          App.toast(j.msg || `已流转到「${App.stText(target)}」`);
          App.go('m03');   // 刷新整页，卡片搬家
        } catch (err) { App.toast(err.msg, false); }
      });
      kb.appendChild(c);
    });
  },

  taskCard(t) {
    const pri = { 1: ['P1', '#e11d48'], 2: ['P2', '#ea580c'], 3: ['P3', '#0891b2'], 4: ['P4', '#64748b'] }[t.priority];
    const typeText = { routine: '例行', deep: '深度', emergency: '紧急', disinfection: '消杀' }[t.task_type];
    const card = App.el(`<div class="task-card" draggable="true" style="border-left-color:${pri[1]}">
      <div style="display:flex;align-items:center;gap:6px">
        <span class="badge" style="background:${pri[1]}18;color:${pri[1]}">${pri[0]}</span>
        <span class="badge violet">${typeText}</span>
        <span style="flex:1"></span><span style="font-size:11px;color:var(--ink-soft)">${t.code}</span></div>
      <b style="margin-top:5px">${App.esc(t.title)}</b>
      <div class="tc-meta"><span>📍 ${t.zone_name || ''}</span>
        ${t.assignee_name ? `<span>👷 ${t.assignee_name}</span>` : '<span style="color:var(--warn)">未派单</span>'}
        ${t.robot_name ? `<span>🤖 ${t.robot_name}</span>` : ''}</div>
    </div>`);
    card.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', t.id));
    card.onclick = () => this.taskDetail(t);
    return card;
  },

  /* 任务详情弹窗：状态机合法去向按钮组 */
  taskDetail(t) {
    const NEXT = {
      created: [['assigned', '派单开工', 'blue']],
      assigned: [['in_progress', '开始作业', 'cyan'], ['cancelled', '取消任务', 'rose']],
      in_progress: [['awaiting_inspection', '作业完成·提交验收', 'violet'], ['cancelled', '取消任务', 'rose']],
      awaiting_inspection: [],
      failed: [['assigned', '重新派单返工', 'amber'], ['cancelled', '取消任务', 'rose']],
      passed: [], cancelled: [],
    };
    const btns = (NEXT[t.status] || []).map(([to, label, c]) =>
      `<button class="btn sm ${c}" data-to="${to}">${label}</button>`).join('');
    App.modal({
      title: `${t.code} · 任务详情`, width: 500, hideFoot: true,
      body: `<div style="line-height:2;font-size:13.5px">
        <div><b style="font-size:15px">${App.esc(t.title)}</b>　${App.badge(t.status)}</div>
        <div>区域：${t.zone_name}　类型：${{ routine: '例行', deep: '深度', emergency: '紧急', disinfection: '消杀' }[t.task_type]}</div>
        <div>执行：${t.assignee_name || '未定'} ${t.robot_name ? '＋ ' + t.robot_name : ''}</div>
        <div>计划：${App.fmtT(t.planned_start)} ~ ${App.fmtT(t.planned_end)}</div>
        ${t.clean_score != null ? `<div>验收评分：<b style="color:${t.clean_score >= 60 ? 'var(--ok)' : 'var(--bad)'}">${t.clean_score}</b></div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">
          ${btns}
          ${['created', 'assigned'].includes(t.status) ? '<button class="btn sm amber" id="td-auto">🎯 智能派单</button>' : ''}
          ${['created', 'cancelled'].includes(t.status) ? '<button class="btn sm rose" id="td-del">删除任务</button>' : ''}
          <button class="btn sm btn-line" id="td-log">查看轨迹</button>
        </div></div>`,
    });
    document.querySelectorAll('[data-to]').forEach(b => b.onclick = async () => {
      try {
        const j = await App.api(`/tasks/${t.id}/transit`, { method: 'POST', body: { to: b.dataset.to, note: '详情弹窗操作', version: t.version } });
        App.toast(j.msg || '流转成功');
        document.querySelector('.modal-scrim')?.remove(); App.go('m03');
      } catch (e) { App.toast(e.msg, false); }
    });
    const auto = document.getElementById('td-auto');
    if (auto) auto.onclick = () => this.autoDispatch(t.id);
    const del = document.getElementById('td-del');
    if (del) del.onclick = async () => {
      if (!await App.confirm(`确定删除任务 ${t.code}？`)) return;
      try { const j = await App.api(`/tasks/${t.id}`, { method: 'DELETE' }); App.toast(j.msg);
        document.querySelector('.modal-scrim')?.remove(); App.go('m03'); }
      catch (e) { App.toast(e.msg, false); }
    };
    document.getElementById('td-log').onclick = () => { document.querySelector('.modal-scrim')?.remove(); App.go('m03'); };
  },

  /* 智能派单结果展示：算法得分透明公开 */
  async autoDispatch(tid) {
    try {
      const j = await App.api(`/tasks/${tid}/auto-dispatch`, { method: 'POST', body: {} });
      const d = j.data;
      App.modal({
        title: '智能派单完成', width: 440, hideFoot: true,
        body: `<div style="text-align:center;padding:8px 0 14px">
          <div style="font-size:44px">🤝</div>
          <div style="font-size:16px;font-weight:700;color:var(--ok)">人机组合匹配成功</div></div>
          <div style="background:rgba(5,150,105,.07);border-radius:12px;padding:14px 18px;line-height:2.2;font-size:14px">
            <div>👷 保洁员：<b>${d.staff.name}</b><span style="float:right">适配分 <b style="color:var(--c-teal)">${d.staff.score}</b></span></div>
            <div>🤖 机器人：<b>${d.robot.name}</b><span style="float:right">适配分 <b style="color:var(--c-violet)">${d.robot.score}</b></span></div>
            <div style="border-top:1px dashed var(--line);padding-top:6px">综合调度得分：<b style="font-size:20px;color:var(--c-amber)">${d.total}</b>
              <span style="font-size:11px;color:var(--ink-soft)">（技能×负荷×认证×距离 四维加权）</span></div>
          </div>`,
      });
      App.toast(j.msg || '派单成功');
      setTimeout(() => { document.querySelector('.modal-scrim')?.remove(); App.go('m03'); }, 3000);
    } catch (e) { App.toast(e.msg, false); }
  },

  /* ---------------- 子页2：派发调度台 ---------------- */
  async tabDispatch(el) {
    el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1.3fr;gap:12px;height:100%">
      <div class="panel"><div class="panel-head"><b>待派任务池</b><span class="tag">created / failed</span>
        <div class="spacer"></div><button class="btn sm amber" id="m03-new">＋ 新建任务</button></div>
        <div class="panel-body" id="m03-pool"></div></div>
      <div class="panel alt"><div class="panel-head"><b>调度详情</b><span class="tag">人机协同匹配</span></div>
        <div class="panel-body" id="m03-detail"><div class="empty-tip">← 从左侧选择一单待派任务</div></div></div>
    </div>`;
    let tasks, zones;
    try {
      [tasks, zones] = await Promise.all([
        App.api('/tasks/list'), App.api('/dashboard/scene')]);
    } catch (e) { App.toast(e.msg, false); return; }
    const pool = el.querySelector('#m03-pool');
    const waiting = tasks.data.filter(t => ['created', 'failed'].includes(t.status));
    if (!waiting.length) pool.innerHTML = `<div class="empty-tip">🎉 任务池已清空<br>所有任务均已派发</div>`;
    waiting.forEach(t => {
      const item = App.el(`<div style="padding:10px 12px;border-radius:10px;background:#fff8;border:1.5px solid var(--line);margin-bottom:8px;cursor:pointer;transition:all .15s">
        <b style="font-size:13.5px">${App.esc(t.title)}</b> ${App.badge(t.status)}
        <div style="font-size:11.5px;color:var(--ink-soft);margin-top:4px">${t.code} · ${t.zone_name} · P${t.priority}</div></div>`);
      item.onmouseenter = () => item.style.borderColor = '#f59e0b';
      item.onmouseleave = () => item.style.borderColor = 'var(--line)';
      item.onclick = () => {
        pool.querySelectorAll('div[style]').forEach(x => x.style.background = '#fff8');
        item.style.background = 'rgba(245,158,11,.14)';
        this.showDispatchDetail(el, t, zones.data.zones);
      };
      pool.appendChild(item);
    });
    el.querySelector('#m03-new').onclick = () => this.createTask(zones.data.zones);
  },

  showDispatchDetail(el, t, zones) {
    const z = zones.find(z => z.id === t.zone_id) || {};
    const box = el.querySelector('#m03-detail');
    box.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;height:100%">
      <div style="background:#fff;border-radius:12px;padding:14px 16px;box-shadow:var(--shadow)">
        <b style="font-size:16px">${App.esc(t.title)}</b> ${App.badge(t.status)}
        <div style="font-size:12.5px;color:var(--ink-soft);margin-top:6px;line-height:1.9">
          ${t.code} · ${t.zone_name}（ISO${z.iso_class || '?'}）· 优先级 P${t.priority}<br>
          计划窗口：${App.fmtT(t.planned_start)} ~ ${App.fmtT(t.planned_end)}</div></div>
      <div style="background:linear-gradient(135deg,#fff7ed,#fef3c7);border-radius:12px;padding:14px 16px;border:1px solid #fcd34d">
        <b style="font-size:13.5px">🧠 调度算法说明</b>
        <div style="font-size:12px;color:#92400e;margin-top:5px;line-height:1.8">
          技能匹配 35% + 空闲负荷 25% + 认证匹配 20% + 距离成本 20%<br>
          ISO${z.iso_class || '?'} 区域${z.iso_class <= 6 ? '仅派 A 级认证人员，' : ''}机器人需空闲且电量＞30%</div></div>
      <button class="btn lg amber" id="m03-do-dispatch" style="margin-top:auto">🎯 执行智能派单（人机协同）</button>
    </div>`;
    box.querySelector('#m03-do-dispatch').onclick = () => this.autoDispatch(t.id);
  },

  createTask(zones) {
    App.modal({
      title: '新建保洁任务', width: 500, okText: '创建',
      body: `<div class="form-grid">
        <div class="field full"><label>任务标题</label><input id="nt-title" placeholder="如：A1 区回风口深度保洁"></div>
        <div class="field"><label>类型</label><select id="nt-type">
          <option value="routine">例行保洁</option><option value="deep">深度保洁</option>
          <option value="emergency">紧急处置</option><option value="disinfection">消杀作业</option></select></div>
        <div class="field"><label>区域</label><select id="nt-zone">
          ${zones.map(z => `<option value="${z.id}">${z.name}（ISO${z.iso_class}）</option>`).join('')}</select></div>
        <div class="field"><label>优先级</label><select id="nt-pri">
          <option value="1">P1 最高</option><option value="2" selected>P2 高</option>
          <option value="3">P3 常规</option><option value="4">P4 低</option></select></div>
        <div class="field"><label>&nbsp;</label><div style="font-size:11px;color:var(--ink-soft);padding-top:8px">创建后进入「已创建」待派单</div></div>
        <div class="field"><label>计划开始</label><input id="nt-s" type="datetime-local"></div>
        <div class="field"><label>计划结束</label><input id="nt-e" type="datetime-local"></div>
      </div>`,
      async onOk(box) {
        const title = box.querySelector('#nt-title').value.trim();
        if (!title) { App.toast('任务标题不能为空', false); return false; }
        const f = v => v ? v.replace('T', ' ') + ':00' : null;
        const j = await App.api('/tasks/create', { method: 'POST', body: {
          title, task_type: box.querySelector('#nt-type').value,
          zone_id: +box.querySelector('#nt-zone').value, priority: +box.querySelector('#nt-pri').value,
          planned_start: f(box.querySelector('#nt-s').value), planned_end: f(box.querySelector('#nt-e').value),
        }});
        App.toast(j.msg || '任务创建成功'); App.go('m03');
      },
    });
  },

  /* ---------------- 子页3：任务轨迹 ---------------- */
  async tabTrace(el) {
    el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1.5fr;gap:12px;height:100%">
      <div class="panel"><div class="panel-head"><b>任务清单</b>
        <div class="spacer"></div><input id="m03-q" placeholder="🔍 搜索标题/编号" style="padding:6px 12px;border-radius:9px;border:1.5px solid var(--line);font-size:12.5px"></div>
        <div class="panel-body" id="m03-list"></div></div>
      <div class="panel alt"><div class="panel-head"><b>全生命周期轨迹</b><span class="tag">状态机流水</span></div>
        <div class="panel-body" id="m03-flow"><div class="empty-tip">← 选择一条任务查看轨迹</div></div></div>
    </div>`;
    let tasks;
    try { tasks = (await App.api('/tasks/list')).data; } catch (e) { App.toast(e.msg, false); return; }
    const listBox = el.querySelector('#m03-list');
    const renderList = kw => {
      listBox.innerHTML = '';
      tasks.filter(t => !kw || t.title.includes(kw) || t.code.includes(kw)).forEach(t => {
        const item = App.el(`<div style="padding:9px 12px;border-radius:10px;background:#fff8;margin-bottom:7px;cursor:pointer;border-left:4px solid var(--c-violet)">
          <b style="font-size:13px">${App.esc(t.title)}</b> ${App.badge(t.status)}
          <div style="font-size:11px;color:var(--ink-soft);margin-top:3px">${t.code} · ${t.zone_name}</div></div>`);
        item.onclick = () => this.showFlow(el, t);
        listBox.appendChild(item);
      });
    };
    renderList('');
    el.querySelector('#m03-q').oninput = e => renderList(e.target.value.trim());
  },

  async showFlow(el, t) {
    const box = el.querySelector('#m03-flow');
    box.innerHTML = '<div class="empty-tip">轨迹加载中…</div>';
    let logs;
    try { logs = (await App.api(`/tasks/${t.id}/logs`)).data; }
    catch (e) { box.innerHTML = `<div class="empty-tip">${App.esc(e.msg)}</div>`; return; }
    // 状态进度条：5 节点，当前高亮
    const steps = ['created', 'assigned', 'in_progress', 'awaiting_inspection', 'passed'];
    const curIdx = t.status === 'failed' ? 3 : steps.indexOf(t.status);
    box.innerHTML = `
      <div style="display:flex;align-items:center;margin-bottom:18px;padding:0 6px">
        ${steps.map((s, i) => `
          <div style="display:flex;align-items:center;flex:1">
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
              <div style="width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;
                background:${i <= curIdx ? (t.status === 'failed' && i === curIdx ? '#e11d48' : '#8b5cf6') : '#d7e3e2'};
                color:${i <= curIdx ? '#fff' : '#8aa'};${i === curIdx ? 'transform:scale(1.3);box-shadow:0 0 10px rgba(139,92,246,.5)' : ''}">${i + 1}</div>
              <span style="font-size:10.5px;color:var(--ink-soft)">${App.stText(s)}</span>
            </div>
            ${i < steps.length - 1 ? `<div style="flex:1;height:3px;border-radius:2px;background:${i < curIdx ? '#8b5cf6' : '#d7e3e2'};margin:0 4px 16px"></div>` : ''}
          </div>`).join('')}
      </div>
      <div style="font-size:13px;margin-bottom:10px"><b>${App.esc(t.title)}</b>　${App.badge(t.status)}
        ${t.status === 'failed' ? '<span class="badge red" style="margin-left:6px">验收不合格·待返工</span>' : ''}</div>
      <div class="timeline" id="m03-tl"></div>`;
    const tl = box.querySelector('#m03-tl');
    if (!logs.length) tl.innerHTML = '<div class="empty-tip">暂无流水</div>';
    logs.forEach((l, i) => {
      tl.appendChild(App.el(`<div class="tl-item" style="animation-delay:${i * 50}ms">
        <b>${l.action}${l.to_status ? ' → ' + App.stText(l.to_status) : ''}</b>
        <i>${App.fmtT(l.created_at)} · ${l.operator_name || '系统'}${l.note ? ' · ' + App.esc(l.note) : ''}</i>
      </div>`));
    });
  },
});
