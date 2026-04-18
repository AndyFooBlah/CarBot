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
 * CarBot application router.
 *
 * Routes:
 *   /         → /sessions (redirect)
 *   /login    → LoginScreen (public)
 *   /sessions → SessionList (auth-guarded via Layout)
 *   /sessions/new → SessionView (auth-guarded via Layout)
 *   /sessions/:id → SessionDetail (auth-guarded via Layout)
 *   /context  → ContextLibrary (auth-guarded)
 *   /memories → MemoryBrowser (auth-guarded)
 *   /settings → SettingsPage (auth-guarded)
 *   /diagnostics → DiagnosticsPage (auth-guarded)
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { Layout } from './components/shared/Layout';
import { LoginScreen } from './components/auth/LoginScreen';
import { SessionList } from './components/history/SessionList';
import { SessionDetail } from './components/history/SessionDetail';
import { SessionView } from './components/session/SessionView';
import { ContextLibrary } from './components/context/ContextLibrary';
import { MemoryBrowser } from './components/memories/MemoryBrowser';
import { SettingsPage } from './components/settings/SettingsPage';
import { DiagnosticsPage } from './components/diagnostics/DiagnosticsPage';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
          <Route path="/login" element={<LoginScreen />} />

          {/* Auth-guarded routes inside Layout */}
          <Route element={<Layout />}>
            <Route path="/sessions" element={<SessionList />} />
            <Route path="/sessions/new" element={<SessionView />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
            <Route path="/context" element={<ContextLibrary />} />
            <Route path="/memories" element={<MemoryBrowser />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
