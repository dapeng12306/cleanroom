/* ==========================================================================
   m07 物料耗材 —— 库存货架 / 领用审批 / 成本透视
   布局走"立体货架"路子：按库位分区摆槽位，低库存槽位亮红灯，
   点槽位弹窗操作。审批流单独一屏，角色不对批准按钮直接哑火。
   ========================================================================== */
App.register('m07', {
  title: '物料耗材', icon: '📦', color: '#d97706',
  bg: 'linear-gradient(135deg,#f59e0b,#b45309)',
  bgImg: '/web/assets/img/materials_shelf.jpg',
  desc: '立体货架库存 · 领用审批流 · 成本消耗透视',
  subs: ['库存货架', '领用审批', '成本透视'],

  CAT: { consumable: ['耗材', '#0891b2'], reagent: ['试剂', '#8b5cf6'], tool: ['工装', '#d97706'] },

  render(host) {
    host.appendChild(App.el(`
      <div class="page-head">
        <div class="ph-icon" style="background:linear-gradient(135deg,#fbbf24,#d97706)">📦</div>
        <div><h2>物料耗材</h2><div class="ph-sub">库存安全线预警 · 审批通过即事务扣库 · 跌破红线自动生成报警</div></div>
        <div class="spacer"></div>
        <button class="btn btn-line" id="m07-back">⌂ 返回菜单中枢</button>
      </div>`));
    host.querySelector('#m07-back').onclick = () => App.goHub();
    const body = App.el(`<div class="page-body"></div>`);
    host.appendChild(body);
    App.tabs(body, [
      { label: '库存货架', icon: '🏗', render: el => this.tabShelf(el) },
      { label: '领用审批', icon: '📋', render: el => this.tabApprove(el) },
      { label: '成本透视', icon: '💰', render: el => this.tabCost(el) },
    ], { style: 'bar', color: '#d97706' });
  },

  /* 物料编辑/盘点弹窗：create 与 update 共用一个表单，省一套代码 */
  matForm(mat, onSaved) {
    const isNew = !mat;
    App.modal({
      title: isNew ? '新增物料建档' : `编辑物料 ${mat.code}`, width: 460,
      body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
        <label style="grid-column:1/3">名称<input class="ipt" id="mf-name" value="${App.esc(mat?.name || '')}"></label>
        <label>类别<select class="ipt" id="mf-cat">
          ${Object.entries(this.CAT).map(([k, v]) =>
            `<option value="${k}" ${mat?.category === k ? 'selected' : ''}>${v[0]}</option>`).join('')}
        </select></label>
        <label>单位<input class="ipt" id="mf-unit" value="${App.esc(mat?.unit || '个')}" ${isNew ? '' : 'disabled'}></label>
        <label>当前库存<input class="ipt" id="mf-stock" type="number" step="0.5" value="${mat?.stock ?? 0}"></label>
        <label>安全库存<input class="ipt" id="mf-safe" type="number" step="0.5" value="${mat?.safety_stock ?? 0}"></label>
        <label>单价(元)<input class="ipt" id="mf-price" type="number" step="0.1" value="${mat?.price ?? 0}"></label>
        <label>库位<input class="ipt" id="mf-loc" value="${App.esc(mat?.location || '')}" placeholder="如 A库-01架"></label>
      </div>
      ${isNew ? '' : '<div style="font-size:11px;color:var(--ink-soft);margin-top:6px">盘点场景允许直接改库存；日常消耗必须走领用审批流</div>'}`,
      okText: isNew ? '建 档' : '保 存',
      onOk: async (body) => {
        const d = {
          name: body.querySelector('#mf-name').value.trim(),
          category: body.querySelector('#mf-cat').value,
          stock: +body.querySelector('#mf-stock').value,
          safety_stock: +body.querySelector('#mf-safe').value,
          price: +body.querySelector('#mf-price').value,
          location: body.querySelector('#mf-loc').value.trim(),
        };
        if (!d.name) { App.toast('物料名称不能为空', false); return false; }
        if (isNew) {
          d.unit = body.querySelector('#mf-unit').value.trim() || '个';
          const j = await App.api('/materials/create', { method: 'POST', body: d });
          App.toast(j.msg);
        } else {
          delete d.category;   // 类别和编号属于档案属性，后端也不收
          const j = await App.api(`/materials/${mat.id}`, { method: 'PUT', body: d });
          App.toast(j.msg);
        }
        onSaved();
      },
    });
  },

  /* 领用申请弹窗：货架页和审批页都要用 */
  requestForm(mats, onSaved, presetId) {
    App.modal({
      title: '申请物料领用', width: 420,
      body: `<div style="display:flex;flex-direction:column;gap:10px;font-size:13px">
        <label>物料<select class="ipt" id="rf-mid">
          ${mats.map(m => `<option value="${m.id}" ${m.id === presetId ? 'selected' : ''}>
            ${App.esc(m.name)}（余 ${m.stock}${App.esc(m.unit)}）</option>`).join('')}
        </select></label>
        <label>数量<input class="ipt" id="rf-qty" type="number" step="1" min="1" value="1"></label>
        <label>用途说明<textarea class="ipt" id="rf-reason" rows="2" placeholder="如：A1 区深度保洁耗用"></textarea></label>
        <div style="font-size:11px;color:var(--ink-soft)">提交后进入待审批队列，由洁净班长审批；批准后库存即刻扣减</div>
      </div>`,
      okText: '提交申请',
      onOk: async (body) => {
        const d = {
          material_id: +body.querySelector('#rf-mid').value,
          quantity: +body.querySelector('#rf-qty').value,
          reason: body.querySelector('#rf-reason').value.trim(),
        };
        const j = await App.api('/materials/requests', { method: 'POST', body: d });
        App.toast(j.msg);
        onSaved();
      },
    });
  },

  /* ---------------- 子页1：库存货架 ---------------- */
  async tabShelf(el) {
    el.innerHTML = `
      <div class="panel" style="height:100%;display:flex;flex-direction:column">
        <div class="panel-head"><b>立体货架</b><span class="tag">按库位分区</span>
          <div class="spacer"></div>
          <span style="font-size:11.5px;color:var(--ink-soft)">红框 = 跌破安全线</span>
          <button class="btn sm amber" id="m07-add">＋ 新增物料</button></div>
        <div class="panel-body" id="m07-shelf"></div>
      </div>`;

    const load = async () => {
      const j = await App.api('/materials/list');
      const mats = j.data;
      // 按库位前缀分库：A库/B库/C库 各一排货架
      const groups = {};
      mats.forEach(m => {
        const g = (m.location || '未分配').split('-')[0];
        (groups[g] = groups[g] || []).push(m);
      });
      const box = el.querySelector('#m07-shelf');
      box.innerHTML = '';
      Object.entries(groups).forEach(([gname, list]) => {
        const rack = App.el(`
          <div style="margin-bottom:16px">
            <div style="font-size:13px;font-weight:800;color:var(--c-amber);margin-bottom:7px">🏷 ${App.esc(gname)}
              <span style="font-weight:400;color:var(--ink-soft);font-size:11.5px">　${list.length} 种物料</span></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px;
                 padding:12px;border-radius:12px;background:linear-gradient(180deg,rgba(217,119,6,.07),rgba(217,119,6,.02));
                 border:1.5px dashed rgba(217,119,6,.3)"></div>
          </div>`);
        const grid = rack.querySelector('div:last-child');
        list.forEach(m => {
          const low = m.stock < m.safety_stock;
          const [catText, catColor] = this.CAT[m.category] || ['其他', '#64748b'];
          const slot = App.el(`
            <div class="shelf-slot ${low ? 'low' : ''}" style="cursor:pointer;padding:10px">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <span class="badge" style="background:${catColor}18;color:${catColor}">${catText}</span>
                ${low ? '<span class="dot pulse" style="background:var(--bad)"></span>' : ''}
              </div>
              <div style="font-size:13.5px;font-weight:700;margin:6px 0 2px">${App.esc(m.name)}</div>
              <div style="font-size:11px;color:var(--ink-soft)">${App.esc(m.code)} · ${App.esc(m.location || '未分配')}</div>
              <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-top:8px">
                <div><b style="font-size:21px;color:${low ? 'var(--bad)' : 'var(--ok)'}">${m.stock}</b>
                  <span style="font-size:11px;color:var(--ink-soft)"> ${App.esc(m.unit)}</span></div>
                <div style="font-size:10.5px;color:var(--ink-soft);text-align:right">安全线 ${m.safety_stock}<br>¥${m.price}/${App.esc(m.unit)}</div>
              </div>
              <div style="height:5px;border-radius:3px;background:rgba(14,52,66,.1);margin-top:7px;overflow:hidden">
                <div style="height:100%;width:${Math.min(100, m.stock / Math.max(1, m.safety_stock * 2) * 100)}%;
                     background:${low ? 'var(--bad)' : 'linear-gradient(90deg,#f59e0b,#059669)'}"></div>
              </div>
            </div>`);
          slot.onclick = () => {
            App.modal({
              title: `${m.name}（${m.code}）`, width: 420, hideFoot: true,
              body: `<div style="font-size:13px;line-height:2">
                <div>库位：<b>${App.esc(m.location || '未分配')}</b>　类别：${catText}</div>
                <div>库存：<b style="color:${low ? 'var(--bad)' : 'var(--ok)'}">${m.stock} ${App.esc(m.unit)}</b>
                  （安全线 ${m.safety_stock}）${low ? '　<span class="badge red">已跌破安全线</span>' : ''}</div>
                <div>单价：¥${m.price}　存货价值：¥${(m.stock * m.price).toFixed(2)}</div>
                <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
                  <button class="btn sm amber" id="sl-req">📋 申请领用</button>
                  <button class="btn sm blue" id="sl-edit">✏ 编辑/盘点</button>
                  <button class="btn sm rose" id="sl-del">🗑 删除</button>
                </div></div>`,
            });
            const b = document.querySelector('.modal:last-child') || document;
            document.getElementById('sl-req').onclick = () => {
              document.querySelector('.modal-scrim')?.remove();
              this.requestForm(mats, load, m.id);
            };
            document.getElementById('sl-edit').onclick = () => {
              document.querySelector('.modal-scrim')?.remove();
              this.matForm(m, load);
            };
            document.getElementById('sl-del').onclick = async () => {
              document.querySelector('.modal-scrim')?.remove();
              if (!await App.confirm(`确定删除物料 ${m.name}（${m.code}）？有待审批领用单时将被拦截。`)) return;
              try { const d = await App.api(`/materials/${m.id}`, { method: 'DELETE' }); App.toast(d.msg); load(); }
              catch (e) { App.toast(e.msg, false); }
            };
          };
          grid.appendChild(slot);
        });
        box.appendChild(rack);
      });
      el.querySelector('#m07-add').onclick = () => this.matForm(null, load);
    };
    await load();
  },

  /* ---------------- 子页2：领用审批 ---------------- */
  async tabApprove(el) {
    el.innerHTML = `
      <div style="display:flex;gap:14px;height:100%;min-height:0">
        <div class="panel" style="flex:1.5;min-width:0;display:flex;flex-direction:column">
          <div class="panel-head"><b>领用单队列</b><span class="tag">事务扣库</span>
            <div class="spacer"></div>
            <button class="btn sm amber" id="m07a-new">＋ 新建领用申请</button>
            <button class="btn btn-line sm" id="m07a-refresh">↻</button></div>
          <div class="panel-body"><div id="m07a-list" style="display:flex;flex-direction:column;gap:9px"></div></div>
        </div>
        <div class="panel dark" style="width:320px;flex:none">
          <div class="panel-head"><b>审批规则</b></div>
          <div class="panel-body" style="font-size:12.5px;line-height:2">
            <div style="padding:10px;border-radius:10px;background:rgba(251,191,36,.12);margin-bottom:10px">
              <b style="color:#fcd34d">谁批？</b><br>仅洁净班长可批准/驳回，其他角色点批准会被规则引擎 403 拦下。
            </div>
            <div style="padding:10px;border-radius:10px;background:rgba(34,211,238,.1);margin-bottom:10px">
              <b style="color:#7de8dc">批了就扣</b><br>批准与库存扣减在同一事务里，要么都成要么都败，不存在"批了没扣"。
            </div>
            <div style="padding:10px;border-radius:10px;background:rgba(244,63,94,.12)">
              <b style="color:#fda4af">跌破红线</b><br>扣库后库存跌破安全线，系统自动生成物料报警单，推送到处置中心。
            </div>
            <div id="m07a-me" style="margin-top:10px;font-size:12px;opacity:.85"></div>
          </div>
        </div>
      </div>`;

    el.querySelector('#m07a-me').innerHTML =
      `当前登录：<b>${App.esc(App.user?.real_name || '')}</b>（${App.esc(App.ROLE_TEXT[App.user?.role] || '')}）` +
      (App.user?.role === 'leader' ? '<br><span style="color:#86efac">✔ 你有审批权</span>'
        : '<br><span style="color:#fda4af">✖ 你没有审批权，批准按钮将被驳回</span>');

    const load = async () => {
      const j = await App.api('/materials/requests');
      const list = el.querySelector('#m07a-list');
      if (!j.data.length) {
        list.innerHTML = `<div style="text-align:center;color:var(--ink-soft);padding:40px">暂无领用单</div>`;
        return;
      }
      list.innerHTML = '';
      j.data.forEach(r => {
        const pend = r.status === 'pending';
        const card = App.el(`
          <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;
               background:rgba(255,255,255,.72);border:1.5px solid ${pend ? 'rgba(217,119,6,.35)' : 'rgba(14,52,66,.08)'}">
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;font-weight:700">${App.esc(r.code)} ${App.badge(r.status)}</div>
              <div style="font-size:12px;color:var(--ink-soft);margin-top:3px">
                ${App.esc(r.material_name)} × <b style="color:var(--c-amber)">${r.quantity}${App.esc(r.unit)}</b>
                　申请人 ${App.esc(r.applicant_name || '—')}</div>
              <div style="font-size:11.5px;color:var(--ink-soft);margin-top:2px">用途：${App.esc(r.reason || '—')}</div>
              ${r.approver_name ? `<div style="font-size:11px;color:var(--ink-soft)">审批人：${App.esc(r.approver_name)} · ${App.fmtT(r.approved_at)}</div>` : ''}
            </div>
            ${pend ? `<div style="flex:none;display:flex;flex-direction:column;gap:6px">
              <button class="btn sm emerald act-ok">✔ 批准</button>
              <button class="btn sm rose act-no">✖ 驳回</button>
            </div>` : `<div style="flex:none;font-size:11px;color:var(--ink-soft)">${App.fmtT(r.created_at)}</div>`}
          </div>`);
        if (pend) {
          card.querySelector('.act-ok').onclick = async () => {
            try {
              const d = await App.api(`/materials/requests/${r.id}/approve`, { method: 'POST', body: { approve: true } });
              App.toast(d.msg); load();
            } catch (e) { App.toast(e.msg, false); }
          };
          card.querySelector('.act-no').onclick = async () => {
            if (!await App.confirm(`确定驳回领用单 ${r.code}？`)) return;
            try {
              const d = await App.api(`/materials/requests/${r.id}/approve`, { method: 'POST', body: { approve: false } });
              App.toast(d.msg); load();
            } catch (e) { App.toast(e.msg, false); }
          };
        }
        list.appendChild(card);
      });
    };
    el.querySelector('#m07a-refresh').onclick = load;
    el.querySelector('#m07a-new').onclick = async () => {
      const j = await App.api('/materials/list');
      this.requestForm(j.data, load);
    };
    await load();
  },

  /* ---------------- 子页3：成本透视 ---------------- */
  async tabCost(el) {
    const j = await App.api('/materials/stats');
    const s = j.data;
    const maxV = Math.max(...s.by_category.map(c => c.value), 1);
    el.innerHTML = `
      <div style="display:flex;gap:14px;height:100%;min-height:0">
        <div class="panel" style="flex:1.3;min-width:0">
          <div class="panel-head"><b>各类别存货价值</b><span class="tag">手绘条形，无图表库</span></div>
          <div class="panel-body" style="display:flex;flex-direction:column;justify-content:center;gap:16px">
            ${s.by_category.map(c => {
              const [t, col] = this.CAT[c.category] || ['其他', '#64748b'];
              return `<div>
                <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">
                  <b>${t}</b><span style="color:var(--ink-soft)">¥${c.value.toLocaleString()}</span></div>
                <div style="height:22px;border-radius:8px;background:rgba(14,52,66,.07);overflow:hidden">
                  <div style="height:100%;width:${(c.value / maxV * 100).toFixed(1)}%;border-radius:8px;
                       background:linear-gradient(90deg,${col},${col}aa);display:flex;align-items:center;
                       justify-content:flex-end;padding-right:8px;color:#fff;font-size:11px;font-weight:700;
                       min-width:36px;transition:width .6s">${(c.value / maxV * 100).toFixed(0)}%</div>
                </div></div>`;
            }).join('')}
            <div class="kpi" style="background:linear-gradient(135deg,#d97706,#b45309);margin-top:6px">
              <i>本月已批领用金额</i><b>¥${s.month_consume.toLocaleString()}</b><s>仅统计已批准单</s></div>
          </div>
        </div>
        <div class="panel" style="flex:1;min-width:0">
          <div class="panel-head"><b>补货预警清单</b><span class="tag" style="background:rgba(225,29,72,.12);color:var(--bad)">跌破安全线</span></div>
          <div class="panel-body">
            ${s.low_list.length ? `<div style="display:flex;flex-direction:column;gap:9px">
              ${s.low_list.map(m => `
                <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:11px;
                     background:rgba(225,29,72,.06);border:1.5px solid rgba(225,29,72,.28)">
                  <span class="dot pulse" style="background:var(--bad)"></span>
                  <div style="flex:1"><b style="font-size:13px">${App.esc(m.name)}</b>
                    <span style="font-size:11px;color:var(--ink-soft);margin-left:6px">${App.esc(m.code)}</span></div>
                  <div style="text-align:right;font-size:12px">
                    <b style="color:var(--bad);font-size:16px">${m.stock}</b> / ${m.safety_stock} ${App.esc(m.unit)}
                    <div style="font-size:10.5px;color:var(--ink-soft)">缺口 ${(m.safety_stock - m.stock).toFixed(0)}</div>
                  </div></div>`).join('')}</div>
              <div style="margin-top:12px;font-size:11.5px;color:var(--ink-soft)">提示：批准领用导致跌破安全线时，系统将自动生成物料报警单。</div>`
            : `<div style="text-align:center;color:var(--ok);padding:50px 0;font-size:14px">✔ 全部物料库存均在安全线以上</div>`}
          </div>
        </div>
      </div>`;
  },
});
