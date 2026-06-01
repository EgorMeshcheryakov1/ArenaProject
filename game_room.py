import asyncio
import json
import math
import logging
import time
from typing import Dict, Optional, Set

from player import Player
from physics import PhysicsEngine

logger = logging.getLogger(__name__)
SPAWN_CONFIG = [
    {"x": -140.0, "y": 0.0, "angle": 0.0},
    {"x":  140.0, "y": 0.0, "angle": math.pi},
]

PLAYER_COLORS = ["#ff5a7a", "#57b8ff"]
TICK_INTERVAL = 1.0 / 20

class GameRoom:
    def __init__(self) -> None:
        self.state: str = "waiting"
        self.players: Dict = {}
        self.connections: Dict = {}
        self.ready_set: Set[int] = set()
        self.winner_id: Optional[int] = None
        self.game_task: Optional[asyncio.Task] = None
        self._next_id: int = 1
        self._restart_requested: Set[int] = set()

    def is_full(self) -> bool:
        return len(self.players) >= 2

    @property
    def player_list(self) -> list:
        return list(self.players.values())

    async def add_player(self, ws, name: str) -> Optional[Player]:
        if self.is_full():
            return None

        idx = len(self.players)
        pid = self._next_id
        self._next_id += 1

        cfg = SPAWN_CONFIG[idx]
        player = Player(pid, cfg["x"], cfg["y"], cfg["angle"],
                        PLAYER_COLORS[idx], name)
        player.slot = idx

        self.players[ws] = player
        self.connections[pid] = ws
        logger.info(f"[JOIN] {player.name!r} → id={pid}, слот {idx+1}/2")
        return player

    async def remove_player(self, ws) -> None:
        if ws not in self.players:
            return

        player = self.players.pop(ws)
        self.connections.pop(player.id, None)
        self.ready_set.discard(player.id)
        self._restart_requested.discard(player.id)
        logger.info(f"[LEAVE] {player.name!r} (id={player.id})")

        if self.state == "playing":
            remaining = self.player_list
            self.winner_id = remaining[0].id if remaining else None
            self.state = "game_over"

            await self.broadcast({
                "type": "game_over",
                "winner_id": self.winner_id,
                "players": [p.to_dict() for p in remaining],
                "reason": "disconnect",
            })
            if self.game_task and not self.game_task.done():
                self.game_task.cancel()
        if not self.players:
            self._hard_reset()

    async def _mark_ready_and_maybe_start(self, ws) -> None:
        if ws not in self.players:
            return

        pid = self.players[ws].id
        self.ready_set.add(pid)
        logger.info(f"[READY] id={pid}, готовых: {len(self.ready_set)}/2")

        if len(self.ready_set) == 2 and len(self.players) == 2:
            await self._start_game()

    async def set_ready(self, ws) -> None:
        if ws not in self.players:
            return

        if self.state == "playing":
            return

        if self.state == "game_over":
            self.state = "waiting"
            self.winner_id = None
            self.ready_set.clear()
            await self.broadcast({"type": "lobby"})
            logger.info("[GAME] Переход в waiting по ready из game_over")

        if self.state == "waiting":
            await self._mark_ready_and_maybe_start(ws)

    async def _start_game(self) -> None:
        for i, player in enumerate(self.player_list):
            cfg = SPAWN_CONFIG[i]
            player.reset(cfg["x"], cfg["y"], cfg["angle"])
            player.slot = i
            player.color = PLAYER_COLORS[i % len(PLAYER_COLORS)]

        self.state = "playing"
        self.winner_id = None

        arena_info = {
            "radius": PhysicsEngine.ARENA_RADIUS,
            "cx": 0, "cy": 0,
        }
        await self.broadcast({
            "type": "start",
            "players": [p.to_dict() for p in self.player_list],
            "arena": arena_info,
        })
        logger.info("[GAME] Матч начался!")
        self.game_task = asyncio.create_task(self._game_loop())

    async def _game_loop(self) -> None:
        last = time.monotonic()
        try:
            while self.state == "playing":
                await asyncio.sleep(TICK_INTERVAL)

                now = time.monotonic()
                dt = min(now - last, 0.1)
                last = now
                PhysicsEngine.update(self.player_list, dt)
                dead  = [p for p in self.player_list if not p.alive]
                alive = [p for p in self.player_list if p.alive]

                if dead:
                    self.state = "game_over"
                    self.winner_id = alive[0].id if alive else None
                    winner_name = alive[0].name if alive else "—"
                    logger.info(f"[GAME OVER] Победитель: {winner_name!r}")

                    await self.broadcast({
                        "type": "game_over",
                        "winner_id": self.winner_id,
                        "players": [p.to_dict() for p in self.player_list],
                        "reason": "eliminated",
                    })
                    return
                await self.broadcast({
                    "type": "state",
                    "players": [p.to_dict() for p in self.player_list],
                })

        except asyncio.CancelledError:
            logger.info("[GAME] Игровой цикл остановлен")

    async def handle_dash(self, ws) -> None:
        if ws in self.players and self.state == "playing":
            PhysicsEngine.apply_dash(self.players[ws])

    async def handle_rotate(self, ws, direction: str) -> None:
        if ws not in self.players or self.state != "playing":
            return

        p = self.players[ws]
        speed = Player.AUTO_ROTATION_SPEED

        if direction == "left":
            p.angular_velocity = -speed * 1.5
        elif direction == "right":
            p.angular_velocity = speed * 1.5
        else:  # "stop" → авторотация
            p.angular_velocity = speed

    async def handle_restart(self, ws) -> None:
        if ws not in self.players:
            return

        if self.state == "playing":
            return

        if self.state == "game_over":
            self.state = "waiting"
            self.winner_id = None
            self.ready_set.clear()
            await self.broadcast({"type": "lobby"})
            logger.info("[GAME] Возврат в лобби")

        if self.state == "waiting":
            await self._mark_ready_and_maybe_start(ws)

    async def broadcast(self, message: dict) -> None:
        payload = json.dumps(message, ensure_ascii=False)
        dead = []
        for ws in list(self.players.keys()):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.remove_player(ws)

    def _hard_reset(self) -> None:
        self.state = "waiting"
        self.players.clear()
        self.connections.clear()
        self.ready_set.clear()
        self._restart_requested.clear()
        self.winner_id = None
        self._next_id = 1
        if self.game_task and not self.game_task.done():
            self.game_task.cancel()
        self.game_task = None
        logger.info("[ROOM] Комната сброшена")
