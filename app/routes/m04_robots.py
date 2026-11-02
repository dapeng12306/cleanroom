# -*- coding: utf-8 -*-
"""M04 机器人编队：台账、指令下发、机群聚合面板。

指令接口是给前端 3D 场景里的遥控面板用的，所有"能不能动"的硬规则
都集中在 /command 里拦，别指望前端自觉 —— 前端永远可能被绕过。
"""
import functools
import sqlite3
from flask import Blueprint, jsonify, request, current_app

from ..db import get_conn, q
from ..rules import BizError

bp = Blueprint("robots", __name__, url_prefix="/api/robots")

VALID_TYPES = ("scrubber", "vacuum", "uv", "mop")
VALID_MODES = ("auto", "manual", "collaborative")


def auth_required(fn):
    """import 期 current_app 未绑定，装饰器推迟到请求时再取（见 m01 同款坑）。"""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return current_app.auth_required(fn)(*args, **kwargs)
    return wrapper


@bp.get("/list")
@auth_required
def robot_list():
    rows = q("""
        SELECT r.*, z.name AS zone_name
        FROM robots r LEFT JOIN zones z ON z.id = r.zone_id
        ORDER BY r.id
    """)
    return jsonify({"ok": True, "data": rows})


@bp.post("/create")
@auth_required
def robot_create():
    d = request.get_json(force=True)
    name = (d.get("name") or "").strip()
    robot_type = d.get("robot_type") or "scrubber"
    mode = d.get("mode") or "auto"
    if not name:
        raise BizError("机器人名称不能为空")
    if robot_type not in VALID_TYPES:
        raise BizError(f"机器人类型不合法，允许：{'、'.join(VALID_TYPES)}")
    if mode not in VALID_MODES:
        raise BizError(f"运行模式不合法，允许：{'、'.join(VALID_MODES)}")
    zone_id = d.get("zone_id")
    if zone_id and not q("SELECT 1 AS ok FROM zones WHERE id=?", (zone_id,), one=True):
        raise BizError("所属区域不存在")
    # 编号接着现有最大号排，RB-01 这种两位格式
    row = q("SELECT MAX(CAST(SUBSTR(code,4) AS INTEGER)) AS m FROM robots", one=True)
    code = f"RB-{(row['m'] or 0) + 1:02d}"
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO robots(code,name,robot_type,mode,zone_id) VALUES (?,?,?,?,?)",
            (code, name, robot_type, mode, zone_id))
        conn.commit()
        return jsonify({"ok": True, "msg": f"机器人 {code}「{name}」已入库",
                        "data": q("SELECT * FROM robots WHERE id=?", (cur.lastrowid,), one=True)})
    finally:
        conn.close()


@bp.put("/<int:rid>")
@auth_required
def robot_update(rid):
    """档案维护只允许改名称/类型/模式，状态和坐标只能走 /command，两条路不混。"""
    d = request.get_json(force=True)
    if not q("SELECT 1 AS ok FROM robots WHERE id=?", (rid,), one=True):
        raise BizError("机器人不存在", 404)
    sets, args = [], []
    if "name" in d:
        sets.append("name=?")
        args.append((d["name"] or "").strip())
    if "robot_type" in d:
        if d["robot_type"] not in VALID_TYPES:
            raise BizError("机器人类型不合法")
        sets.append("robot_type=?")
        args.append(d["robot_type"])
    if "mode" in d:
        if d["mode"] not in VALID_MODES:
            raise BizError("运行模式不合法")
        sets.append("mode=?")
        args.append(d["mode"])
    if not sets:
        raise BizError("没有可更新的字段（支持 name / robot_type / mode）")
    args.append(rid)
    conn = get_conn()
    conn.execute(f"UPDATE robots SET {', '.join(sets)} WHERE id=?", args)
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "data": q("SELECT * FROM robots WHERE id=?", (rid,), one=True),
                    "msg": "已保存"})


