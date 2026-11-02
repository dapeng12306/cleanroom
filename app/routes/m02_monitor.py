# -*- coding: utf-8 -*-
"""M02 环境监测：传感器台账、读数曲线、区域风险雷达、演示模拟。

传感器读数是高频数据，sensor_readings 上有 (sensor_id, recorded_at) 索引，
按时间范围查走索引，别手贱做全表扫描。
"""
import functools
import datetime
from flask import Blueprint, jsonify, request, current_app

from ..db import get_conn, q
from ..rules import BizError
from ..ai_engine import zone_risk_assessment

bp = Blueprint("monitor", __name__, url_prefix="/api/monitor")

# 表结构里 CHECK 约束管着这份清单，新增类型要动 schema，不是这里加个字就完事
VALID_STYPES = ("particle", "temp", "humidity", "pressure", "voc")
VALID_SENSOR_STATUS = ("online", "offline", "calibrating")


def auth_required(fn):
    """import 期 current_app 未绑定，装饰器推迟到请求时再取（见 m01 同款坑）。"""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return current_app.auth_required(fn)(*args, **kwargs)
    return wrapper


@bp.get("/sensors")
@auth_required
def sensor_list():
    """传感器列表，每条带最新一条读数。
    最新读数用相关子查询取 —— 实测比 JOIN + GROUP BY 再回表快，
    因为 idx_readings_sensor 索引正好是 (sensor_id, recorded_at)。"""
    zone_id = request.args.get("zone_id", type=int)
    sql = """
        SELECT s.*, z.name AS zone_name,
               (SELECT r.value FROM sensor_readings r
                 WHERE r.sensor_id = s.id ORDER BY r.recorded_at DESC LIMIT 1) AS latest_value,
               (SELECT r.recorded_at FROM sensor_readings r
                 WHERE r.sensor_id = s.id ORDER BY r.recorded_at DESC LIMIT 1) AS latest_time
        FROM sensors s JOIN zones z ON z.id = s.zone_id
    """
    args = []
    if zone_id:
        sql += " WHERE s.zone_id = ?"
        args.append(zone_id)
    sql += " ORDER BY s.id"
    return jsonify({"ok": True, "data": q(sql, args)})


@bp.get("/readings")
@auth_required
def readings():
    """某传感器最近 N 小时的读数，画趋势曲线用。按时间升序给前端。"""
    sensor_id = request.args.get("sensor_id", type=int)
    hours = request.args.get("hours", default=24, type=int)
    if not sensor_id:
        raise BizError("sensor_id 不能为空")
    if not (1 <= hours <= 24 * 30):
        raise BizError("hours 超出允许范围（1~720）")
    if not q("SELECT 1 AS ok FROM sensors WHERE id=?", (sensor_id,), one=True):
        raise BizError("传感器不存在", 404)
    # 时间修饰符拼进参数里，SQLite 的 || 拼接不影响参数化安全性
    rows = q("""
        SELECT id, value, unit, recorded_at FROM sensor_readings
        WHERE sensor_id = ?
          AND recorded_at >= datetime('now','localtime', '-' || ? || ' hours')
        ORDER BY recorded_at ASC
    """, (sensor_id, hours))
    return jsonify({"ok": True, "data": rows})


@bp.get("/zone-risk")
@auth_required
def zone_risk():
    """每个区域的粒子浓度风险评级：最近 24h 均值 vs ISO 限值。
    判定话术统一走 ai_engine.zone_risk_assessment，别在路由里再发明一套阈值。"""
    rows = q("""
        SELECT z.id, z.name, z.iso_class, z.target_particles,
               AVG(r.value) AS mean
        FROM zones z
        LEFT JOIN sensors s ON s.zone_id = z.id AND s.stype = 'particle'
        LEFT JOIN sensor_readings r ON r.sensor_id = s.id
              AND r.recorded_at >= datetime('now','localtime','-24 hours')
        GROUP BY z.id ORDER BY z.id
    """)
    data = []
    for z in rows:
        mean = z["mean"] or 0.0  # 没有读数的区按 0 处理，别让它变成 None 炸掉算法
        risk = zone_risk_assessment({"target_particles": z["target_particles"]}, mean)
        data.append({
            "zone_id": z["id"], "zone_name": z["name"], "iso_class": z["iso_class"],
            "mean": round(mean, 1), "limit": z["target_particles"], "risk": risk,
        })
    return jsonify({"ok": True, "data": data})


