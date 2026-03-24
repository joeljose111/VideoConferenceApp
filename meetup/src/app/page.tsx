'use client'

import { useCallback, useEffect, useRef, useState } from "react"
import Peer from "simple-peer"
import type { Instance as PeerInstance } from "simple-peer"
import type { SignalData } from "simple-peer"
import { io } from "socket.io-client"
import type { Socket } from "socket.io-client"
import { MdMic, MdMicOff, MdVideocam, MdVideocamOff } from "react-icons/md"
import Navbar from "./components/Navbar"

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:8000"
const MAX_USERS = 3

type RemoteVideo = {
  socketId: string
  stream: MediaStream
}

type RoomJoinedPayload = {
  roomId: string
  socketId: string
  participants: string[]
  maxUsers: number
}

type UserPayload = {
  socketId: string
}

type SignalPayload = {
  from: string
  signal: SignalData
}

function VideoTile({ stream, label, muted = false }: { stream: MediaStream | null; label: string; muted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!videoRef.current) {
      return
    }

    if (stream) {
      videoRef.current.srcObject = stream
      videoRef.current.onloadedmetadata = () => {
        void videoRef.current?.play().catch(() => {})
      }
    } else {
      videoRef.current.srcObject = null
    }
  }, [stream])

  return (
    <div className="relative h-56 overflow-hidden rounded-lg border border-white/10 bg-black md:h-64">
      {stream ? (
        <video ref={videoRef} autoPlay playsInline muted={muted} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-white/70">Waiting for participant...</div>
      )}
      <p className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs">{label}</p>
    </div>
  )
}

