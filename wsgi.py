# -*- coding: utf-8 -*-
"""WSGI 入口：云平台（Render / gunicorn 等）用 gunicorn wsgi:app 启动。
本地开发仍用 python run.py（固定 8017 端口）。"""
from app import create_app

app = create_app()
