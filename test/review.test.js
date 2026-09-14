import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyseImage, optimizeImage } from '../src/images.js';
import { analyseAudio } from '../src/audio.js';
import { run } from '../src/run.js';
import { app } from '../src/server.js';
sharp.cache(false);
const dir = await mkdtemp(join(tmpdir(), 'asset-review-'));
const make = async (name, pipeline) => { const f = join(dir, name); await pipeline.toFile(f); return f; };
const solid = (alpha = 1) => sharp({create:{width:64,height:64,channels:4,background:{r:200,g:30,b:70,alpha}}});

test('exact alpha including palette PNGs and near-opaque pixels', async () => {
  for (const palette of [false,true]) for (const alpha of [1,254/255,250/255,0]) {
    const f = await make(`alpha-${palette}-${alpha}.png`,solid(alpha).png({palette}));
    const a = await analyseImage(f,'general');
    assert.equal(a.unusedAlpha, a.hasAlpha && alpha === 1);
  }
});
test('orientation resize and ICC preservation',async()=>{
  const f=await make('oriented.jpg',sharp({create:{width:2500,height:1200,channels:3,background:'red'}}).withMetadata({orientation:6}).jpeg());
  const a=await analyseImage(f,'mobile'); assert.equal(a.width,1200); assert.equal(a.height,2500);
  const r=await optimizeImage(a,join(dir,'oriented-out'),dir,'mobile');
  assert.ok(!r.skipped); const m=await sharp(r.outFile).metadata(); assert.equal(m.height,1024); assert.ok(m.width<1024); assert.ok(m.icc); assert.equal(m.orientation,undefined);
});
test('high-depth, CMYK, disguised GIF and APNG are skipped',async()=>{
  const files=[await make('deep.png',solid().toColourspace('rgb16').png()),await make('cmyk.jpg',solid().toColourspace('cmyk').jpeg()),await make('gif.png',solid().gif())];
  const png=await solid().png().toBuffer(); const chunk=Buffer.alloc(20);chunk.writeUInt32BE(8);chunk.write('acTL',4);chunk.writeUInt32BE(2,8);
  const apng=join(dir,'anim.png'); await writeFile(apng,Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)]));files.push(apng);
  for(const f of files){const a=await analyseImage(f,'web');assert.ok(a.skipReason||a.error,JSON.stringify(a));if(a.skipReason) assert.equal((await optimizeImage(a,dir,dir,'web')).skipped,true);}
});
test('small palettes are not called photos; larger conversions are skipped',async()=>{
 const f=await make('pixel.png',sharp({create:{width:600,height:600,channels:3,background:'blue'}}).png({palette:true}));
 const a=await analyseImage(f,'unity');assert.ok(!a.findings.some(x=>x.code==='png-photo'));
 const r=await optimizeImage({...a,size:1},join(dir,'larger'),dir,'web');assert.equal(r.skipped,true);
});
test('output safety, input collisions, repeat scanning and concurrency bounds',async()=>{
 const root=join(dir,'root');await mkdir(root,{recursive:true});
 for(const ext of ['png','jpg']) await sharp({create:{width:2400,height:1200,channels:3,background:'red'}}).toFormat(ext==='jpg'?'jpeg':'png').toFile(join(root,`a.${ext}`));
 for(const concurrency of [0,-1,1.5,9,NaN]) await assert.rejects(run(root,{concurrency}),/concurrency/);
 await assert.rejects(run(root,{preset:'__proto__'}),/unknown preset/);
 await assert.rejects(run(root,{outDir:root}),/output/);
 const out=join(root,'result');const r=await run(root,{outDir:out,preset:'mobile'});assert.equal(r.totals.errors,0);assert.equal(new Set(r.items.map(x=>x.result.outFile)).size,2);
 await assert.rejects(run(root,{outDir:out}),/EEXIST/);
 assert.equal((await run(root,{outDir:out,dryRun:true})).totals.files,2);
 await symlink(root,join(root,'loop'),'junction'); assert.equal((await run(root,{outDir:out,dryRun:true})).totals.files,2);
 const original=await readFile(join(root,'a.png'));assert.ok(original.length>0);
});
test('unreadable assets return per-file errors and do not abort batch',async()=>{
 const root=join(dir,'broken');await mkdir(root);await writeFile(join(root,'bad.png'),'nope');await writeFile(join(root,'bad.wav'),'RIFF');
 const r=await run(root,{dryRun:true});assert.equal(r.totals.errors,2);
 assert.ok((await analyseAudio(join(root,'missing.wav'),'general')).error);
});
test('Discord and Steam role findings are scoped',async()=>{
 const f=await make('sticker.png',solid().png());assert.ok((await analyseImage(f,'discord')).findings.some(x=>x.code==='discord-size'));
 assert.ok(!(await analyseImage(f,'steam')).findings.some(x=>x.code==='steam-size'));
});
test('server rejects cross-origin, rebound hosts, invalid types and large bodies; no-store',async()=>{
 const request=(headers,body={folder:dir,dryRun:true})=>app.request('http://localhost:3000/api/run',{method:'POST',headers:{host:'localhost:3000','content-type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await request({origin:'https://evil.example'})).status,403);
 assert.equal((await request({origin:'http://evil.example',host:'evil.example'})).status,403);
 assert.equal((await request({})).status,403);
 for(const body of [{folder:dir,preset:'constructor'},{folder:dir,out:{}},{folder:dir,dryRun:'false'}]) assert.equal((await request({origin:'http://localhost:3000'},body)).status,400);
 assert.equal((await request({origin:'http://localhost:3000'},{folder:'x'.repeat(9000)})).status,413);
 const r=await request({origin:'http://localhost:3000'},{folder:join(dir,'broken'),dryRun:true});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
});

test('pixel bound rejects oversized decoded images',async()=>{
 const f=await make('huge.png',sharp({create:{width:4097,height:4097,channels:3,background:'black'}}).png());
 assert.match((await analyseImage(f,'general')).error,/pixel limit/i);
});
test('animated WebP is skipped',async()=>{
 const header=Buffer.from('47494638396101000100800000000000ffffff','hex');
 const frame=Buffer.from('21f904000a0000002c0000000001000100000202440100','hex');
 const second=Buffer.from(frame); second[second.length-3]=0x4c;
 const gif=Buffer.concat([header,frame,second,Buffer.from([0x3b])]);
 assert.equal((await sharp(gif,{animated:true}).metadata()).pages,2);
 const f=await make('animated.webp',sharp(gif,{animated:true}).webp({loop:0,delay:[100,200]}));
 const a=await analyseImage(f,'web'); assert.ok(a.skipReason,JSON.stringify(a));
});
