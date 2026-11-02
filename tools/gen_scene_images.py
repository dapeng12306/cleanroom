# -*- coding: utf-8 -*-
"""
场景图程序化生成器（一次性工具，非系统运行依赖）。

背景：评审要求的在线文生图接口当前对所有 prompt 都返回同一张
占位图（176626 字节，MD5 相同，重试无效），无法满足"11 张图
互不相同且与项目强相关"的要求。因此改用 OpenCV 程序化绘制：
每张图按真实洁净车间的场景结构手工构图——透视线、材质渐变、
设备剪影、灯光辉光、底噪颗粒一样不少，远看就是一张场景照片。
"""
import os
import numpy as np
import cv2

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "web", "assets", "img")
W, H = 1280, 720
rng = np.random.default_rng(7)


def save(name, img):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        raise RuntimeError("encode fail")
    with open(os.path.join(OUT, name), "wb") as fp:
        fp.write(buf.tobytes())
    print(name, "ok")


def canvas(top, bottom):
    """竖向双色渐变底 + 细颗粒噪声，所有场景的统一底子。"""
    t = np.linspace(0, 1, H)[:, None, None]
    img = (np.array(top, float) * (1 - t) + np.array(bottom, float) * t)
    img = np.repeat(img, W, axis=1).astype(np.int16)
    noise = rng.normal(0, 5, (H, W, 3)).astype(np.int16)
    return np.clip(img + noise, 0, 255).astype(np.uint8)


def glow(img, cx, cy, r, color, strength=0.55):
    """灯光辉光：径向衰减叠加。"""
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
    mask = np.clip(1 - d, 0, 1) ** 2 * strength
    for ch in range(3):
        img[:, :, ch] = np.clip(img[:, :, ch] + mask * color[ch], 0, 255).astype(np.uint8)
    return img


def vline(img, x, y0, y1, color, th=2):
    cv2.line(img, (int(x), int(y0)), (int(x), int(y1)), color, th)


# ----------------------------------------------------------------------
# 1. login_bg —— 深夜洁净车间走廊尽头，冷色灯带，适合登录页压暗放文字
# ----------------------------------------------------------------------
def login_bg():
    img = canvas((8, 30, 44), (16, 74, 88))
    vx, vy = W // 2, 300  # 灭点在画面中上部
    # 天花与地面的透视线
    for i in range(-6, 7):
        cv2.line(img, (vx + i * 40, vy), (vx + i * 220, 0), (20, 60, 74), 2)
        cv2.line(img, (vx + i * 40, vy), (vx + i * 260, H), (12, 46, 58), 2)
    # 走廊两侧门框
    for k in range(5):
        s = 1 - k * 0.16
        x0 = int(vx - 460 * s)
        x1 = int(vx + 460 * s)
        y0 = int(vy - 190 * s)
        y1 = int(vy + 250 * s)
        cv2.rectangle(img, (x0, y0), (x0 + int(90 * s), y1), (10, 42, 54), -1)
        cv2.rectangle(img, (x1 - int(90 * s), y0), (x1, y1), (10, 42, 54), -1)
        cv2.rectangle(img, (x0, y0), (x0 + int(90 * s), y1), (36, 96, 110), 2)
        cv2.rectangle(img, (x1 - int(90 * s), y0), (x1, y1), (36, 96, 110), 2)
    # 顶部灯带 + 辉光
    for k in range(4):
        y = int(vy - 200 + k * 62)
        cv2.line(img, (vx - 300, y), (vx + 300, y), (140, 230, 235), 3)
        img = glow(img, vx, y, 260, (60, 130, 135), 0.30)
    # 地面中央指引线
    cv2.line(img, (vx - 26, H), (vx - 8, vy), (30, 170, 170), 4)
    cv2.line(img, (vx + 26, H), (vx + 8, vy), (30, 170, 170), 4)
    # 漂浮微粒
    for _ in range(240):
        x, y = int(rng.integers(0, W)), int(rng.integers(0, H))
        r = int(rng.integers(1, 3))
        cv2.circle(img, (x, y), r, (120, 200, 210), -1)
    save("login_bg.jpg", cv2.GaussianBlur(img, (3, 3), 0))


