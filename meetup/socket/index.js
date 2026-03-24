import http from "http"
import { Server } from "socket.io"
import dotenv from "dotenv"

dotenv.config()


const allowedOrigins = (process.env.CLIENT_ORIGIN || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)

const server = http.createServer((req, res) => {
    if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok" }))
        return
    }

    res.writeHead(200, { "Content-Type": "text/plain" })
    res.end("Socket server is running")
})

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
                callback(null, true)
                return
            }

            callback(new Error("CORS blocked for this origin"), false)
        },
        methods: ["GET", "POST"]
    }
})
const port = process.env.PORT || 5000
const rooms = new Map() // roomid to socketid
const socketToRoom = new Map() //socketid to room

const leaveRoom = (socket) => {
    const roomId = socketToRoom.get(socket.id)

    if (!roomId) {
        return
    }

    const members = rooms.get(roomId)

    if (members) {
        members.delete(socket.id)
        if (members.size === 0) {
            rooms.delete(roomId)
        }
    }

    socketToRoom.delete(socket.id)
    socket.leave(roomId)
    socket.to(roomId).emit("user-left", { socketId: socket.id })
}

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use. Stop the existing process or change PORT in socket/.env.`)
        process.exit(1)
    }

    console.error("Socket server failed to start:", error)
    process.exit(1)
})

io.on("connection", (socket) => {
    socket.on("join-room", ({ roomId }) => {
        if (roomId.trim().length === 0) {
            socket.emit("join-error", { message: "Room id is required." })
            return
        }

        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set())
        }

        const members = rooms.get(roomId)

        if (members.size >= 3) {
            socket.emit("room-full", { roomId: roomId, maxUsers: 3 })
            return
        }

        const participants = [...members]

        members.add(socket.id)
        socketToRoom.set(socket.id, roomId)
        socket.join(roomId)

        socket.emit("room-joined", {
            roomId: roomId,
            socketId: socket.id,
            participants,
            maxUsers: 3
        })

        socket.to(roomId).emit("user-joined", { socketId: socket.id })
    })

    socket.on("signal", ({ to, signal }) => {
        if (typeof to !== "string" || !signal) {
            return
        }

        io.to(to).emit("signal", {
            from: socket.id,
            signal
        })
    })

    socket.on("leave-room", () => {
        leaveRoom(socket)
    })

    socket.on("disconnect", () => {
        leaveRoom(socket)
    })
})

server.listen(port, () => {
    console.log("server is running at:", port)
})