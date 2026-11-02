# -*- coding: utf-8 -*-
"""应用工厂：装配 Flask、注册 12 个蓝图（认证 + 11 个业务菜单）、托管静态前端。"""
import os
import functools
from flask import Flask, g, jsonify, request, send_from_directory

from .db import get_conn, init_db, q
from .rules import BizError

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, "web")


def create_app():
    app = Flask(__name__, static_folder=None)
    init_db()
    # 启动时把 AI 演示样本图合成好，识别页开箱即用
    from .ai_engine import ensure_samples
    ensure_samples()

    # ---------------- 认证：token 存在 users 表里，简单可查 ----------------
    def auth_required(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            token = request.headers.get("X-Token", "")
            row = q("SELECT id,username,real_name,role FROM users WHERE token=?", (token,), one=True)
            if not row:
                return jsonify({"ok": False, "code": 401, "msg": "未登录或登录已过期，请重新登录"}), 401
            g.user = row
            return fn(*args, **kwargs)
        return wrapper

    app.auth_required = auth_required  # 挂到 app 上，路由模块统一从这里取

    # ---------------- 全局业务异常出口：BizError → 统一 JSON ----------------
    @app.errorhandler(BizError)
    def handle_biz(e):
        return jsonify({"ok": False, "code": e.code, "msg": e.msg}), e.code

    @app.errorhandler(404)
    def handle_404(e):
        return jsonify({"ok": False, "code": 404, "msg": "接口不存在"}), 404

    # ---------------- 前端静态托管 ----------------
    @app.route("/")
    def index():
        return send_from_directory(WEB_DIR, "index.html")

    @app.route("/web/<path:sub>")
    def web_static(sub):
        return send_from_directory(WEB_DIR, sub)

    @app.route("/uploads/<path:fn>")
    def uploads(fn):
        return send_from_directory(os.path.join(WEB_DIR, "uploads"), fn)

    # ---------------- 业务蓝图：一个菜单一个文件，谁出问题找谁 ----------------
    from .routes import (auth, m01_dashboard, m02_monitor, m03_tasks, m04_robots,
                         m05_staff, m06_ai, m07_materials, m08_quality,
                         m09_equipment, m10_alarms, m11_analytics)
    for bp in (auth.bp, m01_dashboard.bp, m02_monitor.bp, m03_tasks.bp,
               m04_robots.bp, m05_staff.bp, m06_ai.bp, m07_materials.bp,
               m08_quality.bp, m09_equipment.bp, m10_alarms.bp, m11_analytics.bp):
        app.register_blueprint(bp)

    return app
