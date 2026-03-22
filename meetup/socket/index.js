import http from "http"
import {Server} from "socket.io"
import dotenv from "dotenv"
import {v4 as uuid} from 'uuid'
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

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use. Stop the existing process or change PORT in socket/.env.`)
        process.exit(1)
    }

    console.error("Socket server failed to start:", error)
    process.exit(1)
})

var waitingQueue = []
const activePairs = new Map()
const sockets = new Map() // Store socket objects by ID

const removeFromQueue = (socketId) => {
    waitingQueue = waitingQueue.filter((queuedSocketId) => queuedSocketId !== socketId)
}

const cleanupPair = (socketId, shouldNotifyPartner = true) => {
    const partnerId = activePairs.get(socketId)

    if (!partnerId) {
        removeFromQueue(socketId)
        return
    }

    const partnerSocket = sockets.get(partnerId)

    activePairs.delete(socketId)
    activePairs.delete(partnerId)
    removeFromQueue(socketId)

    if (shouldNotifyPartner) {
        partnerSocket?.emit("partner-disconnected")
    }
}

io.on("connection",(socket)=>{
    console.log("sockets: ", socket.id, waitingQueue)
    sockets.set(socket.id, socket) // Store socket object

    socket.on("start",()=>{
        removeFromQueue(socket.id)

        if(waitingQueue.length>0){
            const partnerId = waitingQueue.shift()
            const partnerSocket = sockets.get(partnerId)

            if (!partnerId || !partnerSocket) {
                return
            }

            const roomId = uuid()
            activePairs.set(socket.id, partnerId)
            activePairs.set(partnerId, socket.id)
            socket.emit("matched",{roomId, initiator: true})
            partnerSocket.emit("matched",{roomId, initiator: false})
        }
        else{
            console.log("adding")
            waitingQueue.push(socket.id)
            console.log("sockets: ",  waitingQueue)
        }
    })

    socket.on("offer", (data) => {
        const partnerId = activePairs.get(socket.id)
        if (partnerId) {
            const partnerSocket = sockets.get(partnerId)
            partnerSocket?.emit("offer", data)
        }
    })

    socket.on("answer", (data) => {
        const partnerId = activePairs.get(socket.id)
        if (partnerId) {
            const partnerSocket = sockets.get(partnerId)
            partnerSocket?.emit("answer", data)
        }
    })

    socket.on("ice-candidate", (data) => {
        const partnerId = activePairs.get(socket.id)
        if (partnerId) {
            const partnerSocket = sockets.get(partnerId)
            partnerSocket?.emit("ice-candidate", data)
        }
    })

    socket.on("leave", () => {
        cleanupPair(socket.id)
    })

    socket.on("disconnect", () => {
        cleanupPair(socket.id)
        sockets.delete(socket.id) // Remove socket object
    })
})

server.listen(port,()=>{
    console.log("server is running at: ",port)
})