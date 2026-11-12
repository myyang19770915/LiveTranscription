// Runs every bench/*check.js (front-end rule checks, no browser or services needed) and exits 1 if any of them failed.
// node bench/checks.js
const {spawnSync}=require('child_process'),fs=require('fs'),path=require('path');
const dir=path.resolve(process.argv[2]||__dirname);   // another folder only to test this runner itself
const checks=fs.readdirSync(dir).filter(f=>/check\.js$/.test(f)&&f!=='checks.js').sort();
let failed=0;
for(const file of checks){
  // catalogcheck groups by local day: run in the team's time zone like the server does.
  const run=spawnSync(process.execPath,[path.join(dir,file)],{encoding:'utf8',env:{...process.env,TZ:process.env.TZ||'Asia/Taipei'}});
  const out=`${run.stdout||''}${run.stderr||''}`;
  const ok=(out.match(/^ok\b/gm)||[]).length,fail=(out.match(/^FAIL\b/gm)||[]).length;
  const good=run.status===0&&fail===0;
  if(!good){failed++;process.stdout.write(out)}
  console.log(`${good?'ok  ':'FAIL'} ${file}: ${ok} ok, ${fail} FAIL, exit ${run.status}`);
}
console.log(failed?`${failed} of ${checks.length} checks failed`:`all ${checks.length} checks passed`);
if(failed)process.exitCode=1;
