# -*- coding: utf-8 -*-
"""
Streamlit 版本 —— 洁净车间智能保洁人机协同一体化软件

直接复用 app.db / app.rules / app.ai_engine 三层业务，避开 Flask 路由 + HTTP 层。
Streamlit Cloud 部署时只需 git push + 选这个 app.py，一行就能跑。
"""
import os
import sys
import datetime as dt
import hashlib
from io import BytesIO

import streamlit as st
import numpy as np
import pandas as pd
from PIL import Image

# 让 app.* 包能被 import（Streamlit 用 subprocess 跑，cwd 不一定是项目根）
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app.db import get_conn, q, init_db, hash_pwd, DB_PATH
from app.rules import (
    BizError, STATUS_TEXT, TASK_FLOW, ALARM_FLOW, REQUEST_FLOW, INSPECTION_FLOW,
    transit_task, auto_dispatch, approve_request,
    judge_inspection, submit_inspection, review_inspection, handle_alarm,
)
from app.ai_engine import (
    detect_contamination, predict_particle_trend, zone_risk_assessment,
    ensure_samples, SAMPLE_DIR, UPLOAD_DIR,
)

# ======================================================================
# 登录态（Streamlit 原生 session_state，比 cookies 省事）
# ======================================================================
def do_login(username, password):
    pw_hash = hash_pwd(password)
    row = q(
        "SELECT id, username, real_name, role FROM users WHERE username=? AND password_hash=?",
        (username, pw_hash), one=True)
    if not row:
        raise BizError("用户名或口令不正确")
    return dict(row)


ROLE_TEXT = {"cleaner": "保洁员", "leader": "洁净班长",
             "inspector": "质检员", "dispatcher": "调度工程师"}
MENU = [
    ("dashboard", "工作台总览", "🏠"),
    ("monitor",   "洁净度监测", "📡"),
    ("tasks",     "保洁任务中心", "📋"),
    ("robots",    "机器人协同", "🤖"),
    ("staff",     "人员与排班", "👷"),
    ("materials", "物料耗材", "📦"),
    ("quality",   "质量验收", "⚖️"),
    ("equipment", "设备设施", "🌬️"),
    ("alarms",    "报警中心", "🚨"),
    ("ai",        "AI 视觉巡检", "🧠"),
    ("analytics", "智能分析", "🔮"),
]


# ======================================================================
# 页面入口（公共壳 + 侧栏 + 分发）
# ======================================================================
def run():
    init_db()  # SQLite 建库 + 种子；幂等，不会重复灌
    ensure_samples()  # AI 演示样本

    st.set_page_config(
        page_title="洁净车间智能保洁人机协同一体化软件",
        page_icon="🧹",
        layout="wide",
    )

    # ---- 登录门 ----
    if "user" not in st.session_state:
        with st.container(border=True):
            st.markdown("## 🧹 洁净车间智能保洁人机协同一体化软件")
            st.caption("登录口令：chenjing · liqiang · wangfang · sunmei · zhouyang · 123456")
            with st.form("login_form"):
                c1, c2 = st.columns(2)
                with c1:
                    username = st.text_input("用户名", placeholder="如 chenjing")
                with c2:
                    password = st.text_input("口令", type="password", placeholder="123456")
                submitted = st.form_submit_button("登 录", type="primary", use_container_width=True)
            if submitted:
                try:
                    st.session_state.user = do_login(username.strip(), password.strip())
                    st.success(f"欢迎回来，{st.session_state.user['real_name']}")
                    st.rerun()
                except BizError as e:
                    st.error(str(e.msg))
        st.stop()

    user = st.session_state.user

    # ---- 侧栏 ----
    with st.sidebar:
        st.markdown(f"### 🛡 {user['real_name']} · {ROLE_TEXT[user['role']]}")
        st.caption(f"口令：{user['username']}　角色：{user['role']}")
        st.divider()
        choice = st.radio(
            "菜单", [f"{icon}  {name}" for _, name, icon in MENU],
            label_visibility="collapsed", key="menu_radio")
        st.divider()
        if st.button("🚪 退出登录", use_container_width=True):
            st.session_state.pop("user", None); st.rerun()

    page_key = MENU[next(i for i, (_, n, _) in enumerate(MENU)
                        if f"{MENU[i][2]}  {n}" == choice)][0]
    st.title(f"{MENU[[k for k, n, ic in MENU].index(page_key)][2]} {MENU[[k for k, n, ic in MENU].index(page_key)][1]}")
    st.caption("所有增删改改状态流转都走后端规则引擎，角色权限自动拦截")
    st.divider()
    globals()[f"page_{page_key}"](user)


