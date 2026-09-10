import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { SignJWT } from "jose";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const SECRET="perf-check-secret", PORT=3198;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"crm-dbg-"));
const dbUrl=`file:${path.join(dir,"d.db")}`;
const { migrate } = await import("./src/lib/db/migrate.ts");
const c=createClient({url:dbUrl}); await c.execute("PRAGMA busy_timeout=15000"); await migrate(c);
const now=Date.now(); const avatar="data:image/jpeg;base64,"+"A".repeat(700000);
for(let i=1;i<=8;i++) await c.execute({sql:`INSERT INTO users (name,email,password_hash,is_admin,theme,created_at,avatar_data_url,avatar_updated_at) VALUES (?,?,'x',?, 'lys',?,?,?)`,args:[`B${i}`,`b${i}@t.no`,i===1?1:0,now,avatar,now]});
for(let i=1;i<=900;i++) await c.execute({sql:`INSERT INTO companies (name,org_name,org_number,brreg_verified,owner_id,created_at) VALUES (?,?,?,0,?,?)`,args:[`S${i}`,`S${i} AS`,String(900000000+i),(i%8)+1,now-i*1000]});
const st=(await c.execute("SELECT id FROM stages ORDER BY sort_order")).rows.map(r=>String(r.id));
for(let i=1;i<=700;i++){ await c.execute({sql:"INSERT INTO people (name,email,created_at) VALUES (?,?,?)",args:[`P${i}`,`p${i}@t.no`,now]}); await c.execute({sql:"INSERT INTO company_people (company_id,person_id,created_at) VALUES (?,?,?)",args:[(i%900)+1,i,now]}); }
for(let i=1;i<=400;i++) await c.execute({sql:`INSERT INTO deals (company_id,title,stage,value,owner_id,comment,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`,args:[(i%900)+1,`D${i}`,st[i%st.length],1000+i,(i%8)+1,`k${i}`,now-i*1000,now-i*500]});
for(let i=1;i<=400;i++) await c.execute({sql:"INSERT INTO activities (deal_id,user_id,type,content,created_at) VALUES (?,?,'comment',?,?)",args:[i,(i%8)+1,`k${i}`,now-i*400]});
const p=spawn("npx",["next","start","-p",String(PORT)],{env:{...process.env,NODE_ENV:"production",DATABASE_URL:dbUrl,SESSION_SECRET:SECRET,CRYPTO_KEY:"0".repeat(64)},stdio:"ignore"});
for(let i=0;i<60;i++){try{if((await fetch(`http://localhost:${PORT}/login`)).ok)break}catch{} await new Promise(r=>setTimeout(r,500));}
const tok=await new SignJWT({uid:1}).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(SECRET));
const first=await (await fetch(`http://localhost:${PORT}/`,{headers:{cookie:`crm_session=${tok}`}})).text();
console.log("/ bytes:", first.length);
const html=await (await fetch(`http://localhost:${PORT}/leads`,{headers:{cookie:`crm_session=${tok}`}})).text();
fs.writeFileSync(process.argv[2],html);
console.log("bytes:",html.length);
console.log("antall 'AAAAAAAA'-forekomster:",(html.match(/A{5000}/g)||[]).length);
const i=html.indexOf("A".repeat(5000));
console.log("kontekst før første treff:", JSON.stringify(html.slice(Math.max(0,i-260),i).slice(-260)));
p.kill(); fs.rmSync(dir,{recursive:true,force:true});
