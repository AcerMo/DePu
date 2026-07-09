import os
import json
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import Dict, Set
try:
    from backend.poker_engine import PokerGame
except ImportError:
    from poker_engine import PokerGame

app = FastAPI()

# 房间管理器数据结构
class Room:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.game = PokerGame()
        self.connections: Dict[int, WebSocket] = {} # seat_idx -> WebSocket
        self.spectators: Set[WebSocket] = set() # 旁观者的 WebSocket 连接
        self.ws_to_seat: Dict[WebSocket, int] = {} # WebSocket -> seat_idx
        self.ws_to_name: Dict[WebSocket, str] = {} # WebSocket -> name

    async def broadcast_state(self):
        """
        向房间内的所有人广播游戏状态。由于需要保密个人手牌，每个玩家收到的序列化数据都是专属量身定做的。
        """
        # 1. 向坐下的玩家发送专属数据
        for seat_idx, ws in list(self.connections.items()):
            try:
                state = self.game.to_dict(current_player_seat=seat_idx)
                # 附加上玩家自己的座位号，以便前端判断自己是谁
                state["your_seat"] = seat_idx
                await ws.send_text(json.dumps({"type": "state", "data": state}))
            except Exception:
                # 处理已断开连接但未触发 disconnect 的脏连接
                pass

        # 2. 向旁观者发送公开数据（底牌显示为问号）
        spectator_state = self.game.to_dict(current_player_seat=None)
        spectator_state["your_seat"] = -1
        closed_spectators = []
        for ws in self.spectators:
            try:
                await ws.send_text(json.dumps({"type": "state", "data": spectator_state}))
            except Exception:
                closed_spectators.append(ws)

        for ws in closed_spectators:
            self.spectators.remove(ws)

    async def send_chat_message(self, sender: str, msg: str):
        """
        广播聊天消息
        """
        message_packet = json.dumps({
            "type": "chat",
            "sender": sender,
            "message": msg
        })
        # 广播给所有人
        for ws in list(self.connections.values()) + list(self.spectators):
            try:
                await ws.send_text(message_packet)
            except Exception:
                pass

    async def remove_socket(self, ws: WebSocket):
        """
        断开连接时，清理 WebSocket 注册
        """
        name = self.ws_to_name.get(ws, "未知玩家")
        
        # 1. 检查是否坐下了
        if ws in self.ws_to_seat:
            seat_idx = self.ws_to_seat[ws]
            self.game.remove_player(seat_idx)
            if seat_idx in self.connections:
                del self.connections[seat_idx]
            del self.ws_to_seat[ws]
        
        # 2. 检查是否在旁观者列表中
        if ws in self.spectators:
            self.spectators.remove(ws)
            
        if ws in self.ws_to_name:
            del self.ws_to_name[ws]

        await self.send_chat_message("系统", f"{name} 离开了房间")
        await self.broadcast_state()

rooms: Dict[str, Room] = {}

def get_or_create_room(room_id: str) -> Room:
    if room_id not in rooms:
        rooms[room_id] = Room(room_id)
    return rooms[room_id]

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, name: str = Query(...)):
    await websocket.accept()
    
    room = get_or_create_room(room_id)
    room.ws_to_name[websocket] = name
    room.spectators.add(websocket) # 默认作为旁观者加入

    await room.send_chat_message("系统", f"欢迎 {name} 进入房间")
    await room.broadcast_state()

    try:
        while True:
            data = await websocket.receive_text()
            packet = json.loads(data)
            action = packet.get("action")

            if action == "sit":
                seat_idx = packet.get("seat")
                # 检查座位是否空缺
                if 0 <= seat_idx < 8 and room.game.seats[seat_idx] is None:
                    # 如果之前已经坐在了别的位置，先站起来
                    if websocket in room.ws_to_seat:
                        old_seat = room.ws_to_seat[websocket]
                        room.game.remove_player(old_seat)
                        if old_seat in room.connections:
                            del room.connections[old_seat]

                    # 移除旁观者身份，建立坐下映射
                    if websocket in room.spectators:
                        room.spectators.remove(websocket)
                    
                    room.connections[seat_idx] = websocket
                    room.ws_to_seat[websocket] = seat_idx
                    
                    # 在游戏引擎中入座
                    room.game.add_player(name, seat_idx)
                    await room.broadcast_state()
                else:
                    await websocket.send_text(json.dumps({"type": "error", "message": "该座位已被占用或无效"}))

            elif action == "stand":
                if websocket in room.ws_to_seat:
                    seat_idx = room.ws_to_seat[websocket]
                    room.game.remove_player(seat_idx)
                    if seat_idx in room.connections:
                        del room.connections[seat_idx]
                    del room.ws_to_seat[websocket]
                    
                    room.spectators.add(websocket)
                    await room.broadcast_state()

            elif action == "start_game":
                success = room.game.start_hand()
                if success:
                    await room.send_chat_message("系统", "游戏已由玩家启动！")
                    await room.broadcast_state()
                else:
                    await websocket.send_text(json.dumps({"type": "error", "message": "无法启动游戏，至少需要2名有筹码的玩家"}))

            elif action in ["fold", "check", "call", "raise"]:
                if websocket in room.ws_to_seat:
                    seat_idx = room.ws_to_seat[websocket]
                    amount = packet.get("amount", 0)
                    success, err_msg = room.game.player_action(seat_idx, action, amount)
                    if success:
                        # 检查如果轮到 showdown 或者结束，自动广播状态
                        await room.broadcast_state()
                        
                        # 如果这局手牌结束了，延迟 5 秒后自动开启下一局（如果有足够玩家的话）
                        if room.game.round_name == "ended":
                            await asyncio.sleep(5)
                            # 如果在这 5 秒期间房间状态还是 ended，且玩家数足够，就开启新一轮
                            if room.game.round_name == "ended":
                                success_next = room.game.start_hand()
                                if success_next:
                                    await room.send_chat_message("系统", "自动开启新一局")
                                    await room.broadcast_state()
                    else:
                        await websocket.send_text(json.dumps({"type": "error", "message": err_msg}))

            elif action == "buy_in":
                # 重买筹码/充值筹码
                if websocket in room.ws_to_seat:
                    seat_idx = room.ws_to_seat[websocket]
                    p = room.game.seats[seat_idx]
                    if p is not None and p.chips == 0 and room.game.round_name in ["waiting", "ended"]:
                        p.chips = 10000
                        p.status = "spectator" # 重买后设为待机，下一轮自动加入
                        room.game.add_history(f"{p.name} 补充筹码 10000")
                        await room.broadcast_state()

            elif action == "chat":
                msg = packet.get("message", "")
                if msg:
                    await room.send_chat_message(name, msg)

    except WebSocketDisconnect:
        await room.remove_socket(websocket)
    except Exception as e:
        # 捕捉其他可能的网络断开/解析异常并做清理
        await room.remove_socket(websocket)

# 托管前端静态资源
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

@app.get("/")
def get_index():
    return FileResponse(os.path.join(frontend_dir, "index.html"))

app.mount("/", StaticFiles(directory=frontend_dir), name="frontend")
