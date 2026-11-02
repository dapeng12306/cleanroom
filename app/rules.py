# -*- coding: utf-8 -*-
"""
业务规则引擎：全系统的"裁判"。

这里集中管四类硬逻辑，页面和路由不许绕开它自己写 if-else：
  1. 状态机流转 —— 任务/审批/报警/验收 各自一张流转表，非法跳转直接驳回
  2. 权限审批   —— 每个流转动作绑定允许的角色，角色不够格直接 403
  3. 资源调度   —— 人机协同派单算法（技能×负荷×距离×认证 四维打分）
  4. 数据一致性 —— 乐观锁 + 事务，库存扣减和状态变更要么都成要么都败

抛出 BizError 的业务异常，路由层统一捕获转成带 code 的 JSON，
前端据此给出鲜明的红/绿反馈。
"""
import datetime
import numpy as np
from .db import get_conn, q


class BizError(Exception):
    """业务规则违例。msg 直接给前端弹窗用，所以写人话。"""
    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.msg = msg
        self.code = code


# ======================================================================
# 一、状态机定义
# ======================================================================

# 保洁任务：created → assigned → in_progress → awaiting_inspection → passed/failed
# failed 允许打回 assigned 返工，cancelled 是终态不能再动
TASK_FLOW = {
    "created":              {"assigned", "cancelled"},
    "assigned":             {"in_progress", "cancelled"},
    "in_progress":          {"awaiting_inspection", "cancelled"},
    "awaiting_inspection":  {"passed", "failed"},
    "failed":               {"assigned", "cancelled"},
    "passed":               set(),
    "cancelled":            set(),
}

# 每个流转动作绑定的最小角色。assign 必须班长/调度来做，
# 验收结论（passed/failed）只有质检员能下 —— 这是质量红线
TASK_ROLE_RULE = {
    ("created", "assigned"):             {"leader", "dispatcher"},
    ("assigned", "in_progress"):         {"leader", "dispatcher", "cleaner"},
    ("in_progress", "awaiting_inspection"): {"leader", "cleaner"},
    ("awaiting_inspection", "passed"):   {"inspector"},
    ("awaiting_inspection", "failed"):   {"inspector"},
    ("failed", "assigned"):              {"leader", "dispatcher"},
}

ALARM_FLOW = {
    "open":       {"processing", "ignored"},
    "processing": {"resolved", "ignored"},
    "resolved":   set(),
    "ignored":    set(),
}

REQUEST_FLOW = {
    "pending":  {"approved", "rejected"},
    "approved": {"returned"},
    "rejected": set(),
    "returned": set(),
}

INSPECTION_FLOW = {
    "draft":     {"submitted"},
    "submitted": {"approved", "rejected"},
    "approved":  set(),
    "rejected":  {"submitted"},
}

# 中文状态文案，前端展示直接用，不用各页面再翻一遍
STATUS_TEXT = {
    "created": "已创建", "assigned": "已派发", "in_progress": "作业中",
    "awaiting_inspection": "待验收", "passed": "验收通过", "failed": "验收不合格",
    "cancelled": "已取消", "open": "待处理", "processing": "处理中",
    "resolved": "已解决", "ignored": "已忽略", "pending": "待审批",
    "approved": "已批准", "rejected": "已驳回", "returned": "已归还",
    "draft": "草稿", "submitted": "已提交",
}


def _check(flow, cur, nxt, what):
    if cur == nxt:
        raise BizError(f"{what}已处于「{STATUS_TEXT.get(nxt, nxt)}」状态，无需重复操作")
    if nxt not in flow.get(cur, set()):
        legal = "、".join(STATUS_TEXT.get(s, s) for s in flow.get(cur, set())) or "无（终态）"
        raise BizError(f"{what}当前为「{STATUS_TEXT.get(cur, cur)}」，不允许流转到「{STATUS_TEXT.get(nxt, nxt)}」。"
                       f"允许的去向：{legal}")


# ======================================================================
# 二、任务状态流转（状态机 + 角色权限 + 乐观锁一致性）
# ======================================================================

