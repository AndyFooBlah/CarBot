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
 * CarBot application entry point.
 *
 * Initializes VoiceCommon (voice infrastructure) and KnowledgeCommon (knowledge
 * tools) with CarBot's Firebase and API key configuration, then mounts the React
 * app. Both must be called before any Firebase services, hooks, or tools are used.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { initializeVoiceCommon, db } from '@andyfooblah/voice-common';
import { initializeKnowledgeCommon } from '@andyfooblah/knowledge-common';
import { proxyGetWeather, proxySearchPlace, proxyGetDistanceBetweenPlaces, proxyCacheWikipediaArticle } from './services/geoProxy';
import { mintGeminiLiveToken, invokeGemini, embedGemini } from './services/geminiBroker';

initializeVoiceCommon({
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  },
  // VoiceCommon's useSession calls tokenProvider() to obtain a single-use
  // ephemeral Gemini Live token from our server-side broker — the long-lived
  // GEMINI_API_KEY never reaches the browser.
  tokenProvider: mintGeminiLiveToken,
});

initializeKnowledgeCommon({
  // KnowledgeCommon 1.0 routes every internal Gemini call through this broker
  // (server-side Cloud Function callables that hold GEMINI_API_KEY in Firebase
  // Secret Manager). The long-lived key never reaches the browser.
  gemini: { invokeGemini, embedContent: embedGemini },
  firestore: db,
  // Maps and Weather APIs don't allow browser CORS; route through geoProxy Cloud Function.
  toolOverrides: {
    getWeather: proxyGetWeather,
    searchPlace: proxySearchPlace,
    getDistanceBetweenPlaces: proxyGetDistanceBetweenPlaces,
  },
  cacheWikipediaArticle: proxyCacheWikipediaArticle,
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
