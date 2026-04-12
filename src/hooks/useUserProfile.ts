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
 * Hook for reading and writing the CarBot user profile.
 */

import { useState, useEffect } from 'react';
import { getUserProfile } from '../services/userProfile';
import type { CarbotUserProfile } from '../types';

export interface UseUserProfileReturn {
  profile: CarbotUserProfile | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUserProfile(uid: string | null): UseUserProfileReturn {
  const [profile, setProfile] = useState<CarbotUserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!uid) {
      setProfile(null);
      return;
    }
    setLoading(true);
    setError(null);
    getUserProfile(uid)
      .then(setProfile)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [uid, tick]);

  return {
    profile,
    loading,
    error,
    refetch: () => setTick((t) => t + 1),
  };
}