@bp.post("/sensors")
@auth_required
def sensor_create():
    d = request.get_json(force=True)
    code = (d.get("code") or "").strip()
    stype = d.get("stype")
    zone_id = d.get("zone_id")
    if not code or not stype or not zone_id:
        raise BizError("编号、类型、所属区域都不能为空")
    if stype not in VALID_STYPES:
        raise BizError(f"传感器类型不合法，允许：{'、'.join(VALID_STYPES)}")
    if not q("SELECT 1 AS ok FROM zones WHERE id=?", (zone_id,), one=True):
        raise BizError("所属区域不存在")
    if q("SELECT 1 AS ok FROM sensors WHERE code=?", (code,), one=True):
        raise BizError(f"传感器编号 {code} 已存在", 409)
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO sensors(code,stype,zone_id,x,y,z) VALUES (?,?,?,?,?,?)",
            (code, stype, zone_id, d.get("x", 0), d.get("y", 0), d.get("z", 1.2)))
        conn.commit()
        row = q("SELECT * FROM sensors WHERE id=?", (cur.lastrowid,), one=True)
        return jsonify({"ok": True, "data": row, "msg": f"传感器 {code} 已接入"})
    finally:
        conn.close()


@bp.put("/sensors/<int:sid>")
@auth_required
def sensor_update(sid):
    """只放行状态和位置两件事 —— 类型/编号属于设备档案，改了历史读数就对不上了。"""
    d = request.get_json(force=True)
    if not q("SELECT 1 AS ok FROM sensors WHERE id=?", (sid,), one=True):
        raise BizError("传感器不存在", 404)
    sets, args = [], []
    if "status" in d:
        if d["status"] not in VALID_SENSOR_STATUS:
            raise BizError(f"状态不合法，允许：{'、'.join(VALID_SENSOR_STATUS)}")
        sets.append("status=?")
        args.append(d["status"])
    for k in ("x", "y"):
        if k in d:
            sets.append(f"{k}=?")
            args.append(float(d[k]))
    if not sets:
        raise BizError("没有可更新的字段（支持 status / x / y）")
    args.append(sid)
    conn = get_conn()
    conn.execute(f"UPDATE sensors SET {', '.join(sets)} WHERE id=?", args)
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "data": q("SELECT * FROM sensors WHERE id=?", (sid,), one=True),
                    "msg": "已更新"})


@bp.delete("/sensors/<int:sid>")
@auth_required
def sensor_delete(sid):
    """读数靠外键 ON DELETE CASCADE 级联清掉，不用手动删两回。"""
    conn = get_conn()
    cur = conn.execute("DELETE FROM sensors WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise BizError("传感器不存在", 404)
    return jsonify({"ok": True, "msg": "传感器已删除，历史读数已级联清理"})


@bp.post("/simulate")
@auth_required
def simulate():
    """演示按钮：给指定区域的粒子传感器灌一条超标读数，并同步拉起报警、
    把区域标成 warning。评审现场点一下，大屏立刻红光一片，效果拉满。"""
    d = request.get_json(force=True)
    zone_id = d.get("zone_id")
    zone = q("SELECT * FROM zones WHERE id=?", (zone_id,), one=True)
    if not zone:
        raise BizError("区域不存在", 404)
    sensor = q("SELECT * FROM sensors WHERE zone_id=? AND stype='particle' ORDER BY id",
               (zone_id,), one=True)
    if not sensor:
        raise BizError(f"{zone['name']} 没有粒子传感器，无法模拟")

    conn = get_conn()
    try:
        value = round(zone["target_particles"] * 1.3, 2)
        cur = conn.execute(
            "INSERT INTO sensor_readings(sensor_id,value,unit) VALUES (?,?,'个/m³')",
            (sensor["id"], value))
        reading_id = cur.lastrowid
        # 报警编号带时间戳防重；source 标 sensor，因为它确实是"读数触发"的
        code = "AL-SIM-" + datetime.datetime.now().strftime("%H%M%S%f")
        cur = conn.execute(
            """INSERT INTO alarms(code,level,source,zone_id,title,detail,status)
               VALUES (?,?,?,?,?,?,'open')""",
            (code, "critical", "sensor", zone_id,
             f"{zone['name']} 粒子浓度超标(模拟)",
             f"读数 {value} 个/m³，达 ISO{zone['iso_class']} 限值 {zone['target_particles']} 的 130%"))
        alarm_id = cur.lastrowid
        conn.execute("UPDATE zones SET status='warning' WHERE id=?", (zone_id,))
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True, "msg": "已注入模拟超标数据，大屏与报警列表将同步变化",
                    "data": {
                        "reading": q("SELECT * FROM sensor_readings WHERE id=?",
                                     (reading_id,), one=True),
                        "alarm": q("SELECT * FROM alarms WHERE id=?", (alarm_id,), one=True),
                    }})
