'use client'
import Navbar from "./components/Navbar";
import {io} from "socket.io-client";
import { useCallback, useEffect } from "react";
import { useState,useRef } from "react";
import {MdMic, MdMicOff, MdVideocam,MdVideocamOff} from "react-icons/md";
import Peer from "simple-peer";
import type { Instance as PeerInstance } from "simple-peer";
import type { SignalData } from "simple-peer";

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:8000"
const socket = io(socketUrl,{
  transports:["websocket"]
})

export default function Home() {

  const [localStream, setLocalStream] = useState<MediaStream | null >(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null >(null)
  const [remoteStreamThird, setRemoteStreamThird] = useState<MediaStream | null >(null)

  const [isMicOn,setIsMicOn] = useState(true)
  const [isVidOn,setIsVidOn] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const peerRef = useRef<PeerInstance | null>(null)
  const pendingSignalsRef = useRef<SignalData[]>([])

  const stopStream = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop())
  }, [])

  const createPeer = useCallback((initiator: boolean, stream: MediaStream)=>{
    const peer = new Peer({
      initiator,
      trickle: false,
      stream
    })

    peer.on('signal', (data) => {
      if (initiator) {
        socket.emit('offer', data)
      } else {
        socket.emit('answer', data)
      }
    })

    peer.on('stream', (stream) => {
      setRemoteStream(stream)
      setIsConnected(true)
      setIsWaiting(false)
    })

    peer.on('error', (err) => {
      console.error('Peer error:', err)
    })

    peer.on('close', () => {
      setIsConnected(false)
      setRemoteStream(null)
      setIsWaiting(false)
      pendingSignalsRef.current = []
      peerRef.current = null
    })

    if (pendingSignalsRef.current.length > 0) {
      pendingSignalsRef.current.forEach((signal) => {
        peer.signal(signal)
      })
      pendingSignalsRef.current = []
    }

    return peer
  },[])

  const getMediaStream = useCallback( async (faceMode?: string)=>{
    if(localStream){
      return localStream
    }

    try{
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter(device => device.kind == 'videoinput')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio:true,
        video:{
          width:{min:640,ideal:1280,max:1920},
          height:{min:360,ideal:720,max:1080},
          frameRate:{min:16,ideal:30,max:30},
          facingMode:videoDevices.length > 0 ? faceMode: undefined
        }
      })
      setLocalStream(stream)
      return stream
    } catch(error) {
        console.log("failed to get stream",error)
        setLocalStream(null)
        return null
    }
  },[localStream])

  useEffect(()=>{
    const handleMatched = (data: { initiator: boolean }) => {
      setIsWaiting(true)
      getMediaStream().then((stream) => {
        if (stream) {
          peerRef.current?.destroy()
          pendingSignalsRef.current = []
          peerRef.current = createPeer(data.initiator, stream)
        }
      })
    }

    const handleOffer = (data: SignalData) => {
      if (peerRef.current) {
        peerRef.current.signal(data)
        return
      }

      pendingSignalsRef.current.push(data)
    }

    const handleAnswer = (data: SignalData) => {
      if (peerRef.current) {
        peerRef.current.signal(data)
      }
    }

    const handleIceCandidate = (data: SignalData) => {
      if (peerRef.current) {
        peerRef.current.signal(data)
      }
    }

    const handlePartnerDisconnected = () => {
      setIsConnected(false)
      setRemoteStream(null)
      setIsWaiting(false)
      pendingSignalsRef.current = []
      if (peerRef.current) {
        peerRef.current.destroy()
        peerRef.current = null
      }
    }

    socket.on('matched', handleMatched)
    socket.on('offer', handleOffer)
    socket.on('answer', handleAnswer)
    socket.on('ice-candidate', handleIceCandidate)
    socket.on('partner-disconnected', handlePartnerDisconnected)

    return () => {
      socket.off('matched', handleMatched)
      socket.off('offer', handleOffer)
      socket.off('answer', handleAnswer)
      socket.off('ice-candidate', handleIceCandidate)
      socket.off('partner-disconnected', handlePartnerDisconnected)
    }
  },[createPeer, getMediaStream])

  useEffect(()=>{
    if(localStream){
      const videoTrack = localStream.getVideoTracks()[0]
      setIsVidOn(videoTrack.enabled)
      const audioTrack = localStream.getAudioTracks()[0]
      setIsMicOn(audioTrack.enabled)
    }
  },[localStream])

  const toggleCamera = ()=>{
    if(localStream){
      const videoTrack = localStream.getVideoTracks()[0]
      videoTrack.enabled = !videoTrack.enabled
      setIsVidOn(videoTrack.enabled)
    }
  }
  const toggleMic = ()=>{
    if(localStream){
      const audioTrack = localStream.getAudioTracks()[0]
      audioTrack.enabled = !audioTrack.enabled
      setIsMicOn(audioTrack.enabled)
    }
  }

  const handleCall = async ()=>{
    if (isConnected || isWaiting) return

    const stream = await getMediaStream()

    if (!stream) {
      return
    }

    setIsWaiting(true)
    socket.emit("start")
  }

  const handleEndCall = () => {
    if (peerRef.current) {
      peerRef.current.destroy()
      peerRef.current = null
    }
    pendingSignalsRef.current = []
    stopStream(localStream)
    setIsConnected(false)
    setLocalStream(null)
    setRemoteStream(null)
    setIsWaiting(false)
    socket.emit('leave')
  }

  useEffect(() => {
    return () => {
      if (peerRef.current) {
        peerRef.current.destroy()
      }
      stopStream(localStream)
    }
  }, [localStream, stopStream])

  function VideoContainer({ stream, muted = false, className = "" }: { stream: MediaStream | null, muted?: boolean, className?: string }) {
    const videoRef = useRef<HTMLVideoElement>(null)
    useEffect(()=>{
      if(videoRef.current && stream){
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          void videoRef.current?.play().catch(() => {})
        }
      }
    },[stream])
    return(<video className={`rounded border bg-black object-cover ${className}`} ref={videoRef} autoPlay playsInline muted={muted} />);
  }

  return (
    <>
    <Navbar show={true}/>
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      {!isConnected && !isWaiting && (
        <div onClick={handleCall} className="cursor-pointer bg-blue-500 hover:bg-blue-600 px-8 py-4 rounded-lg text-xl font-bold transition-colors">
          Start Video Chat
        </div>
      )}

      {(localStream || isWaiting || isConnected) && (
        <div className="mt-8 flex flex-col items-center space-y-4">
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="relative overflow-hidden rounded border border-white/10 bg-neutral-950">
              <VideoContainer stream={localStream} muted={true} className="h-48 w-64 md:h-64 md:w-80" />
              <p className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-sm">You</p>
            </div>
            <div className="relative flex h-48 w-64 items-center justify-center overflow-hidden rounded border border-white/10 bg-neutral-950 md:h-64 md:w-80">
              {remoteStream ? (
                <VideoContainer stream={remoteStream} className="h-48 w-64 md:h-64 md:w-80" />
              ) : (
                <div className="text-center text-sm text-white/70">
                  <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-b-2 border-white" />
                  <p>{isWaiting ? "Finding a partner..." : "Waiting for remote video..."}</p>
                </div>
              )}
              <p className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-sm">Partner</p>
            </div>

            <div className="relative flex h-48 w-64 items-center justify-center overflow-hidden rounded border border-white/10 bg-neutral-950 md:h-64 md:w-80">
              {remoteStream ? (
                <VideoContainer stream={remoteStream} className="h-48 w-64 md:h-64 md:w-80" />
              ) : (
                <div className="text-center text-sm text-white/70">
                  <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-b-2 border-white" />
                  <p>{isWaiting ? "Finding a partner..." : "Waiting for remote video..."}</p>
                </div>
              )}
              <p className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-sm">Partner</p>
            </div>
          </div>

          {(isWaiting || isConnected) && (
          <div className="flex items-center space-x-4">
            <button onClick={toggleMic} className="p-3 bg-gray-700 hover:bg-gray-600 rounded-full transition-colors">
              {isMicOn ? <MdMic size={24}/> : <MdMicOff size={24}/>}
            </button>
            <button className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors" onClick={handleEndCall}>
              End Call
            </button>
            <button onClick={toggleCamera} className="p-3 bg-gray-700 hover:bg-gray-600 rounded-full transition-colors">
              {isVidOn ? <MdVideocam size={24}/> : <MdVideocamOff size={24}/>}
            </button>
          </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}
