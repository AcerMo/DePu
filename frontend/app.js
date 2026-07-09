// 全局状态变量
let ws = null;
let currentRoomId = "";
let currentUsername = "";
let yourSeatIdx = -1;
let gameState = null;

// HTML 元素选择器
const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");
const usernameInput = document.getElementById("username");
const roomIdInput = document.getElementById("room-id");
const joinBtn = document.getElementById("join-btn");

const displayRoomId = document.getElementById("display-room-id");
const totalPotAmount = document.getElementById("total-pot-amount");
const standBtn = document.getElementById("stand-btn");
const seatsContainer = document.getElementById("seats-container");
const communityCardsContainer = document.getElementById("community-cards-container");
const gameNotifier = document.getElementById("game-notifier");
const notifierText = document.getElementById("notifier-text");

const setupPanel = document.getElementById("setup-panel");
const startGameBtn = document.getElementById("start-game-btn");
const rebuyBtn = document.getElementById("rebuy-btn");
const spectatorMsg = document.getElementById("spectator-msg");

const actionPanel = document.getElementById("action-panel");
const raiseSliderContainer = document.getElementById("raise-slider-container");
const raiseRange = document.getElementById("raise-range");
const raiseValDisplay = document.getElementById("raise-val-display");

const btnFold = document.getElementById("btn-fold");
const btnCheck = document.getElementById("btn-check");
const btnCall = document.getElementById("btn-call");
const btnRaise = document.getElementById("btn-raise");

const shortcutMin = document.getElementById("shortcut-min");
const shortcut2x = document.getElementById("shortcut-2x");
const shortcut3x = document.getElementById("shortcut-3x");
const shortcutPot = document.getElementById("shortcut-pot");
const shortcutAllin = document.getElementById("shortcut-allin");

const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
const chatSidebar = document.getElementById("chat-sidebar");
const logPane = document.getElementById("log-list");
const chatPane = document.getElementById("chat-list");
const chatInput = document.getElementById("chat-input");
const sendChatBtn = document.getElementById("send-chat-btn");
const toastElement = document.getElementById("toast");

// 绑定大厅事件
joinBtn.addEventListener("click", joinRoom);
standBtn.addEventListener("click", standUp);
startGameBtn.addEventListener("click", startGame);
rebuyBtn.addEventListener("click", rebuyChips);

// 侧栏与选项卡切换
sidebarToggleBtn.addEventListener("click", () => {
    chatSidebar.classList.toggle("open");
});

document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
        
        e.target.classList.add("active");
        const paneId = e.target.getAttribute("data-tab");
        document.getElementById(paneId).classList.add("active");
    });
});

// 发送聊天
sendChatBtn.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendChatMessage();
});

// 绑定四大下注动作
btnFold.addEventListener("click", () => sendAction("fold"));
btnCheck.addEventListener("click", () => sendAction("check"));
btnCall.addEventListener("click", () => sendAction("call"));
btnRaise.addEventListener("click", () => {
    const amt = parseInt(raiseRange.value);
    sendAction("raise", amt);
});

// 滑块值监听
raiseRange.addEventListener("input", (e) => {
    raiseValDisplay.textContent = e.target.value;
    btnRaise.querySelector(".val").textContent = `$${e.target.value}`;
});

// 滑块快捷操作
shortcutMin.addEventListener("click", () => updateRaiseSlider(gameState.min_raise));
shortcut2x.addEventListener("click", () => updateRaiseSlider(gameState.bb_amount * 2));
shortcut3x.addEventListener("click", () => updateRaiseSlider(gameState.bb_amount * 3));
shortcutPot.addEventListener("click", () => {
    const pot = gameState.total_pot;
    const callAmt = gameState.current_bet - (gameState.seats[yourSeatIdx]?.chips_in_round || 0);
    updateRaiseSlider(Math.max(gameState.min_raise, pot + callAmt));
});
shortcutAllin.addEventListener("click", () => {
    const myChips = gameState.seats[yourSeatIdx]?.chips || 0;
    const myInRound = gameState.seats[yourSeatIdx]?.chips_in_round || 0;
    updateRaiseSlider(myChips + myInRound);
});

