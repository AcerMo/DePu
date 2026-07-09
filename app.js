// 全局 P2P 联机状态
const peerConfig = {
    config: {
        iceServers: [
            { urls: 'stun:stun.miwifi.com:3478' },
            { urls: 'stun:stun.qq.com:3478' },
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    }
};

let peer = null;
let isHost = false;
let currentRoomId = "";
let currentUsername = "";
let yourSeatIdx = -1;
let localGameState = null;

// 全局捕获 JavaScript 运行异常并输出到日志，方便用户排查
window.onerror = function(message, source, lineno, colno, error) {
    const errorMsg = `JS异常: ${message} (在 ${source.split('/').pop()}:${lineno}:${colno})`;
    console.error(errorMsg);
    // 强制打印在游戏日志和聊天室中
    setTimeout(() => {
        appendChat("系统错误", errorMsg);
        showToast("检测到JS脚本错误，请查看日志");
    }, 500);
    return false;
};

// Host 端独有变量
let pokerGame = null;       // 德州扑克引擎实例
let clientConnections = {}; // peerId -> DataConnection 映射
let peerToName = {};        // peerId -> 玩家姓名
let peerToSeat = {};        // peerId -> 座位号 (-1 表示旁观)
let seatToPeer = {};        // 座位号 -> peerId

// Client 端独有变量
let hostConnection = null;  // 连接到房主的 DataConnection

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
btnFold.addEventListener("click", () => sendPlayerAction("fold"));
btnCheck.addEventListener("click", () => sendPlayerAction("check"));
btnCall.addEventListener("click", () => sendPlayerAction("call"));
btnRaise.addEventListener("click", () => {
    const amt = parseInt(raiseRange.value);
    sendPlayerAction("raise", amt);
});

// 滑块值监听
raiseRange.addEventListener("input", (e) => {
    raiseValDisplay.textContent = e.target.value;
    btnRaise.querySelector(".val").textContent = `$${e.target.value}`;
});

// 滑块快捷操作
shortcutMin.addEventListener("click", () => updateRaiseSlider(localGameState.min_raise));
shortcut2x.addEventListener("click", () => updateRaiseSlider(localGameState.bb_amount * 2));
shortcut3x.addEventListener("click", () => updateRaiseSlider(localGameState.bb_amount * 3));
shortcutPot.addEventListener("click", () => {
    const pot = localGameState.total_pot;
    const callAmt = localGameState.current_bet - (localGameState.seats[yourSeatIdx]?.chips_in_round || 0);
    updateRaiseSlider(Math.max(localGameState.min_raise, pot + callAmt));
});
shortcutAllin.addEventListener("click", () => {
    const myChips = localGameState.seats[yourSeatIdx]?.chips || 0;
    const myInRound = localGameState.seats[yourSeatIdx]?.chips_in_round || 0;
    updateRaiseSlider(myChips + myInRound);
});

// 房主广播游戏状态
function hostBroadcastState() {
    if (!isHost || !pokerGame) return;

    // 1. 房主给自己本地渲染
    localGameState = pokerGame.toDict(yourSeatIdx);
    renderGame();

    // 2. 遍历所有客户端，根据其坐下的座位隔离手牌，分发数据
    Object.keys(clientConnections).forEach(peerId => {
        const conn = clientConnections[peerId];
        const clientSeat = peerToSeat[peerId] !== undefined ? peerToSeat[peerId] : -1;
        const serializedState = pokerGame.toDict(clientSeat === -1 ? null : clientSeat);
        
        conn.send({
            type: "state",
            data: serializedState,
            your_seat: clientSeat
        });
    });
}

// 房主广播系统/聊天消息
function hostBroadcastChat(sender, msg) {
    if (!isHost) return;

    // 本地显示
    appendChat(sender, msg);

    // 广播给所有人
    Object.keys(clientConnections).forEach(peerId => {
        clientConnections[peerId].send({
            type: "chat",
            sender: sender,
            message: msg
        });
    });
}

// 房主给特定 Peer 发送错误提示（支持房主本地提示）
function sendErrorToPeer(peerId, errMsg) {
    if (peerId === "local-host") {
        showToast(errMsg);
    } else if (clientConnections[peerId]) {
        clientConnections[peerId].send({ type: "error", message: errMsg });
    }
}

// 房主处理接收到的客户端消息
function hostHandleClientMessage(peerId, packet) {
    if (!isHost || !pokerGame) return;

    const action = packet.action;
    const seatIdx = peerToSeat[peerId] !== undefined ? peerToSeat[peerId] : -1;
    const name = peerToName[peerId] || "未知玩家";

    if (action === "sit") {
        const targetSeat = packet.seat;
        if (targetSeat >= 0 && targetSeat < 8 && pokerGame.seats[targetSeat] === null) {
            // 如果该连接此前坐过其他位置，先站起
            if (seatIdx !== -1) {
                pokerGame.removePlayer(seatIdx);
                delete seatToPeer[seatIdx];
            }
            
            pokerGame.addPlayer(name, targetSeat);
            peerToSeat[peerId] = targetSeat;
            seatToPeer[targetSeat] = peerId;
            hostBroadcastState();
        } else {
            sendErrorToPeer(peerId, "该座位已被占用");
        }
    } 
    else if (action === "stand") {
        if (seatIdx !== -1) {
            pokerGame.removePlayer(seatIdx);
            delete seatToPeer[seatIdx];
            peerToSeat[peerId] = -1;
            hostBroadcastState();
        }
    } 
    else if (action === "start_game") {
        const success = pokerGame.startHand();
        if (success) {
            hostBroadcastChat("系统", "游戏已由玩家启动！");
            hostBroadcastState();
        } else {
            sendErrorToPeer(peerId, "无法启动游戏，至少需要2名有筹码的玩家");
        }
    } 
    else if (["fold", "check", "call", "raise"].includes(action)) {
        appendChat("系统调试", `房主收到行动: [${action}], 执行人 peerId: ${peerId}, 映射位置 seatIdx: ${seatIdx}`);
        if (seatIdx !== -1) {
            const amount = packet.amount || 0;
            const [success, err_msg] = pokerGame.playerAction(seatIdx, action, amount);
            appendChat("系统调试", `执行结果 success: ${success}, 消息: ${err_msg}`);
            if (success) {
                hostBroadcastState();
                
                // 自动开启下一局延时
                if (pokerGame.round_name === "ended") {
                    setTimeout(() => {
                        if (pokerGame && pokerGame.round_name === "ended") {
                            const nextSuccess = pokerGame.startHand();
                            if (nextSuccess) {
                                hostBroadcastChat("系统", "自动开启新一局");
                                hostBroadcastState();
                            }
                        }
                    }, 5000);
                }
            } else {
                sendErrorToPeer(peerId, err_msg);
            }
        } else {
            appendChat("系统调试", `警告：行动执行人位置为 -1，已被房主抛弃！`);
        }
    } 
    else if (action === "buy_in") {
        if (seatIdx !== -1) {
            const p = pokerGame.seats[seatIdx];
            if (p && p.chips === 0 && ["waiting", "ended"].includes(pokerGame.round_name)) {
                p.chips = 10000;
                p.status = "spectator";
                pokerGame.addHistory(`${p.name} 补充筹码 10000`);
                hostBroadcastState();
            }
        }
    } 
    else if (action === "chat") {
        const msg = packet.message;
        if (msg) {
            hostBroadcastChat(name, msg);
        }
    }
}

// 建立并加入房间的主逻辑
function joinRoom() {
    const username = usernameInput.value.trim();
    const roomId = roomIdInput.value.trim();

    if (!username) { showToast("请输入昵称"); return; }
    if (!roomId) { showToast("请输入房间号"); return; }

    currentUsername = username;
    currentRoomId = roomId;

    // 格式化房主 Peer ID，规避公网公共 PeerJS 命名冲突
    const hostPeerId = `depu-room-p2p-${roomId}`;
    showToast("正在连接网络对局中...");

    // 1. 尝试以“房主”身份建立连接
    peer = new Peer(hostPeerId, peerConfig);

    peer.on("open", (id) => {
        // 成功以房主身份创建了房间
        isHost = true;
        yourSeatIdx = -1;
        pokerGame = new PokerGame();
        
        showToast("创建房间成功，你已成为房主");
        lobbyScreen.classList.remove("active");
        gameScreen.classList.add("active");
        displayRoomId.textContent = roomId;
        
        // 更新连接状态徽章
        const statusBadge = document.getElementById("connection-status");
        if (statusBadge) {
            statusBadge.textContent = "已联机 (房主)";
            statusBadge.className = "connection-status-badge host";
        }
        
        // 房主本地初始化状态并渲染
        localGameState = pokerGame.toDict(null);
        renderGame();
        
        // 监听客户端连接
        peer.on("connection", (conn) => {
            const clientPeerId = conn.peer;
            clientConnections[clientPeerId] = conn;
            peerToSeat[clientPeerId] = -1; // 默认是旁观
            appendChat("系统", "检测到远程客户端正在尝试接入直连...");

            conn.on("open", () => {
                appendChat("系统", `与客户端 ${clientPeerId} 数据直连通道开启！`);
            });

            conn.on("data", (packet) => {
                if (packet.type === "join") {
                    peerToName[clientPeerId] = packet.name;
                    hostBroadcastChat("系统", `欢迎新玩家 ${packet.name} 进入房间`);
                    hostBroadcastState();
                } else {
                    hostHandleClientMessage(clientPeerId, packet);
                }
            });

            conn.on("close", () => {
                const name = peerToName[clientPeerId] || "未知玩家";
                const seat = peerToSeat[clientPeerId];
                if (seat !== undefined && seat !== -1) {
                    pokerGame.removePlayer(seat);
                    delete seatToPeer[seat];
                }
                delete clientConnections[clientPeerId];
                delete peerToName[clientPeerId];
                delete peerToSeat[clientPeerId];

                hostBroadcastChat("系统", `${name} 离开了房间`);
                hostBroadcastState();
            });

            conn.on("error", (err) => {
                console.error("连接通道故障:", err);
                appendChat("系统", `与客户端的通道发生异常: ${err.message}`);
            });
        });
    });

    peer.on("error", (err) => {
        // 如果不可用，说明该房间已有房主在主持，我们作为客户端接入
        if (err.type === "unavailable-id") {
            peer.destroy();
            setupAsClient(hostPeerId);
        } else {
            showToast(`连接故障: ${err.type}`);
            appendChat("系统", `房主注册失败: ${err.type}`);
            const statusBadge = document.getElementById("connection-status");
            if (statusBadge) {
                statusBadge.textContent = "连接失败";
                statusBadge.className = "connection-status-badge error";
            }
        }
    });
}

// 客户端模式接入
function setupAsClient(hostPeerId) {
    isHost = false;
    // 生成随机 Peer ID
    peer = new Peer(peerConfig);

    peer.on("open", (id) => {
        // 启动连接时，更新连接状态徽章为“连接中”
        const statusBadge = document.getElementById("connection-status");
        if (statusBadge) {
            statusBadge.textContent = "正在连接房主...";
            statusBadge.className = "connection-status-badge";
        }
        appendChat("系统", `我的临时ID为 ${id}，正在尝试直连房主...`);

        hostConnection = peer.connect(hostPeerId);

        hostConnection.on("open", () => {
            showToast("成功连接到房间");
            lobbyScreen.classList.remove("active");
            gameScreen.classList.add("active");
            displayRoomId.textContent = currentRoomId;
            
            // 更新连接状态徽章
            if (statusBadge) {
                statusBadge.textContent = "已联机 (客端)";
                statusBadge.className = "connection-status-badge client";
            }
            appendChat("系统", "连接成功！正在向房主投递加入请求...");

            // 发送加入消息
            hostConnection.send({ type: "join", name: currentUsername });
        });

        hostConnection.on("data", (packet) => {
            if (packet.type === "state") {
                localGameState = packet.data;
                yourSeatIdx = packet.your_seat;
                renderGame();
            } else if (packet.type === "chat") {
                appendChat(packet.sender, packet.message);
            } else if (packet.type === "error") {
                showToast(packet.message);
            }
        });

        hostConnection.on("close", () => {
            showToast("房主已关闭房间，返回大厅");
            if (statusBadge) {
                statusBadge.textContent = "连接断开";
                statusBadge.className = "connection-status-badge error";
            }
            gameScreen.classList.remove("active");
            lobbyScreen.classList.add("active");
        });

        hostConnection.on("error", (err) => {
            showToast("与房主的数据链接故障");
            if (statusBadge) {
                statusBadge.textContent = "连接故障";
                statusBadge.className = "connection-status-badge error";
            }
        });
    });

    peer.on("error", (err) => {
        showToast("无法解析目标房间号");
        const statusBadge = document.getElementById("connection-status");
        if (statusBadge) {
            statusBadge.textContent = "连接解析错误";
            statusBadge.className = "connection-status-badge error";
        }
    });
}

// 扑克牌花色字符配置
const SUIT_SYMBOLS = { 'h': '♥', 'd': '♦', 'c': '♣', 's': '♠' };
const SUIT_CLASSES = { 'h': 'red-suit', 'd': 'red-suit', 'c': 'black-suit', 's': 'black-suit' };

// 页面渲染函数
function renderGame() {
    if (!localGameState) return;

    // 1. 渲染总底池
    totalPotAmount.textContent = localGameState.total_pot;

    // 2. 渲染 8 个座位
    seatsContainer.innerHTML = "";
    for (let i = 0; i < 8; i++) {
        const player = localGameState.seats[i];
        const seatDiv = document.createElement("div");
        seatDiv.className = `seat seat-${i}`;

        if (!player) {
            // 空闲座位
            seatDiv.classList.add("empty");
            seatDiv.innerHTML = `
                <div class="player-avatar" onclick="sitDown(${i})">
                    <span>坐下</span>
                </div>
            `;
        } else {
            // 占用座位
            seatDiv.classList.add("occupied");
            if (player.status === "playing") seatDiv.classList.add("playing");
            if (localGameState.current_turn === i) seatDiv.classList.add("active");

            const displayName = player.name + (i === yourSeatIdx ? " (我)" : "");
            
            // D, SB, BB 徽章
            let badgeHtml = "";
            if (localGameState.dealer_idx === i) badgeHtml += `<div class="dealer-button">D</div>`;
            if (localGameState.sb_idx === i) badgeHtml += `<div class="blind-badge sb">S</div>`;
            if (localGameState.bb_idx === i) badgeHtml += `<div class="blind-badge bb">B</div>`;

            // 弃牌与 All-in 状态角标
            let statusHtml = "";
            if (player.status === "folded") {
                statusHtml = `<div class="status-badge fold">FOLD</div>`;
            } else if (player.status === "all-in") {
                statusHtml = `<div class="status-badge all-in">ALL IN</div>`;
            }

            // 渲染手牌
            let cardsHtml = "";
            if (player.status !== "spectator" && player.status !== "folded" && player.cards && player.cards.length > 0) {
                cardsHtml = `<div class="player-hand-cards">`;
                player.cards.forEach(card => {
                    cardsHtml += createCardMarkup(card);
                });
                cardsHtml += `</div>`;
            }

            // 下注额
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
        const card = localGameState.community_cards[i];
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

    // 5. 更新控制面板
    updateControlPanel();

    // 渲染历史记录
    renderHistoryLogs();

    // 6. 更新我的手牌悬浮显示区
    const myHandDisplay = document.getElementById("my-hand-display");
    const myHandCardsContainer = document.getElementById("my-hand-cards-container");
    const myHandValueBadge = document.getElementById("my-hand-value-badge");

    const myPlayer = yourSeatIdx !== -1 ? localGameState.seats[yourSeatIdx] : null;
    const isPlaying = myPlayer && myPlayer.status !== "spectator" && myPlayer.status !== "folded";
    const hasHand = isPlaying && myPlayer.cards && myPlayer.cards.length > 0;
    const isGameRunning = !["waiting", "ended"].includes(localGameState.round_name);

    if (hasHand && isGameRunning) {
        myHandDisplay.classList.remove("hidden");
        myHandCardsContainer.innerHTML = "";
        
        myPlayer.cards.forEach(card => {
            const slot = document.createElement("div");
            slot.className = "card-slot large";
            slot.innerHTML = createCardMarkup(card);
            myHandCardsContainer.appendChild(slot);
        });

        // 智能评估当前最佳手牌并更新徽章
        const desc = getHandDescription(myPlayer.cards, localGameState.community_cards);
        myHandValueBadge.textContent = desc;
    } else {
        myHandDisplay.classList.add("hidden");
    }
}

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

function updateNotifier() {
    const round = localGameState.round_name;
    gameNotifier.classList.remove("hidden");

    if (round === "waiting") {
        notifierText.textContent = "等待玩家加入桌台，点击空闲座位入座";
    } else if (round === "ended") {
        notifierText.textContent = localGameState.win_messages.join(" | ");
    } else if (round === "showdown") {
        notifierText.textContent = "游戏结束，进入摊牌比牌阶段";
    } else {
        const turnPlayer = localGameState.seats[localGameState.current_turn];
        if (turnPlayer) {
            notifierText.textContent = `当前行动圈: [${round.toUpperCase()}]，等待 [${turnPlayer.name}] 操作...`;
        }
    }
}

function updateControlPanel() {
    setupPanel.classList.remove("active");
    actionPanel.classList.remove("active");

    const me = localGameState.seats[yourSeatIdx];

    // 情况一：旁观者
    if (yourSeatIdx === -1) {
        setupPanel.classList.add("active");
        startGameBtn.classList.add("hidden");
        rebuyBtn.classList.add("hidden");
        spectatorMsg.classList.remove("hidden");
        return;
    }

    // 情况二：等待/结束结算阶段
    if (localGameState.round_name === "waiting" || localGameState.round_name === "ended") {
        setupPanel.classList.add("active");
        spectatorMsg.classList.add("hidden");
        
        if (me.chips <= 0) {
            rebuyBtn.classList.remove("hidden");
            startGameBtn.classList.add("hidden");
        } else {
            rebuyBtn.classList.add("hidden");
            const activeCount = localGameState.seats.filter(p => p !== null && p.chips > 0).length;
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
    
    if (localGameState.current_turn !== yourSeatIdx) {
        setActionsDisabled(true);
        raiseSliderContainer.style.display = "none";
        return;
    }

    setActionsDisabled(false);

    const myChips = me.chips;
    const myInRound = me.chips_in_round;
    const currentBet = localGameState.current_bet;
    const callAmount = currentBet - myInRound;

    // 过牌
    btnCheck.disabled = (callAmount > 0);

    // 跟注
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

    // 加注
    const maxRaise = myChips + myInRound;
    const minRaise = localGameState.min_raise;

    if (myChips <= callAmount || minRaise > maxRaise) {
        raiseSliderContainer.style.display = "none";
        btnRaise.disabled = true;
        btnRaise.querySelector(".val").textContent = "";
    } else {
        raiseSliderContainer.style.display = "block";
        btnRaise.disabled = false;
        
        raiseRange.min = minRaise;
        raiseRange.max = maxRaise;
        
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
    
    target = Math.round(target / 50) * 50;
    target = Math.max(min, Math.min(max, target));

    raiseRange.value = target;
    raiseValDisplay.textContent = target;
    btnRaise.querySelector(".val").textContent = `$${target}`;
}

// 统一行动包分发
function sendMessageToHost(packet) {
    if (isHost) {
        // 房主直接本地执行
        hostHandleClientMessage("local-host", packet);
    } else if (hostConnection && hostConnection.open) {
        // 客户端向房主发送
        hostConnection.send(packet);
    }
}

// UI 交互方法
function sitDown(seatIdx) {
    if (isHost && pokerGame) {
        // 房主直接入座逻辑
        if (pokerGame.seats[seatIdx] === null) {
            if (yourSeatIdx !== -1) {
                pokerGame.removePlayer(yourSeatIdx);
                delete seatToPeer[yourSeatIdx];
            }
            pokerGame.addPlayer(currentUsername, seatIdx);
            yourSeatIdx = seatIdx;
            peerToSeat["local-host"] = seatIdx;
            seatToPeer[seatIdx] = "local-host";
            peerToName["local-host"] = currentUsername;
            hostBroadcastState();
        }
    } else {
        sendMessageToHost({ action: "sit", seat: seatIdx });
    }
}

function standUp() {
    if (isHost && pokerGame) {
        if (yourSeatIdx !== -1) {
            pokerGame.removePlayer(yourSeatIdx);
            delete seatToPeer[yourSeatIdx];
            peerToSeat["local-host"] = -1;
            yourSeatIdx = -1;
            hostBroadcastState();
        }
    } else {
        sendMessageToHost({ action: "stand" });
    }
}

function startGame() {
    sendMessageToHost({ action: "start_game" });
}

function rebuyChips() {
    sendMessageToHost({ action: "buy_in" });
}

function sendPlayerAction(actionType, amount = 0) {
    appendChat("系统调试", `点击行动: [${actionType}], 下注量: ${amount}, 你的Seat位置: ${yourSeatIdx}, 当前Turn行动位置: ${localGameState ? localGameState.current_turn : '无'}`);
    sendMessageToHost({ action: actionType, amount: amount });
}

function sendChatMessage() {
    const text = chatInput.value.trim();
    if (text) {
        if (isHost) {
            hostBroadcastChat(currentUsername, text);
        } else {
            sendMessageToHost({ action: "chat", message: text });
        }
        chatInput.value = "";
    }
}

// 渲染历史数据日志
function renderHistoryLogs() {
    logPane.innerHTML = "";
    localGameState.history.forEach(log => {
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

// Toast 弹窗
let toastTimer = null;
function showToast(msg) {
    toastElement.textContent = msg;
    toastElement.classList.remove("hidden");
    
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastElement.classList.add("hidden");
    }, 3000);
}

// 兼容房主作为玩家的消息触发
peerToName["local-host"] = currentUsername;
peerToSeat["local-host"] = -1;
