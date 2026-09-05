import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {applyMigrations} from '../src/schema/migrator';
import {summarizeActionTimeline} from '../src/metacognitive/action-timeline';
test('timeline compares actual UTC instants across space, Z and offset formats',()=>{
 const db=new Database(':memory:');applyMigrations(db);
 try{
  for(const [i,ts] of ['2026-08-31 01:00:00','2026-08-31T02:00:00Z','2026-08-30T23:30:00-04:00','2026-09-07 00:00:00'].entries())
   db.run('INSERT INTO action_log(action_id,source_system,source_id,who,what_text,when_ts) VALUES (?,\'manual\',?,\'user\',\'test\',?)',[String(i),String(i),ts]);
  const r=summarizeActionTimeline(db,'this week',{now:new Date('2026-09-05T00:00:00Z')});
  expect(r.action_count).toBe(3);expect(r.actions.map(a=>a.action_id)).toEqual(['2','1','0']);
  expect(r.days).toHaveLength(1);
 }finally{db.close();}
});
