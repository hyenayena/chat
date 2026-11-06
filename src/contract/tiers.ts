export const TIERS = ['light', 'standard', 'strong', 'max'] as const;
export type Tier = (typeof TIERS)[number];

export const isTier = (v: unknown): v is Tier => TIERS.includes(v as Tier);
export const tierRank = (t: Tier): number => TIERS.indexOf(t);
export const maxTier = (a: Tier, b: Tier): Tier => (tierRank(a) >= tierRank(b) ? a : b);