def transit_task(task_id, nxt, user, note="", expected_version=None):
    """任务流转唯一入口。
    - 先查流转表，再查角色表，两层都过才动库
    - expected_version 传了就走乐观锁，两个人同时点"完成"只有一个能成功
    返回 (新状态行, 轨迹记录)"""
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not row:
            raise BizError("任务不存在", 404)
        cur = row["status"]
        _check(TASK_FLOW, cur, nxt, "任务")

        # 角色红线：验收结论只有质检员能下
        allowed_roles = TASK_ROLE_RULE.get((cur, nxt))
        if allowed_roles and user["role"] not in allowed_roles:
            names = {"cleaner": "保洁员", "leader": "洁净班长", "inspector": "质检员", "dispatcher": "调度工程师"}
            raise BizError(f"该操作需要 {'/'.join(names[r] for r in allowed_roles)} 权限，"
                           f"您当前角色是「{names[user['role']]}」", 403)

        # ISO5 区域作业必须 A 级认证 —— 派人到核心区之前再拦一道
        if nxt == "in_progress" and row["assignee_id"]:
            z = conn.execute("SELECT iso_class FROM zones WHERE id=?", (row["zone_id"],)).fetchone()
            s = conn.execute("SELECT cert_level,name FROM staff WHERE id=?", (row["assignee_id"],)).fetchone()
            if z and z["iso_class"] == 5 and s and s["cert_level"] != "A":
                raise BizError(f"{s['name']} 的洁净室准入认证为 {s['cert_level']} 级，"
                               f"无权进入 ISO5 核心洁净区作业")

        sql = "UPDATE tasks SET status=?, version=version+1"
        args = [nxt]
        if nxt == "in_progress":
            sql += ", actual_start=datetime('now','localtime')"
        if nxt in ("passed", "failed"):
            sql += ", actual_end=datetime('now','localtime')"
        sql += " WHERE id=?"
        args.append(task_id)
        if expected_version is not None:
            # 乐观锁：版本号对不上说明已被别人改过，这次操作作废
            sql += " AND version=?"
            args.append(expected_version)
        res = conn.execute(sql, args)
        if res.rowcount == 0:
            raise BizError("任务已被他人修改，请刷新后重试（乐观锁拦截）", 409)

        conn.execute(
            "INSERT INTO task_logs(task_id,action,from_status,to_status,operator_id,note) VALUES (?,?,?,?,?,?)",
            (task_id, "状态流转", cur, nxt, user["id"], note))

        # 联动：任务验收不合格 → 自动开一张 major 报警，质检问题不落地不行
        if nxt == "failed":
            zname = conn.execute("SELECT name FROM zones WHERE id=?", (row["zone_id"],)).fetchone()["name"]
            code = "AL-" + datetime.datetime.now().strftime("%H%M%S%f")
            conn.execute(
                "INSERT INTO alarms(code,level,source,zone_id,title,detail,status) VALUES (?,?,?,?,?,?,'open')",
                (code, "major", "manual", row["zone_id"], f"{zname} 保洁验收不合格",
                 f"任务 {row['code']} 验收未通过，需安排返工"))

        conn.commit()
        new_row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return dict(new_row)
    except BizError:
        conn.rollback()
        raise
    finally:
        conn.close()


# ======================================================================
# 三、人机协同调度算法（项目核心算法）
# ======================================================================

