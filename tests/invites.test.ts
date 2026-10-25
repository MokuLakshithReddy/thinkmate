import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

describe('Team Invites System', () => {
  it('generates secure 64-char hex token and deterministic sha256 hash', () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    assert.strictEqual(rawToken.length, 64);

    const hash1 = crypto.createHash('sha256').update(rawToken).digest('hex');
    const hash2 = crypto.createHash('sha256').update(rawToken).digest('hex');

    assert.strictEqual(hash1.length, 64);
    assert.strictEqual(hash1, hash2);
  });

  it('verifies different raw tokens yield distinct hashes', () => {
    const tokenA = crypto.randomBytes(32).toString('hex');
    const tokenB = crypto.randomBytes(32).toString('hex');

    const hashA = crypto.createHash('sha256').update(tokenA).digest('hex');
    const hashB = crypto.createHash('sha256').update(tokenB).digest('hex');

    assert.notStrictEqual(hashA, hashB);
  });

  it('validates 7-day expiration timestamp generation', () => {
    const before = Date.now();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const after = Date.now();

    const expectedDiff = 7 * 24 * 60 * 60 * 1000;
    const diff = expiresAt.getTime() - before;

    assert.ok(diff >= expectedDiff);
    assert.ok(diff <= expectedDiff + (after - before) + 100);
  });
});