# ======================================================================
# 公共小部件
# ======================================================================
def badge_text(text, kind="ok"):
    """生成 Streamlit 原生状态胶囊（用 st.markdown + 样式）"""
    colors = {"ok": "#059669", "warn": "#d97706", "bad": "#e11d48",
              "info": "#0891b2", "soft": "#64748b"}
    color = {"passed": "ok", "approved": "ok", "resolved": "ok",
             "online": "ok", "running": "ok", "normal": "ok",
             "working": "info", "assigned": "info", "in_progress": "info",
             "submitted": "info", "critical": "bad", "fault": "bad",
             "failed": "bad", "rejected": "bad", "offline": "bad",
             "warning": "warn", "charge": "warn", "maintenance": "warn",
             "open": "bad", "processing": "warn",
             "draft": "soft", "pending": "warn", "cancelled": "soft",
             "ignored": "soft"}.get(text, "soft")
    c = colors.get(kind if kind in colors else None, colors[color])
    return (f"<span style='display:inline-block;padding:2px 10px;background:{c}22;color:{c};"
            f"border-radius:12px;font-size:12px;border:1px solid {c}55'>{STATUS_TEXT.get(text, text)}</span>")


# ======================================================================
# M01 工作台总览
# ======================================================================
def page_dashboard(user):
    ov = dict(q("""
        SELECT
          (SELECT COUNT(*) FROM tasks WHERE status IN ('in_progress','assigned')) AS task_busy,
          (SELECT COUNT(*) FROM tasks WHERE status='awaiting_inspection')      AS task_wait_insp,
          (SELECT COUNT(*) FROM alarms WHERE status IN ('open','processing'))  AS alarm_open,
          (SELECT COUNT(*) FROM robots WHERE status='fault')                   AS robot_fault,
          (SELECT COUNT(*) FROM robots WHERE status='working')                 AS robot_work,
          (SELECT COUNT(*) FROM staff WHERE status='leave')                    AS staff_leave,
          (SELECT COUNT(*) FROM materials WHERE stock<safety_stock AND safety_stock>0) AS mat_low
    """, one=True))
    kcols = st.columns(4)
    kcols[0].metric("作业中任务", ov["task_busy"], "待验收 " + str(ov["task_wait_insp"]))
    kcols[1].metric("未结报警", ov["alarm_open"], help="含处理中")
    kcols[2].metric("机器人作业 / 故障", f"{ov['robot_work']} / {ov['robot_fault']}")
    kcols[3].metric("缺货物料 / 请假", f"{ov['mat_low']} / {ov['staff_leave']}")
    st.divider()

    left, right = st.columns([1.5, 1])
    with left:
        st.subheader("📊 区域状态")
        zones = q("""SELECT z.*,
                     (SELECT COUNT(*) FROM alarms a WHERE a.zone_id=z.id
                            AND a.status IN ('open','processing')) AS alarm_cnt,
                     (SELECT AVG(r.value) FROM sensor_readings r
                      JOIN sensors s ON s.id=r.sensor_id
                      WHERE s.zone_id=z.id AND s.stype='particle') AS mean_particle
                     FROM zones z ORDER BY z.id""")
        status_colors = {"normal": "🟢", "warning": "🟡", "critical": "🔴", "cleaning": "🔵"}
        rows = []
        for z in zones:
            ratio = (z["mean_particle"] or 0) / z["target_particles"] * 100
            rows.append([
                f"{status_colors.get(z['status'],'⚪')} ISO{z['iso_class']} {z['name']}",
                f"{round(z['mean_particle'] or 0, 0)} / {z['target_particles']}",
                min(ratio / 100, 1.0),  # ProgressColumn 吃 0~1 数值，不是 st.progress() 对象
                z["alarm_cnt"]])
        df = pd.DataFrame(rows, columns=["区域", "实测 / 限值", "progress", "报警"])
        st.dataframe(df, use_container_width=True, hide_index=True,
                     column_config={"progress": st.column_config.ProgressColumn(
                         "相对负荷", width="medium", format="%.0f%%")})
    with right:
        st.subheader("🚨 未结报警 Top 5")
        alarms = q("""SELECT a.*, z.name AS zone_name
                      FROM alarms a
                      LEFT JOIN zones z ON z.id=a.zone_id
                      ORDER BY CASE a.level WHEN 'critical' THEN 0
                                           WHEN 'major' THEN 1 ELSE 2 END, a.id DESC LIMIT 5""")
        for a in alarms:
            level_map = {"critical": "🔴 紧急", "major": "🟠 重要", "minor": "🔵 一般"}
            st.markdown(f"**{level_map.get(a['level'], '—')}** · "
                        f"{a['zone_name'] or '未关联区域'} · {a['title']}  "
                        f"<span style='color:#94a3b8'>{a['code']}</span>", unsafe_allow_html=True)
            st.caption(a["detail"] or "")


