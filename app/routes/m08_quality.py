# -*- coding: utf-8 -*-
"""质量验收（菜单8）：质检员开单 → 提交实测值 → 自动判结论 → 复核 → 联动任务。

四种验收方法全是"越小越好"（粒子/ATP/沉降菌/表面残留），所以判定
收敛在 rules.judge_inspection 一处。将来要加"越大越好"的指标，
只改那一处，路由不用跟着动。
"""
import functools
from flask import Blueprint, current_app, g, jsonify, request

from ..db import get_conn, q
from ..rules import BizError, STATUS_TEXT, review_inspection, submit_inspection

bp = Blueprint("quality", __name__, url_prefix="/api/quality")


def auth_required(fn):
    """蓝图是在 create_app() 里 import 的，装饰器求值那一刻 app 还没绑定到
    current_app，直接写 @auth_required 会在启动时就抛
    "Working outside of application context"。包一层，把取值推迟到请求进来时。"""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return current_app.auth_required(fn)(*args, **kwargs)
    return wrapper

CONCLUSION_TEXT = {"pass": "合格", "fail": "不合格", "pending": "待检"}

# 验收方法档案：单位写死在这里，新建单据时前端跟着方法带出单位与默认标准
METHODS = [
    {"key": "particle",     "name": "粒子计数", "unit": "个/m³",  "desc": "≥0.5μm 悬浮粒子浓度"},
    {"key": "atp",          "name": "ATP荧光",  "unit": "RLU",    "desc": "三磷酸腺苷残留，反映有机物污染"},
    {"key": "settle_plate", "name": "沉降菌",   "unit": "CFU/皿", "desc": "沉降法微生物采样"},
    {"key": "surface",      "name": "表面残留", "unit": "μg/cm²", "desc": "表面化学残留擦拭法"},
]

# 各方法的兜底判定标准；particle 例外——跟着区域 ISO 等级走，不能写死
DEFAULT_STANDARD = {"atp": 50.0, "settle_plate": 1.0, "surface": 2.5}


def _next_qc(conn):
    rows = conn.execute("SELECT code FROM inspections WHERE code LIKE 'QC-%'").fetchall()
    seq = 0
    for r in rows:
        tail = r["code"].split("-", 1)[1]
        if tail.isdigit():
            seq = max(seq, int(tail))
    return f"QC-{seq + 1:03d}"


@bp.get("/list")
@auth_required
def insp_list():
    """验收单列表，可按结论过滤。关联任务用 LEFT JOIN——
    抽检单（不挂任务的）也得能显示。"""
    conclusion = request.args.get("conclusion", "")
    sql = """SELECT i.*, z.name AS zone_name, u.real_name AS inspector_name, t.code AS task_code
             FROM inspections i
             JOIN zones z ON z.id = i.zone_id
             LEFT JOIN users u ON u.id = i.inspector_id
             LEFT JOIN tasks t ON t.id = i.task_id"""
    args = []
    if conclusion in CONCLUSION_TEXT:
        sql += " WHERE i.conclusion = ?"
        args.append(conclusion)
    sql += " ORDER BY i.id DESC"
    rows = q(sql, args)
    for r in rows:
        r["status_text"] = STATUS_TEXT.get(r["status"], r["status"])
        r["conclusion_text"] = CONCLUSION_TEXT.get(r["conclusion"], r["conclusion"])
    return jsonify({"ok": True, "data": rows})


@bp.get("/methods")
@auth_required
def methods():
    return jsonify({"ok": True, "data": METHODS})


@bp.get("/pending-tasks")
@auth_required
def pending_tasks():
    """新建验收单的任务下拉：只有"待验收"状态的任务能挂。
    别的状态挂了也对不上联动逻辑，干脆不列。"""
    rows = q("""SELECT id, code, title, zone_id FROM tasks
                WHERE status = 'awaiting_inspection' ORDER BY id DESC""")
    return jsonify({"ok": True, "data": rows})


