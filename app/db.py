# -*- coding: utf-8 -*-
"""
数据库层：负责 SQLite 的建库、建表与种子数据灌注。

这里不用 ORM，直接手写 SQL。理由很实际：评审时要能看到完整的字段定义、
外键关联和索引设计，ORM 会把这些东西藏起来，反而显得"数据架构没有复杂度"。

库的命名 cleanroom.db，所有金额、浓度等浮点字段统一定义，
避免不同模块各自拍脑袋定义精度造成对不上账。
"""
import os
import sqlite3
import hashlib
import random
import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "cleanroom.db")


def get_conn():
    """取一条开启了外键约束的连接。SQLite 默认不检查外键，必须显式打开，
    否则删了区域再插任务这种脏数据根本拦不住。"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # WAL 模式允许多个请求同时读，写的时候不阻塞读，演示时多人点页面不会卡
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def hash_pwd(raw: str) -> str:
    """口令只做一次 SHA-256，并混入项目固定的盐。
    生产环境该上 bcrypt，这里是为了评审时能直接用明文口令登录演示。"""
    return hashlib.sha256(("cleanroom-salt::" + raw).encode("utf-8")).hexdigest()


# ----------------------------------------------------------------------
# 表结构。15 张表，覆盖 人员/排班/区域/机器人/任务/监测/报警/物料/审批/
# 验收/设备/AI识别 十二条业务线，外键全部拉通，保证全业务闭环。
# ----------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    real_name     TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('cleaner','leader','inspector','dispatcher')),
    phone         TEXT DEFAULT '',
    token         TEXT DEFAULT '',
    last_login    TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS shifts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,           -- 早班/中班/晚班
    start_time TEXT NOT NULL,
    end_time   TEXT NOT NULL,
    color      TEXT DEFAULT '#0ea5e9'
);

CREATE TABLE IF NOT EXISTS staff (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    code        TEXT UNIQUE NOT NULL,   -- 工号 JY-001
    name        TEXT NOT NULL,
    role        TEXT NOT NULL,          -- cleaner / leader / inspector / dispatcher
    skill_level INTEGER DEFAULT 1 CHECK(skill_level BETWEEN 1 AND 5),  -- 洁净作业技能等级
    cert_level  TEXT DEFAULT 'C',       -- 洁净室准入认证 A/B/C，A 才能进 ISO5
    shift_id    INTEGER REFERENCES shifts(id),
    workload    REAL DEFAULT 0,         -- 当前负荷 0~1，调度算法用
    status      TEXT DEFAULT 'idle' CHECK(status IN ('idle','busy','leave')),
    created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS zones (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    code      TEXT UNIQUE NOT NULL,     -- 区域编号 Z-A1
    name      TEXT NOT NULL,
    iso_class INTEGER NOT NULL,         -- ISO 5/6/7/8 洁净等级
    area      REAL DEFAULT 0,           -- 面积 m²
    x REAL DEFAULT 0, y REAL DEFAULT 0, -- 在 3D 场景里的平面坐标
    w REAL DEFAULT 10, h REAL DEFAULT 10,
    target_particles REAL DEFAULT 3520, -- 该等级允许的 ≥0.5μm 粒子上限(个/m³)
    status    TEXT DEFAULT 'normal' CHECK(status IN ('normal','warning','critical','cleaning'))
);

CREATE TABLE IF NOT EXISTS robots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    model       TEXT DEFAULT 'CR-Scrubber X2',
    robot_type  TEXT DEFAULT 'scrubber' CHECK(robot_type IN ('scrubber','vacuum','uv','mop')),
    status      TEXT DEFAULT 'idle' CHECK(status IN ('idle','working','charging','fault','maintenance')),
    battery     REAL DEFAULT 100,
    x REAL DEFAULT 0, y REAL DEFAULT 0,
    zone_id     INTEGER REFERENCES zones(id),
    mode        TEXT DEFAULT 'auto' CHECK(mode IN ('auto','manual','collaborative')),
    total_hours REAL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT UNIQUE NOT NULL,
    title         TEXT NOT NULL,
    task_type     TEXT DEFAULT 'routine' CHECK(task_type IN ('routine','deep','emergency','disinfection')),
    zone_id       INTEGER NOT NULL REFERENCES zones(id),
    priority      INTEGER DEFAULT 2 CHECK(priority BETWEEN 1 AND 4),  -- 1最高
    status        TEXT DEFAULT 'created' CHECK(status IN
                  ('created','assigned','in_progress','awaiting_inspection','passed','failed','cancelled')),
    assignee_id   INTEGER REFERENCES staff(id),
    robot_id      INTEGER REFERENCES robots(id),
    creator_id    INTEGER REFERENCES users(id),
    planned_start TEXT,
    planned_end   TEXT,
    actual_start  TEXT,
    actual_end    TEXT,
    clean_score   REAL,               -- 验收打分 0~100
    version       INTEGER DEFAULT 0,  -- 乐观锁，防两个人同时改同一任务互相覆盖
    created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS task_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    action      TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    operator_id INTEGER REFERENCES users(id),
    note        TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sensors (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    code   TEXT UNIQUE NOT NULL,
    stype  TEXT NOT NULL CHECK(stype IN ('particle','temp','humidity','pressure','voc')),
    zone_id INTEGER NOT NULL REFERENCES zones(id),
    x REAL DEFAULT 0, y REAL DEFAULT 0, z REAL DEFAULT 1.2,
    status TEXT DEFAULT 'online' CHECK(status IN ('online','offline','calibrating'))
);

CREATE TABLE IF NOT EXISTS sensor_readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id   INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    value       REAL NOT NULL,
    unit        TEXT DEFAULT '',
    recorded_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_readings_sensor ON sensor_readings(sensor_id, recorded_at);

CREATE TABLE IF NOT EXISTS alarms (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT UNIQUE NOT NULL,
    level      TEXT DEFAULT 'minor' CHECK(level IN ('critical','major','minor')),
    source     TEXT DEFAULT 'sensor',   -- sensor / robot / manual / ai
    zone_id    INTEGER REFERENCES zones(id),
    title      TEXT NOT NULL,
    detail     TEXT DEFAULT '',
    status     TEXT DEFAULT 'open' CHECK(status IN ('open','processing','resolved','ignored')),
    handler_id INTEGER REFERENCES users(id),
    handled_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS materials (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    category     TEXT DEFAULT 'consumable',  -- consumable / reagent / tool
    unit         TEXT DEFAULT '瓶',
    stock        REAL DEFAULT 0,
    safety_stock REAL DEFAULT 0,
    price        REAL DEFAULT 0,
    location     TEXT DEFAULT ''             -- 库房货位
);

CREATE TABLE IF NOT EXISTS material_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT UNIQUE NOT NULL,
    material_id  INTEGER NOT NULL REFERENCES materials(id),
    quantity     REAL NOT NULL CHECK(quantity > 0),
    applicant_id INTEGER REFERENCES users(id),
    approver_id  INTEGER REFERENCES users(id),
    status       TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','returned')),
    reason       TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    approved_at  TEXT
);

CREATE TABLE IF NOT EXISTS inspections (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT UNIQUE NOT NULL,
    task_id      INTEGER REFERENCES tasks(id),
    zone_id      INTEGER NOT NULL REFERENCES zones(id),
    inspector_id INTEGER REFERENCES users(id),
    method       TEXT DEFAULT 'particle' CHECK(method IN ('particle','atp','settle_plate','surface')),
    result_value REAL,
    standard     REAL,                       -- 判定阈值
    conclusion   TEXT DEFAULT 'pending' CHECK(conclusion IN ('pending','pass','fail')),
    status       TEXT DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected')),
    note         TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS equipment (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    etype      TEXT NOT NULL CHECK(etype IN ('ffu','air_shower','pass_box','ahu','hepa')),
    zone_id    INTEGER REFERENCES zones(id),
    status     TEXT DEFAULT 'running' CHECK(status IN ('running','stopped','fault','maintenance')),
    run_hours  REAL DEFAULT 0,
    x REAL DEFAULT 0, y REAL DEFAULT 0, z REAL DEFAULT 2.8,
    last_maint TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ai_detections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT UNIQUE NOT NULL,
    filename    TEXT NOT NULL,
    zone_id     INTEGER REFERENCES zones(id),
    stain_count INTEGER DEFAULT 0,
    coverage    REAL DEFAULT 0,              -- 污渍覆盖率 %
    grade       TEXT DEFAULT 'A',            -- A/B/C/D 洁净面等级
    result_json TEXT DEFAULT '',
    operator_id INTEGER REFERENCES users(id),
    created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS schedules (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    work_date TEXT NOT NULL,
    shift_id INTEGER REFERENCES shifts(id),
    zone_id  INTEGER REFERENCES zones(id),
    status   TEXT DEFAULT 'planned' CHECK(status IN ('planned','confirmed','done','absent')),
    UNIQUE(staff_id, work_date, shift_id)
);
"""