# ======================================================================
# M02 洁净度监测
# ======================================================================
def page_monitor(user):
    zones = q("SELECT * FROM zones ORDER BY id")
    zone_opt = {z["id"]: f"ISO{z['iso_class']} · {z['name']}" for z in zones}
    zid = st.selectbox("区域", zone_opt.keys(), format_func=lambda k: zone_opt[k])
    z = q("SELECT * FROM zones WHERE id=?", (zid,), one=True)

    kcols = st.columns(4)
    for col, label, stype in zip(kcols,
                                  ["粒子数(个/m³)", "温度(℃)", "湿度(%RH)", "压差(Pa)"],
                                  ["particle", "temp", "humidity", "pressure"]):
        row = q("""SELECT AVG(r.value) AS v, r.unit AS u FROM sensor_readings r
                    JOIN sensors s ON s.id=r.sensor_id
                    WHERE s.zone_id=? AND s.stype=?
                    AND r.recorded_at >= datetime('now','localtime','-24 hours')""",
                (zid, stype), one=True)
        col.metric(label, f"{round(row['v'] or 0, 1)} {row['u'] or ''}")
    st.divider()

    # 粒子 24h 折线（真实 readings 表）
    st.subheader("📈 粒子浓度 24h 走势")
    history = q("""SELECT datetime(r.recorded_at,'localtime') AS t, r.value
                    FROM sensor_readings r JOIN sensors s ON s.id=r.sensor_id
                    WHERE s.zone_id=? AND s.stype='particle'
                    ORDER BY r.recorded_at DESC LIMIT 48""", (zid,))[::-1]
    if history:
        df = pd.DataFrame([[h["t"], h["value"]] for h in history], columns=["时刻", "个/m³"])
        limit = z["target_particles"]
        st.line_chart(df.set_index("时刻"), use_container_width=True)
        st.caption(f"ISO{z['iso_class']} 限值：{limit} 个/m³")

        # 风险评估
        mean_val = df["个/m³"].mean()
        risk = zone_risk_assessment(z, mean_val)
        lv = {"normal": ("🟢 正常", "#059669"),
              "warning": ("🟡 预警", "#d97706"),
              "critical": ("🔴 超标", "#e11d48")}[risk["level"]]
        st.markdown(f"**风险等级**：{lv[0]}　均值/限值 = {mean_val:.0f} / {limit}  "
                    f"({risk['ratio']*100:.0f}%)")
        st.info(risk["advice"])
    else:
        st.warning("该区域近 24h 暂无粒子读数")


# ======================================================================
# M03 保洁任务中心
# ======================================================================
def page_tasks(user):
    tab1, tab2, tab3 = st.tabs(["任务看板", "状态流转", "智能派单"])

    with tab1:
        tasks = q("""SELECT t.*, z.name AS zone_name, r.name AS assignee_name,
                     ro.name AS robot_name
                     FROM tasks t LEFT JOIN zones z ON z.id=t.zone_id
                     LEFT JOIN staff r ON r.id=t.assignee_id
                     LEFT JOIN robots ro ON ro.id=t.robot_id
                     ORDER BY CASE t.status WHEN 'passed' THEN 1 WHEN 'failed' THEN 2
                                           WHEN 'awaiting_inspection' THEN 3
                                           WHEN 'in_progress' THEN 4
                                           WHEN 'assigned' THEN 5 ELSE 6 END, t.id""")
        status_filter = st.multiselect("状态", list(TASK_FLOW.keys()), default=["created", "assigned", "in_progress"])
        tasks = [t for t in tasks if t["status"] in (status_filter or [])]
        for t in tasks:
            with st.container(border=True):
                clr = {"passed": "#059669", "failed": "#e11d48",
                       "awaiting_inspection": "#8b5cf6", "in_progress": "#0891b2",
                       "assigned": "#2563eb", "created": "#64748b",
                       "cancelled": "#64748b"}.get(t["status"], "#64748b")
                st.markdown(f"**{t['code']}** {t['title']}  "
                            f"<span style='float:right;color:{clr}'>{STATUS_TEXT.get(t['status'])}</span>",
                            unsafe_allow_html=True)
                st.caption(f"📍 {t['zone_name']}　👤 {t['assignee_name'] or '未派'}　"
                           f"🤖 {t['robot_name'] or '未分配'}　优先级 {'★' * t['priority']}")
                cols = st.columns(4)
                if t["status"] == "created" or t["status"] == "failed":
                    if cols[0].button("🔄 智能派单", key=f"auto_{t['id']}"):
                        try:
                            info = auto_dispatch(t["id"], user)
                            st.success(f"派单完成：{info['staff']['name']} + {info['robot']['name']}，得分 {info['total']}")
                            st.rerun()
                        except BizError as e:
                            st.error(str(e.msg))
                if t["status"] == "assigned":
                    if cols[1].button("▶ 开始作业", key=f"start_{t['id']}"):
                        try: transit_task(t["id"], "in_progress", user); st.rerun()
                        except BizError as e: st.error(str(e.msg))
                if t["status"] == "in_progress":
                    if cols[2].button("✅ 完成作业", key=f"done_{t['id']}"):
                        try: transit_task(t["id"], "awaiting_inspection", user); st.rerun()
                        except BizError as e: st.error(str(e.msg))
                if t["status"] == "awaiting_inspection" and user["role"] == "inspector":
                    if cols[3].button("⚠ 验收不合格", key=f"fail_{t['id']}"):
                        try: transit_task(t["id"], "failed", user); st.rerun()
                        except BizError as e: st.error(str(e.msg))

    with tab2:
        st.subheader("🔧 手动流转测试")
        tid = st.selectbox("选任务", q("SELECT id, code, title, status FROM tasks ORDER BY id DESC"),
                           format_func=lambda r: f"{r['code']} · {r['title']} · [{STATUS_TEXT.get(r['status'],'')}]")["id"]
        t = q("SELECT * FROM tasks WHERE id=?", (tid,), one=True)
        legal = TASK_FLOW.get(t["status"], set())
        nxt = st.selectbox("目标状态", sorted(legal))
        note = st.text_input("备注", key="tn_note")
        if st.button("执行流转", type="primary"):
            try:
                transit_task(tid, nxt, user, note=note or "")
                st.success(f"流转成功：{STATUS_TEXT.get(t['status'],'')} → {STATUS_TEXT.get(nxt,'')}")
            except BizError as e:
                st.error(str(e.msg))

    with tab3:
        st.subheader("🤖 智能派单演示")
        tid2 = st.selectbox("选已创建/不合格任务",
                            q("SELECT id, code, title FROM tasks WHERE status IN ('created','failed')"),
                            format_func=lambda r: f"{r['code']} · {r['title']}")["id"]
        if st.button("🔍 执行四维打分派单", type="primary"):
            try:
                info = auto_dispatch(tid2, user)
                st.success(f"派单完成！综合得分 {info['total']}")
                c1, c2 = st.columns(2)
                c1.markdown(f"**最佳保洁员**：{info['staff']['name']}　人评分 {info['staff']['score']}")
                c2.markdown(f"**最佳机器人**：{info['robot']['name']}　机评分 {info['robot']['score']}")
            except BizError as e:
                st.error(str(e.msg))


