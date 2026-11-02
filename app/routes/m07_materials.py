# -*- coding: utf-8 -*-
"""物料耗材（菜单7）：库存台账 + 领用审批流。

库存扣减只发生在 rules.approve_request 的事务里，这层绝不自己写
stock-quantity —— 审批和扣库之间一旦留缝，演示时两个窗口同时点
"批准"就能把库存扣成负数，这种低级 bug 最丢分。
"""
import datetime
import functools
from flask import Blueprint, current_app, g, jsonify, request

from ..db import get_conn, q
from ..rules import BizError, STATUS_TEXT, approve_request

bp = Blueprint("materials", __name__, url_prefix="/api/materials")


def auth_required(fn):
    """蓝图是在 create_app() 里 import 的，装饰器求值那一刻 app 还没绑定到
    current_app，直接写 @auth_required 会在启动时就抛
    "Working outside of application context"。包一层，把取值推迟到请求进来时。"""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return current_app.auth_required(fn)(*args, **kwargs)
    return wrapper


def _next_code(conn, table, prefix):
    """编号续号：扫出现有最大数字部分 +1。
    单机演示够用了，真撞号有 UNIQUE 约束兜底，不会写脏数据。"""
    rows = conn.execute(f"SELECT code FROM {table} WHERE code LIKE ?", (prefix + "-%",)).fetchall()
    seq = 0
    for r in rows:
        tail = r["code"].split("-", 1)[1]
        if tail.isdigit():
            seq = max(seq, int(tail))
    return f"{prefix}-{seq + 1:03d}"


@bp.get("/list")
@auth_required
def material_list():
    """库存列表。stock_state 是给前端红黄绿徽标用的，
    跌破安全线就是 low，采购看这一列就知道该补什么货。"""
    rows = q("SELECT * FROM materials ORDER BY id")
    for r in rows:
        r["stock_state"] = "low" if r["stock"] < r["safety_stock"] else "ok"
    return jsonify({"ok": True, "data": rows})


@bp.post("/create")
@auth_required
def create():
    d = request.get_json(force=True)
    name = (d.get("name") or "").strip()
    if not name:
        raise BizError("物料名称不能为空")
    conn = get_conn()
    try:
        code = _next_code(conn, "materials", "MT")
        cur = conn.execute(
            """INSERT INTO materials(code,name,category,unit,stock,safety_stock,price,location)
               VALUES (?,?,?,?,?,?,?,?)""",
            (code, name, d.get("category") or "consumable", d.get("unit") or "个",
             float(d.get("stock") or 0), float(d.get("safety_stock") or 0),
             float(d.get("price") or 0), d.get("location") or ""))
        conn.commit()
        return jsonify({"ok": True, "msg": f"已建档，编号 {code}",
                        "data": q("SELECT * FROM materials WHERE id=?", (cur.lastrowid,), one=True)})
    finally:
        conn.close()


@bp.put("/<int:mid>")
@auth_required
def update(mid):
    """盘点式调整：允许直接改 stock（月底盘库场景）。
    注意这跟"领用消耗"是两个入口，消耗必须走审批流，别混。"""
    d = request.get_json(force=True)
    if not q("SELECT id FROM materials WHERE id=?", (mid,), one=True):
        raise BizError("物料不存在", 404)
    fields, args = [], []
    for col in ("name", "stock", "safety_stock", "price", "location"):
        if d.get(col) is not None:
            fields.append(f"{col}=?")
            args.append(d[col])
    if not fields:
        raise BizError("没有需要修改的字段")
    conn = get_conn()
    conn.execute(f"UPDATE materials SET {', '.join(fields)} WHERE id=?", args + [mid])
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "msg": "已更新",
                    "data": q("SELECT * FROM materials WHERE id=?", (mid,), one=True)})


