import { describe, it, expect } from 'vitest';
import { shareNotificationEmail, inviteEmail, teamJoinEmail } from '@/lib/email/templates';

const URL = 'https://remill.example/s/rms_abc123';

describe('email templates (D20) — escaped, branded, link in html + text', () => {
  it('every template carries the link in both html and text', () => {
    for (const rendered of [
      shareNotificationEmail({ url: URL, siteName: 'My Site' }),
      inviteEmail({ link: URL, siteName: 'My Site' }),
      teamJoinEmail({ link: URL, teamName: 'Tech team', siteName: 'My Site' }),
    ]) {
      expect(rendered.html).toContain(`href="${URL}"`);
      expect(rendered.text).toContain(URL);
      expect(rendered.subject.length).toBeGreaterThan(0);
      // The working-ink accent drives the CTA button (the Overprint light
      // palette, mirrored by hand — this pin is the drift tripwire, D43).
      expect(rendered.html).toContain('#0078bf');
    }
  });

  it('XSS: user-authored names are entity-escaped, never emitted as markup', () => {
    const evil = teamJoinEmail({ link: URL, teamName: '<script>alert(1)</script>', siteName: '<img src=x>' });
    expect(evil.html).not.toContain('<script>');
    expect(evil.html).not.toContain('<img src=x>');
    expect(evil.html).toContain('&lt;script&gt;');
  });

  it('defaults the site name to remill', () => {
    expect(inviteEmail({ link: URL }).subject).toContain('remill');
  });
});
