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
 * The Settings recap-email control in both states of the email switch (#36):
 * a working toggle when email features are on, a "Currently off" notice with
 * no toggle when they are off.
 *
 * Plain DOM assertions: the jest-dom matchers are loaded at runtime by
 * setup.ts but are not typed for vitest in this repo.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmailSummariesControl } from '../components/settings/EmailSummariesControl';
import { EMAIL_FEATURES_ENABLED } from '../config/features';

describe('EmailSummariesControl', () => {
  it('shows "Currently off" and no toggle when email features are off', () => {
    const onChange = vi.fn();
    render(<EmailSummariesControl value={true} onChange={onChange} featureEnabled={false} />);

    expect(screen.getByText('Currently off')).not.toBeNull();
    expect(screen.getByText(/not sending recap emails/i)).not.toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('Enabled')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the toggle and reports changes when email features are on', () => {
    const onChange = vi.fn();
    render(<EmailSummariesControl value={true} onChange={onChange} featureEnabled={true} />);

    expect(screen.queryByText('Currently off')).toBeNull();
    expect(screen.getByText('Enabled')).not.toBeNull();
    const toggle = screen.getByRole('switch', { name: 'Session summary emails' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('reflects a stored "disabled" preference when the feature is on', () => {
    render(<EmailSummariesControl value={false} onChange={() => {}} featureEnabled={true} />);
    expect(screen.getByText('Disabled')).not.toBeNull();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  });

  it('defaults to the build-time switch, which is off without the Vite define', () => {
    expect(EMAIL_FEATURES_ENABLED).toBe(false);
    render(<EmailSummariesControl value={true} onChange={() => {}} />);
    expect(screen.getByTestId('email-summaries-off')).not.toBeNull();
  });
});
