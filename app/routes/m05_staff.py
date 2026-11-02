# -*- coding: utf-8 -*-
"""M05 人员与排班：档案、班次、排班表、自动排班、技能矩阵。
自动排班核心规则：高技能优先去"任务多 + ISO 等级高"的区，ISO5/6 有 A 证硬门槛。
"""
import functools
import datetime
import sqlite3
from flask import Blueprint, jsonify, request, current_app

from ..db import get_conn, q
from ..rules import BizError

bp = Blueprint("staff", __name__, url_prefix="/api/staff")

VALID_STAFF_STATUS = ("idle", "busy", "leave")
VALID_CERTS = ("A", "B", "C")


def auth_required(fn):
    """import 期 current_app 未绑定，装饰器推迟到请求时再取（见 m01 同款坑）。"""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return current_app.auth_required(fn)(*args, **kwargs)
    return wrapper


@bp.get("/list")
@auth_required
def staff_list():
    """人员列表带班次，顺带把今天排到哪了也带上（没排就是 NULL）。"""
    rows = q("""
        SELECT s.*, sh.name AS shift_name, sh.color AS shift_color,
               sc.zone_id AS today_zone_id
        FROM staff s
        LEFT JOIN shifts sh ON sh.id = s.shift_id
        LEFT JOIN schedules sc ON sc.staff_id = s.id
              AND sc.work_date = date('now','localtime')
        ORDER BY s.id
    """)
    return jsonify({"ok": True, "data": rows})


@bp.post("/create")
@auth_required
def staff_create():
    """外聘/临时人员建档：只建 staff 档案，不开 users 登录账号。
    工号接现有最大号排，别用 COUNT+1（删过人就会撞号，踩过坑）。"""
    d = request.get_json(force=True)
    name = (d.get("name") or "").strip()
    role = d.get("role") or "cleaner"
    if not name:
        raise BizError("姓名不能为空")
    if role not in ("cleaner", "leader", "inspector", "dispatcher"):
        raise BizError("岗位角色不合法")
    try:
        skill = int(d.get("skill_level", 1))
    except (TypeError, ValueError):
        raise BizError("技能等级必须是 1~5 的整数")
    if not 1 <= skill <= 5:
        raise BizError("技能等级必须是 1~5 的整数")
    cert = d.get("cert_level") or "C"
    if cert not in VALID_CERTS:
        raise BizError("准入认证必须是 A/B/C")
    shift_id = d.get("shift_id")
    if shift_id and not q("SELECT 1 AS ok FROM shifts WHERE id=?", (shift_id,), one=True):
        raise BizError("班次不存在")
    row = q("SELECT MAX(CAST(SUBSTR(code,4) AS INTEGER)) AS m FROM staff", one=True)
    code = f"JY-{(row['m'] or 0) + 1:03d}"
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO staff(code,name,role,skill_level,cert_level,shift_id) VALUES (?,?,?,?,?,?)",
            (code, name, role, skill, cert, shift_id))
        conn.commit()
        return jsonify({"ok": True, "msg": f"已建档，工号 {code}",
                        "data": q("SELECT * FROM staff WHERE id=?", (cur.lastrowid,), one=True)})
    finally:
        conn.close()


@bp.put("/<int:sid>")
@auth_required
def staff_update(sid):
    d = request.get_json(force=True)
    if not q("SELECT 1 AS ok FROM staff WHERE id=?", (sid,), one=True):
        raise BizError("人员不存在", 404)
    sets, args = [], []
    if "skill_level" in d:
        try:
            skill = int(d["skill_level"])
        except (TypeError, ValueError):
            raise BizError("技能等级必须是 1~5 的整数")
        if not 1 <= skill <= 5:
            raise BizError("技能等级必须是 1~5")
        sets.append("skill_level=?"); args.append(skill)
    if "cert_level" in d:
        if d["cert_level"] not in VALID_CERTS:
            raise BizError("准入认证必须是 A/B/C")
        sets.append("cert_level=?"); args.append(d["cert_level"])
    if "shift_id" in d:
        if d["shift_id"] and not q("SELECT 1 AS ok FROM shifts WHERE id=?",
                                   (d["shift_id"],), one=True):
            raise BizError("班次不存在")
        sets.append("shift_id=?"); args.append(d["shift_id"])
    if "status" in d:
        if d["status"] not in VALID_STAFF_STATUS:
            raise BizError("状态仅支持 idle / busy / leave")
        sets.append("status=?"); args.append(d["status"])
    if not sets:
        raise BizError("没有可更新的字段")
    args.append(sid)
    conn = get_conn()
    conn.execute(f"UPDATE staff SET {', '.join(sets)} WHERE id=?", args)
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "data": q("SELECT * FROM staff WHERE id=?", (sid,), one=True),
                    "msg": "已保存"})


