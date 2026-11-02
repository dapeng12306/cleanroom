# -*- coding: utf-8 -*-
"""M01 驾驶舱：首页总览 + 3D 场景数据源。

这一层全是聚合只读查询。首页大屏刷新很勤，所以一条写操作都不许有；
聚合都下推到 SQL 里做，不在 Python 里循环数行，数据量大点才扛得住。
"""
import functools
from flask import Blueprint, jsonify, current_app

from ..db import q
from ..rules import TASK_FLOW

bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")

# 机器人全部状态，聚合时补 0 用 —— 前端图表不补 0 会缺柱子
ROBOT_STATUSES = ("idle", "working", "charging", "fault", "maintenance")


def auth_required(fn):
    """蓝图是在 create_app() 里 import 的，装饰器求值那一刻 app 还没绑定到
    current_app，直接写 @current_app.auth_required 会在启动时就抛
    "Working outside of application context"。包一层，把取值推迟到请求进来时。"""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return current_app.auth_required(fn)(*args, **kwargs)
    return wrapper


@bp.get("/overview")
@auth_required
def overview():
    """首页顶部的 KPI 卡片 + 区域状态条，一次请求全拿回去。"""
    # 区域列表顺带把每个区挂着的未结报警数聚合出来。
    # 用 LEFT JOIN 子查询而不用相关子查询，区域多了以后差距很明显
    zones = q("""
        SELECT z.*, COALESCE(a.cnt, 0) AS open_alarms
        FROM zones z
        LEFT JOIN (
            SELECT zone_id, COUNT(*) AS cnt FROM alarms
            WHERE status IN ('open', 'processing') GROUP BY zone_id
        ) a ON a.zone_id = z.id
        ORDER BY z.id
    """)

    # 每个区再补两个驾驶舱要用的派生指标：
    # 今日任务数 —— 区域卡片上"今天还有几单"的数字
    # 粒子均值占限值比例 —— 决定区域卡片描边颜色（>70% 橙、>100% 红）
    today_cnt = {r["zone_id"]: r["c"] for r in q(
        """SELECT zone_id, COUNT(*) AS c FROM tasks
           WHERE date(COALESCE(planned_start, created_at)) = date('now','localtime')
           GROUP BY zone_id""")}
    particle_ratio = {r["id"]: r["ratio"] for r in q("""
        SELECT z.id,
               AVG(r.value) / z.target_particles AS ratio
        FROM zones z
        LEFT JOIN sensors s ON s.zone_id = z.id AND s.stype = 'particle'
        LEFT JOIN sensor_readings r ON r.sensor_id = s.id
              AND r.recorded_at >= datetime('now','localtime','-24 hours')
        GROUP BY z.id
    """)}
    for z in zones:
        z["today_tasks"] = today_cnt.get(z["id"], 0)
        ratio = particle_ratio.get(z["id"])
        # 没有读数的区给 0，前端拿到 None 会直接不渲染
        z["particle_ratio"] = round(ratio, 3) if ratio is not None else 0.0

    # 各状态任务数/机器人数：按状态机全集补 0，缺的状态前端不用判空
    task_stat = {st: 0 for st in TASK_FLOW}
    for r in q("SELECT status, COUNT(*) AS c FROM tasks GROUP BY status"):
        task_stat[r["status"]] = r["c"]
    robot_stat = {st: 0 for st in ROBOT_STATUSES}
    for r in q("SELECT status, COUNT(*) AS c FROM robots GROUP BY status"):
        robot_stat[r["status"]] = r["c"]

    alarm_open = q("SELECT COUNT(*) AS c FROM alarms WHERE status IN ('open','processing')",
                   one=True)["c"]
    staff_online = q("SELECT COUNT(*) AS c FROM staff WHERE status != 'leave'", one=True)["c"]
    # 今天验收通过的：按实际结束时间算，不按创建时间，跨天任务才不会算错
    today_done = q("""SELECT COUNT(*) AS c FROM tasks
                      WHERE status='passed' AND date(actual_end)=date('now','localtime')""",
                   one=True)["c"]
    materials_low = q("SELECT COUNT(*) AS c FROM materials WHERE stock < safety_stock",
                      one=True)["c"]

    # 近 7 天验收通过量：驾驶舱右下角的小趋势图。先造连续日期轴再 LEFT JOIN，
    # 某天没单也不能断档，不然前端折线图会缺一天看起来象bug
    week_trend = q("""
        WITH RECURSIVE days(d) AS (
            SELECT date('now','localtime','-6 days')
            UNION ALL SELECT date(d, '+1 day') FROM days WHERE d < date('now','localtime')
        )
        SELECT days.d AS day, COUNT(t.id) AS done
        FROM days LEFT JOIN tasks t
          ON date(t.actual_end) = days.d AND t.status = 'passed'
        GROUP BY days.d ORDER BY days.d
    """)

    return jsonify({"ok": True, "data": {
        "zones": zones,
        "task_stat": task_stat,
        "alarm_open": alarm_open,
        "robot_stat": robot_stat,
        "staff_online": staff_online,
        "today_done": today_done,
        "materials_low": materials_low,
        "week_trend": week_trend,
    }})


@bp.get("/scene")
@auth_required
def scene():
    """3D 场景一帧所需的全部实体。坐标都在库里，前端只管摆模型。

    刻意把字段收窄到渲染要用的那几个，全字段 SELECT * 会让
    每帧的网络包大一倍，大屏上肉眼可见地卡。"""
    zones = q("SELECT id,code,name,iso_class,x,y,w,h,status FROM zones ORDER BY id")
    robots = q("""SELECT id,code,name,robot_type,status,battery,x,y,zone_id
                  FROM robots ORDER BY id""")
    # 只有未结的报警才值得在 3D 里冒红光
    alarms = q("""SELECT id,level,title,zone_id FROM alarms
                  WHERE status IN ('open','processing') ORDER BY id""")
    equipment = q("SELECT id,name,etype,status,x,y,z FROM equipment ORDER BY id")
    return jsonify({"ok": True, "data": {
        "zones": zones,
        "robots": robots,
        "alarms": alarms,
        "equipment": equipment,
    }})
