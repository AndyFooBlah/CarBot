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
 * User profile service.
 *
 * Reads and writes the CarBot user profile document at `users/{uid}`,
 * including the Routine and LocationConfig sub-objects.
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@andyfooblah/voicecommon';
import type { CarbotUserProfile, Routine, LocationConfig } from '../types';

/** Fetch the user profile. Returns null if the document does not exist. */
export async function getUserProfile(uid: string): Promise<CarbotUserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  return snap.data() as CarbotUserProfile;
}

/** Create the initial user profile on first sign-in. */
export async function createUserProfile(
  uid: string,
  email: string,
  displayName: string,
): Promise<void> {
  const existing = await getDoc(doc(db, 'users', uid));
  if (existing.exists()) return;

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const profile: Omit<CarbotUserProfile, 'routine' | 'locations' | 'childName'> = {
    email,
    displayName,
    createdAt: Timestamp.now(),
    timezone,
    emailSummariesEnabled: true,
  };
  await setDoc(doc(db, 'users', uid), profile);
}

/** Update the routine configuration. */
export async function saveRoutine(uid: string, routine: Routine): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { routine });
}

/** Update the location configuration. */
export async function saveLocationConfig(uid: string, locations: LocationConfig): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { locations });
}

/** Update the child's name (used in transcript speaker labels). */
export async function saveChildName(uid: string, childName: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { childName });
}

/** Update the email summaries enabled setting. */
export async function saveEmailSummariesEnabled(
  uid: string,
  enabled: boolean,
): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { emailSummariesEnabled: enabled });
}