def dispatch_score(staff_row, robot_row, zone_row, task_priority):
    """四维加权打分：
      技能匹配 0.35 + 空闲负荷 0.25 + 认证匹配 0.20 + 距离成本 0.20
    返回 0~1 的分值，越高越适合接这单。用 numpy 做向量化，批量候选一次算完。"""
    cert_rank = {"A": 1.0, "B": 0.6, "C": 0.3}
    # ISO5 区域只考虑 A 证；ISO7/8 放宽
    need_cert = 1.0 if zone_row["iso_class"] <= 6 else 0.3
    cert_fit = cert_rank.get(staff_row["cert_level"], 0.3)
    if cert_fit < need_cert:
        return -1.0  # 硬门槛，直接出局
    skill = staff_row["skill_level"] / 5.0
    idle = 1.0 - min(max(staff_row["workload"], 0.0), 1.0)
    # 距离：人员和机器人当前位置到区域中心的曼哈顿距离，归一化
    dist = abs(staff_row.get("x", 0) or 0 - zone_row["x"]) + abs(staff_row.get("y", 0) or 0 - zone_row["y"])
    dist_fit = 1.0 / (1.0 + dist / 20.0)
    w = np.array([0.35, 0.25, 0.20, 0.20])
    feat = np.array([skill, idle, cert_fit, dist_fit])
    # 优先级加成：紧急任务放大技能权重
    if task_priority == 1:
        w = np.array([0.45, 0.20, 0.20, 0.15])
    return float(np.dot(w, feat))


def auto_dispatch(task_id, user):
    """给任务自动配"最佳保洁员 + 最佳机器人"组合。
    组合评分 = 人的分 ×0.6 + 机的分 ×0.4，枚举所有可行对取最优。"""
    conn = get_conn()
    try:
        task = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not task:
            raise BizError("任务不存在", 404)
        if task["status"] not in ("created", "failed"):
            raise BizError(f"只有「已创建/验收不合格」的任务才能智能派单，当前状态：{STATUS_TEXT[task['status']]}")
        zone = conn.execute("SELECT * FROM zones WHERE id=?", (task["zone_id"],)).fetchone()

        staff = conn.execute(
            "SELECT *, 0 AS x, 0 AS y FROM staff WHERE role IN ('cleaner','leader') AND status!='leave'").fetchall()
        robots = conn.execute(
            "SELECT * FROM robots WHERE status IN ('idle','charging') AND battery>30").fetchall()
        if not staff:
            raise BizError("没有可调度的保洁人员（全部请假或忙碌）")
        if not robots:
            raise BizError("没有可用机器人（需空闲且电量>30%）")

        # 人的打分
        s_scores = [(s, dispatch_score(dict(s), None, zone, task["priority"])) for s in staff]
        s_scores = [(s, v) for s, v in s_scores if v >= 0]
        if not s_scores:
            raise BizError(f"区域 {zone['name']} 为 ISO{zone['iso_class']}，无满足认证要求的人员可派")

        # 机器人打分：电量 + 类型匹配（消杀任务偏好 uv，深度保洁偏好 scrubber）
        type_pref = {"disinfection": "uv", "deep": "scrubber", "routine": "mop", "emergency": "vacuum"}
        def robot_score(r):
            bat = r["battery"] / 100.0
            tp = 1.0 if r["robot_type"] == type_pref.get(task["task_type"]) else 0.55
            dist = abs(r["x"] - zone["x"]) + abs(r["y"] - zone["y"])
            return float(np.dot(np.array([0.45, 0.35, 0.20]), np.array([bat, tp, 1.0 / (1 + dist / 25.0)])))

        best = None
        for s, sv in s_scores:
            for r in robots:
                rv = robot_score(r)
                total = 0.6 * sv + 0.4 * rv
                if best is None or total > best[2]:
                    best = (s, r, total, sv, rv)
        s, r, total, sv, rv = best

        conn.execute("BEGIN")
        conn.execute("UPDATE tasks SET assignee_id=?, robot_id=?, version=version+1 WHERE id=?",
                     (s["id"], r["id"], task_id))
        conn.execute("UPDATE staff SET status='busy' WHERE id=?", (s["id"],))
        conn.execute("UPDATE robots SET status='working' WHERE id=?", (r["id"],))
        conn.execute(
            "INSERT INTO task_logs(task_id,action,from_status,to_status,operator_id,note) VALUES (?,?,?,?,?,?)",
            (task_id, "智能派单", task["status"], task["status"], user["id"],
             f"调度算法得分 {total:.3f}（人 {sv:.3f} / 机 {rv:.3f}）"))
        conn.commit()
        return {
            "staff": {"id": s["id"], "name": s["name"], "score": round(sv, 3)},
            "robot": {"id": r["id"], "name": r["name"], "score": round(rv, 3)},
            "total": round(total, 3),
        }
    except BizError:
        conn.rollback()
        raise
    finally:
        conn.close()


