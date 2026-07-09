// 德州扑克 JS 核心游戏引擎
const VAL_MAP = {'2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14};
const SUITS = ['h', 'd', 'c', 's']; // h: 红桃, d: 方块, c: 草花, s: 黑桃

// 辅助函数：数组项对比大小 (类似于 Python 元组比大小)
function compareScores(scoreA, scoreB) {
    for (let i = 0; i < Math.max(scoreA.length, scoreB.length); i++) {
        const valA = scoreA[i] || 0;
        const valB = scoreB[i] || 0;
        if (valA > valB) return 1;
        if (valA < valB) return -1;
    }
    return 0;
}

// 辅助函数：从 n 个元素中选出 k 个的全部组合
function getCombinations(array, k) {
    let result = [];
    function helper(start, combo) {
        if (combo.length === k) {
            result.push([...combo]);
            return;
        }
        for (let i = start; i < array.length; i++) {
            combo.push(array[i]);
            helper(i + 1, combo);
            combo.pop();
        }
    }
    helper(0, []);
    return result;
}

// 评估 5 张手牌强度
function evaluate5CardHand(hand) {
    const values = hand.map(c => VAL_MAP[c[0]]).sort((a, b) => b - a);
    const suits = hand.map(c => c[1]);
    
    const isFlush = new Set(suits).size === 1;
    
    let isStraight = false;
    let highestStraightCard = 0;
    
    const uniqueVals = [...new Set(values)].sort((a, b) => b - a);
    if (uniqueVals.length === 5) {
        if (uniqueVals[0] - uniqueVals[4] === 4) {
            isStraight = true;
            highestStraightCard = uniqueVals[0];
        } else if (JSON.stringify(uniqueVals) === JSON.stringify([14, 5, 4, 3, 2])) { // A-5 顺子
            isStraight = true;
            highestStraightCard = 5;
        }
    }
    
    // 计算面值频率
    let counts = {};
    for (let v of values) {
        counts[v] = (counts[v] || 0) + 1;
    }
    
    // 排序频率：先排次数，再排大小
    let freqSorted = Object.entries(counts)
        .map(([val, count]) => [count, parseInt(val)])
        .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
        
    const pattern = freqSorted.map(item => item[0]);
    
    // 返回格式统一为长度 6 的数组: [牌型分, 关键位1, 关键位2, 关键位3, 关键位4, 关键位5]
    if (isFlush && isStraight) {
        return [9, highestStraightCard, 0, 0, 0, 0];
    }
    if (pattern[0] === 4) {
        return [8, freqSorted[0][1], freqSorted[1][1], 0, 0, 0];
    }
    if (pattern[0] === 3 && pattern[1] === 2) {
        return [7, freqSorted[0][1], freqSorted[1][1], 0, 0, 0];
    }
    if (isFlush) {
        return [6, values[0], values[1], values[2], values[3], values[4]];
    }
    if (isStraight) {
        return [5, highestStraightCard, 0, 0, 0, 0];
    }
    if (pattern[0] === 3) {
        return [4, freqSorted[0][1], freqSorted[1][1], freqSorted[2][1], 0, 0];
    }
    if (pattern[0] === 2 && pattern[1] === 2) {
        return [3, freqSorted[0][1], freqSorted[1][1], freqSorted[2][1], 0, 0];
    }
    if (pattern[0] === 2) {
        return [2, freqSorted[0][1], freqSorted[1][1], freqSorted[2][1], freqSorted[3][1], 0];
    }
    return [1, values[0], values[1], values[2], values[3], values[4]];
}

// 从 7 张牌中选出最强 5 张
function evaluate7CardHand(cards) {
    let bestScore = null;
    let bestHand = null;
    const combs = getCombinations(cards, 5);
    for (let comb of combs) {
        const score = evaluate5CardHand(comb);
        if (bestScore === null || compareScores(score, bestScore) > 0) {
            bestScore = score;
            bestHand = comb;
        }
    }
    return { score: bestScore, hand: bestHand };
}

const HAND_NAMES = {
    9: "同花顺",
    8: "四条",
    7: "葫芦",
    6: "同花",
    5: "顺子",
    4: "三条",
    3: "两对",
    2: "一对",
    1: "高牌"
};

function getHandDescription(holeCards, communityCards) {
    if (!holeCards || holeCards.length < 2) return "";
    const validCommunity = (communityCards || []).filter(c => c && c !== "?");
    const allCards = [...holeCards, ...validCommunity];
    if (allCards.length < 5) {
        return "底牌已发";
    }
    try {
        const { score } = evaluate7CardHand(allCards);
        if (!score) return "分析中...";
        const rank = score[0];
        return HAND_NAMES[rank] || "高牌";
    } catch (e) {
        console.error("评估手牌出错:", e);
        return "分析中...";
    }
}

// 边池计算与分配
function resolvePots(playerContributions, activeSeats, foldedSeats, handScores) {
    let contributions = { ...playerContributions };
    let payouts = {};
    for (let seat in contributions) {
        payouts[seat] = 0;
    }
    
    while (true) {
        let contributingSeats = Object.keys(contributions)
            .filter(seat => contributions[seat] > 0)
            .map(seat => parseInt(seat));
            
        if (contributingSeats.length === 0) break;
        
        let minContrib = Math.min(...contributingSeats.map(seat => contributions[seat]));
        
        let currentPot = 0;
        let eligibleSeats = [];
        
        for (let seat of contributingSeats) {
            currentPot += minContrib;
            contributions[seat] -= minContrib;
            if (!foldedSeats.includes(seat)) {
                eligibleSeats.push(seat);
            }
        }
        
        if (eligibleSeats.length === 0) {
            // 退回贡献者
            for (let seat of contributingSeats) {
                payouts[seat] += minContrib;
            }
            continue;
        }
        
        // 寻找符合条件的最大手牌评分
        let bestScore = null;
        for (let seat of eligibleSeats) {
            let score = handScores[seat];
            if (bestScore === null || compareScores(score, bestScore) > 0) {
                bestScore = score;
            }
        }
        
        let winners = eligibleSeats.filter(seat => compareScores(handScores[seat], bestScore) === 0);
        
        let potPerWinner = Math.floor(currentPot / winners.length);
        let oddChips = currentPot % winners.length;
        
        winners.forEach((winner, idx) => {
            payouts[winner] += potPerWinner;
            if (idx < oddChips) payouts[winner] += 1;
        });
    }
    return payouts;
}

// 玩家数据结构
class Player {
    constructor(name, chips = 10000) {
        this.name = name;
        this.chips = chips;
        this.cards = [];
        this.status = "spectator"; // spectator, playing, folded, all-in
        this.chips_in_pot = 0;
        this.chips_in_round = 0;
        this.show_cards = false;
    }

    toDict(isSelf = false) {
        return {
            name: this.name,
            chips: this.chips,
            cards: (isSelf || this.show_cards) ? this.cards : ["?", "?"],
            status: this.status,
            chips_in_pot: this.chips_in_pot,
            chips_in_round: this.chips_in_round,
            show_cards: this.show_cards
        };
    }
}

// 核心德州扑克状态机
class PokerGame {
    constructor() {
        this.seats = Array(8).fill(null);
        this.deck = [];
        this.community_cards = [];
        this.dealer_idx = 0;
        this.sb_idx = -1;
        this.bb_idx = -1;
        this.current_turn = -1;
        this.round_name = "waiting"; // waiting, preflop, flop, turn, river, showdown, ended
        this.current_bet = 0;
        this.last_raiser = -1;
        this.min_raise = 100;
        this.sb_amount = 50;
        this.bb_amount = 100;
        this.winners = [];
        this.win_messages = [];
        this.history = [];
    }

    addPlayer(name, seatIdx = null) {
        if (seatIdx === null) {
            for (let i = 0; i < 8; i++) {
                if (this.seats[i] === null) {
                    seatIdx = i;
                    break;
                }
            }
        }
        if (seatIdx !== null && seatIdx >= 0 && seatIdx < 8 && this.seats[seatIdx] === null) {
            this.seats[seatIdx] = new Player(name);
            this.addHistory(`玩家 ${name} 加入了游戏，坐在座位 ${seatIdx + 1}`);
            return seatIdx;
        }
        return -1;
    }

    removePlayer(seatIdx) {
        if (seatIdx >= 0 && seatIdx < 8 && this.seats[seatIdx] !== null) {
            const p = this.seats[seatIdx];
            this.addHistory(`玩家 ${p.name} 离开了游戏`);
            this.seats[seatIdx] = null;
            
            if (this.current_turn === seatIdx && !["waiting", "showdown", "ended"].includes(this.round_name)) {
                this.passTurn();
            }
            this.checkGameEndConditions();
        }
    }

    addHistory(msg) {
        this.history.push(msg);
        if (this.history.length > 50) {
            this.history.shift();
        }
    }

    getActivePlayersCount() {
        return this.seats.filter(p => p !== null && ["playing", "all-in"].includes(p.status)).length;
    }

    getUnfoldedPlayersCount() {
        return this.seats.filter(p => p !== null && p.status === "playing").length;
    }

    startHand() {
        const activeCount = this.seats.filter(p => p !== null && p.chips > 0).length;
        if (activeCount < 2) {
            this.addHistory("玩家不足，无法开始游戏");
            this.round_name = "waiting";
            return false;
        }

        // 初始化扑克牌
        this.deck = [];
        for (let v of Object.keys(VAL_MAP)) {
            for (let s of SUITS) {
                this.deck.push(v + s);
            }
        }
        
        // 洗牌 Fisher-Yates
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
        
        this.community_cards = [];
        this.winners = [];
        this.win_messages = [];

        // 重置玩家本局属性
        this.seats.forEach(p => {
            if (p !== null) {
                p.cards = [];
                p.chips_in_pot = 0;
                p.chips_in_round = 0;
                p.show_cards = false;
                if (p.chips > 0) {
                    p.status = "playing";
                } else {
                    p.status = "spectator";
                }
            }
        });

        // 移动庄家
        this.dealer_idx = this.getNextSeat(this.dealer_idx, ["playing"]);
        
        // 大小盲
        this.sb_idx = this.getNextSeat(this.dealer_idx, ["playing"]);
        this.bb_idx = this.getNextSeat(this.sb_idx, ["playing"]);

        this.postBlind(this.sb_idx, this.sb_amount);
        this.postBlind(this.bb_idx, this.bb_amount);

        // 发底牌
        for (let round = 0; round < 2; round++) {
            for (let i = 0; i < 8; i++) {
                const idx = (this.dealer_idx + 1 + i) % 8;
                const p = this.seats[idx];
                if (p !== null && p.status === "playing") {
                    p.cards.push(this.deck.pop());
                }
            }
        }

        this.round_name = "preflop";
        this.current_bet = this.bb_amount;
        this.min_raise = this.bb_amount * 2;
        this.last_raiser = this.bb_idx;
        this.current_turn = this.getNextSeat(this.bb_idx, ["playing"]);
        this.addHistory("新一局开始，发牌完毕！");
        return true;
    }

    postBlind(seatIdx, amount) {
        const p = this.seats[seatIdx];
        if (p.chips <= amount) {
            p.chips_in_pot = p.chips;
            p.chips_in_round = p.chips;
            p.chips = 0;
            p.status = "all-in";
            this.addHistory(`${p.name} 筹码不足，强制 All-in 盲注 ${p.chips_in_pot}`);
        } else {
            p.chips -= amount;
            p.chips_in_pot = amount;
            p.chips_in_round = amount;
            this.addHistory(`${p.name} 注入盲注 ${amount}`);
        }
    }

    getNextSeat(startIdx, statuses) {
        for (let i = 1; i <= 8; i++) {
            const idx = (startIdx + i) % 8;
            const p = this.seats[idx];
            if (p !== null && statuses.includes(p.status)) {
                return idx;
            }
        }
        return startIdx;
    }

    playerAction(seatIdx, action, raiseAmount = 0) {
        if (seatIdx !== this.current_turn) {
            return [false, "不该你行动"];
        }

        const p = this.seats[seatIdx];
        const callAmount = this.current_bet - p.chips_in_round;

        if (action === "fold") {
            p.status = "folded";
            this.addHistory(`玩家 ${p.name} 弃牌`);
            
        } else if (action === "check") {
            if (callAmount > 0) {
                return [false, "有下注，无法过牌"];
            }
            this.addHistory(`玩家 ${p.name} 过牌`);
            
        } else if (action === "call") {
            if (callAmount <= 0) {
                this.addHistory(`玩家 ${p.name} 过牌(跟注0)`);
            } else if (p.chips <= callAmount) {
                const actualCall = p.chips;
                p.chips_in_pot += actualCall;
                p.chips_in_round += actualCall;
                p.chips = 0;
                p.status = "all-in";
                this.addHistory(`玩家 ${p.name} 筹码不足，All-in 跟注 ${actualCall}`);
            } else {
                p.chips -= callAmount;
                p.chips_in_pot += callAmount;
                p.chips_in_round += callAmount;
                this.addHistory(`玩家 ${p.name} 跟注 ${callAmount}`);
            }
            
        } else if (action === "raise") {
            if (raiseAmount < this.min_raise) {
                return [false, `加注额必须至少为 ${this.min_raise}`];
            }
            
            const needed = raiseAmount - p.chips_in_round;
            if (p.chips < needed) {
                const actualRaise = p.chips + p.chips_in_round;
                const actualNeeded = p.chips;
                p.chips_in_pot += actualNeeded;
                p.chips_in_round += actualNeeded;
                p.chips = 0;
                p.status = "all-in";
                
                if (actualRaise > this.current_bet) {
                    const diff = actualRaise - this.current_bet;
                    this.min_raise = actualRaise + Math.max(diff, this.bb_amount);
                    this.current_bet = actualRaise;
                    this.last_raiser = seatIdx;
                }
                this.addHistory(`玩家 ${p.name} 筹码不足，All-in 加注到 ${actualRaise}`);
            } else {
                p.chips -= needed;
                p.chips_in_pot += needed;
                p.chips_in_round = raiseAmount;
                
                const diff = raiseAmount - this.current_bet;
                this.current_bet = raiseAmount;
                this.min_raise = raiseAmount + Math.max(diff, this.bb_amount);
                this.last_raiser = seatIdx;
                this.addHistory(`玩家 ${p.name} 加注到 ${raiseAmount}`);
            }
        }

        this.passTurn();
        return [true, "行动成功"];
    }

    passTurn() {
        const totalActive = this.seats.filter(p => p !== null && ["playing", "all-in"].includes(p.status)).length;
        if (totalActive <= 1) {
            this.endHandSingleWinner();
            return;
        }

        let nextTurn = this.current_turn;
        let found = false;
        for (let i = 0; i < 8; i++) {
            nextTurn = (nextTurn + 1) % 8;
            const p = this.seats[nextTurn];
            if (p !== null && p.status === "playing") {
                if (nextTurn === this.last_raiser && p.chips_in_round === this.current_bet) {
                    break;
                }
                if (p.chips_in_round < this.current_bet || this.last_raiser === -1 || nextTurn !== this.last_raiser) {
                    this.current_turn = nextTurn;
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            this.advanceRound();
        }
    }

    advanceRound() {
        this.seats.forEach(p => {
            if (p !== null) {
                p.chips_in_round = 0;
            }
        });

        this.current_bet = 0;
        this.last_raiser = -1;
        this.min_raise = this.bb_amount;

        const unfoldedCanBet = this.seats.filter(p => p !== null && p.status === "playing").length;
        const unfoldedAllIn = this.seats.filter(p => p !== null && p.status === "all-in").length;
        
        if (unfoldedCanBet <= 1 && unfoldedAllIn >= 1) {
            while (this.community_cards.length < 5) {
                this.deck.pop(); // 烧牌
                this.community_cards.push(this.deck.pop());
            }
            this.round_name = "showdown";
            this.evaluateShowdown();
            return;
        }

        if (this.round_name === "preflop") {
            this.round_name = "flop";
            this.deck.pop(); // 烧牌
            for (let i = 0; i < 3; i++) this.community_cards.push(this.deck.pop());
            this.addHistory(`翻牌圈: ${this.community_cards.join(" ")}`);
            
        } else if (this.round_name === "flop") {
            this.round_name = "turn";
            this.deck.pop(); // 烧牌
            this.community_cards.push(this.deck.pop());
            this.addHistory(`转牌圈: ${this.community_cards.join(" ")}`);
            
        } else if (this.round_name === "turn") {
            this.round_name = "river";
            this.deck.pop(); // 烧牌
            this.community_cards.push(this.deck.pop());
            this.addHistory(`河牌圈: ${this.community_cards.join(" ")}`);
            
        } else if (this.round_name === "river") {
            this.round_name = "showdown";
            this.evaluateShowdown();
            return;
        }

        this.current_turn = this.getNextSeat(this.dealer_idx, ["playing"]);
        this.last_raiser = -1;
        if (this.seats[this.current_turn].status !== "playing") {
            this.advanceRound();
        }
    }

    endHandSingleWinner() {
        const winnerIdx = this.seats.findIndex(p => p !== null && ["playing", "all-in"].includes(p.status));
        const winner = this.seats[winnerIdx];
        
        const totalPot = this.seats.reduce((sum, p) => sum + (p ? p.chips_in_pot : 0), 0);
        winner.chips += totalPot;
        
        this.round_name = "ended";
        this.winners = [winnerIdx];
        this.win_messages = [`所有人都弃牌，${winner.name} 赢取筹码池 ${totalPot}`];
        this.addHistory(this.win_messages[0]);
        this.current_turn = -1;
    }

    evaluateShowdown() {
        const activeSeats = [];
        const foldedSeats = [];
        this.seats.forEach((p, idx) => {
            if (p !== null) {
                if (["playing", "all-in"].includes(p.status)) {
                    activeSeats.push(idx);
                } else if (p.status === "folded") {
                    foldedSeats.push(idx);
                }
            }
        });

        const handScores = {};
        const handNames = {
            9: "同花顺", 8: "四条", 7: "葫芦", 6: "同花", 5: "顺子",
            4: "三条", 3: "两对", 2: "一对", 1: "高牌"
        };
        
        activeSeats.forEach(seat => {
            const p = this.seats[seat];
            p.show_cards = true;
            const fullCards = p.cards.concat(this.community_cards);
            const { score } = evaluate7CardHand(fullCards);
            handScores[seat] = score;
        });
        
        const contributions = {};
        this.seats.forEach((p, idx) => {
            if (p !== null) contributions[idx] = p.chips_in_pot;
        });
        
        const payouts = resolvePots(contributions, activeSeats, foldedSeats, handScores);
        
        this.winners = [];
        const winDetails = [];
        for (let seat in payouts) {
            const winAmt = payouts[seat];
            if (winAmt > 0) {
                const p = this.seats[seat];
                p.chips += winAmt;
                this.winners.push(parseInt(seat));
                
                if (!foldedSeats.includes(parseInt(seat))) {
                    const rankScore = handScores[seat][0];
                    const handDesc = handNames[rankScore] || "高牌";
                    winDetails.append ? winDetails.push(`${p.name} (${handDesc}) 赢取 ${winAmt}`) : winDetails.push(`${p.name} (${handDesc}) 赢取 ${winAmt}`);
                } else {
                    winDetails.push(`${p.name} 赢回退还筹码 ${winAmt}`);
                }
            }
        }
        
        this.round_name = "ended";
        this.win_messages = winDetails;
        winDetails.forEach(msg => this.addHistory(msg));
        this.current_turn = -1;
    }

    checkGameEndConditions() {
        const active = this.seats.filter(p => p !== null && ["playing", "all-in"].includes(p.status)).length;
        if (active < 2 && !["waiting", "showdown", "ended"].includes(this.round_name)) {
            this.round_name = "waiting";
            this.current_turn = -1;
            this.addHistory("玩家不足 2 人，游戏暂停，等待其他玩家加入");
        }
    }

    toDict(currentPlayerSeat = null) {
        const totalPot = this.seats.reduce((sum, p) => sum + (p ? p.chips_in_pot : 0), 0);
        
        const playersList = this.seats.map((p, idx) => {
            if (p === null) return null;
            const isSelf = (idx === currentPlayerSeat);
            return p.toDict(isSelf);
        });

        return {
            seats: playersList,
            community_cards: this.community_cards,
            dealer_idx: this.dealer_idx,
            sb_idx: this.sb_idx,
            bb_idx: this.bb_idx,
            current_turn: this.current_turn,
            round_name: this.round_name,
            current_bet: this.current_bet,
            min_raise: this.min_raise,
            total_pot: totalPot,
            winners: this.winners,
            win_messages: this.win_messages,
            history: this.history
        };
    }
}