@bp.delete("/<int:rid>")
@auth_required
def robot_delete(rid):
    robot = q("SELECT * FROM robots WHERE id=?", (rid,), one=True)
    if not robot:
        raise BizError("机器人不存在", 404)
    if robot["status"] == "working":
        raise BizError("机器人正在作业中，不能删除，请先暂停任务")
    conn = get_conn()
    try:
        conn.execute("DELETE FROM robots WHERE id=?", (rid,))
        conn.commit()
    except sqlite3.IntegrityError:
        # 历史任务还引用着它，外键不让删。给个能看懂的说法，别甩英文异常
        raise BizError("该机器人已有历史作业记录，不允许删除，建议置为维护状态")
    finally:
        conn.close()
    return jsonify({"ok": True, "msg": f"机器人 {robot['code']} 已删除"})


@bp.post("/<int:rid>/command")
@auth_required
def robot_command(rid):
    """遥控指令：start / pause / charge / move / mode。
    返回的 msg 写清执行结果，前端直接 toast。"""
    d = request.get_json(force=True)
    action = d.get("action")
    robot = q("SELECT * FROM robots WHERE id=?", (rid,), one=True)
    if not robot:
        raise BizError("机器人不存在", 404)

    # 故障/维护的机器除了去充电什么都不许干 —— 带病上岗是事故源头
    if robot["status"] in ("fault", "maintenance") and action != "charge":
        raise BizError("机器人故障/维护中，请先维修")

    sets, args, msg = [], [], ""
    if action == "start":
        if robot["battery"] <= 20:
            raise BizError("电量不足20%，请先充电")
        sets.append("status='working'")
        msg = f"{robot['name']} 已开始作业"
    elif action == "pause":
        sets.append("status='idle'")
        msg = f"{robot['name']} 已暂停，转入空闲"
    elif action == "charge":
        # 演示用：一键满电。真实场景该按充电曲线慢慢涨
        sets += ["status='charging'", "battery=100"]
        msg = f"{robot['name']} 已回充，电量恢复 100%"
    elif action == "move":
        if robot["status"] not in ("idle", "working"):
            raise BizError("仅空闲/作业中的机器人可以移动")
        if d.get("x") is None or d.get("y") is None:
            raise BizError("move 指令需要 x、y 坐标")
        sets += ["x=?", "y=?"]
        args += [float(d["x"]), float(d["y"])]
        msg = f"{robot['name']} 已移动到 ({d['x']}, {d['y']})"
    elif action == "mode":
        if d.get("mode") not in VALID_MODES:
            raise BizError(f"运行模式不合法，允许：{'、'.join(VALID_MODES)}")
        sets.append("mode=?")
        args.append(d["mode"])
        msg = f"{robot['name']} 已切换为 {d['mode']} 模式"
    else:
        raise BizError("未知指令，支持 start / pause / charge / move / mode")

    args.append(rid)
    conn = get_conn()
    conn.execute(f"UPDATE robots SET {', '.join(sets)} WHERE id=?", args)
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "data": q("SELECT * FROM robots WHERE id=?", (rid,), one=True),
                    "msg": msg})


@bp.get("/fleet")
@auth_required
def fleet():
    """机群面板：状态分布、平均电量、累计工时、类型分布，一次给全。"""
    status_stat = {r["status"]: r["c"] for r in
                   q("SELECT status, COUNT(*) AS c FROM robots GROUP BY status")}
    type_stat = {r["robot_type"]: r["c"] for r in
                 q("SELECT robot_type, COUNT(*) AS c FROM robots GROUP BY robot_type")}
    agg = q("SELECT COALESCE(AVG(battery),0) AS avg_battery, "
            "       COALESCE(SUM(total_hours),0) AS total_hours FROM robots", one=True)
    return jsonify({"ok": True, "data": {
        "status_stat": status_stat,
        "type_stat": type_stat,
        "avg_battery": round(agg["avg_battery"], 1),
        "total_hours": round(agg["total_hours"], 1),
    }})