@bp.delete("/<int:sid>")
@auth_required
def staff_delete(sid):
    staff = q("SELECT * FROM staff WHERE id=?", (sid,), one=True)
    if not staff:
        raise BizError("人员不存在", 404)
    # 手上还有活的不能删，删了任务就成孤儿了
    busy = q("SELECT COUNT(*) AS c FROM tasks WHERE assignee_id=? AND status IN ('assigned','in_progress')",
             (sid,), one=True)["c"]
    if busy:
        raise BizError(f"{staff['name']} 还有 {busy} 个未完成任务，请先改派或完成")
    conn = get_conn()
    try:
        conn.execute("DELETE FROM staff WHERE id=?", (sid,))
        conn.commit()
    except sqlite3.IntegrityError:
        raise BizError("该人员存在历史任务记录，不允许删除，建议改为请假状态")
    finally:
        conn.close()
    return jsonify({"ok": True, "msg": f"人员 {staff['name']}（{staff['code']}）已删除"})


@bp.route("/shifts", methods=["GET", "POST"])
@auth_required
def shifts():
    """班次查/增放一起：同一条 URL 按方法分流，省一个函数壳。"""
    if request.method == "GET":
        return jsonify({"ok": True, "data": q("SELECT * FROM shifts ORDER BY id")})
    d = request.get_json(force=True)
    name = (d.get("name") or "").strip()
    if not name or not d.get("start_time") or not d.get("end_time"):
        raise BizError("班次名称、开始、结束时间都不能为空")
    conn = get_conn()
    try:
        cur = conn.execute("INSERT INTO shifts(name,start_time,end_time,color) VALUES (?,?,?,?)",
                           (name, d["start_time"], d["end_time"], d.get("color") or "#0ea5e9"))
        conn.commit()
        return jsonify({"ok": True, "msg": f"班次「{name}」已创建",
                        "data": q("SELECT * FROM shifts WHERE id=?", (cur.lastrowid,), one=True)})
    finally:
        conn.close()


@bp.get("/schedules")
@auth_required
def schedule_list():
    day = request.args.get("date") or datetime.date.today().strftime("%Y-%m-%d")
    rows = q("""
        SELECT sc.*, s.name AS staff_name, z.name AS zone_name, sh.name AS shift_name, sh.color AS shift_color
        FROM schedules sc
        JOIN staff s ON s.id = sc.staff_id
        LEFT JOIN zones z ON z.id = sc.zone_id
        LEFT JOIN shifts sh ON sh.id = sc.shift_id
        WHERE sc.work_date = ? ORDER BY sc.shift_id, s.id
    """, (day,))
    return jsonify({"ok": True, "data": rows})


@bp.post("/schedules/auto")
@auth_required
def schedule_auto():
    """自动排班：技能高的先挑区域，区域优先级 = 当日任务多 + ISO 等级高（数字小）。
    每派一人该区域需求权重减一，否则所有人挤进任务最多的区 —— 第一版 demo 被骂过。"""
    d = request.get_json(force=True)
    day = d.get("date") or datetime.date.today().strftime("%Y-%m-%d")
    zones = q("SELECT * FROM zones ORDER BY id")
    # 当日各区域任务数：没填计划时间的按创建时间算
    cnt = {r["zone_id"]: r["c"] for r in q(
        """SELECT zone_id, COUNT(*) AS c FROM tasks
           WHERE date(COALESCE(planned_start, created_at)) = ? GROUP BY zone_id""", (day,))}
    weight = {z["id"]: (cnt.get(z["id"], 0), -z["iso_class"]) for z in zones}  # 同数时 ISO 小的优先
    people = q("SELECT * FROM staff WHERE status != 'leave' ORDER BY skill_level DESC, id")
    if not people:
        raise BizError("没有可排班的人员（全部请假）")
    conn = get_conn()
    result = []
    try:
        for p in people:
            # ISO5/6 核心区只放 A 证的人，跟调度算法同一道红线
            eligible = [z for z in zones if z["iso_class"] > 6 or p["cert_level"] == "A"]
            if not eligible:
                continue
            best = max(eligible, key=lambda z: weight[z["id"]])
            conn.execute(
                """INSERT OR REPLACE INTO schedules(staff_id,work_date,shift_id,zone_id,status)
                   VALUES (?,?,?,?,'planned')""",
                (p["id"], day, p["shift_id"], best["id"]))
            w = weight[best["id"]]
            weight[best["id"]] = (w[0] - 1, w[1])  # 派掉一个，需求降一档
            shift = q("SELECT name FROM shifts WHERE id=?", (p["shift_id"],), one=True)
            result.append({"staff_name": p["name"], "zone_name": best["name"],
                           "shift_name": shift["name"] if shift else "未排班"})
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True, "data": result,
                    "msg": f"{day} 自动排班完成，共安排 {len(result)} 人"})


@bp.get("/matrix")
@auth_required
def matrix():
    """技能矩阵：技能/认证/负荷/今日任务数，前端画人力热力表用。"""
    rows = q("""
        SELECT s.id, s.code, s.name, s.role, s.skill_level, s.cert_level, s.workload, s.status,
               (SELECT COUNT(*) FROM tasks t
                 WHERE t.assignee_id = s.id
                   AND date(COALESCE(t.planned_start, t.created_at)) = date('now','localtime')
               ) AS today_tasks
        FROM staff s ORDER BY s.skill_level DESC, s.id
    """)
    return jsonify({"ok": True, "data": rows})
