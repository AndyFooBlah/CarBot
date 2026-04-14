// Copyright 2026 Andrew Brook
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Live voice session page (/sessions/new).
 *
 * Shows a large start/stop button, real-time transcript feed, and a
 * simple animated waveform while the bot is speaking.
 */

import React, { useState, useCallback } from 'react';
import { Timestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@andyfooblah/voicecommon';
import { ConnectionStatus } from '@andyfooblah/voicecommon';
import { useCarbotSession } from '../../hooks/useCarbotSession';
import { useUserProfile } from '../../hooks/useUserProfile';
import { tripContextLabel } from '../../services/sessions';
import { TranscriptFeed } from './TranscriptFeed';

export function SessionView() {
  const { user } = useAuth();
  const { profile } = useUserProfile(user?.uid ?? null);
  const navigate = useNavigate();
  const [botSpeaking, setBotSpeaking] = useState(false);

  // Use a ref so onSessionEndRequest can always see the latest sessionId
  // without being recreated (which would require re-passing it to the hook).
  const sessionIdRef = React.useRef<string | null>(null);

  const onSessionEndRequest = useCallback(async () => {
    const id = sessionIdRef.current;
    navigate(id ? `/sessions/${id}` : '/sessions');
  }, [navigate]);

  const {
    messages,
    connectionStatus,
    startSession,
    stopSession,
    isRecording,
    sessionId,
    error,
    tripContext,
  } = useCarbotSession({
    userId: user?.uid ?? '',
    profile: profile ?? {
      email: user?.email ?? '',
      displayName: user?.displayName ?? '',
      createdAt: new Timestamp(0, 0),
    },
    onSessionEndRequest,
    onBotSpeaking: setBotSpeaking,
  });

  // Keep ref in sync with the latest sessionId
  React.useEffect(() => {
    sessionIdRef.current = sessionId ?? null;
  }, [sessionId]);

  const handleStop = async () => {
    await stopSession();
    if (sessionId) {
      navigate(`/sessions/${sessionId}`);
    } else {
      navigate('/sessions');
    }
  };

  const isConnecting = connectionStatus === ConnectionStatus.CONNECTING;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">New Session</h1>
          {isRecording && (
            <p className="text-sm text-slate-500 mt-0.5">
              {tripContextLabel(tripContext)}
            </p>
          )}
        </div>
        {isRecording && (
          <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Recording
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Waveform / bot speaking indicator */}
      {botSpeaking && (
        <div className="flex justify-center gap-1 py-4">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="w-1.5 bg-blue-400 rounded-full animate-pulse"
              style={{
                height: `${12 + Math.sin(i * 0.8) * 10}px`,
                animationDelay: `${i * 60}ms`,
              }}
            />
          ))}
        </div>
      )}

      {/* Transcript feed */}
      {messages.length > 0 && (
        <TranscriptFeed messages={messages} />
      )}

      {/* Start / Stop button */}
      <div className="flex justify-center pt-4">
        {!isRecording ? (
          <button
            onClick={() => startSession()}
            disabled={isConnecting}
            className="w-32 h-32 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white shadow-lg transition-all active:scale-95 flex flex-col items-center justify-center gap-1"
          >
            {isConnecting ? (
              <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span className="text-3xl">🎙️</span>
                <span className="text-sm font-semibold">Start</span>
              </>
            )}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="w-32 h-32 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg transition-all active:scale-95 flex flex-col items-center justify-center gap-1"
          >
            <span className="text-3xl">⏹️</span>
            <span className="text-sm font-semibold">Stop</span>
          </button>
        )}
      </div>

      {!isRecording && messages.length === 0 && !error && (
        <p className="text-center text-slate-400 text-sm">
          Tap to start talking with CarBot
        </p>
      )}
    </div>
  );
}
