const socket = io();

const els = {
    body: document.body,
    nameModal: document.getElementById("nameModal"),
    nameInput: document.getElementById("nameInput"),
    avatarPicker: document.getElementById("avatarPicker"),
    joinBtn: document.getElementById("joinBtn"),

    myAvatar: document.getElementById("myAvatar"),
    myName: document.getElementById("myName"),
    myRoom: document.getElementById("myRoom"),

    themeToggle: document.getElementById("themeToggle"),
    soundToggle: document.getElementById("soundToggle"),
    autoScrollToggle: document.getElementById("autoScrollToggle"),

    roomInput: document.getElementById("roomInput"),
    joinRoomBtn: document.getElementById("joinRoomBtn"),
    roomCount: document.getElementById("roomCount"),
    usersList: document.getElementById("usersList"),

    conversationTitle: document.getElementById("conversationTitle"),
    conversationSub: document.getElementById("conversationSub"),
    backToRoomBtn: document.getElementById("backToRoomBtn"),

    searchInput: document.getElementById("searchInput"),
    clearSearchBtn: document.getElementById("clearSearchBtn"),
    exportBtn: document.getElementById("exportBtn"),
    searchInfo: document.getElementById("searchInfo"),

    statsBar: document.getElementById("statsBar"),
    pinnedBar: document.getElementById("pinnedBar"),

    messages: document.getElementById("messages"),
    typing: document.getElementById("typing"),

    replyBar: document.getElementById("replyBar"),
    replyText: document.getElementById("replyText"),
    cancelReplyBtn: document.getElementById("cancelReplyBtn"),

    emojiBtn: document.getElementById("emojiBtn"),
    attachBtn: document.getElementById("attachBtn"),
    fileInput: document.getElementById("fileInput"),
    emojiPicker: document.getElementById("emojiPicker"),

    messageInput: document.getElementById("messageInput"),
    sendBtn: document.getElementById("sendBtn"),
    charCount: document.getElementById("charCount")
};

const AVATARS = ["🙂", "😎", "🧠", "⚡", "🚀", "🔥", "🌙", "🟢", "🟣", "🔷", "🎯", "🦊"];
const EMOJIS = ["😀", "😁", "😂", "🤣", "😅", "😊", "😍", "😘", "😎", "🤝", "👍", "👏", "🔥", "💯", "🎉", "💀", "❤️", "💜"];

let socketId = "";
let myProfile = {
    name: localStorage.getItem("zy_name") || "",
    avatar: localStorage.getItem("zy_avatar") || "🙂"
};

let currentRoom = localStorage.getItem("zy_room") || "general";
let currentMode = "room"; // room | private
let privatePeer = null;

let roomMessages = [];
let currentMessages = [];
let roomUsers = [];
let searchTerm = "";
let typingTimer = null;
let amTyping = false;
let replyDraft = null;

let soundEnabled = localStorage.getItem("zy_sound") !== "off";
let autoScrollEnabled = localStorage.getItem("zy_autoscroll") !== "off";
let theme = localStorage.getItem("zy_theme") || "dark";

const seenMessages = new Set();
const unreadPrivate = new Map();

function setTheme(nextTheme) {
    theme = nextTheme === "light" ? "light" : "dark";
    document.body.classList.remove("theme-dark", "theme-light");
    document.body.classList.add(`theme-${theme}`);
    localStorage.setItem("zy_theme", theme);
    els.themeToggle.textContent = theme === "light" ? "Dark Theme" : "Light Theme";
}

function setSoundButton() {
    els.soundToggle.textContent = soundEnabled ? "Sound On" : "Sound Off";
}

function setAutoScrollButton() {
    els.autoScrollToggle.textContent = autoScrollEnabled ? "Auto Scroll On" : "Auto Scroll Off";
}

function formatBytes(bytes) {
    if (bytes === undefined || bytes === null) return "";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function escapeText(value) {
    return String(value ?? "");
}

function scrollToBottom() {
    if (!autoScrollEnabled) return;
    els.messages.scrollTop = els.messages.scrollHeight;
}

function ensureProfileDefaults() {
    if (!myProfile.avatar) myProfile.avatar = "🙂";
    if (!myProfile.name) myProfile.name = "";
}

function renderModalAvatarPicker() {
    els.avatarPicker.innerHTML = "";
    AVATARS.forEach((avatar) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `avatar-option ${myProfile.avatar === avatar ? "selected" : ""}`;
        btn.textContent = avatar;
        btn.addEventListener("click", () => {
            myProfile.avatar = avatar;
            localStorage.setItem("zy_avatar", avatar);
            renderModalAvatarPicker();
        });
        els.avatarPicker.appendChild(btn);
    });
}

function openProfileModal() {
    els.nameModal.classList.remove("hidden");
    els.nameInput.value = myProfile.name || "";
    renderModalAvatarPicker();
    els.nameInput.focus();
}

function closeProfileModal() {
    els.nameModal.classList.add("hidden");
}

function updateProfileUI() {
    els.myAvatar.textContent = myProfile.avatar;
    els.myName.textContent = myProfile.name || "Guest";
    els.myRoom.textContent = `Room: ${currentRoom}`;
    els.roomInput.value = currentRoom;
}

function updateConversationUI() {
    if (currentMode === "private" && privatePeer) {
        els.conversationTitle.textContent = `Private chat with ${privatePeer.name}`;
        els.conversationSub.textContent = "Direct message";
        els.backToRoomBtn.classList.remove("hidden");
    } else {
        els.conversationTitle.textContent = `Room: ${currentRoom}`;
        els.conversationSub.textContent = "Public chat";
        els.backToRoomBtn.classList.add("hidden");
    }
    updateProfileUI();
}

function buildUsersList() {
    els.usersList.innerHTML = "";
    els.roomCount.textContent = String(roomUsers.length);

    roomUsers.forEach((user) => {
        const item = document.createElement("div");
        item.className = "user-item";

        const left = document.createElement("div");
        left.className = "user-left";

        const avatar = document.createElement("div");
        avatar.className = "avatar small";
        avatar.textContent = user.avatar || "🙂";

        const meta = document.createElement("div");
        meta.className = "user-meta";

        const name = document.createElement("div");
        name.className = "user-name";
        name.textContent = user.name;

        const sub = document.createElement("div");
        sub.className = "user-sub";
        sub.textContent = user.id === socketId ? "You" : "Online";

        meta.appendChild(name);
        meta.appendChild(sub);

        left.appendChild(avatar);
        left.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "user-actions";

        const unread = unreadPrivate.get(user.id) || 0;
        if (unread > 0) {
            const badge = document.createElement("span");
            badge.className = "unread-badge";
            badge.textContent = unread;
            actions.appendChild(badge);
        }

        if (user.id !== socketId) {
            const dmBtn = document.createElement("button");
            dmBtn.type = "button";
            dmBtn.className = "secondary-btn small-btn";
            dmBtn.textContent = "DM";
            dmBtn.addEventListener("click", () => openPrivateChat(user));
            actions.appendChild(dmBtn);
        }

        item.appendChild(left);
        item.appendChild(actions);

        item.addEventListener("click", () => {
            if (user.id !== socketId) openPrivateChat(user);
        });

        els.usersList.appendChild(item);
    });
}

