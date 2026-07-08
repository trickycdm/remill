import { describe, it, expect, vi, afterEach } from 'vitest';
import { getEmailTransport, ResendEmailTransport, ConsoleEmailTransport } from '@/lib/email';

const MSG = { to: 'stu@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };

afterEach(() => vi.unstubAllGlobals());

describe('getEmailTransport (D20) — selection + precedence', () => {
  it('degrades to the console stub without a key, without a from, or with nothing', () => {
    expect(getEmailTransport().kind).toBe('console');
    expect(getEmailTransport({ RESEND_API_KEY: 'k' }).kind).toBe('console'); // key but no from
    expect(getEmailTransport({ EMAIL_FROM: 'a@b.co' }).kind).toBe('console'); // from but no key
    expect(getEmailTransport({ RESEND_API_KEY: 'k' }, { emailFrom: '  ' }).kind).toBe('console'); // blank from
  });

  it('selects Resend when key + from are present; settings.emailFrom beats env.EMAIL_FROM', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const t = getEmailTransport({ RESEND_API_KEY: 'rk_test', EMAIL_FROM: 'env@from.co' }, { emailFrom: 'bot@colmack.com' });
    expect(t.kind).toBe('resend');
    await t.send(MSG);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer rk_test');
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({ from: 'bot@colmack.com', to: ['stu@example.com'], subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' });
  });

  it('falls back to env.EMAIL_FROM when settings has none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getEmailTransport({ RESEND_API_KEY: 'rk', EMAIL_FROM: 'env@from.co' }, {}).send(MSG);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).from).toBe('env@from.co');
  });

  it('a non-2xx send logs and does NOT throw (delivery is best-effort)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })));
    await expect(new ResendEmailTransport('rk', 'a@b.co').send(MSG)).resolves.toBeUndefined();
  });

  it('the console stub never touches the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await new ConsoleEmailTransport().send(MSG);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
