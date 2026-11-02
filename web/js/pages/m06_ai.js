/* ==========================================================================
   m06 AI 视觉巡检 —— 上传识别 / 样本体验 / 识别档案
   这一页是"眼睛"的展示窗口：左边传图右边出结果，检出 D 级当场红条警告。
   布局用"上传台 + 判读屏"的双栏结构，跟别的页刻意区分开。
   ========================================================================== */
App.register('m06', {
  title: 'AI 视觉巡检', icon: '🧠', color: '#8b5cf6',
  bg: 'linear-gradient(135deg,#8b5cf6,#6d28d9)',
  bgImg: '/web/assets/img/ai_vision.jpg',
  desc: '污渍图像识别 · 内置样本开箱即测 · 识别档案留痕',
  subs: ['上传识别', '样本体验', '识别档案'],

  GRADE: {
    A: { c: '#059669', t: '洁净' }, B: { c: '#0891b2', t: '基本洁净' },
    C: { c: '#d97706', t: '轻度污染' }, D: { c: '#e11d48', t: '重度污染' },
  },

  render(host) {
    host.appendChild(App.el(`
      <div class="page-head">
        <div class="ph-icon" style="background:linear-gradient(135deg,#a78bfa,#7c3aed)">🧠</div>
        <div><h2>AI 视觉巡检</h2><div class="ph-sub">OpenCV 污渍识别引擎 · HSV 双通道阈值 + 形态学 + 轮廓分析</div></div>
        <div class="spacer"></div>
        <button class="btn btn-line" id="m06-back">⌂ 返回菜单中枢</button>
      </div>`));
    host.querySelector('#m06-back').onclick = () => App.goHub();
    const body = App.el(`<div class="page-body"></div>`);
    host.appendChild(body);
    App.tabs(body, [
      { label: '上传识别', icon: '📤', render: el => this.tabUpload(el) },
      { label: '样本体验', icon: '🧪', render: el => this.tabSamples(el) },
      { label: '识别档案', icon: '🗂', render: el => this.tabHistory(el) },
    ], { style: 'card', color: '#8b5cf6' });
  },

  /* 区域下拉共用：取 3D 场景接口里的区域清单 */
  async zoneOptions() {
    const j = await App.api('/dashboard/scene');
    return j.data.zones.map(z => `<option value="${z.id}">${App.esc(z.name)}（ISO${z.iso_class}）</option>`).join('');
  },

  /* 识别结果统一画法：标注图 + 等级印章 + 指标条 + 报警横幅 */
  renderResult(box, det, alarmCreated, zoneName) {
    const g = this.GRADE[det.grade] || this.GRADE.B;
    box.innerHTML = `
      <div style="display:flex;gap:14px;height:100%;min-height:0">
        <div class="compare-box" style="flex:1.4;min-width:0;align-self:center;position:relative">
          <img src="${det.annotated_b64}" alt="识别标注图">
          <div class="grade-stamp" style="border-color:${g.c};color:${g.c}">${det.grade}</div>
        </div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;justify-content:center">
          <div class="kpi" style="background:linear-gradient(135deg,${g.c},${g.c}cc)">
            <i>洁净面等级</i><b style="font-size:34px">${det.grade} · ${g.t}</b>
          </div>
          <div style="display:flex;gap:10px">
            <div class="kpi" style="flex:1;background:linear-gradient(135deg,#0ea5e9,#0369a1)">
              <i>检出污渍</i><b>${det.stain_count}</b><s>处</s></div>
            <div class="kpi" style="flex:1;background:linear-gradient(135deg,#f59e0b,#b45309)">
              <i>污染覆盖率</i><b>${det.coverage}</b><s>%</s></div>
          </div>
          <div style="font-size:12px;color:var(--ink-soft);line-height:1.7">
            关联区域：<b style="color:var(--ink)">${App.esc(zoneName || '未关联')}</b><br>
            检出框已按 0.02% 面积阈值过滤噪点，黄框为污渍轮廓外接矩形，红十字为质心。
          </div>
          ${alarmCreated ? `<div style="background:rgba(225,29,72,.1);border:1.5px solid var(--bad);border-radius:10px;
               padding:10px 12px;color:var(--bad);font-weight:700;font-size:13px;animation:shake .4s">
            ⚠ 覆盖率超 5% 或等级为 D：已自动生成报警单，关联区域转入预警状态</div>`
          : `<div style="background:rgba(5,150,105,.1);border:1.5px solid var(--ok);border-radius:10px;
               padding:10px 12px;color:var(--ok);font-weight:700;font-size:13px">
            ✔ 未触发报警阈值，识别记录已归档</div>`}
        </div>
      </div>`;
  },

  /* ---------------- 子页1：上传识别 ---------------- */
  async tabUpload(el) {
    el.innerHTML = `
      <style>
        /* 扫描动画只服务这一页：一道青色光带自上而下扫过预览图 */
        @keyframes m06scan { 0% { top: 0; } 100% { top: calc(100% - 4px); } }
        .m06-scanline { position:absolute; left:0; right:0; height:4px; border-radius:2px;
          background:linear-gradient(90deg,transparent,#22d3ee,#a78bfa,#22d3ee,transparent);
          box-shadow:0 0 14px #22d3ee; animation:m06scan 1.1s linear infinite alternate; }
      </style>
      <div style="display:flex;gap:14px;height:100%;min-height:0">
        <div class="panel" style="width:380px;flex:none;display:flex;flex-direction:column">
          <div class="panel-head"><b>影像上传台</b><span class="tag">JPG / PNG</span></div>
          <div class="panel-body" style="display:flex;flex-direction:column;gap:12px;overflow:visible">
            <div class="upload-zone" id="m06-up" style="flex:1;min-height:180px;position:relative;overflow:hidden">
              <div id="m06-up-tip" style="text-align:center;pointer-events:none">
                <div style="font-size:38px;margin-bottom:8px">📷</div>
                <div style="font-size:13.5px;font-weight:700">点击选择或拖拽洁净面照片至此</div>
                <div style="font-size:11.5px;color:var(--ink-soft);margin-top:6px">地面 / 墙面 / 台面 / 视窗均可，建议光线均匀</div>
              </div>
              <img id="m06-up-img" style="display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:10px">
            </div>
            <div>
              <div style="font-size:12px;color:var(--ink-soft);margin-bottom:5px">关联洁净区域（识别超阈值将联动该区域预警）</div>
              <select id="m06-zone" class="ipt" style="width:100%"></select>
            </div>
            <button class="btn violet lg btn-block" id="m06-run">🧠 开始 AI 识别</button>
            <div style="font-size:11px;color:var(--ink-soft);text-align:center">没有现场照片？去「样本体验」页用内置样本直接试</div>
          </div>
        </div>
        <div class="panel" style="flex:1;min-width:0">
          <div class="panel-head"><b>AI 判读屏</b><span class="tag">v2.3</span>
            <div class="spacer"></div><span id="m06-state" style="font-size:12px;color:var(--ink-soft)">待上传</span></div>
          <div class="panel-body" id="m06-result" style="display:grid;place-items:center">
            <div style="text-align:center;color:var(--ink-soft)">
              <div style="font-size:52px;opacity:.35">🔬</div>
              <div style="font-size:13px;margin-top:6px">识别结果将在此呈现：标注图 · 等级印章 · 覆盖率 · 联动报警</div>
            </div>
          </div>
        </div>
      </div>`;

    const zoneSel = el.querySelector('#m06-zone');
    zoneSel.innerHTML = '<option value="">不关联区域</option>' + await this.zoneOptions();

    const upZone = el.querySelector('#m06-up');
    const upImg = el.querySelector('#m06-up-img');
    const fileIn = App.el('<input type="file" accept="image/jpeg,image/png" style="display:none">');
    el.appendChild(fileIn);
    let pickedFile = null;
    const pickFile = f => {
      if (!f) return;
      if (!/\.(jpe?g|png)$/i.test(f.name)) { App.toast('仅支持 JPG / PNG 图片', false); return; }
      pickedFile = f;
      upImg.src = URL.createObjectURL(f);
      upImg.style.display = 'block';
      el.querySelector('#m06-up-tip').style.display = 'none';
      el.querySelector('#m06-state').textContent = '待识别：' + f.name;
    };
    upZone.onclick = () => fileIn.click();
    fileIn.onchange = () => pickFile(fileIn.files[0]);
    upZone.ondragover = e => { e.preventDefault(); upZone.classList.add('dragover'); };
    upZone.ondragleave = () => upZone.classList.remove('dragover');
    upZone.ondrop = e => { e.preventDefault(); upZone.classList.remove('dragover'); pickFile(e.dataTransfer.files[0]); };

    el.querySelector('#m06-run').onclick = async () => {
      if (!pickedFile) { App.toast('请先选择一张洁净面照片', false); return; }
      // 扫描动画覆盖在预览图上，让"AI 正在看"这件事可视化
      const scan = App.el('<div class="m06-scanline"></div>');
      upZone.appendChild(scan);
      const stateEl = el.querySelector('#m06-state');
      stateEl.textContent = '识别中：HSV 阈值分割 → 形态学去噪 → 轮廓提取…';
      const fd = new FormData();
      fd.append('file', pickedFile);
      if (zoneSel.value) fd.append('zone_id', zoneSel.value);
      try {
        const j = await App.api('/ai/detect', { method: 'POST', body: fd });
        const zname = zoneSel.selectedOptions[0].textContent.split('（')[0];
        const resultEl = el.querySelector('#m06-result');
        resultEl.style.display = 'block';
        this.renderResult(resultEl, j.data.detection, j.data.alarm_created, zoneSel.value ? zname : '');
        stateEl.textContent = '识别完成';
        App.toast(j.msg, true);
      } catch (e) {
        App.toast(e.msg, false);
        stateEl.textContent = '识别失败';
      } finally { scan.remove(); }
    };
  },

  /* ---------------- 子页2：样本体验 ---------------- */
  async tabSamples(el) {
    el.innerHTML = `
      <div style="display:flex;gap:14px;height:100%;min-height:0">
        <div class="panel" style="flex:1.35;min-width:0">
          <div class="panel-head"><b>内置示例样本</b><span class="tag">OpenCV 程序化合成</span>
            <div class="spacer"></div>
            <select id="m06s-zone" class="ipt" style="width:200px"></select>
            <button class="btn violet" id="m06s-run">⚡ 对选中样本执行识别</button></div>
          <div class="panel-body">
            <div id="m06s-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px"></div>
            <div id="m06s-out" style="margin-top:12px"></div>
          </div>
        </div>
        <div class="panel dark" style="width:330px;flex:none">
          <div class="panel-head"><b>识别原理透视</b></div>
          <div class="panel-body" style="font-size:12.5px;line-height:2">
            <div style="padding:10px;border-radius:10px;background:rgba(167,139,250,.12);margin-bottom:10px">
              <b style="color:#c4b5fd">① HSV 双通道夹击</b><br>
              低明度通道抓深色油渍水渍，高饱和通道抓彩色试剂残留，合并成污渍掩膜。
            </div>
            <div style="padding:10px;border-radius:10px;background:rgba(34,211,238,.1);margin-bottom:10px">
              <b style="color:#7de8dc">② 形态学修边</b><br>
              开运算去椒盐噪点，闭运算把碎块连成片，得到完整污渍区域。
            </div>
            <div style="padding:10px;border-radius:10px;background:rgba(251,191,36,.1);margin-bottom:10px">
              <b style="color:#fcd34d">③ 轮廓分析定级</b><br>
              提取外轮廓，按面积万分之二阈值滤噪，汇总覆盖率 → A/B/C/D 洁净面等级。
            </div>
            <div style="padding:10px;border-radius:10px;background:rgba(244,63,94,.12)">
              <b style="color:#fda4af">④ 联动处置</b><br>
              D 级或覆盖率 &gt;5% 自动生成报警单并置区域预警，闭环到处置中心。
            </div>
          </div>
        </div>
      </div>`;

    const zoneSel = el.querySelector('#m06s-zone');
    zoneSel.innerHTML = '<option value="">不关联区域</option>' + await this.zoneOptions();

    const grid = el.querySelector('#m06s-grid');
    const SAMPLE_DESC = {
      sample_floor_01.jpg: '地板 · 少量污渍',
      sample_floor_02.jpg: '地板 · 重度污染',
      sample_wall_01.jpg: '墙面 · 试剂痕迹',
      sample_table_01.jpg: '台面 · 颗粒残留',
    };
    let picked = null;
    const j = await App.api('/ai/samples');
    j.data.forEach(s => {
      const card = App.el(`
        <div class="sample-card">
          <img src="${s.url}" alt="${App.esc(s.filename)}">
          <div class="sc-name">${App.esc(SAMPLE_DESC[s.filename] || s.filename)}</div>
        </div>`);
      card.onclick = () => {
        grid.querySelectorAll('.sample-card').forEach(c => c.classList.remove('sel'));
        card.classList.add('sel');
        picked = s.filename;
      };
      grid.appendChild(card);
    });
    grid.firstElementChild && grid.firstElementChild.click();

    el.querySelector('#m06s-run').onclick = async () => {
      if (!picked) { App.toast('请先点选一张样本图', false); return; }
      const out = el.querySelector('#m06s-out');
      out.innerHTML = `<div class="panel" style="text-align:center;padding:26px;color:var(--ink-soft)">
        <span class="dot pulse" style="background:var(--c-violet)"></span>识别引擎运行中…</div>`;
      try {
        const body = { sample: picked };
        if (zoneSel.value) body.zone_id = +zoneSel.value;
        const r = await App.api('/ai/detect', { method: 'POST', body });
        const zname = zoneSel.value ? zoneSel.selectedOptions[0].textContent.split('（')[0] : '';
        out.innerHTML = `<div class="panel" style="height:340px"><div class="panel-head">
          <b>样本识别结果</b><span class="tag">${App.esc(picked)}</span></div>
          <div class="panel-body" id="m06s-rb" style="overflow:hidden"></div></div>`;
        this.renderResult(out.querySelector('#m06s-rb'), r.data.detection, r.data.alarm_created, zname);
        App.toast(r.msg, true);
      } catch (e) {
        out.innerHTML = '';
        App.toast(e.msg, false);
      }
    };
  },

  /* ---------------- 子页3：识别档案 ---------------- */
  async tabHistory(el) {
    el.innerHTML = `
      <div class="panel" style="height:100%;display:flex;flex-direction:column">
        <div class="panel-head"><b>AI 识别档案</b><span class="tag">全量留痕可溯</span>
          <div class="spacer"></div>
          <button class="btn btn-line sm" id="m06h-refresh">↻ 刷新</button></div>
        <div id="m06h-stats" style="display:flex;gap:10px;margin-bottom:10px;flex:none"></div>
        <div class="panel-body"><div id="m06h-list" style="display:flex;flex-direction:column;gap:9px"></div></div>
      </div>`;

    const load = async () => {
      const j = await App.api('/ai/history');
      const rows = j.data;
      const stats = el.querySelector('#m06h-stats');
      const cnt = { A: 0, B: 0, C: 0, D: 0 };
      rows.forEach(r => cnt[r.grade] !== undefined && cnt[r.grade]++);
      stats.innerHTML = `
        <div class="kpi" style="flex:1;background:linear-gradient(135deg,#8b5cf6,#6d28d9)"><i>累计识别</i><b>${rows.length}</b><s>次</s></div>
        ${['A', 'B', 'C', 'D'].map(g => `
          <div class="kpi" style="flex:1;background:linear-gradient(135deg,${this.GRADE[g].c},${this.GRADE[g].c}bb)">
            <i>${g} 级 · ${this.GRADE[g].t}</i><b>${cnt[g]}</b><s>次</s></div>`).join('')}`;

      const list = el.querySelector('#m06h-list');
      if (!rows.length) {
        list.innerHTML = `<div style="text-align:center;color:var(--ink-soft);padding:40px">暂无识别记录，去上传识别或样本体验跑一张</div>`;
        return;
      }
      list.innerHTML = '';
      rows.forEach(r => {
        const g = this.GRADE[r.grade] || this.GRADE.B;
        const card = App.el(`
          <div style="display:flex;align-items:center;gap:14px;padding:11px 14px;border-radius:12px;
               background:rgba(255,255,255,.72);border:1.5px solid rgba(139,92,246,.16)">
            <div style="width:52px;height:52px;flex:none;border-radius:50%;display:grid;place-items:center;
                 border:3px solid ${g.c};color:${g.c};font-weight:800;font-size:22px;transform:rotate(-8deg)">${r.grade}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;font-weight:700">${App.esc(r.code)}
                <span class="badge violet" style="margin-left:6px">${App.esc(r.grade_text)}</span></div>
              <div style="font-size:11.5px;color:var(--ink-soft);margin-top:3px">
                ${App.esc(r.filename)} · ${App.esc(r.zone_name || '未关联区域')} · 操作人 ${App.esc(r.operator_name || '—')}</div>
            </div>
            <div style="text-align:center;flex:none"><div style="font-size:19px;font-weight:800;color:${g.c}">${r.coverage}%</div>
              <div style="font-size:10.5px;color:var(--ink-soft)">覆盖率</div></div>
            <div style="text-align:center;flex:none"><div style="font-size:19px;font-weight:800;color:var(--c-blue)">${r.stain_count}</div>
              <div style="font-size:10.5px;color:var(--ink-soft)">污渍处</div></div>
            <div style="flex:none;font-size:11.5px;color:var(--ink-soft)">${App.fmtT(r.created_at)}</div>
            <div style="flex:none;display:flex;gap:6px">
              <button class="btn sm blue act-view">详 情</button>
              <button class="btn sm rose act-del">删 除</button>
            </div>
          </div>`);
        card.querySelector('.act-view').onclick = () => {
          let boxes = [];
          try { boxes = JSON.parse(r.result_json || '[]'); } catch (e) { }
          App.modal({
            title: `识别单 ${r.code}`, width: 460, hideFoot: true,
            body: `<div style="font-size:13px;line-height:2">
              <div>文件：<b>${App.esc(r.filename)}</b></div>
              <div>等级：<b style="color:${g.c}">${r.grade} · ${App.esc(r.grade_text)}</b>　覆盖率：<b>${r.coverage}%</b>　污渍：<b>${r.stain_count} 处</b></div>
              <div>区域：${App.esc(r.zone_name || '未关联')}　操作人：${App.esc(r.operator_name || '—')}　时间：${App.esc(r.created_at)}</div>
              <div style="margin-top:8px;max-height:180px;overflow:auto;background:rgba(14,52,66,.05);border-radius:8px;padding:8px 10px">
                ${boxes.length ? boxes.map((b, i) =>
                  `<div style="font-size:12px">#${i + 1}　位置(${b.x}, ${b.y})　尺寸 ${b.w}×${b.h}px　面积 ${b.area}px²</div>`).join('')
                  : '<div style="font-size:12px;color:var(--ink-soft)">无检出框明细</div>'}
              </div></div>`,
          });
        };
        card.querySelector('.act-del').onclick = async () => {
          if (!await App.confirm(`确定删除识别单 ${r.code}？删除后不可恢复。`)) return;
          try { const d = await App.api(`/ai/${r.id}`, { method: 'DELETE' }); App.toast(d.msg); load(); }
          catch (e) { App.toast(e.msg, false); }
        };
        list.appendChild(card);
      });
    };
    el.querySelector('#m06h-refresh').onclick = load;
    await load();
  },
});