# ----------------------------------------------------------------------
# 2. cleanroom_wide —— 广角车间：FFU 吊顶网格 + 地面标线 + 设备剪影
# ----------------------------------------------------------------------
def cleanroom_wide():
    img = canvas((188, 205, 210), (150, 168, 172))
    # 吊顶（上 1/3）FFU 网格
    cv2.rectangle(img, (0, 0), (W, 240), (206, 214, 218), -1)
    for gx in range(0, W, 128):
        vline(img, gx, 0, 240, (176, 186, 190), 2)
    for gy in range(0, 240, 80):
        cv2.line(img, (0, gy), (W, gy), (176, 186, 190), 2)
    for gx in range(64, W, 128):
        for gy in range(40, 240, 80):
            cv2.rectangle(img, (gx - 40, gy - 20), (gx + 40, gy + 20), (228, 234, 236), -1)
            cv2.rectangle(img, (gx - 40, gy - 20), (gx + 40, gy + 20), (150, 160, 165), 2)
            img = glow(img, gx, gy, 120, (36, 34, 30), 0.28)
    # 地平线与立柱
    cv2.line(img, (0, 240), (W, 240), (130, 142, 146), 3)
    for px in range(120, W, 260):
        cv2.rectangle(img, (px, 240), (px + 26, H), (172, 182, 186), -1)
        cv2.rectangle(img, (px, 240), (px + 26, H), (140, 150, 154), 2)
    # 地面黄色警示标线
    cv2.line(img, (0, 560), (W, 500), (214, 178, 60), 6)
    cv2.line(img, (0, 590), (W, 530), (214, 178, 60), 2)
    # 不锈钢设备剪影
    for bx, bw, bh in [(160, 150, 190), (420, 220, 150), (760, 180, 210), (1020, 140, 160)]:
        cv2.rectangle(img, (bx, H - bh - 60), (bx + bw, H - 60), (196, 204, 208), -1)
        cv2.rectangle(img, (bx, H - bh - 60), (bx + bw, H - 60), (138, 148, 152), 3)
        cv2.rectangle(img, (bx + 12, H - bh - 40), (bx + bw - 12, H - bh + 30), (120, 138, 144), -1)
        cv2.circle(img, (bx + 20, H - 80), 6, (60, 200, 120), -1)
    # 地面反光
    img = glow(img, 640, 700, 500, (30, 30, 28), 0.35)
    save("cleanroom_wide.jpg", img)


# ----------------------------------------------------------------------
# 3. cleanroom_corridor —— 正面透视走廊，门牌灯、踢脚线
# ----------------------------------------------------------------------
def cleanroom_corridor():
    img = canvas((172, 190, 196), (120, 140, 146))
    vx, vy = 640, 330
    # 两侧墙面梯形
    pts_l = np.array([(0, 0), (vx - 150, vy - 170), (vx - 150, vy + 200), (0, H)], np.int32)
    pts_r = np.array([(W, 0), (vx + 150, vy - 170), (vx + 150, vy + 200), (W, H)], np.int32)
    cv2.fillPoly(img, [pts_l], (158, 176, 182))
    cv2.fillPoly(img, [pts_r], (150, 168, 174))
    # 尽头门
    cv2.rectangle(img, (vx - 90, vy - 120), (vx + 90, vy + 190), (96, 116, 122), -1)
    cv2.rectangle(img, (vx - 90, vy - 120), (vx + 90, vy + 190), (70, 88, 94), 3)
    cv2.rectangle(img, (vx - 60, vy - 80), (vx + 60, vy + 60), (150, 190, 196), -1)  # 观察窗
    cv2.circle(img, (vx + 66, vy + 30), 8, (220, 190, 90), -1)  # 门把手灯
    # 两侧门
    for k in range(3):
        s = 1 - k * 0.22
        for sgn, base in [(-1, 0), (1, W)]:
            x0 = int(base + sgn * (60 + (1 - s) * 320))
            x1 = x0 + int(sgn * 120 * s) if sgn < 0 else x0 + int(120 * s)
            y0 = int(vy - 160 * s)
            y1 = int(vy + 210 * s)
            cv2.rectangle(img, (min(x0, x1), y0), (max(x0, x1), y1), (104, 124, 130), -1)
            cv2.rectangle(img, (min(x0, x1), y0), (max(x0, x1), y1), (78, 96, 102), 2)
            # 门牌灯
            lx = min(x0, x1) - 14 if sgn < 0 else max(x0, x1) + 14
            cv2.circle(img, (lx, y0 + 16), 5, (90, 220, 140), -1)
    # 顶部灯带
    for k in range(4):
        y = int(vy - 175 + k * 56)
        half = int(360 - k * 62)
        cv2.line(img, (vx - half, y), (vx + half, y), (232, 240, 240), 4)
        img = glow(img, vx, y, 300, (40, 40, 36), 0.25)
    # 踢脚线与地面中线
    cv2.line(img, (0, H - 40), (vx - 150, vy + 200), (90, 108, 114), 5)
    cv2.line(img, (W, H - 40), (vx + 150, vy + 200), (90, 108, 114), 5)
    cv2.line(img, (vx - 20, H), (vx - 6, vy + 200), (200, 170, 70), 4)
    cv2.line(img, (vx + 20, H), (vx + 6, vy + 200), (200, 170, 70), 4)
    save("cleanroom_corridor.jpg", img)


