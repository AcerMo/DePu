import random
from itertools import combinations

# 卡牌数值与花色定义
VAL_MAP = {'2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14}
SUITS = ['h', 'd', 'c', 's'] # h: 红桃(Hearts), d: 方块(Diamonds), c: 草花(Clubs), s: 黑桃(Spades)

def evaluate_5_card_hand(hand):
    """
    评估 5 张扑克牌的强度，返回一个元组以供比较大小。
    返回值格式: (牌型等级, *关键排名字段)
    牌型等级:
    9: 同花顺 (Straight Flush)
    8: 四条 (Four of a Kind)
    7: 葫芦 (Full House)
    6: 同花 (Flush)
    5: 顺子 (Straight)
    4: 三条 (Three of a Kind)
    3: 两对 (Two Pairs)
    2: 一对 (One Pair)
    1: 高牌 (High Card)
    """
    values = sorted([VAL_MAP[c[0]] for c in hand], reverse=True)
    suits = [c[1] for c in hand]
    
    is_flush = len(set(suits)) == 1
    
    # 顺子检测
    is_straight = False
    highest_straight_card = 0
    unique_vals = sorted(list(set(values)), reverse=True)
    if len(unique_vals) == 5:
        if unique_vals[0] - unique_vals[4] == 4:
            is_straight = True
            highest_straight_card = unique_vals[0]
        elif unique_vals == [14, 5, 4, 3, 2]: # A-5 顺子 (A作为1)
            is_straight = True
            highest_straight_card = 5
            
    # 计算牌面值出现频率
    counts = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
        
    # 按频率降序排序，频率相同按数值降序
    freq_sorted = sorted([(count, val) for val, count in counts.items()], reverse=True)
    pattern = [item[0] for item in freq_sorted]
    
    # 同花顺
    if is_flush and is_straight:
        return (9, highest_straight_card)
        
    # 四条
    if pattern == [4, 1]:
        return (8, freq_sorted[0][1], freq_sorted[1][1])
        
    # 葫芦
    if pattern == [3, 2]:
        return (7, freq_sorted[0][1], freq_sorted[1][1])
        
    # 同花
    if is_flush:
        return (6, values[0], values[1], values[2], values[3], values[4])
        
    # 顺子
    if is_straight:
        return (5, highest_straight_card)
        
    # 三条
    if pattern == [3, 1, 1]:
        return (4, freq_sorted[0][1], freq_sorted[1][1], freq_sorted[2][1])
        
    # 两对
    if pattern == [2, 2, 1]:
        return (3, freq_sorted[0][1], freq_sorted[1][1], freq_sorted[2][1])
        
    # 一对
    if pattern == [2, 1, 1, 1]:
        return (2, freq_sorted[0][1], freq_sorted[1][1], freq_sorted[2][1], freq_sorted[3][1])
        
    # 高牌
    return (1, values[0], values[1], values[2], values[3], values[4])

def evaluate_7_card_hand(cards):
    """
    从 7 张牌中选出最好的 5 张牌，并返回其评估元组。
    """
    best_score = None
    best_hand = None
    for comb in combinations(cards, 5):
        score = evaluate_5_card_hand(comb)
        if best_score is None or score > best_score:
            best_score = score
            best_hand = comb
    return best_score, best_hand

def resolve_pots(player_contributions, active_seats, folded_seats, hand_scores):
    """
    边池计算逻辑。
    player_contributions: dict {seat_idx: total_chips_contributed_this_hand}
    active_seats: set/list 未折叠玩家座位号
    folded_seats: set/list 已折叠玩家座位号
    hand_scores: dict {seat_idx: hand_score_tuple} 未折叠玩家的手牌评分
    
    返回: dict {seat_idx: chips_won} 分配给每个玩家的筹码额
    """
    contributions = player_contributions.copy()
    payouts = {seat: 0 for seat in contributions}
    
    while sum(contributions.values()) > 0:
        # 寻找本轮有贡献的玩家
        contributing_seats = [seat for seat, amt in contributions.items() if amt > 0]
        if not contributing_seats:
            break
            
        # 找出当前最小贡献值，以此值建立主池/边池
        min_contrib = min(contributions[seat] for seat in contributing_seats)
        
        current_pot = 0
        eligible_seats = [] # 贡献了此池且没有折叠的玩家
        
        for seat in contributing_seats:
            current_pot += min_contrib
            contributions[seat] -= min_contrib
            if seat not in folded_seats:
                eligible_seats.append(seat)
                
        if not eligible_seats:
            # 如果没人符合领奖资格，退还给贡献者
            for seat in contributing_seats:
                payouts[seat] += min_contrib
            continue
            
        # 计算谁在此池中获胜
        best_score = max(hand_scores[seat] for seat in eligible_seats)
        winners = [seat for seat in eligible_seats if hand_scores[seat] == best_score]
        
        # 平均分配该分池
        pot_per_winner = current_pot // len(winners)
        odd_chips = current_pot % len(winners)
        
        for i, winner in enumerate(winners):
            payouts[winner] += pot_per_winner
            if i < odd_chips:
                payouts[winner] += 1
                
    return payouts

class Player:
    def __init__(self, name, chips=10000):
        self.name = name
        self.chips = chips
        self.cards = []
        self.status = "spectator" # spectator, playing, folded, all-in
        self.chips_in_pot = 0 # 本局累计放入池的筹码
        self.chips_in_round = 0 # 本轮投注累计放入的筹码
        self.show_cards = False # 摊牌阶段是否展示牌

    def to_dict(self, is_self=False):
        """
        导出玩家状态字典。如果是自己，可以看到底牌，如果是他人，需要隐藏底牌（除非摊牌阶段）。
        """
        return {
            "name": self.name,
            "chips": self.chips,
            "cards": self.cards if (is_self or self.show_cards) else ["?", "?"],
            "status": self.status,
            "chips_in_pot": self.chips_in_pot,
            "chips_in_round": self.chips_in_round,
            "show_cards": self.show_cards
        }

class PokerGame:
    def __init__(self):
        self.seats = [None] * 8 # 最多8个座位
        self.deck = []
        self.community_cards = []
        self.dealer_idx = 0
        self.sb_idx = -1
        self.bb_idx = -1
        self.current_turn = -1
        self.round_name = "waiting" # waiting, preflop, flop, turn, river, showdown, ended
        self.current_bet = 0 # 当前下注额
        self.last_raiser = -1 # 上一次加注的玩家座位号
        self.min_raise = 100
        self.sb_amount = 50
        self.bb_amount = 100
        self.winners = [] # 胜出者记录
        self.win_messages = [] # 胜出信息展示文字
        self.history = [] # 历史记录（聊天或行动记录）

    def add_player(self, name, seat_idx=None):
        """
        添加玩家，如果未指定座位，则自动寻找空位。
        """
        if seat_idx is None:
            for i, seat in enumerate(self.seats):
                if seat is None:
                    seat_idx = i
                    break
        
        if seat_idx is not None and 0 <= seat_idx < 8 and self.seats[seat_idx] is None:
            self.seats[seat_idx] = Player(name)
            self.add_history(f"玩家 {name} 加入了游戏，坐在座位 {seat_idx + 1}")
            return seat_idx
        return -1

    def remove_player(self, seat_idx):
        if 0 <= seat_idx < 8 and self.seats[seat_idx] is not None:
            p = self.seats[seat_idx]
            self.add_history(f"玩家 {p.name} 离开了游戏")
            self.seats[seat_idx] = None
            
            # 如果离开的刚好是当前回合玩家，需要转交行动权
            if self.current_turn == seat_idx and self.round_name not in ["waiting", "showdown", "ended"]:
                self.pass_turn()
            
            # 检查游戏是否应该结束
            self.check_game_end_conditions()

    def add_history(self, msg):
        self.history.append(msg)
        if len(self.history) > 50:
            self.history.pop(0)

    def get_active_players_count(self):
        return sum(1 for p in self.seats if p is not None and p.status in ["playing", "all-in"])

    def get_unfolded_players_count(self):
        return sum(1 for p in self.seats if p is not None and p.status == "playing")

    def start_hand(self):
        """
        开始一局新游戏
        """
        active_count = sum(1 for p in self.seats if p is not None and p.chips > 0)
        if active_count < 2:
            self.add_history("玩家不足，无法开始游戏")
            self.round_name = "waiting"
            return False

        # 初始化扑克牌
        self.deck = [v + s for v in VAL_MAP.keys() for s in SUITS]
        random.shuffle(self.deck)
        self.community_cards = []
        self.winners = []
        self.win_messages = []

        # 重置玩家局内状态
        for p in self.seats:
            if p is not None:
                p.cards = []
                p.chips_in_pot = 0
                p.chips_in_round = 0
                p.show_cards = False
                if p.chips > 0:
                    p.status = "playing"
                else:
                    p.status = "spectator"

        # 移动庄家按钮 (Dealer)
        self.dealer_idx = self.get_next_seat(self.dealer_idx, ["playing"])
        
        # 确定大小盲
        self.sb_idx = self.get_next_seat(self.dealer_idx, ["playing"])
        self.bb_idx = self.get_next_seat(self.sb_idx, ["playing"])

        # 扣除盲注
        self.post_blind(self.sb_idx, self.sb_amount)
        self.post_blind(self.bb_idx, self.bb_amount)

        # 发底牌
        for _ in range(2):
            for i in range(8):
                idx = (self.dealer_idx + 1 + i) % 8
                p = self.seats[idx]
                if p is not None and p.status == "playing":
                    p.cards.append(self.deck.pop())

        self.round_name = "preflop"
        self.current_bet = self.bb_amount
        self.min_raise = self.bb_amount * 2
        self.last_raiser = self.bb_idx
        
        # 翻牌前行动从大盲座位的下一个玩家开始
        self.current_turn = self.get_next_seat(self.bb_idx, ["playing"])
        self.add_history("新一局开始，发牌完毕！")
        return True

    def post_blind(self, seat_idx, amount):
        p = self.seats[seat_idx]
        if p.chips <= amount:
            # 筹码不足，强制All-in
            p.chips_in_pot = p.chips
            p.chips_in_round = p.chips
            p.chips = 0
            p.status = "all-in"
            self.add_history(f"{p.name} 筹码不足，强制 All-in 盲注 {p.chips_in_pot}")
        else:
            p.chips -= amount
            p.chips_in_pot = amount
            p.chips_in_round = amount
            self.add_history(f"{p.name} 注入盲注 {amount}")

    def get_next_seat(self, start_idx, statuses):
        """
        寻找下一个处于特定状态的玩家的座位号
        """
        for i in range(1, 9):
            idx = (start_idx + i) % 8
            p = self.seats[idx]
            if p is not None and p.status in statuses:
                return idx
        return start_idx

    def player_action(self, seat_idx, action, raise_amount=0):
        """
        处理玩家的行动。
        action: 'fold', 'check', 'call', 'raise'
        """
        if seat_idx != self.current_turn:
            return False, "不该你行动"

        p = self.seats[seat_idx]
        call_amount = self.current_bet - p.chips_in_round

        if action == "fold":
            p.status = "folded"
            self.add_history(f"玩家 {p.name} 弃牌")
            
        elif action == "check":
            if call_amount > 0:
                return False, "有下注，无法过牌"
            self.add_history(f"玩家 {p.name} 过牌")
            
        elif action == "call":
            if call_amount <= 0:
                # 相当于过牌
                self.add_history(f"玩家 {p.name} 过牌(跟注0)")
            elif p.chips <= call_amount:
                # 筹码不够，All-in跟注
                actual_call = p.chips
                p.chips_in_pot += actual_call
                p.chips_in_round += actual_call
                p.chips = 0
                p.status = "all-in"
                self.add_history(f"玩家 {p.name} 筹码不足，All-in 跟注 {actual_call}")
            else:
                p.chips -= call_amount
                p.chips_in_pot += call_amount
                p.chips_in_round += call_amount
                self.add_history(f"玩家 {p.name} 跟注 {call_amount}")
                
        elif action == "raise":
            # raise_amount 是总下注量，不是加注量
            if raise_amount < self.min_raise:
                return False, f"加注额必须至少为 {self.min_raise}"
            
            needed = raise_amount - p.chips_in_round
            if p.chips < needed:
                # 如果筹码不足以跟注到raise_amount，直接选择All-in
                actual_raise = p.chips + p.chips_in_round
                needed = p.chips
                p.chips_in_pot += needed
                p.chips_in_round += needed
                p.chips = 0
                p.status = "all-in"
                
                # 仅在实际下注额大于当前最大bet时更新它
                if actual_raise > self.current_bet:
                    diff = actual_raise - self.current_bet
                    self.min_raise = actual_raise + max(diff, self.bb_amount)
                    self.current_bet = actual_raise
                    self.last_raiser = seat_idx
                self.add_history(f"玩家 {p.name} 筹码不足，All-in 加注到 {actual_raise}")
            else:
                p.chips -= needed
                p.chips_in_pot += needed
                p.chips_in_round += raise_amount - p.chips_in_round
                
                diff = raise_amount - self.current_bet
                self.current_bet = raise_amount
                self.min_raise = raise_amount + max(diff, self.bb_amount)
                self.last_raiser = seat_idx
                self.add_history(f"玩家 {p.name} 加注到 {raise_amount}")

        # 检查是否所有人都跟注，或者只剩1人没有fold
        self.pass_turn()
        return True, "行动成功"

    def pass_turn(self):
        """
        转移行动权，并判断是否需要进入下一阶段。
        """
        # 检查是否只剩1个活着的玩家（其他人全Fold了）
        playing_players = [i for i, p in enumerate(self.seats) if p is not None and p.status == "playing"]
        all_in_players = [i for i, p in enumerate(self.seats) if p is not None and p.status == "all-in"]
        total_active = len(playing_players) + len(all_in_players)

        # 1. 只有1人未折叠，直接获胜
        if sum(1 for p in self.seats if p is not None and p.status in ["playing", "all-in"]) <= 1:
            self.end_hand_single_winner()
            return

        # 2. 寻找下一个需要表态的玩家
        next_turn = self.current_turn
        found = False
        for _ in range(8):
            next_turn = (next_turn + 1) % 8
            p = self.seats[next_turn]
            if p is not None and p.status == "playing":
                # 这个玩家是否已经做过表态，且跟注了当前最高注？
                # 如果当前玩家是 last_raiser 并且大家都跟注了，那么这一轮就应该结束
                if next_turn == self.last_raiser and p.chips_in_round == self.current_bet:
                    break
                # 如果这个玩家还没有跟上最高注，或者还没表态，就是他的回合
                if p.chips_in_round < self.current_bet or self.last_raiser == -1 or next_turn != self.last_raiser:
                    self.current_turn = next_turn
                    found = True
                    break

        if not found:
            # 当前投注轮结束
            self.advance_round()

    def advance_round(self):
        """
        进入下一个发牌阶段
        """
        # 把每个玩家在本轮的投注金额清零，并把筹码汇入总池
        for p in self.seats:
            if p is not None:
                p.chips_in_round = 0

        self.current_bet = 0
        self.last_raiser = -1
        self.min_raise = self.bb_amount

        # 检查是否只剩最多一个玩家还能下注（其他都在 all-in 或 fold）
        # 如果是这样，无需再下注，直接发完剩余所有公共牌并进入摊牌
        unfolded_can_bet = sum(1 for p in self.seats if p is not None and p.status == "playing")
        unfolded_all_in = sum(1 for p in self.seats if p is not None and p.status == "all-in")
        
        if unfolded_can_bet <= 1 and unfolded_all_in >= 1:
            # 自动发完剩下的公共牌
            while len(self.community_cards) < 5:
                self.deck.pop() # Burn card
                self.community_cards.append(self.deck.pop())
            self.round_name = "showdown"
            self.evaluate_showdown()
            return

        if self.round_name == "preflop":
            self.round_name = "flop"
            self.deck.pop() # 烧牌
            for _ in range(3):
                self.community_cards.append(self.deck.pop())
            self.add_history(f"翻牌圈: {' '.join(self.community_cards)}")
            
        elif self.round_name == "flop":
            self.round_name = "turn"
            self.deck.pop() # 烧牌
            self.community_cards.append(self.deck.pop())
            self.add_history(f"转牌圈: {' '.join(self.community_cards)}")
            
        elif self.round_name == "turn":
            self.round_name = "river"
            self.deck.pop() # 烧牌
            self.community_cards.append(self.deck.pop())
            self.add_history(f"河牌圈: {' '.join(self.community_cards)}")
            
        elif self.round_name == "river":
            self.round_name = "showdown"
            self.evaluate_showdown()
            return

        # 新的一轮开始，由庄家左侧第一个未折叠且非 all-in 玩家最先行动
        self.current_turn = self.get_next_seat(self.dealer_idx, ["playing"])
        self.last_raiser = -1 # 新的一轮没有加注者
        # 如果新一轮没有人能行动（其实上面的 unfolded_can_bet 判断已经截获了）
        if self.seats[self.current_turn].status != "playing":
            self.advance_round()

    def end_hand_single_winner(self):
        """
        除了一人外，其余玩家均弃牌，此玩家直接获胜，无需展示底牌。
        """
        winner_idx = [i for i, p in enumerate(self.seats) if p is not None and p.status in ["playing", "all-in"]][0]
        winner = self.seats[winner_idx]
        
        # 收集所有人的放入筹码
        total_pot = sum(p.chips_in_pot for p in self.seats if p is not None)
        winner.chips += total_pot
        
        self.round_name = "ended"
        self.winners = [winner_idx]
        self.win_messages = [f"所有人都弃牌，{winner.name} 赢取筹码池 {total_pot}"]
        self.add_history(self.win_messages[0])
        self.current_turn = -1

    def evaluate_showdown(self):
        """
        摊牌比较大小，并结算筹码
        """
        active_seats = [i for i, p in enumerate(self.seats) if p is not None and p.status in ["playing", "all-in"]]
        folded_seats = [i for i, p in enumerate(self.seats) if p is not None and p.status == "folded"]
        
        # 对每一个玩家计算其最大手牌强度
        hand_scores = {}
        hand_names = {
            9: "同花顺", 8: "四条", 7: "葫芦", 6: "同花", 5: "顺子",
            4: "三条", 3: "两对", 2: "一对", 1: "高牌"
        }
        
        for seat in active_seats:
            p = self.seats[seat]
            p.show_cards = True # 摊牌阶段展示手牌
            full_cards = p.cards + self.community_cards
            score_tuple, best_5 = evaluate_7_card_hand(full_cards)
            hand_scores[seat] = score_tuple
            
        # 运行边池结算算法
        contributions = {i: p.chips_in_pot for i, p in enumerate(self.seats) if p is not None}
        payouts = resolve_pots(contributions, active_seats, folded_seats, hand_scores)
        
        # 给赢家分发筹码，并生成提示词
        self.winners = []
        win_details = []
        for seat, win_amt in payouts.items():
            if win_amt > 0:
                p = self.seats[seat]
                p.chips += win_amt
                self.winners.append(seat)
                
                # 如果这个玩家没弃牌，计算他的手牌类别
                if seat not in folded_seats:
                    rank_score = hand_scores[seat][0]
                    hand_desc = hand_names.get(rank_score, "高牌")
                    win_details.append(f"{p.name} ({hand_desc}) 赢取 {win_amt}")
                else:
                    win_details.append(f"{p.name} 赢回退还筹码 {win_amt}")
                    
        self.round_name = "ended"
        self.win_messages = win_details
        for msg in win_details:
            self.add_history(msg)
        self.current_turn = -1

    def check_game_end_conditions(self):
        """
        检查游戏座位空缺或不符合游戏继续条件
        """
        active = self.get_active_players_count()
        if active < 2 and self.round_name not in ["waiting", "showdown", "ended"]:
            # 如果中途退人导致玩家数少于 2，游戏直接重置回等待状态
            self.round_name = "waiting"
            self.current_turn = -1
            self.add_history("玩家不足 2 人，游戏暂停，等待其他玩家加入")

    def to_dict(self, current_player_seat=None):
        """
        序列化游戏状态发送给客户端。
        根据当前视角 seat_idx 决定是否隐藏牌。
        """
        # 计算当前奖池总额
        total_pot = sum(p.chips_in_pot for p in self.seats if p is not None)
        
        players_list = []
        for idx, p in enumerate(self.seats):
            if p is None:
                players_list.append(None)
            else:
                is_self = (idx == current_player_seat)
                players_list.append(p.to_dict(is_self))

        return {
            "seats": players_list,
            "community_cards": self.community_cards,
            "dealer_idx": self.dealer_idx,
            "sb_idx": self.sb_idx,
            "bb_idx": self.bb_idx,
            "current_turn": self.current_turn,
            "round_name": self.round_name,
            "current_bet": self.current_bet,
            "min_raise": self.min_raise,
            "total_pot": total_pot,
            "winners": self.winners,
            "win_messages": self.win_messages,
            "history": self.history
        }
