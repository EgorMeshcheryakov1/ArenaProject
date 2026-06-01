import math

class Player:
    AUTO_ROTATION_SPEED: float = 2.0

    def __init__(
        self,
        player_id: int,
        x: float,
        y: float,
        angle: float,
        color: str,
        name: str,
    ) -> None:
        self.id = player_id
        self.x = x
        self.y = y
        self.vx = 0.0
        self.vy = 0.0
        self.angle = angle
        self.angular_velocity = self.AUTO_ROTATION_SPEED
        self.radius = 25
        self.color = color
        self.name = name[:20]
        self.alive = True
        self.dash_cooldown = 0.0
        self.slot = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "angle": round(self.angle, 3),
            "radius": self.radius,
            "color": self.color,
            "name": self.name,
            "alive": self.alive,
            "dash_cooldown": round(self.dash_cooldown, 2),
            "slot": self.slot,
        }

    def reset(self, x: float, y: float, angle: float) -> None:
        self.x = x
        self.y = y
        self.vx = 0.0
        self.vy = 0.0
        self.angle = angle
        self.angular_velocity = self.AUTO_ROTATION_SPEED
        self.alive = True
        self.dash_cooldown = 0.0

    def __repr__(self) -> str:
        return (
            f"Player(id={self.id}, name={self.name!r}, "
            f"pos=({self.x:.1f}, {self.y:.1f}), alive={self.alive})"
        )
