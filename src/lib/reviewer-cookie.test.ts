import { describe, it, expect } from 'vitest';
import { signReviewer, verifyReviewer } from './reviewer-cookie';

const SECRET = 'x'.repeat(32);

describe('reviewer cookie (D55)', () => {
  it('round-trips a reviewer id for its own grant', async () => {
    const v = await signReviewer(SECRET, 'grn_a', 'rvw_1');
    expect(await verifyReviewer(SECRET, 'grn_a', v)).toBe('rvw_1');
  });

  it('is no identity on another grant, with another secret, or when tampered', async () => {
    const v = await signReviewer(SECRET, 'grn_a', 'rvw_1');
    expect(await verifyReviewer(SECRET, 'grn_b', v)).toBeUndefined();
    expect(await verifyReviewer('y'.repeat(32), 'grn_a', v)).toBeUndefined();
    expect(await verifyReviewer(SECRET, 'grn_a', v.replace('rvw_1', 'rvw_2'))).toBeUndefined();
    expect(await verifyReviewer(SECRET, 'grn_a', 'garbage')).toBeUndefined();
    expect(await verifyReviewer(SECRET, 'grn_a', undefined)).toBeUndefined();
  });
});