# ======================================================================
# M04 机器人协同
# ======================================================================
def page_robots(user):
    robots = q("SELECT * FROM robots ORDER BY id")
    c1, c2, c3 = st.columns(3)
    for r in robots:
        with (c1 if r["id"] % 3 == 1 else c2 if r["id"] % 3 == 2 else c3).container(border=True):
            st.markdown(f"### 🤖 {r['name']}")
            st.caption(f"{r['code']} · {r['model']}")
            status_color = {"working": "#0891b2", "idle": "#16a34a", "charging": "#d97706",
                            "fault": "#e11d48", "maintenance": "#6366f1"}[r["status"]]
            st.markdown(f"<span style='color:{status_color};font-weight:700;font-size:14px'>"
                        f"● {STATUS_TEXT.get(r['status'])}</span>　模式：{r['mode']}", unsafe_allow_html=True)
            st.progress(int(r["battery"]) / 100, text=f"电量 {r['battery']:.0f}%")
            st.caption(f"累计运行 {r['total_hours']:.0f}h　区域 {'Z-' + str(r['zone_id']) if r['zone_id'] else '未分配'}")


# ======================================================================
# M05 人员与排班
# ======================================================================
def page_staff(user):
    tab1, tab2 = st.tabs(["技能矩阵", "排班日历"])
    with tab1:
        rows = q("""SELECT s.*, u.role AS user_role, u.real_name AS display_name
                     FROM staff s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.id""")
        df = pd.DataFrame([{
            "工号": r["code"], "姓名": r["name"], "角色": ROLE_TEXT.get(r["role"], r["role"]),
            "技能": r["skill_level"], "认证": r["cert_level"], "负荷": f"{r['workload']*100:.0f}%",
            "状态": STATUS_TEXT.get(r["status"], r["status"]),
        } for r in rows])
        st.dataframe(df, use_container_width=True, hide_index=True)
    with tab2:
        today = dt.date.today()
        shift_map = {1: "早班", 2: "中班", 3: "晚班"}
        date_range = st.date_input("查看日期", value=[today, today + dt.timedelta(days=2)],
                                    min_value=today, max_value=today + dt.timedelta(days=30))
        if isinstance(date_range, tuple) and len(date_range) == 2:
            d_start, d_end = date_range
            schedules = q("""SELECT sc.*, s.name AS staff_name, s.cert_level AS cert, z.name AS zone_name, sh.name AS shift_name
                              FROM schedules sc JOIN staff s ON s.id=sc.staff_id
                              JOIN shifts sh ON sh.id=sc.shift_id
                              LEFT JOIN zones z ON z.id=sc.zone_id
                              WHERE sc.work_date BETWEEN ? AND ?
                              ORDER BY sc.work_date, sc.shift_id""",
                          (d_start.strftime("%Y-%m-%d"), d_end.strftime("%Y-%m-%d")))
            for s in schedules:
                st.markdown(f"📅 **{s['work_date']}**　{shift_map[s['shift_id']]}　"
                            f"👤 {s['staff_name']}（{s['cert']}证）　📍 {s['zone_name']}　"
                            f"<span style='color:#64748b'>{STATUS_TEXT.get(s['status'])}</span>",
                            unsafe_allow_html=True)
        else:
            st.info("请选择日期区间")