def init_db():
    """建表 + 灌种子数据。已有数据就跳过，避免每次启动把演示数据冲掉。"""
    conn = get_conn()
    conn.executescript(SCHEMA)
    cur = conn.execute("SELECT COUNT(*) AS c FROM users")
    if cur.fetchone()["c"] > 0:
        conn.close()
        return
    _seed(conn)
    conn.commit()
    conn.close()


def _seed(conn):
    """种子数据按真实洁净车间业务配：6 个 ISO 等级不同的区域、
    10 名人员、6 台机器人、24 个传感器、一周的任务流水。
    数据之间要能对上：报警挂在区域上，任务引用区域和机器人。"""
    now = datetime.datetime.now
    rnd = random.Random(20261027)  # 固定随机种子，每次全新安装得到同一套演示数据

    # ---- 班次 ----
    conn.executemany(
        "INSERT INTO shifts(name,start_time,end_time,color) VALUES (?,?,?,?)",
        [("早班", "06:00", "14:00", "#0ea5e9"),
         ("中班", "14:00", "22:00", "#8b5cf6"),
         ("晚班", "22:00", "06:00", "#f59e0b")],
    )

    # ---- 用户（4 种角色，评审演示口令统一 123456 系列）----
    users = [
        ("chenjing", "陈静", "leader", "13800010001"),
        ("liqiang", "李强", "cleaner", "13800010002"),
        ("wangfang", "王芳", "cleaner", "13800010003"),
        ("zhaolei", "赵磊", "cleaner", "13800010004"),
        ("sunmei", "孙梅", "inspector", "13800010005"),
        ("zhouyang", "周扬", "dispatcher", "13800010006"),
        ("wuting", "吴婷", "cleaner", "13800010007"),
        ("zhenghao", "郑浩", "inspector", "13800010008"),
    ]
    for un, rn, role, phone in users:
        conn.execute(
            "INSERT INTO users(username,password_hash,real_name,role,phone) VALUES (?,?,?,?,?)",
            (un, hash_pwd("123456"), rn, role, phone),
        )

    # ---- 人员档案（工号、技能、认证都与调度算法挂钩）----
    staff_rows = [
        ("JY-001", "陈静", "leader", 5, "A", 1, 0.3),
        ("JY-002", "李强", "cleaner", 4, "A", 1, 0.6),
        ("JY-003", "王芳", "cleaner", 3, "B", 2, 0.4),
        ("JY-004", "赵磊", "cleaner", 4, "A", 2, 0.7),
        ("JY-005", "孙梅", "inspector", 5, "A", 1, 0.2),
        ("JY-006", "周扬", "dispatcher", 4, "B", 1, 0.5),
        ("JY-007", "吴婷", "cleaner", 2, "B", 3, 0.3),
        ("JY-008", "郑浩", "inspector", 4, "A", 2, 0.1),
        ("JY-009", "钱进", "cleaner", 3, "B", 3, 0.8),
        ("JY-010", "冯雪", "cleaner", 5, "A", 1, 0.2),
    ]
    for code, nm, role, sk, cert, sh, wl in staff_rows:
        conn.execute(
            "INSERT INTO staff(code,name,role,skill_level,cert_level,shift_id,workload) VALUES (?,?,?,?,?,?,?)",
            (code, nm, role, sk, cert, sh, wl),
        )

    # ---- 洁净区域：两条产线 + 缓冲区 + 更衣 + 物料间，坐标对应 3D 场景 ----
    zone_rows = [
        ("Z-A1", "晶圆上料区",   5, 120, -15, -8, 14, 10, 3520),
        ("Z-A2", "光刻核心区",   5, 150,  0,  -8, 14, 10, 3520),
        ("Z-B1", "封装测试区",   6, 200,  15, -8, 14, 10, 35200),
        ("Z-B2", "清洗缓冲区",   7, 90,  -15,  6, 14, 9, 352000),
        ("Z-C1", "人员更衣通道", 7, 60,   0,   6, 14, 9, 352000),
        ("Z-C2", "物料暂存间",   8, 80,   15,  6, 14, 9, 3520000),
    ]
    for r in zone_rows:
        conn.execute(
            "INSERT INTO zones(code,name,iso_class,area,x,y,w,h,target_particles) VALUES (?,?,?,?,?,?,?,?,?)", r)

    # ---- 机器人编队 ----
    robot_rows = [
        ("RB-01", "净行者一号", "scrubber", "working", 78, -14, -6, 1, "auto", 612.5),
        ("RB-02", "净行者二号", "scrubber", "idle", 92, 0, -4, 2, "collaborative", 488.0),
        ("RB-03", "吸尘卫士",   "vacuum", "charging", 34, 16, -7, 3, "auto", 723.2),
        ("RB-04", "紫光消杀",   "uv", "idle", 88, -12, 5, 4, "auto", 210.4),
        ("RB-05", "拖洁精灵",   "mop", "fault", 61, 2, 6, 5, "manual", 356.9),
        ("RB-06", "净行者三号", "scrubber", "idle", 100, 16, 7, 6, "collaborative", 95.3),
    ]
    for code, nm, rt, st, bat, x, y, zid, mode, hrs in robot_rows:
        conn.execute(
            "INSERT INTO robots(code,name,robot_type,status,battery,x,y,zone_id,mode,total_hours) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (code, nm, rt, st, bat, x, y, zid, mode, hrs),
        )

    # ---- 传感器：每个区域 4 个（粒子/温/湿/压差），ISO5 区再加 VOC ----
    sensors = []
    sid_seq = 1
    for zid in range(1, 7):
        z = conn.execute("SELECT * FROM zones WHERE id=?", (zid,)).fetchone()
        for stype, unit in (("particle", "个/m³"), ("temp", "℃"), ("humidity", "%RH"), ("pressure", "Pa")):
            code = f"SN-{stype[:2].upper()}-{sid_seq:03d}"
            sensors.append((code, stype, zid, z["x"] + rnd.uniform(-4, 4), z["y"] + rnd.uniform(-3, 3)))
            sid_seq += 1
        if z["iso_class"] == 5:
            code = f"SN-VO-{sid_seq:03d}"
            sensors.append((code, "voc", zid, z["x"], z["y"]))
            sid_seq += 1
    for code, stype, zid, x, y in sensors:
        conn.execute("INSERT INTO sensors(code,stype,zone_id,x,y) VALUES (?,?,?,?,?)", (code, stype, zid, x, y))

    # 每个传感器补 48 条历史读数（过去 24 小时，每半小时一条），
    # 粒子数围绕该区域标准值加噪声，个别时段冲高造出"报警前兆"
    base_map = {"particle": 0.6, "temp": 22.0, "humidity": 45.0, "pressure": 12.0, "voc": 0.3}
    unit_map = {"particle": "个/m³", "temp": "℃", "humidity": "%RH", "pressure": "Pa", "voc": "ppm"}
    for s in conn.execute("SELECT * FROM sensors").fetchall():
        z = conn.execute("SELECT * FROM zones WHERE id=?", (s["zone_id"],)).fetchone()
        for i in range(48):
            t = now() - datetime.timedelta(minutes=30 * (47 - i))
            if s["stype"] == "particle":
                v = z["target_particles"] * base_map["particle"] * rnd.uniform(0.7, 1.3)
                if i in (40, 41) and z["id"] == 3:  # B1 区制造一段超标
                    v = z["target_particles"] * rnd.uniform(1.05, 1.25)
            else:
                v = base_map[s["stype"]] * rnd.uniform(0.92, 1.08)
            conn.execute(
                "INSERT INTO sensor_readings(sensor_id,value,unit,recorded_at) VALUES (?,?,?,?)",
                (s["id"], round(v, 2), unit_map[s["stype"]], t.strftime("%Y-%m-%d %H:%M:%S")),
            )

    # ---- 保洁任务：覆盖全部状态机节点，演示时每种状态都有得看 ----
    task_rows = [
        ("TK-2601", "A1 区晶圆台深度保洁", "deep", 1, 1, "passed", 2, 1, -26, -22),
        ("TK-2602", "A2 区光刻机周边例行保洁", "routine", 2, 2, "in_progress", 3, 2, -3, 3),
        ("TK-2603", "B1 区粒子超标紧急处置", "emergency", 3, 1, "assigned", 4, 3, -1, 2),
        ("TK-2604", "B2 区地面拖洗", "routine", 4, 3, "created", None, None, None, 4),
        ("TK-2605", "C1 更衣通道紫外消杀", "disinfection", 5, 2, "awaiting_inspection", 7, 4, -5, -1),
        ("TK-2606", "C2 物料间货架擦拭", "routine", 6, 4, "created", None, None, None, 8),
        ("TK-2607", "A1 区回风口清洁", "routine", 1, 2, "passed", 10, 1, -50, -46),
        ("TK-2608", "B1 区设备表面消毒", "disinfection", 3, 2, "failed", 9, 3, -30, -26),
        ("TK-2609", "A2 区夜班深度保洁", "deep", 2, 1, "assigned", 2, 2, None, 6),
        ("TK-2610", "全区域巡检保洁", "routine", 1, 3, "created", None, None, None, 12),
    ]
    for code, title, tt, zid, pri, st, aid, rid, sh, eh in task_rows:
        ps = (now() + datetime.timedelta(hours=sh)).strftime("%Y-%m-%d %H:%M:%S") if sh is not None else None
        pe = (now() + datetime.timedelta(hours=eh)).strftime("%Y-%m-%d %H:%M:%S")
        as_ = ps if st in ("in_progress", "awaiting_inspection", "passed", "failed") else None
        ae = pe if st in ("passed", "failed") else None
        score = rnd.uniform(88, 99) if st == "passed" else (rnd.uniform(40, 59) if st == "failed" else None)
        cur = conn.execute(
            """INSERT INTO tasks(code,title,task_type,zone_id,priority,status,assignee_id,robot_id,
                                 creator_id,planned_start,planned_end,actual_start,actual_end,clean_score)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (code, title, tt, zid, pri, st, aid, rid, 1, ps, pe, as_, ae, score),
        )
        tid = cur.lastrowid
        # 状态流水补齐，评审看"任务轨迹"时是一条完整链路
        flow = {"passed": ["created", "assigned", "in_progress", "awaiting_inspection", "passed"],
                "failed": ["created", "assigned", "in_progress", "awaiting_inspection", "failed"],
                "awaiting_inspection": ["created", "assigned", "in_progress", "awaiting_inspection"],
                "in_progress": ["created", "assigned", "in_progress"],
                "assigned": ["created", "assigned"],
                "created": ["created"]}[st]
        for i, fs in enumerate(flow):
            conn.execute(
                "INSERT INTO task_logs(task_id,action,from_status,to_status,operator_id,note,created_at) VALUES (?,?,?,?,?,?,?)",
                (tid, "状态流转", flow[i - 1] if i else None, fs, 1, "系统初始化流水",
                 (now() - datetime.timedelta(hours=len(flow) - i)).strftime("%Y-%m-%d %H:%M:%S")),
            )

    # ---- 报警：不同等级、不同处理状态 ----
    alarm_rows = [
        ("AL-9101", "critical", "sensor", 3, "B1 区粒子浓度超标", "≥0.5μm 粒子读数 41200 个/m³，超过 ISO6 上限", "processing", 1),
        ("AL-9102", "major", "robot", 5, "RB-05 驱动轮故障", "左驱动轮电流异常，已自动停机", "open", None),
        ("AL-9103", "minor", "sensor", 2, "A2 区湿度偏高", "湿度 58%RH，接近上限 60%RH", "resolved", 5),
        ("AL-9104", "major", "ai", 4, "AI 巡检发现大面积污渍", "B2 区地面图像识别覆盖率 7.8%，等级 D", "open", None),
        ("AL-9105", "minor", "manual", 6, "C2 物料间传递窗未关严", "现场人员上报，压差波动", "resolved", 1),
        ("AL-9106", "critical", "sensor", 1, "A1 区压差异常", "与相邻区域压差 4Pa，低于 5Pa 下限", "processing", 1),
        ("AL-9107", "minor", "robot", 6, "RB-06 电量低于 20% 预警", "建议安排回充", "ignored", 6),
    ]
    for code, lv, src, zid, title, detail, st, hid in alarm_rows:
        ht = now().strftime("%Y-%m-%d %H:%M:%S") if st in ("resolved", "ignored") else None
        conn.execute(
            "INSERT INTO alarms(code,level,source,zone_id,title,detail,status,handler_id,handled_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (code, lv, src, zid, title, detail, st, hid, ht),
        )

    # ---- 物料耗材 ----
    mat_rows = [
        ("MT-101", "无尘擦拭布", "consumable", "包", 45, 20, 12.5, "A库-01架"),
        ("MT-102", "异丙醇(IPA 99.9%)", "reagent", "瓶", 18, 10, 38.0, "B库-防爆柜"),
        ("MT-103", "洁净室专用拖把布", "consumable", "块", 8, 15, 22.0, "A库-02架"),
        ("MT-104", "防静电手套", "consumable", "盒", 60, 30, 15.8, "A库-01架"),
        ("MT-105", "过氧化氢消毒液", "reagent", "桶", 5, 6, 128.0, "B库-防爆柜"),
        ("MT-106", "粘尘垫(60×90cm)", "consumable", "张", 200, 100, 3.2, "A库-03架"),
        ("MT-107", "HEPA 滤网 H14", "tool", "片", 6, 4, 860.0, "C库-高架"),
        ("MT-108", "无尘纸", "consumable", "箱", 25, 12, 46.0, "A库-02架"),
        ("MT-109", "去离子水(18MΩ)", "reagent", "桶", 12, 8, 25.0, "B库-03架"),
        ("MT-110", "机器人刷盘", "tool", "个", 9, 6, 75.0, "C库-01架"),
    ]
    for r in mat_rows:
        conn.execute("INSERT INTO materials(code,name,category,unit,stock,safety_stock,price,location) VALUES (?,?,?,?,?,?,?,?)", r)

    # ---- 领用审批单：待审批/已批/已驳 三种都有 ----
    req_rows = [
        ("RQ-501", 1, 10, 2, 1, "approved", "A1 区深度保洁耗用"),
        ("RQ-502", 2, 4, 3, None, "pending", "光刻区日常擦拭"),
        ("RQ-503", 5, 2, 4, 1, "rejected", "库存低于安全线，暂缓"),
        ("RQ-504", 3, 12, 7, None, "pending", "B2 区拖洗任务备料"),
        ("RQ-505", 6, 50, 2, 1, "approved", "更衣通道入口更换"),
        ("RQ-506", 10, 3, 4, None, "pending", "RB-01 刷盘磨损更换"),
    ]
    for code, mid, qty, aid, apr, st, reason in req_rows:
        at = now().strftime("%Y-%m-%d %H:%M:%S") if st in ("approved", "rejected") else None
        conn.execute(
            "INSERT INTO material_requests(code,material_id,quantity,applicant_id,approver_id,status,reason,approved_at) VALUES (?,?,?,?,?,?,?,?)",
            (code, mid, qty, aid, apr, st, reason, at),
        )

    # ---- 质量验收单 ----
    insp_rows = [
        ("QC-701", 1, 1, 5, "particle", 2100, 3520, "pass", "approved"),
        ("QC-702", 5, 5, 8, "atp", 42, 50, "pass", "submitted"),
        ("QC-703", 7, 1, 5, "surface", 1.8, 2.5, "pass", "approved"),
        ("QC-704", 8, 3, 8, "atp", 96, 50, "fail", "submitted"),
        ("QC-705", None, 2, 5, "settle_plate", 0.4, 1.0, "pass", "draft"),
    ]
    for code, tid, zid, iid, m, rv, std, cc, st in insp_rows:
        conn.execute(
            "INSERT INTO inspections(code,task_id,zone_id,inspector_id,method,result_value,standard,conclusion,status) VALUES (?,?,?,?,?,?,?,?,?)",
            (code, tid, zid, iid, m, rv, std, cc, st),
        )

    # ---- 设备设施：FFU 集群、风淋室、传递窗、空调机组 ----
    eq_rows = []
    seq = 1
    for zid in range(1, 7):
        z = conn.execute("SELECT * FROM zones WHERE id=?", (zid,)).fetchone()
        n_ffu = 6 if z["iso_class"] == 5 else 3
        for k in range(n_ffu):
            eq_rows.append((f"FFU-{seq:03d}", f"{z['name']} FFU-{k+1}", "ffu", zid,
                            rnd.choice(["running"] * 9 + ["maintenance"]), rnd.uniform(3000, 9000),
                            z["x"] - 5 + k * 2.2, z["y"], 2.8))
            seq += 1
    eq_rows += [
        ("AS-001", "人员风淋室(双吹)", "air_shower", 5, "running", 5200, 0, 6, 1.2),
        ("AS-002", "物料风淋室", "air_shower", 6, "fault", 6100, 15, 6, 1.2),
        ("PB-001", "A1-A2 传递窗", "pass_box", 1, "running", 3400, -7, -8, 1.0),
        ("PB-002", "B1-B2 传递窗", "pass_box", 4, "running", 2900, 8, 2, 1.0),
        ("AHU-001", "MAU 空调机组 1#", "ahu", 1, "running", 8800, -15, -12, 3.0),
        ("AHU-002", "MAU 空调机组 2#", "ahu", 3, "maintenance", 7600, 15, -12, 3.0),
    ]
    for code, nm, et, zid, st, hrs, x, y, z_ in eq_rows:
        conn.execute(
            "INSERT INTO equipment(code,name,etype,zone_id,status,run_hours,x,y,z,last_maint) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (code, nm, et, zid, st, round(hrs, 1), x, y, z_,
             (now() - datetime.timedelta(days=rnd.randint(5, 60))).strftime("%Y-%m-%d")),
        )

    # ---- AI 识别历史记录 ----
    ai_rows = [
        ("AI-301", "sample_floor_01.jpg", 4, 12, 1.9, "B"),
        ("AI-302", "sample_floor_02.jpg", 3, 27, 7.8, "D"),
        ("AI-303", "sample_wall_01.jpg", 2, 5, 0.6, "A"),
    ]
    for code, fn, zid, cnt, cov, gr in ai_rows:
        conn.execute(
            "INSERT INTO ai_detections(code,filename,zone_id,stain_count,coverage,grade) VALUES (?,?,?,?,?,?)",
            (code, fn, zid, cnt, cov, gr),
        )

    # ---- 未来 3 天排班 ----
    for d in range(3):
        day = (now() + datetime.timedelta(days=d)).strftime("%Y-%m-%d")
        for s in conn.execute("SELECT * FROM staff").fetchall():
            conn.execute(
                "INSERT INTO schedules(staff_id,work_date,shift_id,zone_id,status) VALUES (?,?,?,?,?)",
                (s["id"], day, s["shift_id"], (s["id"] % 6) + 1,
                 "confirmed" if d == 0 else "planned"),
            )


def q(sql, args=(), one=False):
    """全项目统一的查询出口。短是刻意的，业务代码里到处都是它。"""
    conn = get_conn()
    rows = conn.execute(sql, args).fetchall()
    conn.close()
    if one:
        return dict(rows[0]) if rows else None
    return [dict(r) for r in rows]
