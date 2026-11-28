import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { WebRTCP2PSession } from '@/src/lib/webrtc/p2p-session';
import { audioTones } from '@/src/lib/audio-tones';
import { notificationService } from '@/src/lib/notification-service';
import { Call, CallType, Profile, ActiveCallState, ConnectionState } from '@/src/types';
import { recordCallInHistory, updateCallInHistory } from './useCallHistory';
import { insertCallLogIntoChat, formatCallDurationText } from '@/src/lib/callChatLog';
import { admobService } from '@/src/lib/admob/admob-service';
import { getClientDeviceId, generateUUID } from '@/src/lib/utils';
import {
  db,
  auth,
  isFirebaseSessionActive,
  OperationType,
  handleFirestoreError,
  tsToIso,
  sanitizeStr,
  sanitizeOptionalStr,
} from '@/src/lib/firebase/client';
import { fetchPublicProfileFs, fetchRelationStatusFs } from '@/src/lib/firebase/services';
import { reportTelemetry } from '@/src/lib/bannedWordsCheck';

function createFallbackProfile(id: string, name = 'Caller'): Profile {
  return {
    id,
    username: name.toLowerCase().replace(/\s+/g, '_'),
    display_name: name,
    avatar_url: null,
    bio: null,
    is_online: true,
    last_seen: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function generateCallUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TERMINAL_CALL_STATUSES = ['ended', 'rejected', 'cancelled', 'missed', 'failed'];

async function safeUpdateFirestoreCall(callId: string, patch: Record<string, any>): Promise<void> {
  try {
    const callRef = doc(db, 'calls', callId);
    const snap = await getDoc(callRef);
    if (!snap.exists()) return;
    if (TERMINAL_CALL_STATUSES.includes(snap.data()?.status)) return;
    await updateDoc(callRef, {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Silent guard against concurrent terminal transitions
  }
}

// Studio Voice Audio Constraints with Multi-Browser Acoustic Echo Cancellation (AEC)
export const HD_CALL_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
  channelCount: { ideal: 1 },
  googEchoCancellation: true,
  googEchoCancellation2: true,
  googAutoGainControl: true,
  googNoiseSuppression: true,
  googHighpassFilter: true,
  googTypingNoiseDetection: true,
  googAudioMirroring: false,
} as any;

// High Definition (720p 30fps) Video Constraints (Mobile-safe ideal parameters)
export const HD_CALL_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

export function useCall(currentUser?: Profile | null) {
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  const [activeCallState, setActiveCallState] = useState<ActiveCallState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [callError, setCallError] = useState<string | null>(null);

  const currentUserRef = useRef<Profile | null | undefined>(currentUser);
  currentUserRef.current = currentUser;

  const activeCallStateRef = useRef<ActiveCallState | null>(null);
  activeCallStateRef.current = activeCallState;

  const incomingCallRef = useRef<Call | null>(null);
  incomingCallRef.current = incomingCall;

  const incomingCallReceivedAtRef = useRef<number>(0);
  const isAnsweringRef = useRef<boolean>(false);
  const answeredCallIdsRef = useRef<Set<string>>(new Set<string>());
  const connectingCallIdRef = useRef<string | null>(null);

  const p2pSessionRef = useRef<WebRTCP2PSession | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const durationIntervalRef = useRef<any>(null);
  const callTimeoutRef = useRef<any>(null);
  const callBusRef = useRef<BroadcastChannel | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    admobService.initialize().catch(() => {});
  }, []);

  const clearCallTimers = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  }, []);

  const cleanupMediaSession = useCallback(async () => {
    clearCallTimers();
    audioTones.stop();
    isAnsweringRef.current = false;
    connectingCallIdRef.current = null;

    if (p2pSessionRef.current) {
      try {
        p2pSessionRef.current.close();
      } catch {
        // ignore
      }
      p2pSessionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    if (typeof window !== 'undefined') {
      (window as any).__liveconnect_active_remote_stream = null;
    }
    remoteStreamRef.current = null;

    setConnectionState(ConnectionState.Disconnected);
  }, [clearCallTimers]);

  const acquireLocalMedia = async (isVideo: boolean) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: HD_CALL_AUDIO_CONSTRAINTS,
            video: isVideo ? HD_CALL_VIDEO_CONSTRAINTS : false,
          });
        } catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                googEchoCancellation: true,
                googAutoGainControl: true,
                googNoiseSuppression: true,
                googHighpassFilter: true,
              } as any,
              video: isVideo
                ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
                : false,
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
              video: isVideo,
            });
          }
        }

        if (!stream) {
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const dst = ctx.createMediaStreamDestination();
            osc.connect(dst);
            osc.start();
            stream = dst.stream;
          } catch {
            stream = new MediaStream();
          }
        }

        localStreamRef.current = stream;

        if (isVideo && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }
        return stream;
      }
    } catch (err: any) {
      console.warn('Could not acquire local camera/mic stream:', err);
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setCallError(
          'Microphone permission is required. Please allow microphone access in your browser to make or receive calls.'
        );
      }
      try {
        const stream = new MediaStream();
        localStreamRef.current = stream;
        return stream;
      } catch {
        // ignore
      }
    }
    return null;
  };

  // Connect to Direct WebRTC 1-to-1 P2P Media Session
  const connectToCallRoom = useCallback(async (call: Call, isVideo: boolean) => {
    try {
      const user = currentUserRef.current;
      if (!user) return;
      setCallError(null);

      if (!localStreamRef.current) {
        await acquireLocalMedia(isVideo);
      }
      if (!localStreamRef.current) {
        localStreamRef.current = new MediaStream();
      }

      if (!durationIntervalRef.current) {
        const startTime = Date.now();
        durationIntervalRef.current = setInterval(() => {
          setActiveCallState((prev) => {
            if (!prev) return null;
            const newDuration = Math.floor((Date.now() - startTime) / 1000);
            return {
              ...prev,
              durationSeconds: newDuration,
            };
          });
        }, 1000);
      }

      if (localStreamRef.current) {
        if (p2pSessionRef.current) {
          setConnectionState(ConnectionState.Connected);
          audioTones.playConnectedSound();
          return;
        }
        const peerId = call.caller_id === user.id ? call.callee_id : call.caller_id;
        const isCaller = call.caller_id === user.id;
        const targetDeviceId = isCaller ? call.calleeDeviceId : call.callerDeviceId;
        const currentDeviceId = getClientDeviceId();

        const p2p = new WebRTCP2PSession(
          call.id,
          user.id,
          peerId,
          isCaller,
          {
            onConnected: () => {
              setConnectionState(ConnectionState.Connected);
              audioTones.playConnectedSound();
            },
            onDisconnected: () => {
              setConnectionState(ConnectionState.Disconnected);
            },
            onRemoteTrack: (track, stream) => {
              remoteStreamRef.current = stream;
              if (typeof window !== 'undefined') {
                (window as any).__liveconnect_active_remote_stream = stream;
              }
              if (track.kind === 'video' && remoteVideoRef.current) {
                const videoTracks = stream.getVideoTracks();
                if (videoTracks.length > 0) {
                  const videoStream = new MediaStream(videoTracks);
                  if (remoteVideoRef.current.srcObject !== videoStream) {
                    remoteVideoRef.current.srcObject = videoStream;
                  }
                }
                remoteVideoRef.current.muted = true;
                remoteVideoRef.current.defaultMuted = true;
                remoteVideoRef.current.play().catch(() => {});
              }
              if (track.kind === 'audio' && remoteAudioRef.current) {
                const audioTracks = stream.getAudioTracks();
                if (audioTracks.length > 0) {
                  const audioStream = new MediaStream(audioTracks);
                  if (remoteAudioRef.current.srcObject !== audioStream) {
                    remoteAudioRef.current.srcObject = audioStream;
                  }
                }
                remoteAudioRef.current.volume = 1.0;
                remoteAudioRef.current.play().catch(() => {});
              }
            },
            onError: (err) => {
              console.warn('WebRTC P2P notice:', err.message);
            },
            onNetworkQualityChange: (quality) => {
              setActiveCallState((prev) => (prev ? { ...prev, networkQuality: quality } : null));
            },
          },
          currentDeviceId,
          targetDeviceId
        );

        p2pSessionRef.current = p2p;
        await p2p.start(localStreamRef.current, isVideo);
        setConnectionState(ConnectionState.Connected);
        audioTones.playConnectedSound();
      }
    } catch (err: any) {
      console.error('Call connection setup error:', err);
      setCallError(err.message || 'Could not connect to call');
    }
  }, []);

  // Subscribe to incoming calls (Firestore real-time when signed in with Firebase; BroadcastChannel + polling otherwise)
  useEffect(() => {
    if (!currentUser?.id) return;

    if (isFirebaseSessionActive(currentUser.id)) {
      const incomingQuery = query(
        collection(db, 'calls'),
        where('calleeId', '==', currentUser.id),
        limit(30)
      );

      const unsubIncoming = onSnapshot(
        incomingQuery,
        async (snap) => {
          if (activeCallStateRef.current) return;

          const now = Date.now();
          let matchedCall: Call | null = null;

          for (const docSnap of snap.docs) {
            const d = docSnap.data();
            if (!d) continue;
            if (d.status !== 'calling' && d.status !== 'ringing') continue;
            if (answeredCallIdsRef.current.has(docSnap.id) || isAnsweringRef.current) continue;
            if (d.callerDeviceId && d.callerDeviceId === getClientDeviceId()) continue;

            const createdIso = tsToIso(d.createdAt);
            const ageMs = now - new Date(createdIso).getTime();
            if (ageMs > 60000) continue;

            const callerProf =
              (await fetchPublicProfileFs(d.callerId).catch(() => null)) ||
              ({
                id: d.callerId,
                username: d.callerUsername || 'user',
                display_name: d.callerDisplayName || d.callerUsername || 'Caller',
                avatar_url: d.callerAvatarUrl || null,
                bio: null,
                is_online: true,
                last_seen: createdIso,
                created_at: createdIso,
                updated_at: createdIso,
              } as Profile);

            matchedCall = {
              id: docSnap.id,
              caller_id: d.callerId,
              callee_id: d.calleeId,
              callerDeviceId: d.callerDeviceId,
              calleeDeviceId: d.calleeDeviceId,
              call_type: d.callType,
              status: d.status,
              room_name: d.roomName,
              started_at: createdIso,
              answered_at: d.answeredAt ? tsToIso(d.answeredAt) : null,
              ended_at: d.endedAt ? tsToIso(d.endedAt) : null,
              created_at: createdIso,
              updated_at: tsToIso(d.updatedAt),
              caller: callerProf,
            };
            break;
          }

          if (matchedCall) {
            const currentIncoming = incomingCallRef.current;
            if (!currentIncoming || currentIncoming.id !== matchedCall.id) {
              incomingCallReceivedAtRef.current = Date.now();
              setIncomingCall(matchedCall);

              recordCallInHistory(currentUser.id, {
                ...matchedCall,
                peer: matchedCall.caller || createFallbackProfile(matchedCall.caller_id, 'Caller'),
                direction: 'incoming',
                isMissed: false,
                durationFormatted: 'Ringing...',
              });

              const isCallSoundEnabled = localStorage.getItem('liveconnect_perm_call_sound') !== 'false';
              if (isCallSoundEnabled) {
                audioTones.startIncomingRingtone();
              }

              const callerName = matchedCall.caller?.display_name || 'Someone';
              notificationService.sendNotification({
                title: `Incoming ${matchedCall.call_type === 'video' ? 'Video' : 'Voice'} Call`,
                body: `${callerName} is calling you on LiveConnect...`,
                icon: matchedCall.caller?.avatar_url || '/icon.svg',
                tag: `call-${matchedCall.id}`,
              });

              if (matchedCall.status === 'calling') {
                safeUpdateFirestoreCall(matchedCall.id, { status: 'ringing' });
              }
            }
          }
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.LIST, 'calls');
        }
      );

      return () => {
        unsubIncoming();
      };
    }

    const handleSignal = async (data: any) => {
      if (!data || !data.type) return;

      if (data.type === 'CALL_RINGING') {
        const incoming = data.call as Call;
        if (
          incoming &&
          incoming.callee_id === currentUser.id &&
          !activeCallStateRef.current &&
          incoming.callerDeviceId !== getClientDeviceId()
        ) {
          const callerProfile = data.callerMeta || incoming.caller;
          const fullCall: Call = {
            ...incoming,
            caller: callerProfile,
          };
          incomingCallReceivedAtRef.current = Date.now();
          setIncomingCall(fullCall);

          const fallbackPeer = createFallbackProfile(incoming.caller_id, 'Caller');
          recordCallInHistory(currentUser.id, {
            ...fullCall,
            peer: callerProfile || fallbackPeer,
            direction: 'incoming',
            isMissed: false,
            durationFormatted: 'Ringing...',
          });

          const isCallSoundEnabled = localStorage.getItem('liveconnect_perm_call_sound') !== 'false';
          if (isCallSoundEnabled) {
            audioTones.startIncomingRingtone();
          }

          const callerName = callerProfile?.display_name || 'Someone';
          notificationService.sendNotification({
            title: `Incoming ${incoming.call_type === 'video' ? 'Video' : 'Voice'} Call`,
            body: `${callerName} is calling you on LiveConnect...`,
            icon: callerProfile?.avatar_url || '/icon.svg',
            tag: `call-${incoming.id}`,
          });
        }
      } else if (data.type === 'CALL_ACCEPTED') {
        const currentActive = activeCallStateRef.current;
        if (currentActive && currentActive.call.id === data.callId) {
          audioTones.stop();
          audioTones.playConnectedSound();
          if (callTimeoutRef.current) {
            clearTimeout(callTimeoutRef.current);
            callTimeoutRef.current = null;
          }
          const nextActive = { ...currentActive, status: 'connected' as const };
          activeCallStateRef.current = nextActive;
          setActiveCallState(nextActive);
          updateCallInHistory(currentUser.id, data.callId, {
            status: 'accepted',
            answered_at: new Date().toISOString(),
            durationFormatted: 'Connected',
          });
          if (currentActive.isCaller) {
            await connectToCallRoom(currentActive.call, currentActive.call.call_type === 'video');
          }
        }
      } else if (['CALL_REJECTED', 'CALL_CANCELLED', 'CALL_ENDED'].includes(data.type)) {
        if (incomingCallRef.current && incomingCallRef.current.id === data.callId) {
          audioTones.stop();
          setIncomingCall(null);
          updateCallInHistory(currentUser.id, data.callId, {
            status: data.type === 'CALL_REJECTED' ? 'rejected' : 'cancelled',
            ended_at: new Date().toISOString(),
            durationFormatted: data.type === 'CALL_REJECTED' ? 'Declined' : 'Cancelled',
          });
        }
        if (activeCallStateRef.current && activeCallStateRef.current.call.id === data.callId) {
          const wasConnected =
            activeCallStateRef.current.status === 'connected' ||
            (activeCallStateRef.current.durationSeconds || 0) > 0;
          const callId = data.callId;
          audioTones.playCallEndedSound();
          const durationSecs =
            typeof data.duration === 'number'
              ? data.duration
              : activeCallStateRef.current.durationSeconds || 0;
          const durationFormatted = formatCallDurationText(durationSecs);
          await cleanupMediaSession();
          setActiveCallState(null);
          updateCallInHistory(currentUser.id, data.callId, {
            status: 'ended',
            ended_at: new Date().toISOString(),
            durationFormatted: durationFormatted || 'Call ended',
          });

          if (wasConnected) {
            admobService.showPostCallInterstitial(callId, true).catch(() => {});
          }
        }
      }
    };

    if (typeof BroadcastChannel !== 'undefined') {
      const bus = new BroadcastChannel('liveconnect_calls_bus');
      callBusRef.current = bus;
      bus.onmessage = (event) => handleSignal(event.data);
    }

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'liveconnect_cross_tab_call_signal' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          handleSignal(parsed);
        } catch {
          // ignore
        }
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageEvent);
    }

    const incomingPollInterval = setInterval(async () => {
      if (activeCallStateRef.current) return;
      try {
        let foundCall: Call | null = null;

        const res = await fetch('/api/calls/incoming', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUser.id,
            username: currentUser.username,
            deviceId: getClientDeviceId(),
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.calls) && data.calls.length > 0) {
            foundCall = data.calls[0] as Call;
          }
        }

        if (foundCall) {
          if (answeredCallIdsRef.current.has(foundCall.id) || isAnsweringRef.current) return;
          const currentIncoming = incomingCallRef.current;
          if (!currentIncoming || currentIncoming.id !== foundCall.id) {
            incomingCallReceivedAtRef.current = Date.now();
            setIncomingCall(foundCall);

            const fallbackPeer = createFallbackProfile(foundCall.caller_id, 'Caller');
            recordCallInHistory(currentUser.id, {
              ...foundCall,
              peer: foundCall.caller || fallbackPeer,
              direction: 'incoming',
              isMissed: false,
              durationFormatted: 'Ringing...',
            });

            const isCallSoundEnabled = localStorage.getItem('liveconnect_perm_call_sound') !== 'false';
            if (isCallSoundEnabled) {
              audioTones.startIncomingRingtone();
            }

            const callerName = foundCall.caller?.display_name || 'Someone';
            notificationService.sendNotification({
              title: `Incoming ${foundCall.call_type === 'video' ? 'Video' : 'Voice'} Call`,
              body: `${callerName} is calling you on LiveConnect...`,
              icon: foundCall.caller?.avatar_url || '/icon.svg',
              tag: `call-${foundCall.id}`,
            });

            fetch('/api/calls/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callId: foundCall.id, action: 'ring', userId: currentUser.id }),
            }).catch(() => {});
          }
        } else if (incomingCallRef.current) {
          if (Date.now() - incomingCallReceivedAtRef.current > 45000) {
            const timedOutCallId = incomingCallRef.current.id;
            audioTones.stop();
            setIncomingCall(null);
            updateCallInHistory(currentUser.id, timedOutCallId, {
              status: 'missed',
              isMissed: true,
              ended_at: new Date().toISOString(),
              durationFormatted: 'Missed',
            });
            return;
          }

          const statusRes = await fetch('/api/calls/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId: incomingCallRef.current.id }),
          });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (
              statusData &&
              statusData.status &&
              ['cancelled', 'ended', 'rejected', 'missed'].includes(statusData.status)
            ) {
              audioTones.stop();
              audioTones.playCallEndedSound();
              setIncomingCall(null);
              updateCallInHistory(currentUser.id, incomingCallRef.current.id, {
                status: statusData.status,
                isMissed: statusData.status !== 'ended',
                ended_at: new Date().toISOString(),
                durationFormatted: statusData.status === 'rejected' ? 'Declined' : 'Missed',
              });
            }
          }
        }
      } catch {
        // network polling fallback
      }
    }, 250);

    return () => {
      clearInterval(incomingPollInterval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageEvent);
      }
      if (callBusRef.current) {
        callBusRef.current.close();
        callBusRef.current = null;
      }
    };
  }, [currentUser?.id, currentUser?.username, connectToCallRoom, cleanupMediaSession]);

  // Monitor an incoming ringing call doc under Firebase so cancellation/timeout dismisses modal instantly
  useEffect(() => {
    if (!incomingCall?.id || !currentUser?.id || !isFirebaseSessionActive(currentUser.id)) return;

    const incomingId = incomingCall.id;
    const unsub = onSnapshot(
      doc(db, 'calls', incomingId),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        if (TERMINAL_CALL_STATUSES.includes(d.status)) {
          audioTones.stop();
          audioTones.playCallEndedSound();
          setIncomingCall(null);
          updateCallInHistory(currentUser.id, incomingId, {
            status: d.status,
            isMissed: d.status !== 'ended',
            ended_at: new Date().toISOString(),
            durationFormatted: d.status === 'rejected' ? 'Declined' : 'Missed',
          });
        }
      },
      () => {}
    );

    const expireTimer = setTimeout(() => {
      if (incomingCallRef.current?.id === incomingId) {
        audioTones.stop();
        setIncomingCall(null);
        updateCallInHistory(currentUser.id, incomingId, {
          status: 'missed',
          isMissed: true,
          ended_at: new Date().toISOString(),
          durationFormatted: 'Missed',
        });
      }
    }, 45000);

    return () => {
      unsub();
      clearTimeout(expireTimer);
    };
  }, [incomingCall?.id, currentUser?.id]);

  // Active call status monitor
  useEffect(() => {
    if (!activeCallState?.call?.id) return;

    const callId = activeCallState.call.id;
    const isCaller = activeCallState.isCaller;

    if (currentUser?.id && isFirebaseSessionActive(currentUser.id)) {
      const unsub = onSnapshot(
        doc(db, 'calls', callId),
        async (snap) => {
          if (!snap.exists()) return;
          const d = snap.data();
          const currentActive = activeCallStateRef.current;
          if (!currentActive || currentActive.call.id !== callId) return;

          if ((d.status === 'accepted' || d.status === 'connected') && currentActive.status !== 'connected') {
            audioTones.stop();
            audioTones.playConnectedSound();
            if (callTimeoutRef.current) {
              clearTimeout(callTimeoutRef.current);
              callTimeoutRef.current = null;
            }
            if (d.calleeDeviceId) {
              currentActive.call.calleeDeviceId = d.calleeDeviceId;
            }
            const nextActive = { ...currentActive, status: 'connected' as const };
            activeCallStateRef.current = nextActive;
            setActiveCallState(nextActive);
            updateCallInHistory(currentUser.id, callId, {
              status: 'accepted',
              answered_at: new Date().toISOString(),
              durationFormatted: 'Connected',
            });
            if (isCaller) {
              await connectToCallRoom(currentActive.call, currentActive.call.call_type === 'video');
            }
          } else if (TERMINAL_CALL_STATUSES.includes(d.status)) {
            const wasConnected =
              currentActive.status === 'connected' || (currentActive.durationSeconds || 0) > 0;
            audioTones.playCallEndedSound();
            await cleanupMediaSession();
            setActiveCallState(null);

            const isMissedStatus = ['rejected', 'cancelled', 'missed'].includes(d.status);
            const durationSecs = currentActive?.durationSeconds || 0;
            const durationFormatted = isMissedStatus
              ? 'No answer'
              : formatCallDurationText(durationSecs) || 'Call ended';

            updateCallInHistory(currentUser.id, callId, {
              status: d.status,
              isMissed: isMissedStatus,
              ended_at: new Date().toISOString(),
              durationFormatted,
            });

            if (currentActive?.peer) {
              insertCallLogIntoChat({
                callId,
                caller: currentActive.isCaller ? currentUser : currentActive.peer,
                callee: currentActive.isCaller ? currentActive.peer : currentUser,
                callType: currentActive.call.call_type,
                status: d.status,
                isMissed: isMissedStatus,
                durationFormatted,
              }).catch(() => {});
            }

            if (wasConnected && d.status === 'ended') {
              admobService.showPostCallInterstitial(callId, true).catch(() => {});
            }
          }
        },
        (err) => {
          if (!auth.currentUser) return;
          handleFirestoreError(err, OperationType.GET, `calls/${callId}`);
        }
      );

      return () => {
        unsub();
      };
    }

    const statusInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/calls/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId }),
        });
        if (!res.ok) return;
        const data = await res.json();

        if (data) {
          const currentActive = activeCallStateRef.current;
          if (currentActive && currentActive.call.id === callId) {
            if ((data.status === 'accepted' || data.status === 'connected') && currentActive.status !== 'connected') {
              audioTones.stop();
              audioTones.playConnectedSound();
              if (callTimeoutRef.current) {
                clearTimeout(callTimeoutRef.current);
                callTimeoutRef.current = null;
              }
              if (data.call?.calleeDeviceId) {
                currentActive.call.calleeDeviceId = data.call.calleeDeviceId;
              }
              const nextActive = { ...currentActive, status: 'connected' as const };
              activeCallStateRef.current = nextActive;
              setActiveCallState(nextActive);
              if (currentUser?.id) {
                updateCallInHistory(currentUser.id, callId, {
                  status: 'accepted',
                  answered_at: new Date().toISOString(),
                  durationFormatted: 'Connected',
                });
              }
              if (isCaller) {
                await connectToCallRoom(currentActive.call, currentActive.call.call_type === 'video');
              }
            } else if (data.exists && ['rejected', 'ended', 'cancelled', 'missed'].includes(data.status)) {
              const wasConnected =
                currentActive.status === 'connected' || (currentActive.durationSeconds || 0) > 0;
              audioTones.playCallEndedSound();
              cleanupMediaSession();
              setActiveCallState(null);
              if (currentUser?.id) {
                const isMissedStatus =
                  data.status === 'rejected' || data.status === 'cancelled' || data.status === 'missed';
                const durationSecs = currentActive?.durationSeconds || 0;
                const durationFormatted = isMissedStatus
                  ? 'No answer'
                  : formatCallDurationText(durationSecs) || 'Call ended';

                updateCallInHistory(currentUser.id, callId, {
                  status: data.status,
                  isMissed: isMissedStatus,
                  ended_at: new Date().toISOString(),
                  durationFormatted,
                });

                if (currentActive?.peer) {
                  insertCallLogIntoChat({
                    callId,
                    caller: currentActive.isCaller ? currentUser : currentActive.peer,
                    callee: currentActive.isCaller ? currentActive.peer : currentUser,
                    callType: currentActive.call.call_type,
                    status: data.status,
                    isMissed: isMissedStatus,
                    durationFormatted,
                  }).catch(() => {});
                }

                if (wasConnected && data.status === 'ended') {
                  admobService.showPostCallInterstitial(callId, true).catch(() => {});
                }
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }, 250);

    return () => {
      clearInterval(statusInterval);
    };
  }, [activeCallState?.call?.id, activeCallState?.isCaller, connectToCallRoom, cleanupMediaSession, currentUser]);

  // Initiate an Outgoing Audio or Video Call
  const startCall = async (peer: Profile, callType: CallType) => {
    if (!currentUser?.id) return;
    setCallError(null);

    const calleeId = peer?.id || (peer as any)?.username;
    if (!calleeId) {
      setCallError('Could not find user to call.');
      return;
    }
    if (calleeId === currentUser.id) {
      setCallError('You cannot start a call with yourself.');
      return;
    }

    const peerProfile: Profile = {
      ...peer,
      id: calleeId,
      username: peer?.username || calleeId,
      display_name: peer?.display_name || peer?.username || 'User',
    };

    const callId = generateCallUUID();
    const roomName = `room_${callId.replace(/-/g, '').substring(0, 16)}`;
    const callerDeviceId = getClientDeviceId();

    try {
      if (isFirebaseSessionActive(currentUser.id)) {
        const rel = await fetchRelationStatusFs(currentUser.id, calleeId);
        if (rel.isBlocked) {
          setCallError('Calling is unavailable because one of you has blocked the other.');
          return;
        }
        if (!rel.isMutual) {
          setCallError('Follow each other to start calling.');
          return;
        }
      }

      const newCall: Call = {
        id: callId,
        caller_id: currentUser.id,
        callee_id: calleeId,
        callerDeviceId,
        call_type: callType,
        status: 'calling',
        room_name: roomName,
        caller: currentUser,
        started_at: new Date().toISOString(),
        answered_at: null,
        ended_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setActiveCallState({
        call: newCall,
        peer: peerProfile,
        isCaller: true,
        status: 'calling',
        localAudioEnabled: true,
        localVideoEnabled: callType === 'video',
        isFrontCamera: true,
        durationSeconds: 0,
      });

      audioTones.startRingbackTone();

      recordCallInHistory(currentUser.id, {
        ...newCall,
        peer: peerProfile,
        direction: 'outgoing',
        isMissed: false,
        durationFormatted: 'Calling...',
      });

      if (isFirebaseSessionActive(currentUser.id)) {
        await setDoc(doc(db, 'calls', callId), {
          id: callId,
          callerId: currentUser.id,
          calleeId,
          callerDeviceId: sanitizeOptionalStr(callerDeviceId, 128),
          callerDisplayName: sanitizeOptionalStr(currentUser.display_name, 80),
          callerUsername: sanitizeOptionalStr(currentUser.username, 32),
          callerAvatarUrl: sanitizeOptionalStr(currentUser.avatar_url, 1024),
          calleeDisplayName: sanitizeOptionalStr(peerProfile.display_name, 80),
          calleeUsername: sanitizeOptionalStr(peerProfile.username, 32),
          calleeAvatarUrl: sanitizeOptionalStr(peerProfile.avatar_url, 1024),
          callType,
          status: 'calling',
          roomName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        void reportTelemetry('call_created', callId);

        // Dispatch incoming call notification
        const notifId = `nc_${generateUUID().replace(/-/g, '').slice(0, 20)}`;
        const callerName = currentUser.display_name || currentUser.username || 'Someone';
        setDoc(doc(db, 'users', calleeId, 'notifications', notifId), {
          id: notifId,
          userId: calleeId,
          actorId: currentUser.id,
          actorDisplayName: sanitizeOptionalStr(currentUser.display_name, 80),
          actorUsername: sanitizeOptionalStr(currentUser.username, 32),
          actorAvatarUrl: sanitizeOptionalStr(currentUser.avatar_url, 1024),
          type: callType === 'video' ? 'call_video' : 'call_audio',
          title: `Incoming ${callType === 'video' ? 'Video' : 'Voice'} Call`,
          message: sanitizeStr(`${callerName} is calling you on LiveConnect.`, 1000),
          referenceId: callId,
          isRead: false,
          createdAt: serverTimestamp(),
        }).catch(() => {});
      } else {
        callBusRef.current?.postMessage({
          type: 'CALL_RINGING',
          call: newCall,
          callerMeta: currentUser,
        });

        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(
              'liveconnect_cross_tab_call_signal',
              JSON.stringify({
                type: 'CALL_RINGING',
                call: newCall,
                callerMeta: currentUser,
                _t: Date.now(),
              })
            );
          } catch {
            // ignore
          }
        }

        fetch('/api/calls/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call: newCall,
            callerMeta: currentUser,
          }),
        })
          .then(async (res) => {
            if (res.status === 403) {
              const errData = await res.json().catch(() => ({}));
              audioTones.stop();
              if (callTimeoutRef.current) {
                clearTimeout(callTimeoutRef.current);
              }
              cleanupMediaSession().catch(() => {});
              setActiveCallState(null);
              setCallError(errData.error || 'Follow each other to start calling.');
            }
          })
          .catch(() => {});
      }

      acquireLocalMedia(callType === 'video').catch((e) => {
        console.warn('Camera/mic access in background notice:', e);
      });

      if (callTimeoutRef.current) {
        clearTimeout(callTimeoutRef.current);
      }
      callTimeoutRef.current = setTimeout(async () => {
        audioTones.playCallEndedSound();

        if (isFirebaseSessionActive(currentUser.id)) {
          await safeUpdateFirestoreCall(newCall.id, {
            status: 'missed',
            endedBy: currentUser.id,
            endedAt: serverTimestamp(),
          });
        } else {
          callBusRef.current?.postMessage({
            type: 'CALL_CANCELLED',
            callId: newCall.id,
          });

          fetch('/api/calls/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId: newCall.id, action: 'cancel', userId: currentUser.id }),
          }).catch(() => {});
        }

        updateCallInHistory(currentUser.id, newCall.id, {
          status: 'missed',
          isMissed: true,
          ended_at: new Date().toISOString(),
          durationFormatted: 'No answer',
        });

        insertCallLogIntoChat({
          callId: newCall.id,
          caller: currentUser,
          callee: peer,
          callType: newCall.call_type,
          status: 'missed',
          isMissed: true,
          durationFormatted: 'No answer',
        }).catch(() => {});

        await cleanupMediaSession();
        setActiveCallState(null);
      }, 45000);
    } catch (err: any) {
      console.error('Call initialization error:', err);
      audioTones.stop();
      setCallError(err.message || 'Could not start call');
      setActiveCallState(null);
    }
  };

  // Accept incoming call
  const acceptCall = async () => {
    if (!incomingCall || !currentUser?.id || isAnsweringRef.current) return;
    const callToAnswer = incomingCall;
    isAnsweringRef.current = true;
    answeredCallIdsRef.current.add(callToAnswer.id);

    setIncomingCall(null);
    incomingCallRef.current = null;
    audioTones.stop();

    const peer =
      callToAnswer.caller ||
      ({
        id: callToAnswer.caller_id,
        username: 'Caller',
        display_name: 'Caller',
        avatar_url: null,
        bio: null,
        is_online: true,
        last_seen: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Profile);

    const initialActiveState: ActiveCallState = {
      call: callToAnswer,
      peer,
      isCaller: false,
      status: 'connected',
      localAudioEnabled: true,
      localVideoEnabled: callToAnswer.call_type === 'video',
      isFrontCamera: true,
      durationSeconds: 0,
    };
    setActiveCallState(initialActiveState);
    activeCallStateRef.current = initialActiveState;

    const calleeDeviceId = getClientDeviceId();
    callToAnswer.calleeDeviceId = calleeDeviceId;

    updateCallInHistory(currentUser.id, callToAnswer.id, {
      status: 'accepted',
      answered_at: new Date().toISOString(),
      durationFormatted: 'Connected',
    });

    if (isFirebaseSessionActive(currentUser.id)) {
      await safeUpdateFirestoreCall(callToAnswer.id, {
        status: 'accepted',
        calleeDeviceId: sanitizeOptionalStr(calleeDeviceId, 128),
        answeredAt: serverTimestamp(),
      });
    } else {
      callBusRef.current?.postMessage({
        type: 'CALL_ACCEPTED',
        callId: callToAnswer.id,
      });
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(
            'liveconnect_cross_tab_call_signal',
            JSON.stringify({ type: 'CALL_ACCEPTED', callId: callToAnswer.id, _t: Date.now() })
          );
        } catch {
          // ignore
        }
      }

      fetch('/api/calls/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: callToAnswer.id,
          action: 'accept',
          userId: currentUser.id,
          calleeDeviceId,
        }),
      }).catch(() => {});
    }

    try {
      await acquireLocalMedia(callToAnswer.call_type === 'video');
      await connectToCallRoom(callToAnswer, callToAnswer.call_type === 'video');
    } catch (err: any) {
      console.error('Failed to answer call:', err);
      setCallError(err.message || 'Error answering call');
      await cleanupMediaSession();
    } finally {
      isAnsweringRef.current = false;
    }
  };

  // Reject incoming call
  const rejectCall = async () => {
    if (!incomingCall) return;
    const callToReject = incomingCall;
    setIncomingCall(null);
    audioTones.stop();
    audioTones.playCallEndedSound();

    if (currentUser?.id && isFirebaseSessionActive(currentUser.id)) {
      await safeUpdateFirestoreCall(callToReject.id, {
        status: 'rejected',
        endedBy: currentUser.id,
        endedAt: serverTimestamp(),
      });
    } else {
      callBusRef.current?.postMessage({
        type: 'CALL_REJECTED',
        callId: callToReject.id,
      });
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(
            'liveconnect_cross_tab_call_signal',
            JSON.stringify({ type: 'CALL_REJECTED', callId: callToReject.id, _t: Date.now() })
          );
        } catch {
          // ignore
        }
      }

      fetch('/api/calls/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: callToReject.id, action: 'reject', userId: currentUser?.id }),
      }).catch(() => {});
    }

    if (currentUser?.id) {
      updateCallInHistory(currentUser.id, callToReject.id, {
        status: 'rejected',
        isMissed: true,
        ended_at: new Date().toISOString(),
        durationFormatted: 'No answer',
      });

      if (callToReject.caller) {
        insertCallLogIntoChat({
          callId: callToReject.id,
          caller: callToReject.caller,
          callee: currentUser,
          callType: callToReject.call_type,
          status: 'rejected',
          isMissed: true,
          durationFormatted: 'No answer',
        }).catch(() => {});
      }
    }
  };

  // Cancel outgoing call before it is answered
  const cancelCall = async () => {
    const currentActive = activeCallStateRef.current || activeCallState;
    if (!currentActive) return;
    const callToCancel = currentActive.call;

    setActiveCallState(null);
    audioTones.stop();
    audioTones.playCallEndedSound();

    if (p2pSessionRef.current) {
      p2pSessionRef.current.sendHangup().catch(() => {});
    }

    cleanupMediaSession();

    if (currentUser?.id && isFirebaseSessionActive(currentUser.id)) {
      await safeUpdateFirestoreCall(callToCancel.id, {
        status: 'cancelled',
        endedBy: currentUser.id,
        endedAt: serverTimestamp(),
      });
    } else {
      callBusRef.current?.postMessage({
        type: 'CALL_CANCELLED',
        callId: callToCancel.id,
      });
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(
            'liveconnect_cross_tab_call_signal',
            JSON.stringify({ type: 'CALL_CANCELLED', callId: callToCancel.id, _t: Date.now() })
          );
        } catch {
          // ignore
        }
      }

      fetch('/api/calls/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: callToCancel.id, action: 'cancel', userId: currentUser?.id }),
      }).catch(() => {});
    }

    if (currentUser?.id) {
      updateCallInHistory(currentUser.id, callToCancel.id, {
        status: 'cancelled',
        isMissed: true,
        ended_at: new Date().toISOString(),
        durationFormatted: 'No answer',
      });

      if (currentActive?.peer) {
        insertCallLogIntoChat({
          callId: callToCancel.id,
          caller: currentActive.isCaller ? currentUser : currentActive.peer,
          callee: currentActive.isCaller ? currentActive.peer : currentUser,
          callType: callToCancel.call_type,
          status: 'cancelled',
          isMissed: true,
          durationFormatted: 'No answer',
        }).catch(() => {});
      }
    }
  };

  // End an active call
  const endCall = async () => {
    const currentActive = activeCallStateRef.current || activeCallState;
    if (!currentActive) return;
    const callToEnd = currentActive.call;
    const callDuration = currentActive.durationSeconds || 0;
    const isAnswered =
      callDuration > 0 || currentActive.status === 'connected' || connectionState === ConnectionState.Connected;
    const isMissed = !isAnswered;

    setActiveCallState(null);
    audioTones.stop();
    audioTones.playCallEndedSound();

    if (p2pSessionRef.current) {
      p2pSessionRef.current.sendHangup().catch(() => {});
    }

    cleanupMediaSession();

    if (currentUser?.id && isFirebaseSessionActive(currentUser.id)) {
      await safeUpdateFirestoreCall(callToEnd.id, {
        status: isMissed ? 'missed' : 'ended',
        endedBy: currentUser.id,
        endedAt: serverTimestamp(),
      });
    } else {
      callBusRef.current?.postMessage({
        type: 'CALL_ENDED',
        callId: callToEnd.id,
        duration: callDuration,
      });
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(
            'liveconnect_cross_tab_call_signal',
            JSON.stringify({ type: 'CALL_ENDED', callId: callToEnd.id, duration: callDuration, _t: Date.now() })
          );
        } catch {
          // ignore
        }
      }

      fetch('/api/calls/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: callToEnd.id, action: 'end', userId: currentUser?.id }),
      }).catch(() => {});
    }

    if (currentUser?.id) {
      const durationFormatted = isAnswered ? formatCallDurationText(callDuration) || 'Ended' : 'No answer';

      updateCallInHistory(currentUser.id, callToEnd.id, {
        status: isMissed ? 'missed' : 'ended',
        isMissed,
        ended_at: new Date().toISOString(),
        durationFormatted,
      });

      if (currentActive?.peer) {
        insertCallLogIntoChat({
          callId: callToEnd.id,
          caller: currentActive.isCaller ? currentUser : currentActive.peer,
          callee: currentActive.isCaller ? currentActive.peer : currentUser,
          callType: callToEnd.call_type,
          status: isMissed ? 'missed' : 'ended',
          isMissed,
          durationFormatted,
        }).catch(() => {});
      }
    }

    if (isAnswered) {
      admobService.showPostCallInterstitial(callToEnd.id, true).catch(() => {});
    }
  };

  // Toggle local audio / microphone
  const toggleMicrophone = async () => {
    const currentState = activeCallStateRef.current?.localAudioEnabled ?? activeCallState?.localAudioEnabled ?? true;
    const newState = !currentState;

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = newState;
      });
    }

    if (p2pSessionRef.current) {
      p2pSessionRef.current.setAudioEnabled(newState);
    }

    setActiveCallState((prev) => (prev ? { ...prev, localAudioEnabled: newState } : null));
  };

  // Toggle local video / camera
  const toggleCamera = async () => {
    const currentState = activeCallStateRef.current?.localVideoEnabled ?? activeCallState?.localVideoEnabled ?? true;
    const newState = !currentState;

    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = newState;
      });
    }

    if (p2pSessionRef.current) {
      p2pSessionRef.current.setVideoEnabled(newState);
    }

    setActiveCallState((prev) => (prev ? { ...prev, localVideoEnabled: newState } : null));
  };

  // Switch camera front/back
  const switchCamera = async () => {
    if (!activeCallState?.localVideoEnabled || !localStreamRef.current) return;

    try {
      const isFront = activeCallState.isFrontCamera ?? true;
      const newFacingMode = isFront ? 'environment' : 'user';

      localStreamRef.current.getVideoTracks().forEach((track) => track.stop());

      let newStream: MediaStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: newFacingMode,
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30, min: 24, max: 60 },
          },
        });
      } catch {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: newFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      }

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (newVideoTrack) {
        localStreamRef.current.removeTrack(localStreamRef.current.getVideoTracks()[0]);
        localStreamRef.current.addTrack(newVideoTrack);

        if (localVideoRef.current) {
          localVideoRef.current.muted = true;
          localVideoRef.current.defaultMuted = true;
          localVideoRef.current.srcObject = new MediaStream([newVideoTrack]);
        }

        if (p2pSessionRef.current) {
          await p2pSessionRef.current.replaceVideoTrack(newVideoTrack);
        }

        setActiveCallState((prev) => (prev ? { ...prev, isFrontCamera: !isFront } : null));
      }
    } catch (err) {
      console.warn('Could not flip camera device:', err);
    }
  };

  useEffect(() => {
    if (
      activeCallState &&
      activeCallState.call.call_type === 'video' &&
      localStreamRef.current &&
      localVideoRef.current
    ) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        localVideoRef.current.muted = true;
        localVideoRef.current.defaultMuted = true;
        const currentSrc = localVideoRef.current.srcObject as MediaStream | null;
        if (!currentSrc || currentSrc.getVideoTracks()[0]?.id !== videoTracks[0].id) {
          localVideoRef.current.srcObject = new MediaStream(videoTracks);
        }
        localVideoRef.current.play().catch(() => {});
      }
    }
  }, [activeCallState?.call.id, activeCallState?.call.call_type, activeCallState?.localVideoEnabled]);

  useEffect(() => {
    if (!activeCallState) return;

    const stream = remoteStreamRef.current || p2pSessionRef.current?.remoteStream;
    if (!stream) return;

    if (remoteAudioRef.current) {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const currentSrc = remoteAudioRef.current.srcObject as MediaStream | null;
        if (!currentSrc || currentSrc.getAudioTracks()[0]?.id !== audioTracks[0].id) {
          remoteAudioRef.current.srcObject = new MediaStream(audioTracks);
        }
        remoteAudioRef.current.volume = 1.0;
        remoteAudioRef.current.play().catch(() => {});
      }
    }

    if (activeCallState.call.call_type === 'video' && remoteVideoRef.current) {
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
        remoteVideoRef.current.muted = true;
        remoteVideoRef.current.defaultMuted = true;
        const currentSrc = remoteVideoRef.current.srcObject as MediaStream | null;
        if (!currentSrc || currentSrc.getVideoTracks()[0]?.id !== videoTracks[0].id) {
          remoteVideoRef.current.srcObject = new MediaStream(videoTracks);
        }
        remoteVideoRef.current.play().catch(() => {});
      }
    }
  }, [activeCallState?.call.id, activeCallState?.status, connectionState]);

  return {
    incomingCall,
    activeCallState,
    connectionState,
    callError,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    startCall,
    acceptCall,
    rejectCall,
    cancelCall,
    endCall,
    toggleMicrophone,
    toggleCamera,
    switchCamera,
    clearCallError: () => setCallError(null),
  };
}