def release_task_resources(conn, task_row):
    """任务结束时把人/机占用的状态放掉。抽出来是因为流转和取消都要用。"""
    if task_row["assignee_id"]:
        conn.execute("UPDATE staff SET status='idle', workload=MAX(0, workload-0.3) WHERE id=?",
                     (task_row["assignee_id"],))
    if task_row["robot_id"]:
        conn.execute("UPDATE robots SET status='idle' WHERE id=? AND status='working'",
                     (task_row["robot_id"],))


# ======================================================================
# 四、物料审批（审批流 + 库存一致性事务）
# ======================================================================

def approve_request(req_id, user, approve=True, note=""):
    """批准领料：通过的瞬间在同一事务里扣库存，
    库存不够直接整张单驳回，绝不允许扣成负数。"""
    if user["role"] not in ("leader", "dispatcher"):
        raise BizError("只有洁净班长/调度工程师能审批领用单", 403)
    conn = get_conn()
    try:
        req = conn.execute("SELECT * FROM material_requests WHERE id=?", (req_id,)).fetchone()
        if not req:
            raise BizError("审批单不存在", 404)
        _check(REQUEST_FLOW, req["status"], "approved" if approve else "rejected", "领用单")

        conn.execute("BEGIN")
        if approve:
            mat = conn.execute("SELECT * FROM materials WHERE id=?", (req["material_id"],)).fetchone()
            if mat["stock"] < req["quantity"]:
                conn.rollback()
                raise BizError(f"库存不足：{mat['name']} 现存 {mat['stock']}{mat['unit']}，"
                               f"申领 {req['quantity']}{mat['unit']}，无法批准")
            conn.execute("UPDATE materials SET stock=stock-? WHERE id=?", (req["quantity"], req["material_id"]))
            # 扣完再查安全线，跌破了就自动生成补货报警
            left = conn.execute("SELECT stock,safety_stock,name FROM materials WHERE id=?",
                                (req["material_id"],)).fetchone()
            if left["stock"] < left["safety_stock"]:
                code = "AL-STK-" + datetime.datetime.now().strftime("%H%M%S%f")
                conn.execute(
                    "INSERT INTO alarms(code,level,source,zone_id,title,detail,status) VALUES (?,?,?,?,?,?,'open')",
                    (code, "minor", "manual", None, f"{left['name']} 跌破安全库存",
                     f"现存 {left['stock']}，安全线 {left['safety_stock']}，请采购补货"))
        conn.execute(
            "UPDATE material_requests SET status=?, approver_id=?, approved_at=datetime('now','localtime') WHERE id=?",
            ("approved" if approve else "rejected", user["id"], req_id))
        conn.commit()
        return dict(conn.execute("SELECT * FROM material_requests WHERE id=?", (req_id,)).fetchone())
    except BizError:
        conn.rollback()
        raise
    finally:
        conn.close()


# ======================================================================
# 五、验收判定（数据一致性：实测值 vs 标准值 自动定结论）
# ======================================================================

def judge_inspection(method, result_value, standard):
    """不同验收方法判定方向不一样：
    粒子数/ATP/沉降菌/表面残留 全是"越小越好"，所以统一 <= 判定。
    留这个函数是为了将来接入"越大越好"的指标时不用改路由。"""
    if result_value is None or standard is None:
        raise BizError("实测值与判定标准不能为空")
    return "pass" if float(result_value) <= float(standard) else "fail"


def submit_inspection(insp_id, user, result_value, note=""):
    """提交验收单：自动定结论；若关联任务，联动任务状态机。
    质检员提交后单子进入 submitted，等班长复核批准。"""
    conn = get_conn()
    try:
        insp = conn.execute("SELECT * FROM inspections WHERE id=?", (insp_id,)).fetchone()
        if not insp:
            raise BizError("验收单不存在", 404)
        _check(INSPECTION_FLOW, insp["status"], "submitted", "验收单")
        conclusion = judge_inspection(insp["method"], result_value, insp["standard"])
        conn.execute("BEGIN")
        conn.execute(
            "UPDATE inspections SET result_value=?, conclusion=?, status='submitted', note=?, inspector_id=? WHERE id=?",
            (result_value, conclusion, note, user["id"], insp_id))
        conn.commit()
        return dict(conn.execute("SELECT * FROM inspections WHERE id=?", (insp_id,)).fetchone()), conclusion
    except BizError:
        conn.rollback()
        raise
    finally:
        conn.close()