// 加入房间函数
function joinRoom() {
    const username = usernameInput.value.trim();
    const roomId = roomIdInput.value.trim();

    if (!username) {
        showToast("请输入昵称");
        return;
    }
    if (!roomId) {
        showToast("请输入房间号");
        return;
    }

    currentUsername = username;
    currentRoomId = roomId;

    // 建立 WebSocket 连接
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    ws = new WebSocket(`${proto}//${host}/ws/${roomId}?name=${encodeURIComponent(username)}`);

    ws.onopen = () => {
        showToast("成功连接到房间");
        lobbyScreen.classList.remove("active");
        gameScreen.classList.add("active");
        displayRoomId.textContent = roomId;
    };

    ws.onmessage = (event) => {
        const packet = JSON.parse(event.data);
        if (packet.type === "state") {
            gameState = packet.data;
            yourSeatIdx = gameState.your_seat;
            renderGame();
        } else if (packet.type === "chat") {
            appendChat(packet.sender, packet.message);
        } else if (packet.type === "error") {
            showToast(packet.message);
        }
    };

    ws.onclose = () => {
        showToast("连接已断开，返回大厅");
        gameScreen.classList.remove("active");
        lobbyScreen.classList.add("active");
    };

    ws.onerror = () => {
        showToast("WebSocket 连接发生错误");
    };
}

// 扑克花色字符与样式类定义
const SUIT_SYMBOLS = { 'h': '♥', 'd': '♦', 'c': '♣', 's': '♠' };
const SUIT_CLASSES = { 'h': 'red-suit', 'd': 'red-suit', 'c': 'black-suit', 's': 'black-suit' };

// 渲染核心游戏桌台
function renderGame() {
    // 1. 渲染总底池
    totalPotAmount.textContent = gameState.total_pot;

    // 2. 渲染 8 个座位
    seatsContainer.innerHTML = "";
    for (let i = 0; i < 8; i++) {
        const player = gameState.seats[i];
        const seatDiv = document.createElement("div");
        seatDiv.className = `seat seat-${i}`;

        if (!player) {
            // 座位空缺
            seatDiv.classList.add("empty");
            seatDiv.innerHTML = `
                <div class="player-avatar" onclick="sitDown(${i})">
                    <span>坐下</span>
                </div>
            `;
        } else {
            // 座位有玩家
            seatDiv.classList.add("occupied");
            if (player.status === "playing") seatDiv.classList.add("playing");
            if (gameState.current_turn === i) seatDiv.classList.add("active");

            // 判断是否是自己，标记名称
            const displayName = player.name + (i === yourSeatIdx ? " (我)" : "");
            
            // 角标：庄家位、小盲、大盲
            let badgeHtml = "";
            if (gameState.dealer_idx === i) badgeHtml += `<div class="dealer-button">D</div>`;
            if (gameState.sb_idx === i) badgeHtml += `<div class="blind-badge sb">S</div>`;
            if (gameState.bb_idx === i) badgeHtml += `<div class="blind-badge bb">B</div>`;

            // 折叠或 All-in 状态角标
            let statusHtml = "";
            if (player.status === "folded") {
                statusHtml = `<div class="status-badge fold">FOLD</div>`;
            } else if (player.status === "all-in") {
                statusHtml = `<div class="status-badge all-in">ALL IN</div>`;
            }

            // 渲染手牌 (非 spectator / fold)
            let cardsHtml = "";
            if (player.status !== "spectator" && player.status !== "folded" && player.cards && player.cards.length > 0) {
                cardsHtml = `<div class="player-hand-cards">`;
                player.cards.forEach(card => {
                    cardsHtml += createCardMarkup(card);
                });
                cardsHtml += `</div>`;
            }

            // 渲染单人投入的筹码
            let betHtml = "";
            if (player.chips_in_round > 0) {
                betHtml = `<div class="bet-display">$${player.chips_in_round}</div>`;
            }

            seatDiv.innerHTML = `
                ${badgeHtml}
                <div class="player-avatar">
                    <span>${player.name.substring(0, 2)}</span>
                    ${statusHtml}
                </div>
                <div class="player-info">
                    <div class="player-name">${displayName}</div>
                    <div class="player-chips">$${player.chips}</div>
                </div>
                ${cardsHtml}
                ${betHtml}
            `;
        }
        seatsContainer.appendChild(seatDiv);
    }

    // 3. 渲染公共牌
    communityCardsContainer.innerHTML = "";
    for (let i = 0; i < 5; i++) {
        const card = gameState.community_cards[i];
        const slot = document.createElement("div");
        slot.className = "card-slot";
        if (card) {
            slot.innerHTML = createCardMarkup(card);
        } else {
            slot.classList.add("card-placeholder");
        }
        communityCardsContainer.appendChild(slot);
    }

    // 4. 更新系统通知条
    updateNotifier();

    // 5. 更新底部控制区面板
    updateControlPanel();

    // 6. 渲染局内日志
    renderHistory();
}