function markAsSeen(message) {
    if (!message || message.senderId === socketId) return;
    if (message.deleted) return;
    if (seenMessages.has(message.id)) return;

    seenMessages.add(message.id);
    socket.emit("message_seen", { messageId: message.id });
}

function matchesSearch(message) {
    if (!searchTerm) return true;

    const parts = [
        message.senderName,
        message.text,
        message.attachment?.name || "",
        message.targetName || "",
        message.replyTo?.text || ""
    ]
        .join(" ")
        .toLowerCase();

    return parts.includes(searchTerm);
}

function highlightTextNode(text, container) {
    const regex = /(@[a-zA-Z0-9_]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        const span = document.createElement("span");
        span.className = "mention";
        span.textContent = match[0];
        container.appendChild(span);

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
}

function renderText(text) {
    const wrap = document.createElement("div");
    wrap.className = "message-text";
    highlightTextNode(text, wrap);
    return wrap;
}

function openMessageById(id) {
    const el = els.messages.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 900);
}

function renderReplyPreview(replyTo) {
    if (!replyTo) return null;

    const box = document.createElement("div");
    box.className = "reply-preview";
    box.innerHTML = "";

    const title = document.createElement("div");
    title.className = "reply-title";
    title.textContent = `Replying to ${replyTo.senderName}`;

    const text = document.createElement("div");
    text.className = "reply-snippet";
    text.textContent = replyTo.text || "";

    box.appendChild(title);
    box.appendChild(text);

    if (replyTo.id) {
        box.style.cursor = "pointer";
        box.addEventListener("click", () => openMessageById(replyTo.id));
    }

    return box;
}

function renderAttachment(attachment) {
    if (!attachment) return null;

    const box = document.createElement("div");
    box.className = "attachment-box";

    if ((attachment.mime || "").startsWith("image/")) {
        const img = document.createElement("img");
        img.className = "attachment-image";
        img.src = attachment.data;
        img.alt = attachment.name || "image";
        box.appendChild(img);
    } else {
        const fileRow = document.createElement("div");
        fileRow.className = "file-card";

        const icon = document.createElement("div");
        icon.className = "file-icon";
        icon.textContent = "📄";

        const info = document.createElement("div");
        info.className = "file-info";

        const name = document.createElement("div");
        name.className = "file-name";
        name.textContent = attachment.name || "file";

        const size = document.createElement("div");
        size.className = "file-size";
        size.textContent = formatBytes(attachment.size || 0);

        info.appendChild(name);
        info.appendChild(size);

        const link = document.createElement("a");
        link.className = "download-link";
        link.href = attachment.data;
        link.download = attachment.name || "download";
        link.textContent = "Download";

        fileRow.appendChild(icon);
        fileRow.appendChild(info);
        fileRow.appendChild(link);
        box.appendChild(fileRow);
    }

    return box;
}

function toggleReaction(messageId, emoji) {
    socket.emit("react_message", { messageId, emoji });
}

function renderReactionSummary(message) {
    const wrapper = document.createElement("div");
    wrapper.className = "reaction-summary";

    const reactions = message.reactions || {};
    Object.entries(reactions).forEach(([emoji, users]) => {
        if (!users.length) return;

        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "reaction-chip";
        chip.textContent = `${emoji} ${users.length}`;
        chip.addEventListener("click", () => toggleReaction(message.id, emoji));
        wrapper.appendChild(chip);
    });

    return wrapper.children.length ? wrapper : null;
}

function renderQuickReactions(message) {
    const row = document.createElement("div");
    row.className = "quick-reactions";

    ["👍", "❤️", "🔥", "😂"].forEach((emoji) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "reaction-chip";
        btn.textContent = emoji;
        btn.addEventListener("click", () => toggleReaction(message.id, emoji));
        row.appendChild(btn);
    });

    return row;
}

function isPinnedMessage(message) {
    return !!message.pinned && !message.deleted;
}

function renderStats() {
    const visible = currentMessages.filter(matchesSearch);
    const pinned = currentMessages.filter(isPinnedMessage);
    const attachments = currentMessages.filter((m) => m.attachment && !m.deleted);

    els.statsBar.innerHTML = "";

    const items = [
        `Messages: ${visible.length}`,
        `Pinned: ${pinned.length}`,
        `Files: ${attachments.length}`,
        `Mode: ${currentMode === "private" ? "DM" : "Room"}`
    ];

    items.forEach((item) => {
        const chip = document.createElement("span");
        chip.className = "stat-chip";
        chip.textContent = item;
        els.statsBar.appendChild(chip);
    });
}

function renderPinnedBar() {
    const pinned = currentMessages.filter(isPinnedMessage);

    els.pinnedBar.innerHTML = "";

    if (!pinned.length) {
        els.pinnedBar.classList.add("hidden");
        return;
    }

    els.pinnedBar.classList.remove("hidden");

    const label = document.createElement("div");
    label.className = "pinned-label";
    label.textContent = "Pinned";

    els.pinnedBar.appendChild(label);

    pinned.slice(-8).forEach((message) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pinned-chip";
        btn.textContent = `${message.senderName}: ${message.text.slice(0, 28) || "Attachment"}`;
        btn.addEventListener("click", () => openMessageById(message.id));
        els.pinnedBar.appendChild(btn);
    });
}

