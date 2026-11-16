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

import { EMAIL_FEATURES_ENABLED } from '../../config/features';

/**
 * The "Session summary emails" control in Settings → Profile.
 *
 * With email features on it is the per-user toggle for the recap email. With
 * them off (the current state, issue #36) no recap can be sent whatever the
 * toggle says, so the toggle is replaced by a "Currently off" notice. The
 * stored `emailSummariesEnabled` preference is left untouched and applies
 * again when email is switched back on.
 *
 * `featureEnabled` defaults to the build-time switch; it is a prop only so
 * tests can render both states.
 */
export function EmailSummariesControl({
  value,
  onChange,
  featureEnabled = EMAIL_FEATURES_ENABLED,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  featureEnabled?: boolean;
}) {
  if (!featureEnabled) {
    return (
      <div className="flex items-start gap-3" data-testid="email-summaries-off">
        <span className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
          Currently off
        </span>
        <p className="text-sm text-slate-500">
          CarBot is not sending recap emails at the moment. Session summaries and transcripts are still saved
          and available under History.
        </p>
      </div>
    );
  }

  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label="Session summary emails"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-slate-300'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
      <span className="text-sm text-slate-600">{value ? 'Enabled' : 'Disabled'}</span>
    </label>
  );
}