# ======================================================================
# M06 AI 视觉巡检
# ======================================================================
def page_ai(user):
    tab1, tab2, tab3 = st.tabs(["上传识别", "样本体验", "识别档案"])

    with tab1:
        up = st.file_uploader("📷 上传洁净面照片", type=["jpg", "jpeg", "png"])
        zone_opt = {z["id"]: z["name"] for z in q("SELECT * FROM zones")}
        zid = st.selectbox("关联区域（可选）", [None] + list(zone_opt.keys()),
                           format_func=lambda k: (zone_opt.get(k, "") + "（不关联）") if k else "不关联")
        if up and st.button("🧠 开始识别", type="primary"):
            with st.spinner("HSV 双通道阈值 → 形态学去噪 → 轮廓分析..."):
                try:
                    det = detect_contamination(up.getvalue(), up.name)
                except ValueError as e:
                    st.error(str(e)); st.stop()
            col1, col2 = st.columns([1.2, 1])
            col1.image(det["annotated_b64"], caption=f"标注图 · 检出 {det['stain_count']} 处")
            g_rule = {"A": ("#059669", "洁净"), "B": ("#0891b2", "基本洁净"),
                      "C": ("#d97706", "轻度污染"), "D": ("#e11d48", "重度污染")}[det["grade"]]
            col2.metric("洁净面等级", f"{det['grade']} · {g_rule[1]}")
            col2.metric("污渍覆盖率", f"{det['coverage']}%")
            col2.metric("检出污渍", det["stain_count"])
            if det["grade"] == "D" or det["coverage"] > 5:
                st.error(f"⚠ 等级 D / 覆盖率 {det['coverage']}%，已自动生成报警单")
            else:
                st.success(f"✔ 未触发报警阈值，识别记录已归档")

    with tab2:
        samples = sorted([f for f in os.listdir(SAMPLE_DIR) if f.endswith((".jpg", ".jpeg", ".png"))])
        sample = st.selectbox("选择内置样本", samples,
                              format_func=lambda f: {"sample_floor_01.jpg": "地板·少量污渍",
                                                     "sample_floor_02.jpg": "地板·重度污染",
                                                     "sample_wall_01.jpg": "墙面·试剂痕迹",
                                                     "sample_table_01.jpg": "台面·颗粒残留"}.get(f, f))
        col1, col2 = st.columns([1, 1.2])
        col1.image(os.path.join(SAMPLE_DIR, sample), caption="原始样本")
        if st.button("⚡ 执行识别", type="primary"):
            bytes_ = open(os.path.join(SAMPLE_DIR, sample), "rb").read()
            with st.spinner("识别中..."):
                det = detect_contamination(bytes_, sample)
            col2.image(det["annotated_b64"], caption=f"标注 · {det['stain_count']}污渍 · {det['coverage']}%")
            g_rule = {"A": ("#059669", "洁净"), "B": ("#0891b2", "基本洁净"),
                      "C": ("#d97706", "轻度污染"), "D": ("#e11d48", "重度污染")}[det["grade"]]
            st.markdown(f"**等级**：<span style='color:{g_rule[0]};font-size:22px;font-weight:700'>"
                        f"{det['grade']}</span>　{g_rule[1]}　**覆盖率 {det['coverage']}%**　**污渍 {det['stain_count']} 处**",
                        unsafe_allow_html=True)

    with tab3:
        rows = q("SELECT * FROM ai_detections ORDER BY id DESC LIMIT 20")
        if not rows:
            st.info("暂无识别记录")
        for r in rows:
            g_rule = {"A": "#059669", "B": "#0891b2", "C": "#d97706", "D": "#e11d48"}[r["grade"]]
            st.markdown(f"**{r['code']}**　"
                        f"<span style='color:{g_rule};font-weight:700'>{r['grade']}级</span>　"
                        f"{r['filename']}　污渍 {r['stain_count']} · 覆盖率 {r['coverage']}%　"
                        f"<span style='color:#94a3b8'>{r['created_at']}</span>", unsafe_allow_html=True)


# ======================================================================
# M07 物料耗材
# ======================================================================
def page_materials(user):
    tab1, tab2 = st.tabs(["库存货架", "领用审批"])
    with tab1:
        mats = q("SELECT * FROM materials ORDER BY id")
        df = pd.DataFrame([{
            "编号": m["code"], "名称": m["name"], "类别": {"consumable": "耗材", "reagent": "试剂", "tool": "工装"}[m["category"]],
            "库存": f"{m['stock']}{m['unit']}", "安全线": f"{m['safety_stock']}{m['unit']}",
            "单价": f"¥{m['price']:.1f}", "货位": m["location"],
        } for m in mats])
        st.dataframe(df, use_container_width=True, hide_index=True)
        st.divider()
        col1, col2 = st.columns(2)
        with col1:
            st.subheader("📤 申请领料")
            mat = st.selectbox("物料", mats, format_func=lambda m: f"{m['code']} {m['name']}（余{m['stock']}{m['unit']}）")
            qty = st.number_input("数量", min_value=1, max_value=int(mat["stock"] or 1), step=1)
            reason = st.text_input("用途")
            if st.button("提交申请", type="primary"):
                try:
                    code = "RQ-" + dt.datetime.now().strftime("%H%M%S%f")[:12]
                    get_conn().execute("BEGIN")
                    get_conn().execute(
                        "INSERT INTO material_requests(code,material_id,quantity,applicant_id,status,reason) "
                        "VALUES (?,?,?,?,?,'pending')",
                        (code, mat["id"], qty, user["id"], reason))
                    get_conn().commit()
                    st.success(f"领用单 {code} 已提交，等待审批")
                except Exception as e:
                    get_conn().rollback(); st.error(str(e))

    with tab2:
        if user["role"] not in ("leader", "dispatcher"):
            st.warning("领用审批权限：洁净班长 / 调度工程师")
            return
        reqs = q("""SELECT r.*, m.name AS mat_name, m.unit, m.stock AS cur_stock,
                     u.real_name AS applicant_name
                     FROM material_requests r JOIN materials m ON m.id=r.material_id
                     LEFT JOIN users u ON u.id=r.applicant_id
                     ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.id DESC""")
        for r in reqs:
            with st.container(border=True):
                st.markdown(f"**{r['code']}**　{r['mat_name']}　"
                            f"<span style='float:right'>{STATUS_TEXT.get(r['status'])}</span>", unsafe_allow_html=True)
                st.caption(f"申请人 {r['applicant_name']}　申领 {r['quantity']}{r['unit']}　"
                           f"当前库存 {r['cur_stock']}{r['unit']}　原因：{r['reason'] or '—'}")
                if r["status"] == "pending":
                    c1, c2 = st.columns(2)
                    if c1.button("✅ 批准", key=f"ap_{r['id']}", type="primary"):
                        try: approve_request(r["id"], user, approve=True); st.success("批准并扣库"); st.rerun()
                        except BizError as e: st.error(str(e.msg))
                    if c2.button("❌ 驳回", key=f"rj_{r['id']}"):
                        try: approve_request(r["id"], user, approve=False); st.success("已驳回"); st.rerun()
                        except BizError as e: st.error(str(e.msg))