@bp.post("/create")
@auth_required
def create():
    """开验收单（草稿）。standard 不传就按方法给默认：
    粒子用区域的 ISO 限值，其余走 DEFAULT_STANDARD 表。"""
    d = request.get_json(force=True)
    zone = q("SELECT * FROM zones WHERE id=?", (d.get("zone_id"),), one=True)
    if not zone:
        raise BizError("区域不存在", 404)
    method = d.get("method") or "particle"
    if method not in {m["key"] for m in METHODS}:
        raise BizError("未知的验收方法")
    task_id = d.get("task_id")
    if task_id:
        t = q("SELECT status, code FROM tasks WHERE id=?", (task_id,), one=True)
        if not t:
            raise BizError("关联任务不存在", 404)
        if t["status"] != "awaiting_inspection":
            raise BizError(f"任务 {t['code']} 当前不是「待验收」状态，不能关联验收单")
    standard = d.get("standard")
    if standard is None:
        standard = zone["target_particles"] if method == "particle" else DEFAULT_STANDARD[method]
    conn = get_conn()
    try:
        code = _next_qc(conn)
        cur = conn.execute(
            """INSERT INTO inspections(code,task_id,zone_id,method,standard,status)
               VALUES (?,?,?,?,?,'draft')""",
            (code, task_id, zone["id"], method, float(standard)))
        conn.commit()
        return jsonify({"ok": True, "msg": f"验收单 {code} 已创建（草稿）",
                        "data": q("SELECT * FROM inspections WHERE id=?", (cur.lastrowid,), one=True)})
    finally:
        conn.close()


@bp.post("/<int:iid>/submit")
@auth_required
def submit(iid):
    """提交实测值。质检是质量红线，保洁员不许自己验自己的活——
    角色不对直接 403，别进 rules 浪费一次状态机检查。"""
    if g.user["role"] not in ("inspector", "leader"):
        raise BizError("只有质检员/洁净班长能提交验收数据", 403)
    d = request.get_json(force=True)
    if d.get("result_value") is None:
        raise BizError("实测值不能为空")
    row, conclusion = submit_inspection(iid, g.user, d.get("result_value"), d.get("note") or "")
    row["conclusion_text"] = CONCLUSION_TEXT[conclusion]
    return jsonify({"ok": True, "data": row,
                    "msg": f"已提交，自动判定结论：{CONCLUSION_TEXT[conclusion]}"})


@bp.post("/<int:iid>/review")
@auth_required
def review(iid):
    """复核。批准且合格 → 关联任务转 passed；不合格 → 打回 failed 返工。
    task_changed 有值就说明发生了联动，msg 里把任务号点出来。"""
    approve = bool(request.get_json(force=True).get("approve", True))
    row, task_changed = review_inspection(iid, g.user, approve)
    if not approve:
        msg = "已驳回，验收单打回待重新提交"
    elif task_changed and row["task_id"]:
        t = q("SELECT code FROM tasks WHERE id=?", (row["task_id"],), one=True)
        msg = f"复核通过，任务{t['code']}已转为「{STATUS_TEXT[task_changed]}」"
    else:
        msg = "复核通过（无关联任务联动）"
    return jsonify({"ok": True, "data": {"inspection": row, "task_changed": task_changed},
                    "msg": msg})


@bp.delete("/<int:iid>")
@auth_required
def remove(iid):
    """只有草稿能删。提交过的单是质量记录，删了追溯链就断了。"""
    row = q("SELECT status FROM inspections WHERE id=?", (iid,), one=True)
    if not row:
        raise BizError("验收单不存在", 404)
    if row["status"] != "draft":
        raise BizError(f"验收单已「{STATUS_TEXT[row['status']]}」，质量记录不允许删除，仅草稿可删")
    conn = get_conn()
    conn.execute("DELETE FROM inspections WHERE id=?", (iid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "msg": "草稿已删除"})


@bp.get("/stats")
@auth_required
def stats():
    """合格率只统计已出结论的单（pending 的草稿不该拉低分母）。"""
    rows = q("SELECT method, conclusion FROM inspections WHERE conclusion != 'pending'")
    total = len(rows)
    passed = sum(1 for r in rows if r["conclusion"] == "pass")
    by_method = {}
    for m in METHODS:
        sub = [r for r in rows if r["method"] == m["key"]]
        by_method[m["key"]] = {"送检数": len(sub),
                               "合格数": sum(1 for r in sub if r["conclusion"] == "pass")}
    recent_fail = q("""SELECT i.code, i.method, i.result_value, i.standard,
                              z.name AS zone_name, i.created_at
                       FROM inspections i JOIN zones z ON z.id = i.zone_id
                       WHERE i.conclusion = 'fail' ORDER BY i.id DESC LIMIT 5""")
    return jsonify({"ok": True, "data": {
        "pass_rate": round(passed / total * 100, 1) if total else 0.0,
        "by_method": by_method, "recent_fail": recent_fail}})