// 辅助方法：生成卡牌 HTML
function createCardMarkup(card) {
    if (card === "?") {
        return `<div class="card-back">♣</div>`;
    }
    const val = card.substring(0, card.length - 1);
    const suit = card.charAt(card.length - 1);
    const symbol = SUIT_SYMBOLS[suit] || "";
    const colorClass = SUIT_CLASSES[suit] || "black-suit";

    return `
        <div class="poker-card ${colorClass}">
            <div class="card-corner">
                <span>${val}</span>
                <span>${symbol}</span>
            </div>
            <div class="card-suit-big">${symbol}</div>
        </div>
    `;
}

// 更新顶部的游戏提醒
function updateNotifier() {
    const round = gameState.round_name;
    gameNotifier.classList.remove("hidden");

    if (round === "waiting") {
        notifierText.textContent = "等待玩家加入桌台，点击空闲座位入座";
    } else if (round === "ended") {
        notifierText.textContent = gameState.win_messages.join(" | ");
    } else if (round === "showdown") {
        notifierText.textContent = "游戏结束，进入摊牌比牌阶段";
    } else {
        const turnPlayer = gameState.seats[gameState.current_turn];
        if (turnPlayer) {
            notifierText.textContent = `当前行动圈: [${round.toUpperCase()}]，等待 [${turnPlayer.name}] 操作...`;
        }
    }
}

