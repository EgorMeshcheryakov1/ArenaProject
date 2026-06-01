import math
from typing import List
from player import Player

class PhysicsEngine:
    ARENA_RADIUS: float = 280.0
    DASH_IMPULSE: float = 380.0
    DASH_COOLDOWN: float = 1.2
    FRICTION: float = 0.88
    RESTITUTION: float = 1.3
    BOUNDARY_FRAC: float = 0.5

    @classmethod
    def update(cls, players: List[Player], dt: float) -> None:
        for p in players:
            if not p.alive:
                continue
            p.angle += p.angular_velocity * dt
            p.angle %= (2 * math.pi)
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.vx *= cls.FRICTION
            p.vy *= cls.FRICTION
            if p.dash_cooldown > 0:
                p.dash_cooldown = max(0.0, p.dash_cooldown - dt)
        alive = [p for p in players if p.alive]
        if len(alive) >= 2:
            cls._resolve_collision(alive[0], alive[1])
        for p in players:
            if p.alive:
                dist = math.hypot(p.x, p.y)
                boundary = cls.ARENA_RADIUS - p.radius * cls.BOUNDARY_FRAC
                if dist > boundary:
                    p.alive = False

    @classmethod
    def apply_dash(cls, player: Player) -> bool:
        if player.dash_cooldown > 0:
            return False
        player.vx += math.cos(player.angle) * cls.DASH_IMPULSE
        player.vy += math.sin(player.angle) * cls.DASH_IMPULSE
        player.dash_cooldown = cls.DASH_COOLDOWN
        return True

    @classmethod
    def _resolve_collision(cls, p1: Player, p2: Player) -> None:
        dx = p2.x - p1.x
        dy = p2.y - p1.y
        dist = math.hypot(dx, dy)
        min_dist = p1.radius + p2.radius
        if dist >= min_dist or dist < 1e-6:
            return
        nx = dx / dist
        ny = dy / dist
        overlap = min_dist - dist
        p1.x -= nx * overlap * 0.5
        p1.y -= ny * overlap * 0.5
        p2.x += nx * overlap * 0.5
        p2.y += ny * overlap * 0.5
        rel_vn = (p1.vx - p2.vx) * nx + (p1.vy - p2.vy) * ny
        if rel_vn > 0:
            impulse = rel_vn * cls.RESTITUTION
            p1.vx -= nx * impulse
            p1.vy -= ny * impulse
            p2.vx += nx * impulse
            p2.vy += ny * impulse
