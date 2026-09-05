import {Command} from '@commander-js/extra-typings';
import {Database} from 'bun:sqlite';
import {join} from 'path';
import {homedir} from 'os';
import {applyMigrations} from '../../../compost-core/src/schema/migrator';
import {maintainLedger} from '../maintenance';

export function registerMaintenance(program:Command){
  program.command('maintenance').description('Preview explicit ledger repairs; --apply verifies a backup before changing data')
    .option('--scrub-pii','Redact captured text and materialized copies')
    .option('--repair-access-log','Remove only access rows referencing missing facts')
    .option('--backfill-actions','Lift missing observation actions')
    .option('--apply','Apply selected repairs after a verified private backup',false)
    .action((opts)=>{
      if(!opts.scrubPii&&!opts.repairAccessLog&&!opts.backfillActions)throw new Error('select a repair option');
      const dir=process.env.COMPOST_DATA_DIR??join(homedir(),'.compost');
      const db=new Database(join(dir,'ledger.db'));
      try{
        db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
        const migration=applyMigrations(db);if(migration.errors.length)throw new Error('migration failed');
        const report=maintainLedger(db,{...opts,backupDir:join(dir,'backups')});
        process.stdout.write(JSON.stringify(report,null,2)+'\n');
      }finally{db.close();}
    });
}