# ======================================================================
# M08 质量验收
# ======================================================================
def page_quality(user):
    METHOD_NAME = {"particle": "粒子计数", "atp": "ATP荧光",
                   "settle_plate": "沉降菌", "surface": "表面残留"}
    METHOD_UNIT = {"particle": "个/m³", "atp": "RLU",
                   "settle_plate": "CFU/皿", "surface": "μg/cm²"}
    DEFAULT_STD = {"atp": 50.0, "settle_plate": 1.0, "surface": 2.5}

    tab1, tab2, tab3 = st.tabs(["验收工作台", "判定规则台", "合格率透视"])

    with tab1:
        colF, colL = st.columns([1, 2])
        with colF:
            concl = st.multiselect("结论", ["pending", "pass", "fail"], default=["pending", "pass", "fail"],
                                    format_func=lambda x: {"pending": "待检", "pass": "合格", "fail": "不合格"}[x])
            status = st.multiselect("状态", sorted(set(STATUS_TEXT.values())))
        with colL:
            insps = q("""SELECT i.*, z.name AS zone_name, z.target_particles AS zone_limit,
                                  t.code AS task_code, u.real_name AS insp_name
                         FROM inspections i JOIN zones z ON z.id=i.zone_id
                         LEFT JOIN tasks t ON t.id=i.task_id
                         LEFT JOIN users u ON u.id=i.inspector_id""")
            if concl: insps = [x for x in insps if x["conclusion"] in concl]
            if status: insps = [x for x in insps if STATUS_TEXT.get(x["status"]) in status]
            for i in insps:
                st.markdown("---")
                st.markdown(f"**{i['code']}** {METHOD_NAME.get(i['method'],i['method'])} · "
                            f"{i['zone_name']}　结论：**{STATUS_TEXT.get(i['conclusion'],'')}**　"
                            f"状态：{STATUS_TEXT.get(i['status'],'')}")
                st.caption(f"标准 ≤ {i['standard']} {METHOD_UNIT.get(i['method'],'')}　"
                           f"实测 {i['result_value']}　任务 {i['task_code'] or '抽检单'}　"
                           f"质检员 {i['insp_name']}")

    with tab2:
        st.subheader("📐 判定规则演示（纯前端，不入库）")
        c1, c2, c3 = st.columns(3)
        method = c1.selectbox("方法", list(METHOD_NAME.keys()),
                               format_func=lambda k: METHOD_NAME[k])
        zones = q("SELECT * FROM zones ORDER BY id")
        zid = c2.selectbox("区域（粒子法）", [z["id"] for z in zones],
                            format_func=lambda k: next(f"ISO{z['iso_class']} · {z['name']}"
                                                       for z in zones if z["id"] == k))
        std = zones[zid - 1]["target_particles"] if method == "particle" else DEFAULT_STD[method]
        val = c3.number_input("模拟实测值", value=0.0)
        concl = judge_inspection(method, val, std)
        color = {"pass": "#059669", "fail": "#e11d48"}[concl]
        st.markdown(f"**判定结果**：<span style='color:{color};font-size:32px;font-weight:800'>"
                    f"{'✔ 合格 (PASS)' if concl == 'pass' else '✖ 不合格 (FAIL)'}</span>",
                    unsafe_allow_html=True)
        st.caption(f"{METHOD_NAME[method]} ≤ {std} {METHOD_UNIT.get(method,'')}　实测 {val} → {concl}")

    with tab3:
        st.subheader("📈 合格率透视")
        rows = q("SELECT method, conclusion FROM inspections WHERE conclusion != 'pending'")
        if not rows:
            st.info("暂无已判定验收单")
        else:
            pass_total = sum(1 for r in rows if r["conclusion"] == "pass")
            st.metric("一次验收合格率", f"{pass_total/len(rows)*100:.1f}%",
                      help=f"共 {len(rows)} 单，合格 {pass_total}")
            st.caption(f"已判定 {len(rows)} 单 · 合格 {pass_total} · 不合格 {len(rows) - pass_total}")


