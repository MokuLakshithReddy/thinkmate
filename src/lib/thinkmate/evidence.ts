export type Verification = 'unassessed' | 'supported' | 'contradicted' | 'mixed';

// 'supported' only means supporting evidence exists, not that the claim is proven
export function verificationOf(relations: string[]): Verification {
  const s = relations.includes('supports');
  const c = relations.includes('contradicts');
  return s && c ? 'mixed' : s ? 'supported' : c ? 'contradicted' : 'unassessed';
}