function renderMessage(message) {
    if (!message) return null;

    const row = document.createElement("div");
    row.className = `message-row ${message.senderId === socketId ? "mine" : "theirs"}`;
    row.dataset.id = message.id;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = message.avatar || "🙂";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (message.pinned && !message.deleted) {
        const pinBanner = document.createElement("div");
        pinBanner.className = "pin-banner";
        pinBanner.textContent = "Pinned";
        bubble.appendChild(pinBanner);
    }

    const header = document.createElement("div");
    header.className = "message-header";

    const name = document.createElement("div");
    name.className = "message-name";
    name.textContent = message.senderName || "Unknown";

    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = message.time || "";

    header.appendChild(name);
    header.appendChild(time);

    bubble.appendChild(header);

    if (message.replyTo) {
        const replyNode = renderReplyPreview(message.replyTo);
        if (replyNode) bubble.appendChild(replyNode);
    }

    const body = document.createElement("div");
    body.className = "message-body";

    if (message.deleted) {
        const deleted = document.createElement("div");
        deleted.className = "deleted-text";
        deleted.textContent = "Message deleted";
        body.appendChild(deleted);
    } else {
        if (message.text) {
            body.appendChild(renderText(message.text));
        }

        if (message.attachment) {
            const attachmentNode = renderAttachment(message.attachment);
            if (attachmentNode) body.appendChild(attachmentNode);
        }

        if (message.editedAt) {
            const edited = document.createElement("div");
            edited.className = "edited-text";
            edited.textContent = "edited";
            body.appendChild(edited);
        }
    }

    bubble.appendChild(body);

    const footer = document.createElement("div");
    footer.className = "message-footer";

    if (message.senderId === socketId) {
        const seenCount = Array.isArray(message.readBy) ? message.readBy.length : 0;
        const seen = document.createElement("div");
        seen.className = "seen-text";
        seen.textContent = seenCount > 1 ? `Seen by ${seenCount - 1}` : "Sent";
        footer.appendChild(seen);
    }

    const quick = !message.deleted ? renderQuickReactions(message) : null;
    if (quick) footer.appendChild(quick);

    const reactions = !message.deleted ? renderReactionSummary(message) : null;
    if (reactions) footer.appendChild(reactions);

    const actionRow = document.createElement("div");
    actionRow.className = "action-row";

    const replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.className = "action-btn";
    replyBtn.textContent = "Reply";
    replyBtn.addEventListener("click", () => startReply(message));
    actionRow.appendChild(replyBtn);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "action-btn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(message.text || "");
        } catch {
            alert("Copy failed on this browser.");
        }
    });
    actionRow.appendChild(copyBtn);

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "action-btn";
    pinBtn.textContent = message.pinned ? "Unpin" : "Pin";
    pinBtn.addEventListener("click", () => {
        socket.emit("pin_message", { messageId: message.id });
    });
    actionRow.appendChild(pinBtn);

    if (message.senderId === socketId && !message.deleted) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "action-btn";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => {
            const nextText = prompt("Edit your message", message.text || "");
            if (nextText === null) return;
            socket.emit("edit_message", {
                messageId: message.id,
                text: nextText
            });
        });
        actionRow.appendChild(editBtn);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "action-btn danger";
        delBtn.textContent = "Delete";
        delBtn.addEventListener("click", () => {
            socket.emit("delete_message", { messageId: message.id });
        });
        actionRow.appendChild(delBtn);
    }

    footer.appendChild(actionRow);

    bubble.appendChild(footer);

    if (message.senderId === socketId) {
        row.appendChild(bubble);
        row.appendChild(avatar);
    } else {
        row.appendChild(avatar);
        row.appendChild(bubble);
    }

    return row;
}

function renderCurrentMessages() {
    els.messages.innerHTML = "";

    const visible = currentMessages.filter(matchesSearch);
    els.searchInfo.classList.toggle("hidden", !searchTerm);
    els.searchInfo.textContent = searchTerm
        ? `${visible.length} result${visible.length === 1 ? "" : "s"} for "${searchTerm}"`
        : "";

    visible.forEach((message) => {
        const node = renderMessage(message);
        if (node) {
            els.messages.appendChild(node);
            markAsSeen(message);
        }
    });

    renderStats();
    renderPinnedBar();
    scrollToBottom();
}

function upsertById(list, message) {
    const index = list.findIndex((m) => m.id === message.id);
    if (index >= 0) {
        list[index] = message;
    }
}

function handleUpdatedMessage(message) {
    upsertById(roomMessages, message);
    upsertById(currentMessages, message);

    if (currentMode === "room") {
        currentMessages = roomMessages.slice();
    }

    renderCurrentMessages();
}

function playNotificationSound() {
    if (!soundEnabled) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.02;

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.08);

    osc.onended = () => ctx.close();
}

function startReply(message) {
    if (!message || message.deleted) return;

    replyDraft = {
        id: message.id,
        senderName: message.senderName,
        text: message.text || message.attachment?.name || "",
        scope: message.scope
    };

    els.replyText.textContent = `${replyDraft.senderName}: ${replyDraft.text.slice(0, 90)}`;
    els.replyBar.classList.remove("hidden");
    els.messageInput.focus();
}

function clearReply() {
    replyDraft = null;
    els.replyBar.classList.add("hidden");
    els.replyText.textContent = "";
}

function sendTextMessage() {
    const text = els.messageInput.value.trim();
    if (!text) return;

    const payload = {
        text,
        replyTo: replyDraft
    };

    if (currentMode === "private" && privatePeer) {
        socket.emit("send_private_message", {
            targetId: privatePeer.id,
            ...payload
        });
    } else {
        socket.emit("send_message", {
            room: currentRoom,
            ...payload
        });
    }

    els.messageInput.value = "";
    updateCharCount();
    stopTypingIfNeeded();
    clearReply();
    els.messageInput.focus();
}

function sendAttachment(file) {
    if (!file) return;

    const limit = 4 * 1024 * 1024;
    if (file.size > limit) {
        alert("Keep the file under 4 MB. Bigger files may fail here.");
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const payload = {
            attachment: {
                name: file.name,
                mime: file.type || "application/octet-stream",
                data: reader.result,
                size: file.size
            },
            text: file.name,
            replyTo: replyDraft
        };

        if (currentMode === "private" && privatePeer) {
            socket.emit("send_private_attachment", {
                targetId: privatePeer.id,
                ...payload
            });
        } else {
            socket.emit("send_attachment", {
                room: currentRoom,
                ...payload
            });
        }

        clearReply();
    };

    reader.readAsDataURL(file);
}

function insertEmoji(emoji) {
    const input = els.messageInput;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    input.value = `${before}${emoji}${after}`;
    input.focus();
    const pos = start + emoji.length;
    input.setSelectionRange(pos, pos);
    updateCharCount();
}

function buildEmojiPicker() {
    els.emojiPicker.innerHTML = "";
    EMOJIS.forEach((emoji) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "emoji-btn";
        btn.textContent = emoji;
        btn.addEventListener("click", () => {
            insertEmoji(emoji);
            els.emojiPicker.classList.add("hidden");
        });
        els.emojiPicker.appendChild(btn);
    });
}

function toggleTyping(on) {
    if (on && !amTyping) {
        amTyping = true;
        socket.emit("typing", {
            mode: currentMode,
            targetId: privatePeer?.id || ""
        });
    }

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        if (amTyping) {
            amTyping = false;
            socket.emit("stop_typing", {
                mode: currentMode,
                targetId: privatePeer?.id || ""
            });
        }
    }, 800);
}

function stopTypingIfNeeded() {
    if (amTyping) {
        amTyping = false;
        socket.emit("stop_typing", {
            mode: currentMode,
            targetId: privatePeer?.id || ""
        });
    }
}

function openPrivateChat(user) {
    if (!user || user.id === socketId) return;

    currentMode = "private";
    privatePeer = user;
    currentMessages = [];
    seenMessages.clear();
    unreadPrivate.set(user.id, 0);
    buildUsersList();
    updateConversationUI();
    socket.emit("open_private_thread", { targetId: user.id });
}

function openRoomChat() {
    currentMode = "room";
    privatePeer = null;
    currentMessages = roomMessages.slice();
    updateConversationUI();
    renderCurrentMessages();
    buildUsersList();
}

