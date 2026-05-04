const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "../client")));

const users = new Map(); // socket.id -> { name, avatar, room }
const messagesById = new Map(); // messageId -> message
const roomMessages = new Map(); // room -> [messageId]
const privateThreads = new Map(); // threadKey -> [messageId]

function nowTime() {
    return new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });
}

function threadKey(a, b) {
    return [a, b].sort().join("__");
}

function sanitizeReply(replyTo) {
    if (!replyTo) return null;
    return {
        id: String(replyTo.id || ""),
        senderName: String(replyTo.senderName || "Unknown"),
        text: String(replyTo.text || "").slice(0, 120),
        scope: String(replyTo.scope || "public")
    };
}

function cloneMessage(message) {
    return {
        ...message,
        reactions: Object.fromEntries(
            Object.entries(message.reactions || {}).map(([emoji, arr]) => [emoji, [...arr]])
        ),
        readBy: [...(message.readBy || [])],
        replyTo: message.replyTo ? { ...message.replyTo } : null
    };
}

function normalizeText(value, fallback = "") {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function getRoomUsers(room) {
    return [...users.entries()]
        .filter(([, info]) => info.room === room)
        .map(([id, info]) => ({
            id,
            name: info.name,
            avatar: info.avatar,
            room: info.room
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function getRoomHistory(room) {
    const ids = roomMessages.get(room) || [];
    return ids.map((id) => messagesById.get(id)).filter(Boolean).map(cloneMessage);
}

function getPrivateHistory(a, b) {
    const ids = privateThreads.get(threadKey(a, b)) || [];
    return ids.map((id) => messagesById.get(id)).filter(Boolean).map(cloneMessage);
}

function storeMessage(message) {
    messagesById.set(message.id, message);

    if (message.scope === "public") {
        if (!roomMessages.has(message.room)) roomMessages.set(message.room, []);
        roomMessages.get(message.room).push(message.id);
    } else {
        const key = threadKey(message.senderId, message.targetId);
        if (!privateThreads.has(key)) privateThreads.set(key, []);
        privateThreads.get(key).push(message.id);
    }
}

function findMessage(id) {
    return messagesById.get(id);
}

function emitMessageUpdate(message) {
    io.emit("message_updated", cloneMessage(message));
}

function emitRoomUsers(room) {
    io.to(room).emit("room_users", getRoomUsers(room));
}

function canAccessMessage(socketId, message) {
    const me = users.get(socketId);
    if (!me || !message) return false;

    if (message.scope === "public") {
        return me.room === message.room;
    }

    if (message.scope === "private") {
        return message.senderId === socketId || message.targetId === socketId;
    }

    return false;
}

function buildBaseMessage({
    scope,
    senderId,
    senderName,
    avatar,
    text,
    attachment,
    room,
    targetId,
    targetName,
    targetAvatar,
    replyTo
}) {
    return {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        scope,
        type: attachment ? "attachment" : "text",
        senderId,
        senderName,
        avatar,
        room: room || null,
        targetId: targetId || null,
        targetName: targetName || null,
        targetAvatar: targetAvatar || null,
        text: text || "",
        attachment: attachment || null,
        replyTo: sanitizeReply(replyTo),
        createdAt: Date.now(),
        time: nowTime(),
        deleted: false,
        editedAt: null,
        pinned: false,
        pinnedBy: null,
        reactions: {},
        readBy: [senderId]
    };
}

io.on("connection", (socket) => {
    socket.on("join_room", (data = {}) => {
        const previous = users.get(socket.id);

        const name = normalizeText(data.name, "Guest").slice(0, 20);
        const avatar = normalizeText(data.avatar, "🙂").slice(0, 2);
        const room = normalizeText(data.room, "general").slice(0, 32).toLowerCase();

        if (previous?.room && previous.room !== room) {
            socket.leave(previous.room);
            emitRoomUsers(previous.room);
        }

        users.set(socket.id, { name, avatar, room });
        socket.join(room);

        socket.emit("joined_room", { room, name, avatar });
        socket.emit("room_history", getRoomHistory(room));
        emitRoomUsers(room);
    });

    socket.on("open_private_thread", (data = {}) => {
        const me = users.get(socket.id);
        const targetId = String(data.targetId || "");

        if (!me) return;
        if (!targetId) return;

        if (!users.has(targetId) || targetId === socket.id) {
            socket.emit("private_history", []);
            return;
        }

        const target = users.get(targetId);
        socket.emit("private_peer", {
            id: targetId,
            name: target.name,
            avatar: target.avatar
        });
        socket.emit("private_history", getPrivateHistory(socket.id, targetId));
    });

    socket.on("send_message", (data = {}) => {
        const me = users.get(socket.id);
        if (!me) return;

        const text = normalizeText(data.text);
        if (!text) return;

        const message = buildBaseMessage({
            scope: "public",
            senderId: socket.id,
            senderName: me.name,
            avatar: me.avatar,
            text,
            room: me.room,
            replyTo: data.replyTo
        });

        storeMessage(message);
        io.to(me.room).emit("new_message", cloneMessage(message));
    });

    socket.on("send_attachment", (data = {}) => {
        const me = users.get(socket.id);
        if (!me) return;

        const attachment = data.attachment || null;
        if (!attachment?.data || !attachment?.name || !attachment?.mime) return;

        const text = normalizeText(data.text, attachment.name);

        const message = buildBaseMessage({
            scope: "public",
            senderId: socket.id,
            senderName: me.name,
            avatar: me.avatar,
            text,
            attachment,
            room: me.room,
            replyTo: data.replyTo
        });

        storeMessage(message);
        io.to(me.room).emit("new_message", cloneMessage(message));
    });

    socket.on("send_private_message", (data = {}) => {
        const me = users.get(socket.id);
        const targetId = String(data.targetId || "");

        if (!me) return;
        if (!targetId || !users.has(targetId) || targetId === socket.id) return;

        const target = users.get(targetId);
        const text = normalizeText(data.text);
        if (!text) return;

        const message = buildBaseMessage({
            scope: "private",
            senderId: socket.id,
            senderName: me.name,
            avatar: me.avatar,
            text,
            targetId,
            targetName: target.name,
            targetAvatar: target.avatar,
            replyTo: data.replyTo
        });

        storeMessage(message);
        io.to(socket.id).emit("new_message", cloneMessage(message));
        io.to(targetId).emit("new_message", cloneMessage(message));
    });

    socket.on("send_private_attachment", (data = {}) => {
        const me = users.get(socket.id);
        const targetId = String(data.targetId || "");

        if (!me) return;
        if (!targetId || !users.has(targetId) || targetId === socket.id) return;

        const target = users.get(targetId);
        const attachment = data.attachment || null;
        if (!attachment?.data || !attachment?.name || !attachment?.mime) return;

        const text = normalizeText(data.text, attachment.name);

        const message = buildBaseMessage({
            scope: "private",
            senderId: socket.id,
            senderName: me.name,
            avatar: me.avatar,
            text,
            attachment,
            targetId,
            targetName: target.name,
            targetAvatar: target.avatar,
            replyTo: data.replyTo
        });

        storeMessage(message);
        io.to(socket.id).emit("new_message", cloneMessage(message));
        io.to(targetId).emit("new_message", cloneMessage(message));
    });

    socket.on("edit_message", (data = {}) => {
        const message = findMessage(String(data.messageId || ""));
        if (!message) return;
        if (message.senderId !== socket.id) return;
        if (message.deleted) return;

        const newText = normalizeText(data.text);
        if (!newText) return;

        message.text = newText;
        message.editedAt = Date.now();

        emitMessageUpdate(message);
    });

    socket.on("delete_message", (data = {}) => {
        const message = findMessage(String(data.messageId || ""));
        if (!message) return;
        if (message.senderId !== socket.id) return;
        if (message.deleted) return;

        message.deleted = true;
        message.text = "Message deleted";
        message.attachment = null;
        message.replyTo = null;

        emitMessageUpdate(message);
    });

    socket.on("pin_message", (data = {}) => {
        const message = findMessage(String(data.messageId || ""));
        if (!message) return;
        if (!canAccessMessage(socket.id, message)) return;

        message.pinned = !message.pinned;
        message.pinnedBy = message.pinned ? socket.id : null;

        emitMessageUpdate(message);
    });

    socket.on("react_message", (data = {}) => {
        const message = findMessage(String(data.messageId || ""));
        const emoji = normalizeText(data.emoji);

        if (!message || !emoji) return;
        if (!canAccessMessage(socket.id, message)) return;

        if (!message.reactions[emoji]) {
            message.reactions[emoji] = [];
        }

        const idx = message.reactions[emoji].indexOf(socket.id);
        if (idx >= 0) {
            message.reactions[emoji].splice(idx, 1);
            if (message.reactions[emoji].length === 0) {
                delete message.reactions[emoji];
            }
        } else {
            message.reactions[emoji].push(socket.id);
        }

        emitMessageUpdate(message);
    });

    socket.on("message_seen", (data = {}) => {
        const message = findMessage(String(data.messageId || ""));
        if (!message) return;
        if (!canAccessMessage(socket.id, message)) return;

        if (!Array.isArray(message.readBy)) message.readBy = [];
        if (!message.readBy.includes(socket.id)) {
            message.readBy.push(socket.id);
            emitMessageUpdate(message);
        }
    });

    socket.on("typing", (data = {}) => {
        const me = users.get(socket.id);
        if (!me) return;

        if (String(data.mode || "room") === "private") {
            const targetId = String(data.targetId || "");
            if (targetId && users.has(targetId) && targetId !== socket.id) {
                io.to(targetId).emit("typing", { mode: "private", name: me.name });
            }
            return;
        }

        io.to(me.room).emit("typing", { mode: "room", name: me.name });
    });

    socket.on("stop_typing", (data = {}) => {
        const me = users.get(socket.id);
        if (!me) return;

        if (String(data.mode || "room") === "private") {
            const targetId = String(data.targetId || "");
            if (targetId && users.has(targetId) && targetId !== socket.id) {
                io.to(targetId).emit("stop_typing", { mode: "private", name: me.name });
            }
            return;
        }

        io.to(me.room).emit("stop_typing", { mode: "room", name: me.name });
    });

    socket.on("disconnect", () => {
        const me = users.get(socket.id);
        if (!me) return;

        users.delete(socket.id);
        emitRoomUsers(me.room);
    });
});
// ===== ADD-ON PACK: forward + presence + richer room users =====
const presenceRecords = new Map(); // socket.id -> { name, avatar, room, lastSeen, online }

function formatLastSeen(ts) {
    if (!ts) return null;
    const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
}

function getRoomUsers(room) {
    const merged = [];

    for (const [id, info] of users.entries()) {
        if (info.room === room) {
            merged.push({
                id,
                name: info.name,
                avatar: info.avatar,
                room: info.room,
                online: true,
                lastSeen: presenceRecords.get(id)?.lastSeen || null
            });
        }
    }

    for (const [id, rec] of presenceRecords.entries()) {
        if (rec.room === room && !users.has(id)) {
            merged.push({
                id,
                name: rec.name,
                avatar: rec.avatar,
                room: rec.room,
                online: false,
                lastSeen: rec.lastSeen || null
            });
        }
    }

    return merged.sort((a, b) => a.name.localeCompare(b.name));
}

io.on("connection", (socket) => {
    socket.on("presence_ping", () => {
        const me = users.get(socket.id);
        if (!me) return;
        presenceRecords.set(socket.id, {
            name: me.name,
            avatar: me.avatar,
            room: me.room,
            lastSeen: Date.now(),
            online: true
        });
    });

    socket.on("disconnecting", () => {
        const me = users.get(socket.id);
        if (!me) return;
        presenceRecords.set(socket.id, {
            name: me.name,
            avatar: me.avatar,
            room: me.room,
            lastSeen: Date.now(),
            online: false
        });
    });

    socket.on("forward_message", (data = {}) => {
        const me = users.get(socket.id);
        if (!me) return;

        const original = findMessage(String(data.messageId || ""));
        if (!original || !canAccessMessage(socket.id, original)) return;

        const targetValue = normalizeText(data.targetValue);
        if (!targetValue) return;

        const text = original.text || original.attachment?.name || "Forwarded message";
        const attachment = original.attachment ? { ...original.attachment } : null;

        if (targetValue.startsWith("@")) {
            const targetName = targetValue.slice(1).trim().toLowerCase();
            const targetEntry = [...users.entries()].find(([, info]) => info.name.toLowerCase() === targetName);

            if (!targetEntry) return;

            const [targetId, targetInfo] = targetEntry;

            const message = buildBaseMessage({
                scope: "private",
                senderId: socket.id,
                senderName: me.name,
                avatar: me.avatar,
                text,
                attachment,
                targetId,
                targetName: targetInfo.name,
                targetAvatar: targetInfo.avatar,
                replyTo: null
            });

            message.forwardedFrom = {
                id: original.id,
                senderName: original.senderName,
                text: original.text || original.attachment?.name || "Attachment"
            };

            storeMessage(message);
            io.to(socket.id).emit("new_message", cloneMessage(message));
            io.to(targetId).emit("new_message", cloneMessage(message));
            return;
        }

        const room = targetValue.toLowerCase();

        const message = buildBaseMessage({
            scope: "public",
            senderId: socket.id,
            senderName: me.name,
            avatar: me.avatar,
            text,
            attachment,
            room,
            replyTo: null
        });

        message.forwardedFrom = {
            id: original.id,
            senderName: original.senderName,
            text: original.text || original.attachment?.name || "Attachment"
        };

        storeMessage(message);
        io.to(room).emit("new_message", cloneMessage(message));
    });
});
// ===== FILE UPLOAD BUFFER PATCH =====
// Keep this near the end of server.js so large attachments do not get rejected.
try {
    io.engine.opts.maxHttpBufferSize = 25 * 1024 * 1024; // 25 MB
} catch (err) {
    console.warn("Could not raise Socket.IO buffer size:", err?.message || err);
}
// ===== FINAL SERVER START (CLEAN) =====
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});