# -*- coding: utf-8 -*-
"""启动入口：python run.py 然后浏览器开 http://127.0.0.1:8017
端口故意挑了个不常见的 8017，免得和别的演示项目撞车。"""
from app import create_app

if __name__ == "__main__":
    app = create_app()
    app.run(host="127.0.0.1", port=8017, debug=False)