function joinRoom() {
    const room = (els.roomInput.value || "general").trim().toLowerCase().slice(0, 32) || "general";
    currentRoom = room;
    localStorage.setItem("zy_room", room);

    currentMode = "room";
    privatePeer = null;
    currentMessages = [];
    seenMessages.clear();

    socket.emit("join_room", {
        room: currentRoom,
        name: myProfile.name,
        avatar: myProfile.avatar
    });

    updateConversationUI();
}

function exportCurrentConversation() {
    const payload = {
        exportedAt: new Date().toISOString(),
        room: currentRoom,
        mode: currentMode,
        privatePeer: privatePeer ? { ...privatePeer } : null,
        messages: currentMessages.filter(matchesSearch)
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `ZySRa-${currentMode}-${currentMode === "private" && privatePeer ? privatePeer.name : currentRoom}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateCharCount() {
    els.charCount.textContent = `${els.messageInput.value.length} chars`;
}

function showTyping(name) {
    els.typing.textContent = `${name} is typing...`;
    els.typing.classList.remove("hidden");
    clearTimeout(window.__typingHideTimer);
    window.__typingHideTimer = setTimeout(() => {
        els.typing.classList.add("hidden");
    }, 1200);
}

function hideTyping() {
    els.typing.classList.add("hidden");
}

function handleIncomingMessage(message) {
    if (!message) return;

    const isPublic = message.scope === "public";
    const isPrivate = message.scope === "private";

    const publicMatches = isPublic && message.room === currentRoom;

    const privateMatches =
        isPrivate &&
        privatePeer &&
        (
            (message.senderId === socketId && message.targetId === privatePeer.id) ||
            (message.senderId === privatePeer.id && message.targetId === socketId)
        );

    if (publicMatches) {
        roomMessages.push(message);
        if (currentMode === "room") {
            currentMessages.push(message);
            renderCurrentMessages();
        }
        if (message.senderId !== socketId) playNotificationSound();
        return;
    }

    if (privateMatches) {
        currentMessages.push(message);
        renderCurrentMessages();
        if (message.senderId !== socketId) playNotificationSound();
        return;
    }

    if (isPrivate && message.targetId === socketId && message.senderId !== socketId) {
        const count = unreadPrivate.get(message.senderId) || 0;
        unreadPrivate.set(message.senderId, count + 1);
        buildUsersList();
        playNotificationSound();
    }
}

function setInitialButtons() {
    setTheme(theme);
    setSoundButton();
    setAutoScrollButton();
}

socket.on("connect", () => {
    socketId = socket.id;
});

socket.on("joined_room", (data) => {
    currentRoom = data.room || currentRoom;
    localStorage.setItem("zy_room", currentRoom);
    updateConversationUI();
});

socket.on("room_history", (history) => {
    roomMessages = Array.isArray(history) ? history : [];
    if (currentMode === "room") {
        currentMessages = roomMessages.slice();
        renderCurrentMessages();
    }
    updateConversationUI();
});

socket.on("private_peer", (peer) => {
    privatePeer = peer;
    currentMode = "private";
    updateConversationUI();
});

socket.on("private_history", (history) => {
    currentMessages = Array.isArray(history) ? history : [];
    renderCurrentMessages();
});

socket.on("room_users", (users) => {
    roomUsers = Array.isArray(users) ? users : [];
    buildUsersList();
});

socket.on("new_message", (message) => {
    handleIncomingMessage(message);
});

socket.on("message_updated", (message) => {
    if (!message) return;
    upsertById(roomMessages, message);
    upsertById(currentMessages, message);
    renderCurrentMessages();
});

socket.on("typing", ({ name }) => {
    showTyping(name);
});

socket.on("stop_typing", () => {
    hideTyping();
});

els.joinBtn.addEventListener("click", () => {
    const entered = els.nameInput.value.trim();
    myProfile.name = entered.length ? entered.slice(0, 20) : "Guest";
    localStorage.setItem("zy_name", myProfile.name);
    localStorage.setItem("zy_avatar", myProfile.avatar);

    updateProfileUI();
    closeProfileModal();
    joinRoom();
});

els.nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") els.joinBtn.click();
});

els.joinRoomBtn.addEventListener("click", joinRoom);

els.roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoom();
});

els.backToRoomBtn.addEventListener("click", () => {
    openRoomChat();
});

els.themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.classList.contains("theme-light") ? "dark" : "light";
    setTheme(nextTheme);
});

els.soundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem("zy_sound", soundEnabled ? "on" : "off");
    setSoundButton();
});

els.autoScrollToggle.addEventListener("click", () => {
    autoScrollEnabled = !autoScrollEnabled;
    localStorage.setItem("zy_autoscroll", autoScrollEnabled ? "on" : "off");
    setAutoScrollButton();
    renderCurrentMessages();
});

els.clearSearchBtn.addEventListener("click", () => {
    searchTerm = "";
    els.searchInput.value = "";
    renderCurrentMessages();
});

els.searchInput.addEventListener("input", () => {
    searchTerm = els.searchInput.value.trim().toLowerCase();
    renderCurrentMessages();
});

els.exportBtn.addEventListener("click", exportCurrentConversation);

els.sendBtn.addEventListener("click", sendTextMessage);

els.messageInput.addEventListener("input", () => {
    updateCharCount();
    toggleTyping(true);
});

els.messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        sendTextMessage();
    }
});

els.cancelReplyBtn.addEventListener("click", clearReply);

els.emojiBtn.addEventListener("click", () => {
    els.emojiPicker.classList.toggle("hidden");
});

els.attachBtn.addEventListener("click", () => {
    els.fileInput.click();
});

els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files?.[0];
    if (file) sendAttachment(file);
    els.fileInput.value = "";
});

document.addEventListener("click", (e) => {
    if (!els.emojiPicker.contains(e.target) && e.target !== els.emojiBtn) {
        els.emojiPicker.classList.add("hidden");
    }
});

document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        els.searchInput.focus();
    }

    if (e.key === "Escape") {
        clearReply();
        els.emojiPicker.classList.add("hidden");
    }
});

buildEmojiPicker();
renderModalAvatarPicker();
setInitialButtons();
updateCharCount();

ensureProfileDefaults();
updateProfileUI();
openProfileModal();
// ===== ADD-ON PACK: 15 extra features, append-only =====
(() => {
    if (window.__zysra_addon_loaded) return;
    window.__zysra_addon_loaded = true;

    const sidebar = document.querySelector(".sidebar");
    const messagesEl = document.getElementById("messages");
    const roomInputEl = document.getElementById("roomInput");
    const usersListEl = document.getElementById("usersList");
    const bodyEl = document.body;
    const messageInputEl = document.getElementById("messageInput");

    if (!sidebar || !messagesEl || !roomInputEl || !usersListEl || !messageInputEl) return;

    const store = {
        compact: localStorage.getItem("zy_compact_plus") === "on",
        timestamps: localStorage.getItem("zy_timestamps_plus") !== "off",
        starFilter: localStorage.getItem("zy_starfilter_plus") === "on",
        notifications: localStorage.getItem("zy_notifications_plus") === "on",
        accent: localStorage.getItem("zy_accent_plus") || "#25d366",
        starred: new Set(JSON.parse(localStorage.getItem("zy_starred_plus") || "[]")),
        rooms: new Set(JSON.parse(localStorage.getItem("zy_rooms_plus") || "[\"general\"]")),
        userSearch: ""
    };

    function persistRooms() {
        localStorage.setItem("zy_rooms_plus", JSON.stringify([...store.rooms].slice(-12)));
    }

    function persistStarred() {
        localStorage.setItem("zy_starred_plus", JSON.stringify([...store.starred]));
    }

    function persistThemeBits() {
        localStorage.setItem("zy_compact_plus", store.compact ? "on" : "off");
        localStorage.setItem("zy_timestamps_plus", store.timestamps ? "on" : "off");
        localStorage.setItem("zy_starfilter_plus", store.starFilter ? "on" : "off");
        localStorage.setItem("zy_notifications_plus", store.notifications ? "on" : "off");
        localStorage.setItem("zy_accent_plus", store.accent);
    }

    function formatRelativeTime(ts) {
        if (!ts) return "just now";
        const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        return `${hrs}h ago`;
    }

    function currentDraftKey() {
        if (typeof currentMode !== "undefined" && currentMode === "private" && typeof privatePeer !== "undefined" && privatePeer) {
            return `zy_draft_dm_${privatePeer.id}`;
        }
        return `zy_draft_room_${typeof currentRoom !== "undefined" ? currentRoom : "general"}`;
    }

    function saveDraft() {
        localStorage.setItem(currentDraftKey(), messageInputEl.value || "");
    }

    function loadDraft() {
        messageInputEl.value = localStorage.getItem(currentDraftKey()) || "";
        if (typeof updateCharCount === "function") updateCharCount();
    }

    function rememberRoom(room) {
        if (!room) return;
        store.rooms.add(String(room).toLowerCase());
        persistRooms();
        renderRoomHistory();
    }

    function buildRichFragment(raw) {
        const frag = document.createDocumentFragment();
        const regex = /(https?:\/\/[^\s]+)|(\*[^*]+\*)|(_[^_]+\_)|(`[^`]+`)|(@[a-zA-Z0-9_]+)/g;
        let last = 0;
        let match;

        while ((match = regex.exec(raw)) !== null) {
            if (match.index > last) {
                frag.appendChild(document.createTextNode(raw.slice(last, match.index)));
            }

            const token = match[0];

            if (token.startsWith("http")) {
                const a = document.createElement("a");
                a.href = token;
                a.target = "_blank";
                a.rel = "noreferrer";
                a.className = "addon-link";
                a.textContent = token;
                frag.appendChild(a);
            } else if (token.startsWith("*")) {
                const strong = document.createElement("strong");
                strong.textContent = token.slice(1, -1);
                frag.appendChild(strong);
            } else if (token.startsWith("_")) {
                const em = document.createElement("em");
                em.textContent = token.slice(1, -1);
                frag.appendChild(em);
            } else if (token.startsWith("`")) {
                const code = document.createElement("code");
                code.textContent = token.slice(1, -1);
                frag.appendChild(code);
            } else if (token.startsWith("@")) {
                const span = document.createElement("span");
                span.className = "addon-mention";
                span.textContent = token;
                frag.appendChild(span);
            }

            last = regex.lastIndex;
        }

        if (last < raw.length) {
            frag.appendChild(document.createTextNode(raw.slice(last)));
        }

        return frag;
    }

    function exportBookmarks() {
        const starredMessages = [];
        document.querySelectorAll(".message-row").forEach((row) => {
            const id = row.dataset.id;
            if (!id || !store.starred.has(id)) return;

            const message = (typeof currentMessages !== "undefined" ? currentMessages : []).find((m) => m.id === id)
                || (typeof roomMessages !== "undefined" ? roomMessages : []).find((m) => m.id === id);

            if (message) starredMessages.push(message);
        });

        const blob = new Blob([JSON.stringify(starredMessages, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "ZySRa-bookmarks.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function toggleStar(messageId) {
        if (store.starred.has(messageId)) store.starred.delete(messageId);
        else store.starred.add(messageId);
        persistStarred();
        if (typeof renderCurrentMessages === "function") renderCurrentMessages();
    }

    function requestNotifications() {
        if (!("Notification" in window)) {
            alert("Notifications are not supported in this browser.");
            return;
        }

        Notification.requestPermission().then((perm) => {
            store.notifications = perm === "granted";
            persistThemeBits();
            updateAddonButtons();
        });
    }

    function maybeNotify(message) {
        if (!store.notifications) return;
        if (!document.hidden) return;
        if (!message || message.senderId === socket.id) return;

        const myName = (typeof myProfile !== "undefined" && myProfile.name ? myProfile.name : "").toLowerCase();
        const text = String(message.text || "").toLowerCase();
        const isDM = message.scope === "private";
        const hasMention = myName && text.includes(`@${myName}`);

        if (!isDM && !hasMention) return;
        if (!("Notification" in window)) return;

        new Notification(`ZySRa · ${message.senderName}`, {
            body: String(message.text || message.attachment?.name || "").slice(0, 120)
        });
    }

    function applyRichText() {
        messagesEl.querySelectorAll(".message-text").forEach((node) => {
            if (node.dataset.rich === "1") return;
            const raw = node.textContent || "";
            node.textContent = "";
            node.appendChild(buildRichFragment(raw));
            node.dataset.rich = "1";
        });
    }

    function applyTimestamps() {
        messagesEl.querySelectorAll(".message-time").forEach((el) => {
            el.classList.toggle("hidden", !store.timestamps);
        });
    }

    function applyCompact() {
        bodyEl.classList.toggle("compact-mode", store.compact);
    }

    function applyUserSearch() {
        const q = store.userSearch.trim().toLowerCase();
        const rows = [...usersListEl.querySelectorAll(".user-item")];

        rows.forEach((row, idx) => {
            const user = typeof roomUsers !== "undefined" ? roomUsers[idx] : null;
            if (user) {
                row.dataset.userid = user.id;
                const sub = row.querySelector(".user-sub");
                if (sub) {
                    if (user.id === socket.id) {
                        sub.textContent = "You";
                    } else if (user.online === false) {
                        sub.textContent = `Last seen ${formatRelativeTime(user.lastSeen)}`;
                    } else {
                        sub.textContent = "Online";
                    }
                }
            }

            const visible = !q || row.textContent.toLowerCase().includes(q);
            row.style.display = visible ? "" : "none";
        });

        const badge = document.getElementById("roomCount");
        if (badge) {
            const visibleCount = rows.filter((row) => row.style.display !== "none").length;
            badge.textContent = String(visibleCount);
        }
    }

    function renderRoomHistory() {
        const host = document.getElementById("addonRoomHistory");
        if (!host) return;

        host.innerHTML = "";
        [...store.rooms].slice().reverse().forEach((room) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "room-chip";
            btn.textContent = room;
            btn.addEventListener("click", () => {
                roomInputEl.value = room;
                if (typeof joinRoom === "function") joinRoom();
            });
            host.appendChild(btn);
        });
    }

    function updateAddonButtons() {
        const compactBtn = document.getElementById("compactToggle");
        const timestampBtn = document.getElementById("timestampToggle");
        const starFilterBtn = document.getElementById("starFilterToggle");
        const notifBtn = document.getElementById("notifToggle");
        const accentHint = document.getElementById("accentHint");

        if (compactBtn) compactBtn.textContent = store.compact ? "Compact On" : "Compact Off";
        if (timestampBtn) timestampBtn.textContent = store.timestamps ? "Timestamps On" : "Timestamps Off";
        if (starFilterBtn) starFilterBtn.textContent = store.starFilter ? "Starred Only On" : "Starred Only Off";
        if (notifBtn) notifBtn.textContent = store.notifications ? "Notifications On" : "Notifications Off";
        if (accentHint) accentHint.textContent = store.accent;
    }

    function mountPanels() {
        if (document.getElementById("addonToolsPanel")) return;

        const tools = document.createElement("div");
        tools.className = "panel addon-panel";
        tools.id = "addonToolsPanel";
        tools.innerHTML = `
            <h3>Tools</h3>
            <div class="tool-grid">
                <button id="compactToggle" class="secondary-btn">Compact</button>
                <button id="timestampToggle" class="secondary-btn">Timestamps</button>
                <button id="starFilterToggle" class="secondary-btn">Star Filter</button>
                <button id="notifToggle" class="secondary-btn">Notifications</button>
                <button id="bookmarkExportBtn" class="secondary-btn">Export Stars</button>
            </div>
        `;

        const accent = document.createElement("div");
        accent.className = "panel addon-panel";
        accent.id = "addonAccentPanel";
        accent.innerHTML = `
            <h3>Accent</h3>
            <div id="accentPicker" class="accent-picker"></div>
            <div id="accentHint" class="accent-hint"></div>
        `;

        const rooms = document.createElement("div");
        rooms.className = "panel addon-panel";
        rooms.id = "addonRoomsPanel";
        rooms.innerHTML = `
            <h3>Room History</h3>
            <div id="addonRoomHistory" class="room-history"></div>
        `;

        const people = document.createElement("div");
        people.className = "panel addon-panel";
        people.id = "addonPeopleSearchPanel";
        people.innerHTML = `
            <h3>Search People</h3>
            <input id="addonUserSearch" type="text" placeholder="Filter users" />
        `;

        sidebar.appendChild(tools);
        sidebar.appendChild(accent);
        sidebar.appendChild(rooms);
        sidebar.appendChild(people);

        const accentPicker = document.getElementById("accentPicker");
        if (accentPicker) {
            const swatches = ["#25d366", "#1f8fff", "#8a5cff", "#ff8a3d"];
            accentPicker.innerHTML = "";
            swatches.forEach((color) => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "accent-swatch";
                btn.style.background = color;
                btn.addEventListener("click", () => {
                    store.accent = color;
                    document.documentElement.style.setProperty("--accent", color);
                    document.documentElement.style.setProperty("--accentText", "#ffffff");
                    persistThemeBits();
                    updateAddonButtons();
                });
                accentPicker.appendChild(btn);
            });
            document.documentElement.style.setProperty("--accent", store.accent);
            document.documentElement.style.setProperty("--accentText", "#ffffff");
        }

        const userSearch = document.getElementById("addonUserSearch");
        if (userSearch) {
            userSearch.addEventListener("input", () => {
                store.userSearch = userSearch.value || "";
                applyUserSearch();
            });
        }

        const compactBtn = document.getElementById("compactToggle");
        const timestampBtn = document.getElementById("timestampToggle");
        const starFilterBtn = document.getElementById("starFilterToggle");
        const notifBtn = document.getElementById("notifToggle");
        const exportBtn = document.getElementById("bookmarkExportBtn");

        if (compactBtn) {
            compactBtn.addEventListener("click", () => {
                store.compact = !store.compact;
                persistThemeBits();
                updateAddonButtons();
                applyCompact();
            });
        }

        if (timestampBtn) {
            timestampBtn.addEventListener("click", () => {
                store.timestamps = !store.timestamps;
                persistThemeBits();
                updateAddonButtons();
                applyTimestamps();
            });
        }

        if (starFilterBtn) {
            starFilterBtn.addEventListener("click", () => {
                store.starFilter = !store.starFilter;
                persistThemeBits();
                updateAddonButtons();
                if (typeof renderCurrentMessages === "function") renderCurrentMessages();
            });
        }

        if (notifBtn) {
            notifBtn.addEventListener("click", requestNotifications);
        }

        if (exportBtn) {
            exportBtn.addEventListener("click", exportBookmarks);
        }

        updateAddonButtons();
    }

    function applyMessageExtras() {
        applyRichText();
        applyTimestamps();
        applyCompact();

        messagesEl.querySelectorAll(".message-row").forEach((row) => {
            const messageId = row.dataset.id;
            if (!messageId) return;

            const allMessages = [
                ...(typeof currentMessages !== "undefined" ? currentMessages : []),
                ...(typeof roomMessages !== "undefined" ? roomMessages : [])
            ];
            const message = allMessages.find((m) => m.id === messageId);
            if (!message) return;

            const bubble = row.querySelector(".message-bubble");
            const header = row.querySelector(".message-header");
            const actionRow = row.querySelector(".action-row");

            if (bubble && header && message.forwardedFrom && !bubble.querySelector(".forward-banner")) {
                const banner = document.createElement("div");
                banner.className = "forward-banner";
                banner.textContent = `Forwarded from ${message.forwardedFrom.senderName}`;
                banner.addEventListener("click", () => {
                    if (message.forwardedFrom.id && typeof openMessageById === "function") {
                        openMessageById(message.forwardedFrom.id);
                    }
                });
                bubble.insertBefore(banner, header);
            }

            if (actionRow) {
                if (!actionRow.querySelector(".addon-star-btn")) {
                    const starBtn = document.createElement("button");
                    starBtn.type = "button";
                    starBtn.className = "action-btn addon-star-btn";
                    starBtn.textContent = store.starred.has(messageId) ? "Unstar" : "Star";
                    starBtn.addEventListener("click", () => {
                        if (store.starred.has(messageId)) store.starred.delete(messageId);
                        else store.starred.add(messageId);
                        persistStarred();
                        if (typeof renderCurrentMessages === "function") renderCurrentMessages();
                    });
                    actionRow.appendChild(starBtn);
                }

                if (!actionRow.querySelector(".addon-forward-btn")) {
                    const forwardBtn = document.createElement("button");
                    forwardBtn.type = "button";
                    forwardBtn.className = "action-btn addon-forward-btn";
                    forwardBtn.textContent = "Forward";
                    forwardBtn.addEventListener("click", () => {
                        const targetValue = prompt("Forward to room name or @username:");
                        if (!targetValue) return;
                        socket.emit("forward_message", { messageId, targetValue });
                    });
                    actionRow.appendChild(forwardBtn);
                }
            }
        });
    }

    function applyUserExtras() {
        applyUserSearch();
    }

    function applyEnhancements() {
        applyMessageExtras();
        applyUserExtras();
        renderRoomHistory();
        updateAddonButtons();
    }

    const _renderCurrentMessages = renderCurrentMessages;
    renderCurrentMessages = function () {
        _renderCurrentMessages();
        applyEnhancements();
    };

    const _matchesSearch = matchesSearch;
    matchesSearch = function (message) {
        if (store.starFilter && !store.starred.has(message.id)) return false;
        return _matchesSearch(message);
    };

    const _buildUsersList = buildUsersList;
    buildUsersList = function () {
        _buildUsersList();
        applyUserSearch();
        renderRoomHistory();
    };

    const _handleIncomingMessage = handleIncomingMessage;
    handleIncomingMessage = function (message) {
        _handleIncomingMessage(message);
        maybeNotify(message);
    };

    const _joinRoom = joinRoom;
    joinRoom = function () {
        saveDraft();
        const result = _joinRoom();
        if (typeof currentRoom !== "undefined") rememberRoom(currentRoom);
        loadDraft();
        return result;
    };

    const _openPrivateChat = openPrivateChat;
    openPrivateChat = function (user) {
        saveDraft();
        const result = _openPrivateChat(user);
        loadDraft();
        return result;
    };

    const _openRoomChat = openRoomChat;
    openRoomChat = function () {
        saveDraft();
        const result = _openRoomChat();
        loadDraft();
        return result;
    };

    const _sendTextMessage = sendTextMessage;
    sendTextMessage = function () {
        const result = _sendTextMessage();
        localStorage.removeItem(currentDraftKey());
        return result;
    };

    messageInputEl.addEventListener("input", saveDraft);
    roomInputEl.addEventListener("keydown", () => setTimeout(() => rememberRoom(roomInputEl.value.trim().toLowerCase() || "general"), 0));

    setInterval(() => {
        socket.emit("presence_ping");
    }, 15000);

    mountPanels();
    rememberRoom(typeof currentRoom !== "undefined" ? currentRoom : "general");
    loadDraft();
    applyEnhancements();
})();
// ===== FILE UPLOAD + WHATSAPP-STYLE UI PATCH =====
(() => {
    if (window.__zysra_file_patch_loaded) return;
    window.__zysra_file_patch_loaded = true;

    const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
    const ACCEPT = [
        "image/*",
        "video/*",
        ".pdf",
        ".doc",
        ".docx",
        ".txt",
        ".rtf",
        ".ppt",
        ".pptx",
        ".xls",
        ".xlsx",
        ".zip",
        ".rar"
    ].join(",");

    const fileInput = document.getElementById("fileInput");
    const attachBtn = document.getElementById("attachBtn");
    const composer = document.querySelector(".composer");
    const messagesEl = document.getElementById("messages");
    const sidebar = document.querySelector(".sidebar");
    const main = document.querySelector(".main");

    if (!fileInput || !attachBtn || !composer || !messagesEl || !sidebar || !main) return;

    fileInput.accept = ACCEPT;
    fileInput.multiple = true;

    const uploadTray = document.createElement("div");
    uploadTray.id = "uploadTray";
    uploadTray.className = "upload-tray panel hidden";
    composer.insertAdjacentElement("afterend", uploadTray);

    const dropOverlay = document.createElement("div");
    dropOverlay.id = "dropOverlay";
    dropOverlay.className = "drag-overlay hidden";
    dropOverlay.innerHTML = "<div>Drop files here to send</div>";
    document.body.appendChild(dropOverlay);

    let dragDepth = 0;

    function showDropOverlay() {
        dropOverlay.classList.remove("hidden");
        document.body.classList.add("dragging-files");
    }

    function hideDropOverlay() {
        dropOverlay.classList.add("hidden");
        document.body.classList.remove("dragging-files");
    }

    function showTray(files) {
        uploadTray.innerHTML = "";
        if (!files.length) {
            uploadTray.classList.add("hidden");
            return;
        }

        files.forEach((file) => {
            const chip = document.createElement("div");
            chip.className = "upload-chip";

            const title = document.createElement("strong");
            title.textContent = file.name;

            const meta = document.createElement("small");
            meta.textContent = `${file.type || "file"} • ${Math.ceil(file.size / 1024)} KB`;

            chip.appendChild(title);
            chip.appendChild(meta);
            uploadTray.appendChild(chip);
        });

        uploadTray.classList.remove("hidden");

        clearTimeout(window.__zysra_tray_timer);
        window.__zysra_tray_timer = setTimeout(() => {
            uploadTray.classList.add("hidden");
        }, 3500);
    }

    function fileToDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    async function emitFile(file) {
        if (!file) return;

        if (file.size > MAX_UPLOAD_BYTES) {
            alert(`"${file.name}" is too large. Keep it under 25 MB.`);
            return;
        }

        const dataURL = await fileToDataURL(file);

        const payload = {
            attachment: {
                name: file.name,
                mime: file.type || "application/octet-stream",
                data: dataURL,
                size: file.size
            },
            text: file.name,
            replyTo: typeof replyDraft !== "undefined" ? replyDraft : null
        };

        const isPrivate = typeof currentMode !== "undefined" && currentMode === "private" && typeof privatePeer !== "undefined" && privatePeer;
        const roomName = typeof currentRoom !== "undefined" ? currentRoom : "general";

        if (isPrivate) {
            socket.emit("send_private_attachment", {
                targetId: privatePeer.id,
                ...payload
            });
        } else {
            socket.emit("send_attachment", {
                room: roomName,
                ...payload
            });
        }
    }

    async function handleFiles(files) {
        const list = [...files].filter(Boolean);
        if (!list.length) return;

        showTray(list);

        for (const file of list) {
            await emitFile(file);
        }
    }

    function getMessageById(id) {
        const a = (typeof currentMessages !== "undefined" ? currentMessages : []).find((m) => m.id === id);
        if (a) return a;
        const b = (typeof roomMessages !== "undefined" ? roomMessages : []).find((m) => m.id === id);
        if (b) return b;
        return null;
    }

    function insertDateSeparators() {
        const rows = [...messagesEl.querySelectorAll(".message-row")];
        if (!rows.length) return;

        let lastDate = "";

        rows.forEach((row) => {
            const message = getMessageById(row.dataset.id);
            if (!message) return;

            const dayKey = new Date(message.createdAt || Date.now()).toDateString();
            if (dayKey === lastDate) return;

            lastDate = dayKey;

            const sep = document.createElement("div");
            sep.className = "date-separator";
            sep.innerHTML = `<span>${dayKey === new Date().toDateString() ? "Today" : dayKey}</span>`;
            row.parentNode.insertBefore(sep, row);
        });
    }

    function enhanceAttachmentRendering() {
        document.querySelectorAll(".attachment-box").forEach((box) => {
            if (box.dataset.enhanced === "1") return;
            box.dataset.enhanced = "1";

            const img = box.querySelector("img.attachment-image");
            const fileCard = box.querySelector(".file-card");

            if (img) {
                img.classList.add("attachment-image-enhanced");
            }

            if (fileCard) {
                fileCard.classList.add("attachment-file-enhanced");
            }
        });
    }

    function renderUploadFriendlyAttachment(attachment) {
        if (!attachment) return null;

        const mime = String(attachment.mime || "");
        const data = attachment.data || "";
        const name = attachment.name || "file";

        const wrap = document.createElement("div");
        wrap.className = "attachment-box";

        if (mime.startsWith("image/")) {
            const img = document.createElement("img");
            img.className = "attachment-image attachment-image-enhanced";
            img.src = data;
            img.alt = name;
            wrap.appendChild(img);
            return wrap;
        }

        if (mime.startsWith("video/")) {
            const video = document.createElement("video");
            video.className = "video-preview";
            video.src = data;
            video.controls = true;
            video.preload = "metadata";
            wrap.appendChild(video);
            return wrap;
        }

        if (mime === "application/pdf") {
            const card = document.createElement("div");
            card.className = "pdf-preview";

            const badge = document.createElement("div");
            badge.className = "pdf-badge";
            badge.textContent = "PDF";

            const meta = document.createElement("div");
            meta.className = "pdf-meta";

            const title = document.createElement("div");
            title.className = "pdf-title";
            title.textContent = name;

            const open = document.createElement("a");
            open.href = data;
            open.target = "_blank";
            open.rel = "noreferrer";
            open.textContent = "Open PDF";

            meta.appendChild(title);
            meta.appendChild(open);

            card.appendChild(badge);
            card.appendChild(meta);
            wrap.appendChild(card);

            const frame = document.createElement("iframe");
            frame.className = "pdf-frame";
            frame.src = data;
            frame.loading = "lazy";
            wrap.appendChild(frame);

            return wrap;
        }

        const fileCard = document.createElement("div");
        fileCard.className = "file-card attachment-file-enhanced";

        const icon = document.createElement("div");
        icon.className = "file-icon";
        icon.textContent = mime.includes("pdf") ? "📕" : mime.includes("word") ? "📘" : mime.includes("excel") ? "📗" : "📄";

        const info = document.createElement("div");
        info.className = "file-info";

        const fileName = document.createElement("div");
        fileName.className = "file-name";
        fileName.textContent = name;

        const fileSize = document.createElement("div");
        fileSize.className = "file-size";
        fileSize.textContent = `${Math.ceil((attachment.size || 0) / 1024)} KB`;

        info.appendChild(fileName);
        info.appendChild(fileSize);

        const link = document.createElement("a");
        link.className = "download-link";
        link.href = data;
        link.download = name;
        link.textContent = "Download";

        fileCard.appendChild(icon);
        fileCard.appendChild(info);
        fileCard.appendChild(link);
        wrap.appendChild(fileCard);

        return wrap;
    }

    const originalRenderAttachment = typeof renderAttachment === "function" ? renderAttachment : null;
    renderAttachment = function (attachment) {
        const rendered = renderUploadFriendlyAttachment(attachment);
        if (rendered) return rendered;
        return originalRenderAttachment ? originalRenderAttachment(attachment) : null;
    };

    const originalRenderCurrentMessages = typeof renderCurrentMessages === "function" ? renderCurrentMessages : null;
    renderCurrentMessages = function () {
        if (originalRenderCurrentMessages) originalRenderCurrentMessages();
        insertDateSeparators();
        enhanceAttachmentRendering();
    };

    const originalBuildUsersList = typeof buildUsersList === "function" ? buildUsersList : null;
    buildUsersList = function () {
        if (originalBuildUsersList) originalBuildUsersList();

        document.querySelectorAll(".user-item").forEach((row) => {
            row.classList.add("user-item-enhanced");
        });
    };

    fileInput.addEventListener(
        "change",
        async (e) => {
            e.stopImmediatePropagation();
            e.preventDefault();

            const files = [...(e.target.files || [])];
            e.target.value = "";

            if (!files.length) return;
            await handleFiles(files);
        },
        true
    );

    document.addEventListener(
        "paste",
        async (e) => {
            const files = [...(e.clipboardData?.files || [])];
            if (!files.length) return;

            e.preventDefault();
            await handleFiles(files);
        },
        true
    );

    document.addEventListener(
        "dragenter",
        (e) => {
            if (!e.dataTransfer?.types?.includes("Files")) return;
            dragDepth += 1;
            showDropOverlay();
        },
        true
    );

    document.addEventListener(
        "dragover",
        (e) => {
            if (!e.dataTransfer?.types?.includes("Files")) return;
            e.preventDefault();
            showDropOverlay();
        },
        true
    );

    document.addEventListener(
        "dragleave",
        (e) => {
            if (!e.dataTransfer?.types?.includes("Files")) return;
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) hideDropOverlay();
        },
        true
    );

    document.addEventListener(
        "drop",
        async (e) => {
            if (!e.dataTransfer?.files?.length) return;

            e.preventDefault();
            dragDepth = 0;
            hideDropOverlay();

            await handleFiles([...e.dataTransfer.files]);
        },
        true
    );

    const originalSendTextMessage = typeof sendTextMessage === "function" ? sendTextMessage : null;
    sendTextMessage = function () {
        const result = originalSendTextMessage ? originalSendTextMessage() : undefined;
        uploadTray.classList.add("hidden");
        return result;
    };

    const originalOpenRoomChat = typeof openRoomChat === "function" ? openRoomChat : null;
    openRoomChat = function () {
        const result = originalOpenRoomChat ? originalOpenRoomChat() : undefined;
        uploadTray.classList.add("hidden");
        return result;
    };

    const originalOpenPrivateChat = typeof openPrivateChat === "function" ? openPrivateChat : null;
    openPrivateChat = function (user) {
        const result = originalOpenPrivateChat ? originalOpenPrivateChat(user) : undefined;
        uploadTray.classList.add("hidden");
        return result;
    };

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            hideDropOverlay();
        }
    });

    // Small UI polish
    composer.classList.add("composer-whatsapp");
    messagesEl.classList.add("messages-whatsapp");
    sidebar.classList.add("sidebar-whatsapp");
    main.classList.add("main-whatsapp");
})();
// ===== MOBILE SIDEBAR CONTROL =====
(() => {
    if (window.__mobile_ui_loaded) return;
    window.__mobile_ui_loaded = true;

    const sidebar = document.querySelector(".sidebar");
    const header = document.querySelector(".header");

    // menu button
    const menuBtn = document.createElement("button");
    menuBtn.innerText = "☰";
    menuBtn.className = "menu-btn";

    header.prepend(menuBtn);

    menuBtn.onclick = () => {
        sidebar.classList.toggle("open");
    };

    // close on click outside
    document.addEventListener("click", (e) => {
        if (!sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
            sidebar.classList.remove("open");
        }
    });
})();