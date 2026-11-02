# -*- coding: utf-8 -*-
"""报警中心（菜单10）：多来源报警的统一受理与闭环。

来源四种：sensor 阈值触发、robot 故障上报、manual 人工补录、ai 图像识别。
状态流转统一走 rules.handle_alarm（open→processing→resolved，或任意→ignored），
这层只管列表展示、手动补录和统计，不自己碰状态机。
"""
import datetime
import functools
from flask import Blueprint, current_app, g, jsonify, request

from ..db import get_conn, q
from ..rules import BizError, STATUS_TEXT, handle_alarm

bp = Blueprint("alarms", __name__, url_prefix="/api/alarms")


def auth_required(fn):
    """蓝图是在 create_app() 里 import 的，装饰器求值那一刻 app 还没绑定到
    current_app，直接写 @auth_required 会在启动时就抛
    "Working outside of application context"。包一层，把取值推迟到请求进来时。"""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return current_app.auth_required(fn)(*args, **kwargs)
    return wrapper

LEVEL_TEXT = {"critical": "紧急", "major": "重要", "minor": "一般"}


@bp.get("/list")
@auth_required
def alarm_list():
    """报警列表，可按状态/等级过滤。处理人 LEFT JOIN——
    没接手的报警 handler 是空的，别用 INNER JOIN 把它们吞了。"""
    sql = """SELECT a.*, z.name AS zone_name, u.real_name AS handler_name
             FROM alarms a
             LEFT JOIN zones z ON z.id = a.zone_id
             LEFT JOIN users u ON u.id = a.handler_id"""
    conds, args = [], []
    if request.args.get("status"):
        conds.append("a.status = ?")
        args.append(request.args["status"])
    if request.args.get("level"):
        conds.append("a.level = ?")
        args.append(request.args["level"])
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    rows = q(sql + " ORDER BY a.id DESC", args)
    for r in rows:
        r["status_text"] = STATUS_TEXT.get(r["status"], r["status"])
        r["level_text"] = LEVEL_TEXT.get(r["level"], r["level"])
    return jsonify({"ok": True, "data": rows})


@bp.post("/create")
@auth_required
def create():
    """人工补录报警。现场巡检看到的问题不可能都有传感器盯着，
    留个手动入口，source 标 manual 便于统计时跟自动报警分开。"""
    d = request.get_json(force=True)
    title = (d.get("title") or "").strip()
    if not title:
        raise BizError("报警标题不能为空")
    level = d.get("level") or "minor"
    if level not in LEVEL_TEXT:
        raise BizError("报警等级必须是 critical/major/minor")
    if d.get("zone_id") and not q("SELECT id FROM zones WHERE id=?", (d["zone_id"],), one=True):
        raise BizError("所属区域不存在", 404)
    # 编号带微秒，同一秒连点两下也不会撞 UNIQUE
    code = "AL-" + datetime.datetime.now().strftime("%Y%m%d%H%M%S%f")[:16]
    conn = get_conn()
    cur = conn.execute(
        """INSERT INTO alarms(code,level,source,zone_id,title,detail,status)
           VALUES (?,?,'manual',?,?,?,'open')""",
        (code, level, d.get("zone_id"), title, d.get("detail") or ""))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "msg": f"报警 {code} 已上报",
                    "data": q("SELECT * FROM alarms WHERE id=?", (cur.lastrowid,), one=True)})


@bp.post("/<int:aid>/handle")
@auth_required
def handle(aid):
    """处理报警。流转合法性和关闭权限都在 rules.handle_alarm 里，
    这层只负责收 action/note 两个参数。"""
    d = request.get_json(force=True)
    action = d.get("action")
    if action not in ("process", "resolve", "ignore"):
        raise BizError("处理动作必须是 process/resolve/ignore")
    row = handle_alarm(aid, g.user, action, d.get("note") or "")
    row["status_text"] = STATUS_TEXT.get(row["status"], row["status"])
    verb = {"process": "已接手处理", "resolve": "已标记解决", "ignore": "已忽略"}[action]
    return jsonify({"ok": True, "data": row, "msg": f"报警 {row['code']} {verb}"})


@bp.delete("/<int:aid>")
@auth_required
def remove(aid):
    """只有闭环的报警（已解决/已忽略）能删。
    进行中的报警删掉等于销毁证据，出问题追溯不到。"""
    row = q("SELECT status, code FROM alarms WHERE id=?", (aid,), one=True)
    if not row:
        raise BizError("报警不存在", 404)
    if row["status"] not in ("resolved", "ignored"):
        raise BizError(f"报警当前为「{STATUS_TEXT[row['status']]}」，只有已解决/已忽略的报警才能删除")
    conn = get_conn()
    conn.execute("DELETE FROM alarms WHERE id=?", (aid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "msg": f"报警 {row['code']} 已删除"})


@bp.get("/map")
@auth_required
def map_points():
    """活跃报警的 3D 场景映射：带上区域的平面坐标和宽高，
    前端据此在区域上方飘报警标记。"""
    rows = q("""SELECT a.id, a.code, a.title, a.level, a.status,
                       z.id AS zone_id, z.name AS zone_name, z.x, z.y, z.w, z.h
                FROM alarms a JOIN zones z ON z.id = a.zone_id
                WHERE a.status IN ('open', 'processing')
                ORDER BY CASE a.level WHEN 'critical' THEN 0
                                      WHEN 'major' THEN 1 ELSE 2 END, a.id DESC""")
    for r in rows:
        r["level_text"] = LEVEL_TEXT.get(r["level"], r["level"])
    return jsonify({"ok": True, "data": rows})


@bp.get("/stats")
@auth_required
def stats():
    """平均处理时长用 julianday 差值算，单位换算成分钟。
    只统计 resolved——ignored 的时长没业务意义，会拉歪均值。"""
    by_level = {r["level"]: r["c"] for r in
                q("SELECT level, COUNT(*) c FROM alarms GROUP BY level")}
    by_status = {r["status"]: r["c"] for r in
                 q("SELECT status, COUNT(*) c FROM alarms GROUP BY status")}
    by_source = {r["source"]: r["c"] for r in
                 q("SELECT source, COUNT(*) c FROM alarms GROUP BY source")}
    avg = q("""SELECT AVG((julianday(handled_at) - julianday(created_at)) * 1440.0) AS m
               FROM alarms WHERE status = 'resolved' AND handled_at IS NOT NULL""",
            one=True)["m"]
    return jsonify({"ok": True, "data": {
        "by_level": by_level, "by_status": by_status, "by_source": by_source,
        "avg_resolve_minutes": round(avg, 1) if avg is not None else 0.0}})
