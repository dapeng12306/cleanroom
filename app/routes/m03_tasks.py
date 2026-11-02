# -*- coding: utf-8 -*-
"""M03 保洁任务：列表/建单/编辑/流转/智能派单/轨迹/看板。
状态机、角色权限、派单算法全在 rules.py 里，这里只做参数校验和拼装，
绝不绕开 transit_task 自己 UPDATE status —— 那条红线碰了评审要扣分。
"""
import functools
import datetime
from flask import Blueprint, jsonify, request, g, current_app

from ..db import get_conn, q
from ..rules import (BizError, STATUS_TEXT, TASK_FLOW,
                     transit_task, auto_dispatch, release_task_resources)

bp = Blueprint("tasks", __name__, url_prefix="/api/tasks")

VALID_TASK_TYPES = ("routine", "deep", "emergency", "disinfection")


def auth_required(fn):
    """import 期 current_app 未绑定，装饰器推迟到请求时再取（见 m01 同款坑）。"""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return current_app.auth_required(fn)(*args, **kwargs)
    return wrapper


def _with_status_text(rows):
    for r in rows:
        r["status_text"] = STATUS_TEXT.get(r["status"], r["status"])
    return rows


# 列表/看板共用这一段 JOIN，抽出来省得两处各写一遍对不上
_LIST_SQL = """
    SELECT t.*, z.name AS zone_name, s.name AS assignee_name, r.name AS robot_name
    FROM tasks t
    JOIN zones z ON z.id = t.zone_id
    LEFT JOIN staff s ON s.id = t.assignee_id
    LEFT JOIN robots r ON r.id = t.robot_id
"""


@bp.get("/list")
@auth_required
def task_list():
    sql, args = _LIST_SQL, []
    conds = []
    status = request.args.get("status")
    zone_id = request.args.get("zone_id", type=int)
    if status:
        if status not in TASK_FLOW:
            raise BizError("任务状态不合法")
        conds.append("t.status = ?")
        args.append(status)
    if zone_id:
        conds.append("t.zone_id = ?")
        args.append(zone_id)
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY t.created_at DESC, t.id DESC"
    return jsonify({"ok": True, "data": _with_status_text(q(sql, args))})


def _next_code(conn, prefix):
    """编号规则 TK-yymmdd-NNN，当天序号接着最大号往后排。
    用 LIKE 前缀查当天已有编号，解析尾号 +1，比 COUNT 可靠（删过单也不重号）。"""
    row = conn.execute(
        "SELECT code FROM tasks WHERE code LIKE ? ORDER BY code DESC LIMIT 1",
        (prefix + "-%",)).fetchone()
    seq = int(row["code"].rsplit("-", 1)[1]) + 1 if row else 1
    return f"{prefix}-{seq:03d}"


@bp.post("/create")
@auth_required
def task_create():
    d = request.get_json(force=True)
    title = (d.get("title") or "").strip()
    task_type = d.get("task_type") or "routine"
    zone_id = d.get("zone_id")
    if not title or not zone_id:
        raise BizError("任务标题和所属区域不能为空")
    if task_type not in VALID_TASK_TYPES:
        raise BizError(f"任务类型不合法，允许：{'、'.join(VALID_TASK_TYPES)}")
    try:
        priority = int(d.get("priority", 2))
    except (TypeError, ValueError):
        raise BizError("优先级必须是 1~4 的整数")
    if not 1 <= priority <= 4:
        raise BizError("优先级必须是 1~4 的整数（1 最高）")
    if not q("SELECT 1 AS ok FROM zones WHERE id=?", (zone_id,), one=True):
        raise BizError("所属区域不存在")

    conn = get_conn()
    try:
        code = _next_code(conn, "TK-" + datetime.datetime.now().strftime("%y%m%d"))
        cur = conn.execute(
            """INSERT INTO tasks(code,title,task_type,zone_id,priority,creator_id,
                                 planned_start,planned_end)
               VALUES (?,?,?,?,?,?,?,?)""",
            (code, title, task_type, zone_id, priority, g.user["id"],
             d.get("planned_start"), d.get("planned_end")))
        tid = cur.lastrowid
        conn.execute(
            "INSERT INTO task_logs(task_id,action,to_status,operator_id,note) VALUES (?,?,?,?,?)",
            (tid, "创建", "created", g.user["id"], f"创建任务 {code}"))
        conn.commit()
        row = q(_LIST_SQL + " WHERE t.id=?", (tid,), one=True)
        _with_status_text([row])
        return jsonify({"ok": True, "data": row, "msg": f"任务 {code} 已创建"})
    finally:
        conn.close()


