import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Infrastructure adapter tests (Infrastructure Activation): the Resend email provider
 * and the S3-compatible storage adapter. Both use fetch, which is mocked — no network,
 * no real credentials. We assert the request shape, that secrets are never logged, and
 * that the production guard refuses the mock email provider.
 */

describe('ResendEmailProvider', () => {
  const OLD = { ...process.env };
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { process.env = { ...OLD }; });

  it('posts to the Resend API with the from/to/subject and never logs the key', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'test_key_should_not_leak';
    process.env.EMAIL_FROM = 'BIINA <no-reply@biina.ai>';
    const { getEmailService, _resetEmailService } = await import('@/server/email');
    _resetEmailService();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }));
    await getEmailService().send({ to: 'user@example.com', subject: 'Verify your BIINA email', text: 'link' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.from).toContain('biina.ai');
    expect(body.to).toEqual(['user@example.com']);
    // The Authorization header carries the key but the payload/log never should.
    expect(JSON.stringify(body)).not.toContain('test_key_should_not_leak');
    _resetEmailService();
  });

  it('throws if resend is selected without key/from', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    delete process.env.RESEND_API_KEY;
    const { getEmailService, _resetEmailService } = await import('@/server/email');
    _resetEmailService();
    expect(() => getEmailService()).toThrow();
    _resetEmailService();
  });

  it('production refuses the mock/dev email provider', async () => {
    process.env.EMAIL_PROVIDER = 'dev';
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.ALLOW_DEV_FEATURES_IN_PROD;
    const { getEmailService, _resetEmailService } = await import('@/server/email');
    _resetEmailService();
    expect(() => getEmailService()).toThrow();
    _resetEmailService();
    vi.unstubAllEnvs();
  });
});

describe('S3FileStorage (SigV4)', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; vi.restoreAllMocks(); });

  async function s3() {
    process.env.FILE_STORAGE_PROVIDER = 's3';
    process.env.S3_ENDPOINT = 'https://proj.supabase.co/storage/v1/s3';
    process.env.S3_BUCKET = 'biina-files';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY_ID = 'akid';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    const mod = await import('@/server/rag/storage');
    mod._resetFileStorage();
    return mod;
  }

  it('selects the S3 adapter and signs requests with a path-style URL', async () => {
    const mod = await s3();
    const seen: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(new Uint8Array([1, 2, 3]), { status: 200 }); }));
    const store = mod.getFileStorage();
    expect(store.name).toBe('s3');
    const put = await store.put(Buffer.from('hello'), { extension: 'txt' });
    expect(put.storageKey).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{32}\.txt$/);
    // Path-style: endpoint/bucket/key
    expect(seen[0].url).toContain('/storage/v1/s3/biina-files/');
    const auth = (seen[0].init.headers as Record<string, string>).authorization;
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=akid\/\d{8}\/us-east-1\/s3\/aws4_request/);
    expect(auth).toContain('SignedHeaders=');
    expect(auth).toContain('Signature=');
    // The secret key itself never appears in the header.
    expect(auth).not.toContain('secret');
    mod._resetFileStorage();
  });

  it('reads bytes back and treats delete as idempotent (404 ok)', async () => {
    const mod = await s3();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') return new Response(new Uint8Array([9, 9]), { status: 200 });
      return new Response('', { status: 404 });
    }));
    const store = mod.getFileStorage();
    const buf = await store.get('ab/abcdef.txt');
    expect(buf.length).toBe(2);
    await expect(store.delete('ab/abcdef.txt')).resolves.toBeUndefined(); // 404 → no throw
    mod._resetFileStorage();
  });
});