# ======================================================================
# M09 设备设施
# ======================================================================
def page_equipment(user):
    tab1, tab2 = st.tabs(["设备台账", "状态机切换"])
    with tab1:
        etypes = {"ffu": "风机过滤单元", "air_shower": "风淋室",
                  "pass_box": "传递窗", "ahu": "空调机组", "hepa": "高效过滤器"}
        eqs = q("""SELECT e.*, z.name AS zone_name
                   FROM equipment e LEFT JOIN zones z ON z.id=e.zone_id ORDER BY e.id""")
        df = pd.DataFrame([{
            "编号": e["code"], "名称": e["name"], "类型": etypes.get(e["etype"], e["etype"]),
            "区域": e["zone_name"], "状态": STATUS_TEXT.get(e["status"]),
            "运行时长": f"{e['run_hours']:.0f}h", "上次保养": e["last_maint"] or "从未",
        } for e in eqs])
        st.dataframe(df, use_container_width=True, hide_index=True)
    with tab2:
        etype_color = {"running": "#059669", "stopped": "#64748b",
                       "maintenance": "#d97706", "fault": "#e11d48"}
        FLOW = {"running": ["stopped", "maintenance", "fault"],
                "stopped": ["running", "maintenance", "fault"],
                "maintenance": ["running", "stopped"],
                "fault": ["maintenance", "stopped"]}
        eq_opt = {e["id"]: e for e in q("SELECT * FROM equipment ORDER BY id")}
        eid = st.selectbox("选设备", list(eq_opt.keys()),
                            format_func=lambda k: f"{eq_opt[k]['code']} · {eq_opt[k]['name']}  "
                                                  f"[{STATUS_TEXT.get(eq_opt[k]['status'])}]")
        e = eq_opt[eid]
        st.markdown(f"**当前状态**：<span style='color:{etype_color[e['status']]};font-weight:700'>"
                    f"{STATUS_TEXT.get(e['status'])}</span>", unsafe_allow_html=True)
        legal = FLOW.get(e["status"], [])
        if legal:
            nxt = st.selectbox("目标状态", [STATUS_TEXT.get(x) + " · " + x for x in legal],
                                format_func=lambda s: s)
            nxt_raw = nxt.split(" · ")[1]
            if st.button("执行状态切换", type="primary"):
                try:
                    # 直接调 SQL（Flask 路由里的状态规则简化版）
                    if e["status"] == "fault" and nxt_raw != "maintenance":
                        st.error("故障设备必须先转入保养中维修，不能直接恢复运行"); st.stop()
                    get_conn().execute("UPDATE equipment SET status=? WHERE id=?", (nxt_raw, eid))
                    get_conn().commit()
                    # ISO6 区域 FFU 冗余检查
                    zones_row = q("SELECT * FROM zones WHERE id=?", (e.get("zone_id"),), one=True)
                    if zones_row and zones_row["iso_class"] <= 6 and e["etype"] == "ffu" and nxt_raw in ("stopped", "maintenance"):
                        running_cnt = q("SELECT COUNT(*) c FROM equipment WHERE zone_id=? AND etype='ffu' AND status='running'",
                                         (e["zone_id"],), one=True)["c"]
                        if running_cnt < 2:
                            get_conn().rollback()
                            st.error(f"ISO{zones_row['iso_class']} 区域 FFU 至少保持 2 台运行，当前仅 {running_cnt} 台，拦截操作")
                            st.stop()
                    if nxt_raw == "running" and e["status"] == "maintenance":
                        get_conn().execute("UPDATE equipment SET run_hours=0, last_maint=datetime('now','localtime') WHERE id=?", (eid,))
                        get_conn().commit()
                    st.success(f"状态切换成功：{STATUS_TEXT.get(e['status'])} → {STATUS_TEXT.get(nxt_raw)}")
                    st.rerun()
                except Exception as err:
                    st.error(str(err))
        else:
            st.info("当前状态已是终态")