export default function Home() {
  const [roomId, setRoomId] = useState("")
  const [activeRoom, setActiveRoom] = useState("")
  const [status, setStatus] = useState("")
  const [isJoining, setIsJoining] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteVideos, setRemoteVideos] = useState<RemoteVideo[]>([])
  const [isMicOn, setIsMicOn] = useState(true)
  const [isCamOn, setIsCamOn] = useState(true)

  const socketRef = useRef<Socket | null>(null)
  const peersRef = useRef<Map<string, PeerInstance>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    localStreamRef.current = localStream
  }, [localStream])

  const upsertRemoteVideo = useCallback((socketId: string, stream: MediaStream) => {
    setRemoteVideos((prev) => {
      const found = prev.find((item) => item.socketId === socketId)
      if (found) {
        return prev.map((item) => (item.socketId === socketId ? { socketId, stream } : item))
      }
      return [...prev, { socketId, stream }]
    })
  }, [])

  const removeRemoteVideo = useCallback((socketId: string) => {
    setRemoteVideos((prev) => prev.filter((item) => item.socketId !== socketId))
  }, [])

  const destroyAllPeers = useCallback(() => {
    peersRef.current.forEach((peer) => peer.destroy())
    peersRef.current.clear()
    setRemoteVideos([])
  }, [])

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    setLocalStream(null)
  }, [])

  const createPeer = useCallback(
    (remoteSocketId: string, initiator: boolean, stream: MediaStream) => {
      const existingPeer = peersRef.current.get(remoteSocketId)
      if (existingPeer) {
        return existingPeer
      }

      const peer = new Peer({
        initiator,
        trickle: false,
        stream,
      })

      peer.on("signal", (signalData) => {
        socketRef.current?.emit("signal", {
          to: remoteSocketId,
          signal: signalData,
        })
      })

      peer.on("stream", (remoteStream) => {
        upsertRemoteVideo(remoteSocketId, remoteStream)
      })

      peer.on("close", () => {
        peersRef.current.delete(remoteSocketId)
        removeRemoteVideo(remoteSocketId)
      })

      peer.on("error", (error) => {
        console.error("Peer error:", error)
      })

      peersRef.current.set(remoteSocketId, peer)
      return peer
    },
    [removeRemoteVideo, upsertRemoteVideo]
  )

  const getOrCreateSocket = useCallback(() => {
    if (socketRef.current) {
      return socketRef.current
    }

    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
    })

    socket.on("room-joined", ({ roomId: joinedRoomId, participants, maxUsers }: RoomJoinedPayload) => {
      setActiveRoom(joinedRoomId)
      setIsJoining(false)
      setStatus(`Joined room ${joinedRoomId} (${participants.length + 1}/${maxUsers})`)

      const stream = localStreamRef.current
      if (!stream) {
        return
      }

      participants.forEach((participantId) => {
        createPeer(participantId, true, stream)
      })
    })

    socket.on("user-joined", ({ socketId }: UserPayload) => {
      if (peersRef.current.has(socketId)) {
        return
      }

      setStatus("A participant joined the room.")
    })

    socket.on("signal", ({ from, signal }: SignalPayload) => {
      const stream = localStreamRef.current
      if (!stream) {
        return
      }

      let peer = peersRef.current.get(from)
      if (!peer) {
        peer = createPeer(from, false, stream)
      }

      try {
        peer.signal(signal)
      } catch (error) {
        console.warn("Ignored incompatible signal state:", error)
      }
    })

    socket.on("user-left", ({ socketId }: UserPayload) => {
      const peer = peersRef.current.get(socketId)
      if (peer) {
        peer.destroy()
      }
      peersRef.current.delete(socketId)
      removeRemoteVideo(socketId)
      setStatus("A participant left the room.")
    })

    socket.on("room-full", ({ roomId: fullRoomId, maxUsers }: { roomId: string; maxUsers: number }) => {
      setIsJoining(false)
      setStatus(`Room ${fullRoomId} is full (max ${maxUsers}).`)
    })

    socket.on("join-error", ({ message }: { message: string }) => {
      setIsJoining(false)
      setStatus(message)
    })

    socketRef.current = socket
    return socket
  }, [createPeer, removeRemoteVideo])

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
      return localStreamRef.current
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      setLocalStream(stream)
      localStreamRef.current = stream
      const videoTrack = stream.getVideoTracks()[0]
      const audioTrack = stream.getAudioTracks()[0]
      setIsCamOn(videoTrack?.enabled ?? true)
      setIsMicOn(audioTrack?.enabled ?? true)
      return stream
    } catch {
      setStatus("Camera/Mic permission denied.")
      return null
    }
  }, [])

  const handleJoin = useCallback(async () => {
    if (isJoining) {
      return
    }

    const normalizedRoomId = roomId.trim().toLowerCase()
    if (!normalizedRoomId) {
      setStatus("Please enter a room id.")
      return
    }

    const stream = await ensureLocalStream()
    if (!stream) {
      return
    }

    if (activeRoom) {
      socketRef.current?.emit("leave-room")
      destroyAllPeers()
      setRemoteVideos([])
    }

    setIsJoining(true)
    setStatus("Joining room...")

    const socket = getOrCreateSocket()
    socket.emit("join-room", { roomId: normalizedRoomId })
  }, [activeRoom, destroyAllPeers, ensureLocalStream, getOrCreateSocket, isJoining, roomId])

  const handleLeave = useCallback(() => {
    socketRef.current?.emit("leave-room")
    destroyAllPeers()
    stopLocalMedia()
    setActiveRoom("")
    setStatus("You left the room.")
  }, [destroyAllPeers, stopLocalMedia])

  const toggleMic = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0]
    if (!audioTrack) {
      return
    }
    audioTrack.enabled = !audioTrack.enabled
    setIsMicOn(audioTrack.enabled)
  }, [])

  const toggleCam = useCallback(() => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0]
    if (!videoTrack) {
      return
    }
    videoTrack.enabled = !videoTrack.enabled
    setIsCamOn(videoTrack.enabled)
  }, [])

  useEffect(() => {
    return () => {
      socketRef.current?.emit("leave-room")
      socketRef.current?.disconnect()
      socketRef.current = null
      destroyAllPeers()
      stopLocalMedia()
    }
  }, [destroyAllPeers, stopLocalMedia])

  return (
    <>
      <Navbar show={true} />
      <div className="min-h-screen bg-gray-900 px-4 pb-8 pt-24 text-white">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="rounded-lg border border-white/10 bg-black/40 p-4">
            <h1 className="text-2xl font-semibold">Enter the room ID </h1>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Room id"
                className="w-full rounded-md border border-white/15 bg-black/50 px-3 py-2 outline-none ring-blue-500 focus:ring"
              />
              <button
                onClick={handleJoin}
                disabled={isJoining}
                className="rounded-md bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isJoining ? "Joining..." : "Join"}
              </button>
              <button
                onClick={handleLeave}
                disabled={!activeRoom}
                className="rounded-md bg-red-600 px-4 py-2 font-semibold hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Leave
              </button>
            </div>

            {activeRoom && <p className="text-xs text-white/60">Active room: {activeRoom}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <VideoTile stream={localStream} muted={true} label="You" />
            <VideoTile stream={remoteVideos[0]?.stream ?? null} label="Participant 2" />
            <VideoTile stream={remoteVideos[1]?.stream ?? null} label="Participant 3" />
          </div>

          <div className="flex gap-3">
            <button onClick={toggleMic} className="rounded-full bg-gray-700 p-3 hover:bg-gray-600">
              {isMicOn ? <MdMic size={24} /> : <MdMicOff size={24} />}
            </button>
            <button onClick={toggleCam} className="rounded-full bg-gray-700 p-3 hover:bg-gray-600">
              {isCamOn ? <MdVideocam size={24} /> : <MdVideocamOff size={24} />}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