// 更新底部操控板状态
function updateControlPanel() {
    // 默认隐藏全部，根据身份渲染对应面板
    setupPanel.classList.remove("active");
    actionPanel.classList.remove("active");

    const me = gameState.seats[yourSeatIdx];

    // 情况一：玩家还是观众（未入座）
    if (yourSeatIdx === -1) {
        setupPanel.classList.add("active");
        startGameBtn.classList.add("hidden");
        rebuyBtn.classList.add("hidden");
        spectatorMsg.classList.remove("hidden");
        return;
    }

    // 情况二：游戏未开始或已结束结算中
    if (gameState.round_name === "waiting" || gameState.round_name === "ended") {
        setupPanel.classList.add("active");
        spectatorMsg.classList.add("hidden");
        
        // 如果我没筹码了，显示充值按钮
        if (me.chips <= 0) {
            rebuyBtn.classList.remove("hidden");
            startGameBtn.classList.add("hidden");
        } else {
            rebuyBtn.classList.add("hidden");
            // 只要是在桌子上，都可以申请开启游戏（如果有其他人在）
            const activeCount = gameState.seats.filter(p => p !== null && p.chips > 0).length;
            if (activeCount >= 2) {
                startGameBtn.classList.remove("hidden");
            } else {
                startGameBtn.classList.add("hidden");
            }
        }
        return;
    }

    // 情况三：游戏正在运行中，显示四大投注动作
    actionPanel.classList.add("active");
    
    // 如果还没轮到我行动，全部禁用
    if (gameState.current_turn !== yourSeatIdx) {
        setActionsDisabled(true);
        raiseSliderContainer.style.display = "none";
        return;
    }

    // 轮到我行动，激活按钮
    setActionsDisabled(false);

    const myChips = me.chips;
    const myInRound = me.chips_in_round;
    const currentBet = gameState.current_bet;
    const callAmount = currentBet - myInRound;

    // 1. 过牌按钮逻辑
    if (callAmount > 0) {
        btnCheck.disabled = true;
    } else {
        btnCheck.disabled = false;
    }

    // 2. 跟注按钮逻辑
    if (callAmount <= 0) {
        btnCall.querySelector(".val").textContent = "";
        btnCall.disabled = true;
    } else if (myChips <= callAmount) {
        btnCall.querySelector(".val").textContent = `ALL-IN ($${myChips})`;
        btnCall.disabled = false;
    } else {
        btnCall.querySelector(".val").textContent = `$${callAmount}`;
        btnCall.disabled = false;
    }

    // 3. 加注滑杆和加注按钮逻辑
    const maxRaise = myChips + myInRound;
    const minRaise = gameState.min_raise;

    if (myChips <= callAmount || minRaise > maxRaise) {
        // 如果我的钱还没跟注够，或者起加额已经超出了我的总余额，无法再Raise，必须All-in
        raiseSliderContainer.style.display = "none";
        btnRaise.disabled = true;
        btnRaise.querySelector(".val").textContent = "";
    } else {
        raiseSliderContainer.style.display = "block";
        btnRaise.disabled = false;
        
        // 更新滑杆范围
        raiseRange.min = minRaise;
        raiseRange.max = maxRaise;
        
        // 默认滑块保持在最小加注额
        if (parseInt(raiseRange.value) < minRaise || parseInt(raiseRange.value) > maxRaise) {
            raiseRange.value = minRaise;
        }
        
        raiseValDisplay.textContent = raiseRange.value;
        btnRaise.querySelector(".val").textContent = `$${raiseRange.value}`;
    }
}

function setActionsDisabled(disabled) {
    btnFold.disabled = disabled;
    btnCheck.disabled = disabled;
    btnCall.disabled = disabled;
    btnRaise.disabled = disabled;
}

function updateRaiseSlider(value) {
    const min = parseInt(raiseRange.min);
    const max = parseInt(raiseRange.max);
    let target = Math.max(min, Math.min(max, value));
    
    // 舍入到最近的筹码分度
    target = Math.round(target / 50) * 50;
    target = Math.max(min, Math.min(max, target));

    raiseRange.value = target;
    raiseValDisplay.textContent = target;
    btnRaise.querySelector(".val").textContent = `$${target}`;
}

// WebSocket 操作发送封装
function sitDown(seatIdx) {
    sendMessage({ action: "sit", seat: seatIdx });
}

function standUp() {
    sendMessage({ action: "stand" });
}

function startGame() {
    sendMessage({ action: "start_game" });
}

function rebuyChips() {
    sendMessage({ action: "buy_in" });
}

function sendAction(actionType, amount = 0) {
    sendMessage({ action: actionType, amount: amount });
}

function sendChatMessage() {
    const text = chatInput.value.trim();
    if (text) {
        sendMessage({ action: "chat", message: text });
        chatInput.value = "";
    }
}

function sendMessage(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(jsonToString(obj));
    }
}

function jsonToString(obj) {
    return JSON.stringify(obj);
}

// 局内日志与聊天室的插入
function renderHistory() {
    logPane.innerHTML = "";
    gameState.history.forEach(log => {
        const item = document.createElement("div");
        item.className = "log-item";
        item.textContent = log;
        logPane.appendChild(item);
    });
    logPane.scrollTop = logPane.scrollHeight;
}

function appendChat(sender, message) {
    const item = document.createElement("div");
    item.className = "chat-item";
    item.innerHTML = `<span class="sender">${sender}:</span><span class="msg-text">${message}</span>`;
    chatPane.appendChild(item);
    chatPane.scrollTop = chatPane.scrollHeight;
}

// Toast 弹窗消息
let toastTimer = null;
function showToast(msg) {
    toastElement.textContent = msg;
    toastElement.classList.remove("hidden");
    
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastElement.classList.add("hidden");
    }, 3000);
}