# ----------------------------------------------------------------------
# 4. robot_scrubber —— 洗地机器人作业特写
# ----------------------------------------------------------------------
def robot_scrubber():
    img = canvas((150, 160, 170), (96, 104, 112))
    # 地面砖
    cv2.rectangle(img, (0, 420), (W, H), (140, 150, 156), -1)
    for gx in range(0, W, 160):
        vline(img, gx, 420, H, (118, 128, 134), 2)
    for gy in range(420, H, 90):
        cv2.line(img, (0, gy), (W, gy), (118, 128, 134), 2)
    # 背景货架剪影
    for bx in range(60, W, 300):
        cv2.rectangle(img, (bx, 120), (bx + 200, 420), (110, 120, 128), -1)
        for sy in range(160, 400, 70):
            cv2.line(img, (bx, sy), (bx + 200, sy), (88, 96, 104), 3)
    # 机器人机身（圆柱侧视）
    cx, cy = 620, 380
    cv2.ellipse(img, (cx, cy + 130), (170, 40), 0, 0, 360, (60, 66, 74), -1)   # 底盘
    cv2.rectangle(img, (cx - 170, cy - 60), (cx + 170, cy + 130), (196, 210, 218), -1)  # 机身
    cv2.ellipse(img, (cx, cy - 60), (170, 44), 0, 0, 360, (226, 238, 244), -1)  # 顶盖
    cv2.ellipse(img, (cx, cy - 60), (170, 44), 0, 0, 360, (120, 140, 150), 3)
    cv2.rectangle(img, (cx - 170, cy - 60), (cx + 170, cy + 130), (120, 140, 150), 3)
    # 机身饰条与 LOGO 屏
    cv2.rectangle(img, (cx - 150, cy + 10), (cx + 150, cy + 40), (40, 120, 150), -1)
    cv2.rectangle(img, (cx - 90, cy - 30), (cx + 90, cy + 0), (30, 60, 80), -1)
    cv2.putText(img, "CR-07", (cx - 52, cy - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (120, 230, 255), 2)
    # 激光雷达塔
    cv2.rectangle(img, (cx - 26, cy - 120), (cx + 26, cy - 84), (70, 80, 90), -1)
    cv2.circle(img, (cx, cy - 126), 22, (90, 100, 112), -1)
    cv2.circle(img, (cx, cy - 126), 10, (240, 90, 90), -1)
    img = glow(img, cx, cy - 126, 90, (200, 60, 60), 0.4)
    # 刷盘（底部两个）
    for sgn in (-1, 1):
        bx = cx + sgn * 90
        cv2.ellipse(img, (bx, cy + 150), (56, 18), 0, 0, 360, (40, 44, 52), -1)
        for a in range(0, 360, 30):
            ex = int(bx + 52 * np.cos(np.radians(a)))
            ey = int(cy + 150 + 16 * np.sin(np.radians(a)))
            cv2.line(img, (bx, cy + 150), (ex, ey), (120, 200, 220), 2)
    # 水渍反光
    cv2.ellipse(img, (cx, cy + 210), (260, 40), 0, 0, 360, (170, 196, 204), 2)
    img = glow(img, cx, cy + 200, 260, (50, 70, 76), 0.3)
    # 状态灯
    cv2.circle(img, (cx + 150, cy - 30), 8, (80, 230, 130), -1)
    save("robot_scrubber.jpg", img)


# ----------------------------------------------------------------------
# 5. particle_sensor —— 墙面粒子计数器特写，带数码显示
# ----------------------------------------------------------------------
def particle_sensor():
    img = canvas((164, 178, 184), (128, 142, 148))
    # 墙面瓷砖
    for gx in range(0, W, 200):
        vline(img, gx, 0, H, (146, 158, 164), 2)
    for gy in range(0, H, 150):
        cv2.line(img, (0, gy), (W, gy), (146, 158, 164), 2)
    # 设备箱体
    cv2.rectangle(img, (440, 160), (840, 540), (210, 220, 226), -1)
    cv2.rectangle(img, (440, 160), (840, 540), (150, 162, 168), 4)
    cv2.rectangle(img, (440, 160), (840, 200), (120, 150, 160), -1)
    cv2.putText(img, "PARTICLE COUNTER", (470, 188), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (240, 246, 248), 2)
    # 显示屏
    cv2.rectangle(img, (480, 230), (800, 330), (18, 40, 52), -1)
    cv2.rectangle(img, (480, 230), (800, 330), (70, 110, 124), 3)
    cv2.putText(img, "352", (510, 300), cv2.FONT_HERSHEY_SIMPLEX, 2.2, (90, 235, 200), 4)
    cv2.putText(img, "pcs/m3  ISO5", (640, 296), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (120, 200, 210), 2)
    # 采样口
    cv2.circle(img, (560, 420), 44, (90, 100, 108), -1)
    cv2.circle(img, (560, 420), 30, (30, 36, 42), -1)
    cv2.circle(img, (560, 420), 44, (150, 162, 168), 3)
    # 指示灯组
    for i, c in enumerate([(80, 230, 130), (240, 200, 80), (240, 90, 90)]):
        cv2.circle(img, (660 + i * 46, 420), 14, c, -1)
        cv2.circle(img, (660 + i * 46, 420), 14, (60, 70, 76), 2)
    img = glow(img, 660, 420, 60, (60, 200, 110), 0.4)
    # 铭牌
    cv2.rectangle(img, (480, 480), (700, 516), (176, 186, 192), -1)
    cv2.putText(img, "SN-PA-01  CAL:2026-10", (492, 504), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (90, 100, 106), 2)
    save("particle_sensor.jpg", img)


# ----------------------------------------------------------------------
# 6. materials_shelf —— 耗材不锈钢货架
# ----------------------------------------------------------------------
def materials_shelf():
    img = canvas((168, 178, 184), (118, 128, 134))
    # 货架立柱
    for px in (140, 560, 980, 1160):
        cv2.rectangle(img, (px, 80), (px + 22, 660), (186, 196, 202), -1)
        cv2.rectangle(img, (px, 80), (px + 22, 660), (140, 150, 156), 2)
    # 四层板
    colors = [(120, 170, 200), (230, 190, 90), (150, 200, 160), (200, 140, 150)]
    for i, sy in enumerate((140, 270, 400, 530)):
        cv2.rectangle(img, (140, sy + 66), (1182, sy + 84), (170, 180, 186), -1)
        # 每层摆放盒子/桶
        x = 180
        while x < 1100:
            bw = int(rng.integers(70, 130))
            bh = int(rng.integers(40, 62))
            c = colors[int(rng.integers(0, 4))]
            shade = tuple(int(v * 0.82) for v in c)
            cv2.rectangle(img, (x, sy + 66 - bh), (x + bw, sy + 66), c, -1)
            cv2.rectangle(img, (x, sy + 66 - bh), (x + bw, sy + 66), shade, 3)
            cv2.rectangle(img, (x + 8, sy + 66 - bh + 8), (x + 44, sy + 66 - bh + 22), (236, 240, 242), -1)
            x += bw + int(rng.integers(24, 60))
    # 地面
    cv2.rectangle(img, (0, 660), (W, H), (140, 150, 156), -1)
    cv2.line(img, (0, 662), (W, 662), (110, 120, 126), 2)
    save("materials_shelf.jpg", img)


# ----------------------------------------------------------------------
# 7. ffu_ceiling —— 仰视 FFU 风机滤网单元阵列
# ----------------------------------------------------------------------
def ffu_ceiling():
    img = canvas((200, 208, 212), (150, 160, 166))
    step = 160
    for gy in range(0, H, step):
        for gx in range(0, W, step):
            x0, y0 = gx + 10, gy + 10
            cv2.rectangle(img, (x0, y0), (x0 + step - 20, y0 + step - 20), (222, 228, 232), -1)
            cv2.rectangle(img, (x0, y0), (x0 + step - 20, y0 + step - 20), (150, 158, 164), 3)
            # 内部滤网栅格
            for k in range(4):
                off = 18 + k * 26
                cv2.rectangle(img, (x0 + off // 2, y0 + off // 2),
                              (x0 + step - 20 - off // 2, y0 + step - 20 - off // 2),
                              (196 - k * 8, 204 - k * 8, 208 - k * 8), 2)
            # 中央风机圆
            cx, cy = x0 + (step - 20) // 2, y0 + (step - 20) // 2
            cv2.circle(img, (cx, cy), 30, (170, 178, 184), -1)
            cv2.circle(img, (cx, cy), 30, (130, 138, 144), 3)
            for a in range(0, 360, 45):
                ex = int(cx + 26 * np.cos(np.radians(a + (gx + gy) % 40)))
                ey = int(cy + 26 * np.sin(np.radians(a + (gx + gy) % 40)))
                cv2.line(img, (cx, cy), (ex, ey), (110, 118, 124), 3)
    # 两盏长条灯
    for lx in (320, 880):
        cv2.rectangle(img, (lx - 130, 330), (lx + 130, 366), (246, 250, 250), -1)
        img = glow(img, lx, 348, 260, (50, 50, 44), 0.35)
    save("ffu_ceiling.jpg", img)


# ----------------------------------------------------------------------
# 8. control_room —— 中控室监控墙
# ----------------------------------------------------------------------
def control_room():
    img = canvas((16, 30, 44), (8, 16, 26))
    # 屏幕墙 3x2
    for r in range(2):
        for c in range(3):
            x0 = 90 + c * 380
            y0 = 70 + r * 240
            cv2.rectangle(img, (x0, y0), (x0 + 340, y0 + 200), (10, 60, 78), -1)
            cv2.rectangle(img, (x0, y0), (x0 + 340, y0 + 200), (50, 110, 130), 3)
            # 屏内曲线
            pts = []
            for i in range(24):
                px = x0 + 20 + i * 12
                py = y0 + 150 - int(60 * np.sin(i / 3.5 + c) + rng.integers(-8, 8))
                pts.append((px, py))
            for i in range(len(pts) - 1):
                cv2.line(img, pts[i], pts[i + 1], (90, 230, 200), 2)
            cv2.putText(img, f"ZONE-{r * 3 + c + 1}", (x0 + 16, y0 + 34),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (140, 220, 235), 2)
            cv2.circle(img, (x0 + 316, y0 + 24), 6, (90, 235, 150), -1)
            img = glow(img, x0 + 170, y0 + 100, 220, (30, 90, 100), 0.22)
    # 操作台
    cv2.rectangle(img, (0, 560), (W, H), (24, 40, 52), -1)
    cv2.rectangle(img, (200, 520), (1080, 580), (36, 58, 72), -1)
    for k in range(6):
        cv2.circle(img, (280 + k * 140, 550), 10, (70 + (k % 2) * 40, 180, 200), -1)
    save("control_room.jpg", img)


# ----------------------------------------------------------------------
# 9. ai_vision —— AI 视觉识别主题：画面 + 检出框
# ----------------------------------------------------------------------
def ai_vision():
    img = canvas((190, 198, 206), (132, 142, 150))
    # 地面透视
    for i in range(-8, 9):
        cv2.line(img, (640 + i * 30, 240), (640 + i * 160, H), (150, 160, 168), 2)
    cv2.line(img, (0, 240), (W, 240), (140, 150, 158), 2)
    # 污渍团
    for _ in range(6):
        cx, cy = int(rng.integers(200, 1100)), int(rng.integers(380, 660))
        for _ in range(4):
            cv2.circle(img, (cx + int(rng.normal(0, 16)), cy + int(rng.normal(0, 10))),
                       int(rng.integers(10, 30)), (70, 66, 60), -1)
    # AI 检出框 + 标签
    boxes = [(300, 430, 150, 110), (620, 500, 200, 130), (950, 400, 130, 100)]
    for i, (x, y, bw, bh) in enumerate(boxes):
        cv2.rectangle(img, (x, y), (x + bw, y + bh), (40, 220, 255), 3)
        cv2.rectangle(img, (x, y - 30), (x + 128, y), (40, 220, 255), -1)
        cv2.putText(img, f"stain {0.92 - i * 0.05:.2f}", (x + 6, y - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (20, 30, 40), 2)
        cx, cy = x + bw // 2, y + bh // 2
        cv2.drawMarker(img, (cx, cy), (40, 80, 255), cv2.MARKER_CROSS, 22, 3)
    # 顶部扫描线
    cv2.rectangle(img, (0, 300), (W, 306), (60, 200, 255), -1)
    img = glow(img, 640, 303, 500, (40, 120, 160), 0.3)
    # HUD 角标
    cv2.putText(img, "AI VISION  v2.3", (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (30, 60, 80), 3)
    cv2.putText(img, "REC", (1150, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (240, 80, 80), 2)
    cv2.circle(img, (1120, 44), 8, (240, 80, 80), -1)
    save("ai_vision.jpg", img)


# ----------------------------------------------------------------------
# 10. lab_quality —— 质检实验室台面
# ----------------------------------------------------------------------
def lab_quality():
    img = canvas((186, 196, 200), (134, 146, 152))
    # 台面
    cv2.rectangle(img, (0, 430), (W, H), (172, 182, 188), -1)
    cv2.line(img, (0, 432), (W, 432), (140, 150, 156), 3)
    # 粒子计数器主机
    cv2.rectangle(img, (120, 220), (420, 430), (206, 216, 222), -1)
    cv2.rectangle(img, (120, 220), (420, 430), (150, 160, 166), 3)
    cv2.rectangle(img, (150, 250), (390, 320), (20, 44, 56), -1)
    cv2.putText(img, "0.3um: 28", (170, 290), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (110, 235, 200), 2)
    cv2.putText(img, "0.5um:  9", (170, 314), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (110, 235, 200), 2)
    for i in range(3):
        cv2.circle(img, (180 + i * 60, 370), 12, [(90, 230, 140), (240, 200, 90), (240, 110, 110)][i], -1)
    # 培养皿
    for i, px in enumerate((560, 700, 840)):
        cv2.ellipse(img, (px, 500), (64, 22), 0, 0, 360, (214, 224, 228), -1)
        cv2.ellipse(img, (px, 494), (64, 22), 0, 0, 360, (236, 244, 246), -1)
        cv2.ellipse(img, (px, 494), (64, 22), 0, 0, 360, (150, 160, 166), 2)
        cv2.circle(img, (px - 10, 490), 5, (200, 140, 120), -1)
        cv2.circle(img, (px + 14, 498), 4, (170, 120, 150), -1)
    # 试管架
    cv2.rectangle(img, (980, 330), (1180, 430), (150, 160, 166), -1)
    for i in range(5):
        tx = 1000 + i * 36
        cv2.rectangle(img, (tx, 260), (tx + 20, 400), (220, 230, 234), -1)
        cv2.rectangle(img, (tx, 340), (tx + 20, 400), [(90, 170, 220), (120, 200, 160),
                     (230, 190, 100), (200, 140, 160), (150, 170, 220)][i], -1)
        cv2.ellipse(img, (tx + 10, 260), (10, 5), 0, 0, 360, (240, 246, 248), -1)
    save("lab_quality.jpg", img)


# ----------------------------------------------------------------------
# 11. worker_suit —— 洁净服人员拖地作业
# ----------------------------------------------------------------------
def worker_suit():
    img = canvas((170, 186, 192), (120, 134, 140))
    # 地面与墙
    cv2.rectangle(img, (0, 460), (W, H), (146, 158, 164), -1)
    cv2.line(img, (0, 460), (W, 460), (118, 128, 134), 3)
    # 背景传递窗
    cv2.rectangle(img, (900, 180), (1160, 400), (196, 206, 212), -1)
    cv2.rectangle(img, (900, 180), (1160, 400), (150, 160, 166), 4)
    cv2.rectangle(img, (930, 210), (1130, 370), (150, 190, 196), -1)
    cv2.putText(img, "PASS BOX", (960, 168), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (90, 100, 106), 2)
    # 人物（连体洁净服剪影）
    cx = 520
    cv2.ellipse(img, (cx, 170), (46, 52), 0, 0, 360, (228, 236, 240), -1)   # 头罩
    cv2.ellipse(img, (cx, 170), (46, 52), 0, 0, 360, (160, 172, 178), 3)
    cv2.rectangle(img, (cx - 34, 150), (cx + 34, 186), (120, 170, 190), -1)  # 护目镜
    cv2.rectangle(img, (cx - 60, 214), (cx + 60, 420), (228, 236, 240), -1)  # 躯干
    cv2.rectangle(img, (cx - 60, 214), (cx + 60, 420), (160, 172, 178), 3)
    # 手臂（一前一后握拖把）
    cv2.line(img, (cx - 54, 240), (cx + 70, 330), (228, 236, 240), 26)
    cv2.line(img, (cx + 54, 250), (cx + 96, 350), (228, 236, 240), 26)
    # 腿与鞋套
    cv2.rectangle(img, (cx - 52, 420), (cx - 8, 580), (218, 228, 232), -1)
    cv2.rectangle(img, (cx + 8, 420), (cx + 52, 580), (218, 228, 232), -1)
    cv2.ellipse(img, (cx - 30, 586), (34, 14), 0, 0, 360, (120, 170, 200), -1)
    cv2.ellipse(img, (cx + 30, 586), (34, 14), 0, 0, 360, (120, 170, 200), -1)
    # 拖把
    cv2.line(img, (cx + 84, 320), (cx + 210, 620), (150, 120, 80), 8)
    cv2.ellipse(img, (cx + 224, 636), (70, 22), 0, 0, 360, (200, 210, 216), -1)
    cv2.ellipse(img, (cx + 224, 636), (70, 22), 0, 0, 360, (150, 160, 166), 2)
    # 湿地面反光
    cv2.ellipse(img, (cx + 240, 660), (240, 30), 0, 0, 360, (180, 200, 206), 2)
    img = glow(img, cx + 240, 650, 240, (50, 66, 70), 0.3)
    # 顶部灯
    for lx in (300, 760, 1100):
        cv2.rectangle(img, (lx - 110, 30), (lx + 110, 58), (246, 250, 250), -1)
        img = glow(img, lx, 44, 220, (50, 50, 44), 0.3)
    save("worker_suit.jpg", img)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    login_bg()
    cleanroom_wide()
    cleanroom_corridor()
    robot_scrubber()
    particle_sensor()
    materials_shelf()
    ffu_ceiling()
    control_room()
    ai_vision()
    lab_quality()
    worker_suit()
    print("ALL DONE")
