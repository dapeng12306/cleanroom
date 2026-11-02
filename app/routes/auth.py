# -*- coding: utf-8 -*-
"""认证模块：注册 / 登录 / 当前用户 / 退出。所有菜单共用的地基。"""
import secrets
from flask import Blueprint, g, jsonify, request, current_app

from ..db import get_conn, hash_pwd, q

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@bp.post("/register")
def register():
    """注册即建档：users 和 staff 同时写，不然登录后调度算法找不到人。
    角色四选一，前端注册页用项目专属角色卡，没有 admin 这种词。"""
    d = request.get_json(force=True)
    username = (d.get("username") or "").strip()
    password = (d.get("password") or "").strip()
    real_name = (d.get("real_name") or "").strip()
    role = d.get("role") or "cleaner"
    phone = (d.get("phone") or "").strip()
    if not username or not password or not real_name:
        return jsonify({"ok": False, "msg": "用户名、口令、姓名都不能为空"}), 400
    if role not in ("cleaner", "leader", "inspector", "dispatcher"):
        return jsonify({"ok": False, "msg": "角色不合法"}), 400
    if len(password) < 6:
        return jsonify({"ok": False, "msg": "口令至少 6 位"}), 400

    conn = get_conn()
    try:
        if conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            return jsonify({"ok": False, "msg": f"用户名 {username} 已被占用"}), 409
        conn.execute("BEGIN")
        cur = conn.execute(
            "INSERT INTO users(username,password_hash,real_name,role,phone) VALUES (?,?,?,?,?)",
            (username, hash_pwd(password), real_name, role, phone))
        # 工号接着现有最大号往下排
        seq = conn.execute("SELECT COUNT(*) c FROM staff").fetchone()["c"] + 1
        conn.execute(
            "INSERT INTO staff(user_id,code,name,role,skill_level,cert_level,shift_id) VALUES (?,?,?,?,?,?,?)",
            (cur.lastrowid, f"JY-{seq:03d}", real_name, role, 2, "B", (seq % 3) + 1))
        conn.commit()
        return jsonify({"ok": True, "msg": f"注册成功，工号 JY-{seq:03d}，请登录"})
    except Exception as e:
        conn.rollback()
        return jsonify({"ok": False, "msg": f"注册失败：{e}"}), 500
    finally:
        conn.close()


@bp.post("/login")
def login():
    d = request.get_json(force=True)
    username = (d.get("username") or "").strip()
    password = (d.get("password") or "").strip()
    row = q("SELECT * FROM users WHERE username=?", (username,), one=True)
    if not row or row["password_hash"] != hash_pwd(password):
        return jsonify({"ok": False, "msg": "用户名或口令错误"}), 401
    token = secrets.token_hex(16)
    conn = get_conn()
    conn.execute("UPDATE users SET token=?, last_login=datetime('now','localtime') WHERE id=?",
                 (token, row["id"]))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "msg": f"欢迎回来，{row['real_name']}",
                    "data": {"token": token, "username": row["username"],
                             "real_name": row["real_name"], "role": row["role"]}})


@bp.get("/me")
def me():
    from flask import current_app as app
    token = request.headers.get("X-Token", "")
    row = q("SELECT id,username,real_name,role FROM users WHERE token=?", (token,), one=True)
    if not row:
        return jsonify({"ok": False, "msg": "未登录"}), 401
    return jsonify({"ok": True, "data": row})


@bp.post("/logout")
def logout():
    token = request.headers.get("X-Token", "")
    conn = get_conn()
    conn.execute("UPDATE users SET token='' WHERE token=?", (token,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "msg": "已退出登录"})