# ======================================================================
# M10 报警中心
# ======================================================================
def page_alarms(user):
    level_opt = {"critical": "🔴 紧急", "major": "🟠 重要", "minor": "🔵 一般"}
    status_opt = {"open": "待处理", "processing": "处理中",
                  "resolved": "已解决", "ignored": "已忽略"}
    st.markdown("### 🗺 活跃报警沙盘")
    alarms_map = q("""SELECT a.*, z.name AS zone_name
                       FROM alarms a JOIN zones z ON z.id=a.zone_id
                       WHERE a.status IN ('open','processing')
                       ORDER BY CASE a.level WHEN 'critical' THEN 0
                                            WHEN 'major' THEN 1 ELSE 2 END""")
    if not alarms_map:
        st.success("全域无活跃报警 ✅")
    for a in alarms_map:
        with st.container(border=True):
            col_map = {"critical": "#e11d48", "major": "#f59e0b", "minor": "#06b6d4"}
            st.markdown(f"<span style='color:{col_map.get(a['level'],'#64748b')};font-size:22px'>●</span> "
                        f"**{level_opt.get(a['level'])}** {a['title']}　📍 {a['zone_name']}　"
                        f"<span style='color:#94a3b8'>{a['code']}</span>",
                        unsafe_allow_html=True)
            st.caption(a["detail"] or "")
            if a["status"] == "open":
                if st.button("🎛 接手处理", key=f"apr_{a['id']}"):
                    try: handle_alarm(a["id"], user, "process"); st.success("已接手"); st.rerun()
                    except BizError as e: st.error(str(e.msg))
            if a["status"] == "processing":
                c1, c2 = st.columns(2)
                note = st.text_input("处置备注（忽略必须填原因）", key=f"note_{a['id']}")
                if c1.button("✔ 标记解决", key=f"rs_{a['id']}"):
                    try:
                        handle_alarm(a["id"], user, "resolve", note)
                        st.success("报警已解决，区域状态已恢复常态"); st.rerun()
                    except BizError as e: st.error(str(e.msg))
                if c2.button("🚫 忽略", key=f"ig_{a['id']}"):
                    if not note: st.error("忽略报警必须填写原因备注")
                    else:
                        try: handle_alarm(a["id"], user, "ignore", note); st.success("已忽略"); st.rerun()
                        except BizError as e: st.error(str(e.msg))
    st.divider()
    st.markdown("### 📊 处置统计")
    cnt_by = {}
    for a in q("SELECT level FROM alarms"):
        cnt_by[a["level"]] = cnt_by.get(a["level"], 0) + 1
    st.metric("总报警", sum(cnt_by.values()))
    st.caption("按等级：" + "　".join(f"{level_opt.get(k,'')} {v}" for k, v in cnt_by.items()))


# ======================================================================
# M11 智能分析
# ======================================================================
def page_analytics(user):
    zones = q("SELECT * FROM zones ORDER BY id")
    zone_id = st.selectbox("选区域做趋势预测", [z["id"] for z in zones],
                            format_func=lambda k: f"{next(z['name'] for z in zones if z['id']==k)} "
                                                  f"· ISO{next(z['iso_class'] for z in zones if z['id']==k)}")

    # 读历史粒子读数
    readings = q("""SELECT r.value FROM sensor_readings r
                    JOIN sensors s ON s.id=r.sensor_id
                    WHERE s.zone_id=? AND s.stype='particle'
                    ORDER BY r.recorded_at ASC LIMIT 48""", (zone_id,))
    pairs = list(enumerate([r["value"] for r in readings]))
    if len(readings) < 6:
        st.warning("该区域历史读数不足 6 条，跳过趋势预测")
    else:
        z = next(z for z in zones if z["id"] == zone_id)
        pred = predict_particle_trend(pairs, horizon=12)
        risk = zone_risk_assessment(z, float(np.mean([r["value"] for r in readings])))
        lv = {"normal": ("🟢 正常", "#059669"), "warning": ("🟡 预警", "#d97706"),
              "critical": ("🔴 超标", "#e11d48")}[risk["level"]]
        st.metric("风险等级", lv[0], f"均值/限值 = {risk['ratio']*100:.0f}%")
        st.info(risk["advice"])
        if pred.get("peak"):
            st.caption(f"未来预测峰值：**{pred['peak']:.0f} 个/m³**　预测次数 {len(pred['points'])}　"
                       f"拟合系数 {pred['coef']}")
        # 拼接实测 + 预测
        hist_vals = [r["value"] for r in readings]
        fut_vals = [p["value"] for p in pred["points"]]
        future_lim = [z["target_particles"]] * len(fut_vals)
        df = pd.DataFrame({"实测": hist_vals + [None] * len(fut_vals),
                           "预测": [None] * len(hist_vals) + fut_vals,
                           "ISO限值": future_lim})
        st.line_chart(df, use_container_width=True)

    # ---- 建议引擎 ----
    st.divider(); st.markdown("### 🧭 智能建议")
    cnts = {
        "open_alarm": q("SELECT COUNT(*) c FROM alarms WHERE status IN ('open','processing')", one=True)["c"],
        "fault_robot": q("SELECT COUNT(*) c FROM robots WHERE status='fault'", one=True)["c"],
        "mat_low": q("SELECT COUNT(*) c FROM materials WHERE stock<safety_stock AND safety_stock>0", one=True)["c"],
    }
    sugg = []
    if cnts["fault_robot"] > 0:
        sugg.append(("🟠", "机器人故障需安排维修或换备机", "调度工程师"))
    if cnts["open_alarm"] >= 2:
        sugg.append(("🟠", "未结报警超过 2 条，建议班长介入督办", "洁净班长"))
    if cnts["mat_low"] > 0:
        sugg.append(("🔴", f"{cnts['mat_low']} 种物料跌破安全线，建议走补货流程", "调度工程师"))
    if pred.get("peak", 0) > z["target_particles"]:
        sugg.append(("🟠", f"预测峰值 {pred['peak']:.0f} 破 ISO 限值 {z['target_particles']}，建议提前安排深度保洁", "洁净班长"))
    if not sugg:
        sugg.append(("🟢", "全域无异常，维持例行保洁即可", "—"))
    for ic, text, role in sugg:
        st.markdown(f"{ic} **{text}**　<span style='color:#64748b'>· 建议 {role} 处理</span>", unsafe_allow_html=True)


if __name__ == "__main__":
    run()
