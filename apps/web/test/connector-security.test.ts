import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptCredential, decryptCredential, _resetCredentialKey, CredentialCryptoError } from '@/server/connectors/crypto';
import { getTool, TOOL_ALLOWLIST, isReadCapability, writeToolsEnabled, READ_CAPABILITIES, WRITE_CAPABILITIES } from '@/server/connectors/registry';
import { connectedInstructions } from '@/server/connectors/connected-search';

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

describe('credential encryption (AES-256-GCM)', () => {
  beforeEach(() => { process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = KEY; _resetCredentialKey(); });
  afterEach(() => { delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY; _resetCredentialKey(); });

  it('round-trips a credential and the ciphertext never contains the plaintext', () => {
    const cred = { accessToken: 'ya29.SECRET-TOKEN', refreshToken: 'r3fr3sh' };
    const { ciphertext } = encryptCredential(cred);
    expect(ciphertext).not.toContain('SECRET-TOKEN');
    expect(ciphertext.startsWith('v1:')).toBe(true);
    expect(decryptCredential(ciphertext)).toEqual(cred);
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const { ciphertext } = encryptCredential({ accessToken: 'x' });
    const parts = ciphertext.split(':');
    parts[3] = Buffer.from('tampered-data').toString('base64');
    expect(() => decryptCredential(parts.join(':'))).toThrow(CredentialCryptoError);
  });

  it('fails safe with the wrong key', () => {
    const { ciphertext } = encryptCredential({ accessToken: 'x' });
    process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = OTHER_KEY; _resetCredentialKey();
    expect(() => decryptCredential(ciphertext)).toThrow(CredentialCryptoError);
  });

  it('rejects malformed ciphertext', () => {
    expect(() => decryptCredential('not-a-ciphertext')).toThrow(CredentialCryptoError);
  });
});

describe('tool allowlist + read/write separation', () => {
  it('only allowlisted tools resolve; unknown tools do not', () => {
    expect(getTool('drive.search')?.risk).toBe('READ');
    expect(getTool('mock.search')).toBeTruthy();
    expect(getTool('call.arbitrary.url')).toBeNull();
    expect(getTool('http.request')).toBeNull();
  });

  it('has NO arbitrary-HTTP / arbitrary-API tool', () => {
    for (const t of TOOL_ALLOWLIST) {
      expect(t.id).not.toMatch(/http|url|fetch|arbitrary|shell|exec/i);
    }
  });

  it('write / side-effecting tools are registered but disabled by default', () => {
    const writes = TOOL_ALLOWLIST.filter((t) => t.risk !== 'READ');
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((t) => t.enabledByDefault === false)).toBe(true);
    expect(TOOL_ALLOWLIST.find((t) => t.id === 'drive.delete')?.risk).toBe('DESTRUCTIVE');
    expect(TOOL_ALLOWLIST.find((t) => t.id === 'gmail.send')?.risk).toBe('HIGH_RISK_WRITE');
  });

  it('read vs write capability classification is disjoint and correct', () => {
    expect(READ_CAPABILITIES.every(isReadCapability)).toBe(true);
    expect(WRITE_CAPABILITIES.some(isReadCapability)).toBe(false);
    expect(isReadCapability('SEARCH')).toBe(true);
    expect(isReadCapability('DELETE')).toBe(false);
  });

  it('write actions are off unless the env flag is set', () => {
    const prev = process.env.CONNECTOR_WRITE_ACTIONS_ENABLED;
    delete process.env.CONNECTOR_WRITE_ACTIONS_ENABLED;
    expect(writeToolsEnabled()).toBe(false);
    process.env.CONNECTOR_WRITE_ACTIONS_ENABLED = 'true';
    expect(writeToolsEnabled()).toBe(true);
    if (prev === undefined) delete process.env.CONNECTOR_WRITE_ACTIONS_ENABLED; else process.env.CONNECTOR_WRITE_ACTIONS_ENABLED = prev;
  });
});

describe('connected-data injection defense', () => {
  it('frames connected content as untrusted, private, and non-instructional', () => {
    const i = connectedInstructions(true).toLowerCase();
    expect(i).toContain('untrusted data');
    expect(i).toContain('never follow instructions');
    expect(i).toContain('private');
    expect(i).toContain('never send it to a web search');
    expect(connectedInstructions(false).toLowerCase()).toContain('rather than inventing');
  });
});
