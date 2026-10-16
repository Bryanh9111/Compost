import {Command} from '@commander-js/extra-typings';
import {Database} from 'bun:sqlite';
import {existsSync} from 'fs';
import {join} from 'path';
import {homedir} from 'os';
import {applyMigrations} from '../../../compost-core/src/schema/migrator';
import {maintainLedger} from '../maintenance';
import {assertDaemonStopped, consolidateVectors} from '../maintenance-vectors';
import {backfillChunks, type BackfillVectorSource} from '../maintenance-chunks';

async function openVectors(dir:string):Promise<(BackfillVectorSource&{close():Promise<void>})|null>{
  const lanceDir=join(dir,'lancedb');if(!existsSync(lanceDir))return null;
  const {OllamaEmbeddingService}=await import('../../../compost-core/src/embedding/ollama');
  const {VectorStore}=await import('../../../compost-core/src/storage/lancedb');
  const store=new VectorStore(lanceDir,new OllamaEmbeddingService());await store.connect();return store;
}

export function registerMaintenance(program:Command){
  program.command('maintenance').description('Preview explicit ledger repairs; --apply verifies a backup before changing data')
    .option('--scrub-pii','Redact captured text and materialized copies')
    .option('--repair-access-log','Remove only access rows referencing missing facts')
    .option('--backfill-actions','Lift missing observation actions')
    .option('--consolidate-vectors','Rebuild the LanceDB index from the live table (plus --include-previous dirs) without re-embedding; daemon must be stopped')
    .option('--include-previous <dir...>','Older LanceDB directories to merge behind the live index')
    .option('--backfill-chunks','Re-derive missing chunk manifest rows from stored raw bytes; daemon must be stopped')
    .option('--concurrency <n>','Parallel extractions for --backfill-chunks',(v)=>Number(v),1)
    .option('--limit <n>','Process at most n candidates for --backfill-chunks',(v)=>Number(v))
    .option('--apply','Apply selected repairs after a verified private backup',false)
    .action(async(opts)=>{
      const ledgerRepair=opts.scrubPii||opts.repairAccessLog||opts.backfillActions;
      if(!ledgerRepair&&!opts.consolidateVectors&&!opts.backfillChunks)throw new Error('select a repair option');
      const dir=process.env.COMPOST_DATA_DIR??join(homedir(),'.compost');
      const db=new Database(join(dir,'ledger.db'));
      try{
        db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
        const migration=applyMigrations(db);if(migration.errors.length)throw new Error('migration failed');
        // Ledger repair fields stay top-level for existing consumers; index ops nest.
        const report:Record<string,unknown>=ledgerRepair?{...maintainLedger(db,{...opts,backupDir:join(dir,'backups')})}:{};
        if(opts.consolidateVectors){
          if(opts.apply)assertDaemonStopped(dir);
          report.vectors=await consolidateVectors(db,{dataDir:dir,includePrevious:opts.includePrevious,apply:opts.apply});
        }
        if(opts.backfillChunks){
          if(opts.apply)assertDaemonStopped(dir);
          const vectors=opts.apply?await openVectors(dir):null;
          try{report.chunks=await backfillChunks(db,{apply:opts.apply,concurrency:opts.concurrency,limit:opts.limit,vectors});}
          finally{await vectors?.close();}
        }
        process.stdout.write(JSON.stringify(report,null,2)+'\n');
      }finally{db.close();}
    });
}
