# -*- coding: utf-8 -*-
"""M06 AI 视觉巡检：样本管理、污渍识别、历史记录。

识别算法本身在 ai_engine.py（OpenCV 那套），这里只负责接文件、
落库、联动报警。大面积污渍必须自动开报警单 —— 检出来没人管等于没检。
"""
import os
import json
import functools
import datetime
from flask import Blueprint, jsonify, request, g, current_app

from ..db import get_conn, q
from ..rules import BizError
from ..ai_engine import detect_contamination, ensure_samples, SAMPLE_DIR

bp = Blueprint("ai", __name__, url_prefix="/api/ai")

GRADE_TEXT = {"A": "洁净", "B": "基本洁净", "C": "轻度污染", "D": "重度污染"}


def auth_required(fn):
    """import 期 current_app 未绑定，装饰器推迟到请求时再取（见 m01 同款坑）。"""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return current_app.auth_required(fn)(*args, **kwargs)
    return wrapper


@bp.get("/samples")
@auth_required
def samples():
    """内置示例图，评审时没真照片也能当场演示识别。"""
    files = ensure_samples()
    return jsonify({"ok": True,
                    "data": [{"filename": f, "url": "/web/assets/samples/" + f}
                             for f in files]})


@bp.post("/detect")
@auth_required
def detect():
    """两种传图方式：multipart 文件上传，或指定内置样本名。
    检出 D 级或覆盖率>5% 自动拉起 major 报警。"""
    zone_id = request.values.get("zone_id", type=int)
    if zone_id is None and request.is_json:
        zone_id = (request.get_json(silent=True) or {}).get("zone_id")

    upload = request.files.get("file")
    if upload and upload.filename:
        image_bytes = upload.read()
        filename = upload.filename
    else:
        # 样本模式：名字必须掐头去尾只留文件名，防 ../ 路径穿越
        sample = os.path.basename((request.get_json(silent=True) or {}).get("sample") or "")
        path = os.path.join(SAMPLE_DIR, sample)
        if not sample or not os.path.isfile(path):
            raise BizError("请上传图片文件，或指定有效的示例样本名")
        with open(path, "rb") as fp:
            image_bytes = fp.read()
        filename = sample

    if zone_id and not q("SELECT 1 AS ok FROM zones WHERE id=?", (zone_id,), one=True):
        raise BizError("关联区域不存在")

    try:
        result = detect_contamination(image_bytes, filename)
    except ValueError as e:
        raise BizError(str(e))

    # 编号 AI-yymmdd-NNN，跟任务编号同一个套路：查当天最大尾号 +1
    conn = get_conn()
    try:
        prefix = "AI-" + datetime.datetime.now().strftime("%y%m%d")
        row = conn.execute(
            "SELECT code FROM ai_detections WHERE code LIKE ? ORDER BY code DESC LIMIT 1",
            (prefix + "-%",)).fetchone()
        seq = int(row["code"].rsplit("-", 1)[1]) + 1 if row else 1
        code = f"{prefix}-{seq:03d}"
        cur = conn.execute(
            """INSERT INTO ai_detections(code,filename,zone_id,stain_count,coverage,grade,
                                         result_json,operator_id)
               VALUES (?,?,?,?,?,?,?,?)""",
            (code, filename, zone_id, result["stain_count"], result["coverage"],
             result["grade"], json.dumps(result["boxes"], ensure_ascii=False), g.user["id"]))
        record_id = cur.lastrowid

        alarm_created = False
        if result["grade"] == "D" or result["coverage"] > 5:
            # 同一秒内可能连识别多张，编号必须带微秒才不会撞 UNIQUE 约束
            al_code = "AL-AI-" + datetime.datetime.now().strftime("%H%M%S%f")
            conn.execute(
                """INSERT INTO alarms(code,level,source,zone_id,title,detail,status)
                   VALUES (?,?,?,?,?,?,'open')""",
                (al_code, "major", "ai", zone_id, "AI巡检发现大面积污渍",
                 f"识别单 {code}：覆盖率 {result['coverage']}%，等级 {result['grade']}，"
                 f"污渍 {result['stain_count']} 处"))
            if zone_id:
                conn.execute("UPDATE zones SET status='warning' WHERE id=? AND status='normal'",
                             (zone_id,))
            alarm_created = True
        conn.commit()
    finally:
        conn.close()

    msg = (f"识别完成：{GRADE_TEXT.get(result['grade'], result['grade'])}（等级 {result['grade']}），"
           f"覆盖率 {result['coverage']}%，发现污渍 {result['stain_count']} 处")
    if alarm_created:
        msg += "，已自动生成报警单"
    return jsonify({"ok": True, "msg": msg,
                    "data": {"detection": result, "record_id": record_id,
                             "alarm_created": alarm_created}})


@bp.get("/history")
@auth_required
def history():
    rows = q("""
        SELECT d.*, z.name AS zone_name, u.real_name AS operator_name
        FROM ai_detections d
        LEFT JOIN zones z ON z.id = d.zone_id
        LEFT JOIN users u ON u.id = d.operator_id
        ORDER BY d.created_at DESC, d.id DESC
    """)
    for r in rows:
        r["grade_text"] = GRADE_TEXT.get(r["grade"], r["grade"])
    return jsonify({"ok": True, "data": rows})


@bp.delete("/<int:did>")
@auth_required
def detect_delete(did):
    conn = get_conn()
    cur = conn.execute("DELETE FROM ai_detections WHERE id=?", (did,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise BizError("识别记录不存在", 404)
    return jsonify({"ok": True, "msg": "识别记录已删除"})
