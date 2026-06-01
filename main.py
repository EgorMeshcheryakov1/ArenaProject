import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from game_room import GameRoom
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)
app = FastAPI(title="Arena Game", version="1.0.0")
app.mount("/static", StaticFiles(directory="static"), name="static")
room = GameRoom()

@app.get("/")
async def index():
    return FileResponse("static/index.html")

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):

    await ws.accept()
    logger.info("[WS] Новое соединение")
    player = None

    try:
        async for raw in ws.iter_text():
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(f"[WS] Получены невалидные данные: {raw[:80]}")
                continue

            msg_type = msg.get("type", "")
            if msg_type == "join":
                name = str(msg.get("name", "Player")).strip() or "Player"

                if room.is_full():
                    await ws.send_text(json.dumps({
                        "type": "room_full",
                        "message": "Комната заполнена. Подождите окончания матча.",
                    }))
                    continue

                player = await room.add_player(ws, name)
                if not player:
                    continue
                await ws.send_text(json.dumps({
                    "type": "joined",
                    "player_id": player.id,
                    "color": player.color,
                    "name": player.name,
                }))

                if not room.is_full():
                    await ws.send_text(json.dumps({
                        "type": "waiting",
                        "message": "Ожидание второго игрока...",
                    }))
                else:
                    await room.broadcast({
                        "type": "room_ready",
                        "message": "Оба игрока подключены! Нажмите «Готов».",
                    })
            elif msg_type == "ready":
                await room.set_ready(ws)
            elif msg_type == "dash":
                await room.handle_dash(ws)
            elif msg_type == "rotate":
                direction = msg.get("direction", "stop")
                if direction in ("left", "right", "stop"):
                    await room.handle_rotate(ws, direction)
            elif msg_type == "restart":
                await room.handle_restart(ws)

            else:
                logger.debug(f"[WS] Неизвестный тип сообщения: {msg_type!r}")

    except WebSocketDisconnect:
        logger.info("[WS] Соединение разорвано")
    except Exception as exc:
        logger.error(f"[WS] Неожиданная ошибка: {exc}", exc_info=True)
    finally:
        if player:
            await room.remove_player(ws)
        logger.info("[WS] Соединение закрыто")