@bp.delete("/<int:mid>")
@auth_required
def remove(mid):
    """有待审批领用单的不许删——删了单就成孤儿，审批人点批准时会查不到物料。"""
    pend = q("SELECT COUNT(*) c FROM material_requests WHERE material_id=? AND status='pending'",
             (mid,), one=True)["c"]
    if pend:
        raise BizError(f"该物料还有 {pend} 张待审批的领用单，请先处理完再删除")
    conn = get_conn()
    res = conn.execute("DELETE FROM materials WHERE id=?", (mid,))
    conn.commit()
    conn.close()
    if res.rowcount == 0:
        raise BizError("物料不存在", 404)
    return jsonify({"ok": True, "msg": "已删除"})


@bp.get("/requests")
@auth_required
def request_list():
    """领用单列表：申请人/审批人都翻成实名，前端不用二次查用户表。"""
    rows = q("""SELECT r.*, m.name AS material_name, m.unit,
                       ua.real_name AS applicant_name, ub.real_name AS approver_name
                FROM material_requests r
                JOIN materials m ON m.id = r.material_id
                LEFT JOIN users ua ON ua.id = r.applicant_id
                LEFT JOIN users ub ON ub.id = r.approver_id
                ORDER BY r.id DESC""")
    for r in rows:
        r["status_text"] = STATUS_TEXT.get(r["status"], r["status"])
    return jsonify({"ok": True, "data": rows})


@bp.post("/requests")
@auth_required
def request_create():
    """申请领用。这里只守"库存>0"这条底线，"够不够发"留给审批人判断——
    超领被驳回也是正常业务，不该在申请环节就堵死。"""
    d = request.get_json(force=True)
    mat = q("SELECT * FROM materials WHERE id=?", (d.get("material_id"),), one=True)
    if not mat:
        raise BizError("物料不存在", 404)
    qty = float(d.get("quantity") or 0)
    if qty <= 0:
        raise BizError("领用数量必须大于 0")
    if mat["stock"] <= 0:
        raise BizError(f"{mat['name']} 库存已为 0，请先通知采购补货")
    conn = get_conn()
    try:
        code = _next_code(conn, "material_requests", "RQ")
        cur = conn.execute(
            """INSERT INTO material_requests(code,material_id,quantity,applicant_id,reason)
               VALUES (?,?,?,?,?)""",
            (code, mat["id"], qty, g.user["id"], d.get("reason") or ""))
        conn.commit()
        return jsonify({"ok": True, "msg": f"领用申请 {code} 已提交，等待审批",
                        "data": q("SELECT * FROM material_requests WHERE id=?", (cur.lastrowid,), one=True)})
    finally:
        conn.close()


@bp.post("/requests/<int:rid>/approve")
@auth_required
def request_approve(rid):
    """批准/驳回。角色校验、状态机、扣库事务全在 rules 里，
    这层只把结果包装成前端要的话术——批准时带上剩余库存，弹窗更有说服力。"""
    approve = bool(request.get_json(force=True).get("approve", True))
    row = approve_request(rid, g.user, approve)
    if approve:
        mat = q("SELECT name,stock,unit FROM materials WHERE id=?", (row["material_id"],), one=True)
        msg = f"已批准，{mat['name']} 剩余库存 {mat['stock']}{mat['unit']}"
    else:
        msg = "已驳回该领用申请"
    return jsonify({"ok": True, "data": row, "msg": msg})


@bp.get("/stats")
@auth_required
def stats():
    """看板三件套：各类别存货总值、低于安全线清单、本月已批领用金额。
    月消耗按 approved_at 归月——驳回的单不算钱，pending 的也先不算。"""
    by_cat = q("""SELECT category, ROUND(SUM(stock * price), 2) AS value
                  FROM materials GROUP BY category ORDER BY value DESC""")
    low = q("""SELECT code,name,stock,safety_stock,unit FROM materials
               WHERE stock < safety_stock ORDER BY (safety_stock - stock) DESC""")
    month = datetime.datetime.now().strftime("%Y-%m")
    consume = q("""SELECT COALESCE(SUM(r.quantity * m.price), 0) AS total
                   FROM material_requests r JOIN materials m ON m.id = r.material_id
                   WHERE r.status = 'approved' AND substr(r.approved_at, 1, 7) = ?""",
                (month,), one=True)
    return jsonify({"ok": True, "data": {
        "by_category": by_cat, "low_list": low,
        "month_consume": round(consume["total"], 2)}})
