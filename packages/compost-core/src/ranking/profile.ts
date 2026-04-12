import type { Database } from "bun:sqlite";

export interface RankingProfile {
  profile_id: string;
  name: string;
  w1_semantic: number;
  w2_temporal: number;
  w3_access: number;
  w4_importance: number;
  w5_emotional: number;
  w6_repetition_penalty: number;
  w7_context_mismatch: number;
  access_saturation: number;
}

/**
 * Load a ranking profile from the database.
 * Falls back to rp-phase1-default if not found.
 */
export function loadRankingProfile(
  db: Database,
  profileId: string = "rp-phase1-default"
): RankingProfile {
  const row = db
    .query(
      `SELECT profile_id, name, w1_semantic, w2_temporal, w3_access, w4_importance,
              w5_emotional, w6_repetition_penalty, w7_context_mismatch, access_saturation
       FROM ranking_profile WHERE profile_id = ? AND superseded_by IS NULL`
    )
    .get(profileId) as RankingProfile | null;

  if (!row) {
    throw new Error(
      `Ranking profile '${profileId}' not found. Check ranking_profile table.`
    );
  }

  return row;
}