def review_inspection(insp_id, user, approve=True):
    """班长复核验收单。批准且结论 pass → 关联任务流转 passed；
    结论 fail → 任务打回 failed 走返工。全在一个事务里。"""
    if user["role"] not in ("leader", "inspector"):
        raise BizError("只有洁净班长/质检员能复核验收单", 403)
    conn = get_conn()
    try:
        insp = conn.execute("SELECT * FROM inspections WHERE id=?", (insp_id,)).fetchone()
        if not insp:
            raise BizError("验收单不存在", 404)
        _check(INSPECTION_FLOW, insp["status"], "approved" if approve else "rejected", "验收单")
        conn.execute("BEGIN")
        conn.execute("UPDATE inspections SET status=? WHERE id=?",
                     ("approved" if approve else "rejected", insp_id))
        task_changed = None
        if approve and insp["task_id"]:
            t = conn.execute("SELECT * FROM tasks WHERE id=?", (insp["task_id"],)).fetchone()
            if t and t["status"] == "awaiting_inspection":
                nxt = "passed" if insp["conclusion"] == "pass" else "failed"
                conn.execute("UPDATE tasks SET status=?, clean_score=?, version=version+1 WHERE id=?",
                             (nxt, 95.0 if nxt == "passed" else 45.0, t["id"]))
                conn.execute(
                    "INSERT INTO task_logs(task_id,action,from_status,to_status,operator_id,note) VALUES (?,?,?,?,?,?)",
                    (t["id"], "验收联动", "awaiting_inspection", nxt, user["id"],
                     f"验收单 {insp['code']} 复核通过，结论 {'合格' if nxt=='passed' else '不合格'}"))
                release_task_resources(conn, t)
                task_changed = nxt
        conn.commit()
        return dict(conn.execute("SELECT * FROM inspections WHERE id=?", (insp_id,)).fetchone()), task_changed
    except BizError:
        conn.rollback()
        raise
    finally:
        conn.close()


# ======================================================================
# 六、报警处理流转
# ======================================================================

def handle_alarm(alarm_id, user, action, note=""):
    """action: process / resolve / ignore"""
    target = {"process": "processing", "resolve": "resolved", "ignore": "ignored"}
    if action not in target:
        raise BizError("未知的报警处理动作")
    nxt = target[action]
    conn = get_conn()
    try:
        a = conn.execute("SELECT * FROM alarms WHERE id=?", (alarm_id,)).fetchone()
        if not a:
            raise BizError("报警不存在", 404)
        _check(ALARM_FLOW, a["status"], nxt, "报警")
        if action == "resolve" and user["role"] not in ("leader", "dispatcher", "inspector"):
            raise BizError("关闭报警需要班长/调度/质检角色确认", 403)
        conn.execute("UPDATE alarms SET status=?, handler_id=?, handled_at=datetime('now','localtime') WHERE id=?",
                     (nxt, user["id"], alarm_id))
        # 报警解除联动区域状态恢复
        if action == "resolve" and a["zone_id"]:
            open_cnt = conn.execute(
                "SELECT COUNT(*) c FROM alarms WHERE zone_id=? AND status IN ('open','processing')",
                (a["zone_id"],)).fetchone()["c"]
            if open_cnt == 0:
                conn.execute("UPDATE zones SET status='normal' WHERE id=?", (a["zone_id"],))
        conn.commit()
        return dict(conn.execute("SELECT * FROM alarms WHERE id=?", (alarm_id,)).fetchone())
    except BizError:
        conn.rollback()
        raise
    finally:
        conn.close()
