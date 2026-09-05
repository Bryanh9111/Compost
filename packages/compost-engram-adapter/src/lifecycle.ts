import type { Database } from 'bun:sqlite';
import { engramStateSchema, type EngramStreamClient } from './stream-puller';

/** Optional background reconciliation. Failures preserve cached local availability. */
export async function reconcileUpstreamStates(db: Database, client: EngramStreamClient): Promise<string[]> {
  if (!client.statesForCompost) return [];
  const rows = db.query(`SELECT DISTINCT substr(o.source_uri, 17) AS memory_id
    FROM observations o JOIN facts f USING(observe_id)
    WHERE o.adapter='engram' AND o.source_uri LIKE 'engram://memory/%' AND f.archived_at IS NULL`).all() as {memory_id:string}[];
  const errors: string[] = [];
  for (let i=0; i<rows.length; i+=1000) {
    const ids = rows.slice(i,i+1000).map(r=>r.memory_id);
    try {
      const result = await client.statesForCompost(ids);
      if (!result.ok) throw new Error(result.error ?? 'state request failed');
      const states = engramStateSchema.array().parse(result.data);
      // Incomplete/foreign responses must never be interpreted as deletion.
      const returned = new Set(states.map(s=>s.memory_id));
      if (states.length !== ids.length || returned.size !== ids.length || ids.some(id=>!returned.has(id))) {
        throw new Error('incomplete upstream lifecycle response');
      }
      db.transaction(()=>{
        for (const state of states) {
          if (state.searchable) continue;
          const changed = db.run(`UPDATE facts SET archived_at=datetime('now'), archive_reason='stale'
            WHERE archived_at IS NULL AND observe_id IN
            (SELECT observe_id FROM observations WHERE adapter='engram' AND source_uri=?)`, [`engram://memory/${state.memory_id}`]);
          if (changed.changes) db.run(`INSERT INTO maintenance_audit(operation,target_table,target_id,detail_json)
            VALUES ('upstream-invalidation','facts',?,?)`,[state.memory_id,JSON.stringify({status:state.status,expires_at:state.expires_at,facts:changed.changes})]);
        }
      })();
    } catch (error) { errors.push(`Engram lifecycle: ${String(error)}`); }
  }
  return errors;
}