@bp.put("/<int:tid>")
@auth_required
def task_update(tid):
    """只有 created 状态能改 —— 派出去的单再改计划，干活的人和机器人会对不上口径。"""
    d = request.get_json(force=True)
    task = q("SELECT * FROM tasks WHERE id=?", (tid,), one=True)
    if not task:
        raise BizError("任务不存在", 404)
    if task["status"] != "created":
        raise BizError(f"任务当前为「{STATUS_TEXT[task['status']]}」，仅「已创建」状态允许编辑")
    fields = ("title", "priority", "planned_start", "planned_end")
    sets, args = [], []
    for f in fields:
        if f in d:
            sets.append(f"{f}=?")
            args.append(d[f])
    if not sets:
        raise BizError("没有可更新的字段")
    args.append(tid)
    conn = get_conn()
    conn.execute(f"UPDATE tasks SET {', '.join(sets)}, version=version+1 WHERE id=?", args)
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "data": q("SELECT * FROM tasks WHERE id=?", (tid,), one=True),
                    "msg": "已保存修改"})


@bp.delete("/<int:tid>")
@auth_required
def task_delete(tid):
    task = q("SELECT * FROM tasks WHERE id=?", (tid,), one=True)
    if not task:
        raise BizError("任务不存在", 404)
    if task["status"] not in ("created", "cancelled"):
        raise BizError(f"任务当前为「{STATUS_TEXT[task['status']]}」，仅「已创建/已取消」允许删除")
    conn = get_conn()
    conn.execute("DELETE FROM tasks WHERE id=?", (tid,))  # task_logs 走级联
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "msg": f"任务 {task['code']} 已删除"})


@bp.post("/<int:tid>/transit")
@auth_required
def task_transit(tid):
    """流转统一交给 rules.transit_task。取消是特例：人/机资源要顺手放掉。
    transit_task 内部已自己 commit 并关连接，资源释放蹭不了它的事务，
    所以取消成功后另开一条连接执行 release_task_resources。"""
    d = request.get_json(force=True)
    to = d.get("to")
    if to not in TASK_FLOW:
        raise BizError("目标状态不合法")
    note = d.get("note") or ""
    version = d.get("version")  # 前端传了就上乐观锁，不传也能流转
    task = transit_task(tid, to, g.user, note, version)
    if to == "cancelled":
        conn = get_conn()
        try:
            release_task_resources(conn, task)
            conn.commit()
        finally:
            conn.close()
    return jsonify({"ok": True,
                    "data": {"task": task},
                    "msg": f"已流转到「{STATUS_TEXT[to]}」"})


@bp.post("/<int:tid>/auto-dispatch")
@auth_required
def task_auto_dispatch(tid):
    """智能派单分两步：算法只负责挑人挑机（填 assignee/robot，不动状态），
    状态从 created/failed → assigned 要另走状态机，角色权限才拦得住。"""
    result = auto_dispatch(tid, g.user)
    task = transit_task(tid, "assigned", g.user, "智能派单完成")
    return jsonify({"ok": True,
                    "data": {"dispatch": result, "task": task},
                    "msg": f"已派单：{result['staff']['name']} + {result['robot']['name']}"
                           f"（综合得分 {result['total']}）"})


@bp.get("/<int:tid>/logs")
@auth_required
def task_logs(tid):
    """任务轨迹：谁、什么时候、从哪到哪、备注。前端画时间轴用。"""
    if not q("SELECT 1 AS ok FROM tasks WHERE id=?", (tid,), one=True):
        raise BizError("任务不存在", 404)
    rows = q("""
        SELECT l.*, u.real_name AS operator_name
        FROM task_logs l LEFT JOIN users u ON u.id = l.operator_id
        WHERE l.task_id = ? ORDER BY l.created_at ASC, l.id ASC
    """, (tid,))
    for r in rows:
        r["from_text"] = STATUS_TEXT.get(r["from_status"], r["from_status"])
        r["to_text"] = STATUS_TEXT.get(r["to_status"], r["to_status"])
    return jsonify({"ok": True, "data": rows})


@bp.get("/board")
@auth_required
def task_board():
    """拖拽看板：按状态分组返回。状态列的顺序跟状态机走，前端不用自己排。"""
    rows = _with_status_text(q(_LIST_SQL + " ORDER BY t.priority ASC, t.created_at DESC"))
    board = {st: [] for st in TASK_FLOW}
    for r in rows:
        board.setdefault(r["status"], []).append(r)
    return jsonify({"ok": True, "data": board})
