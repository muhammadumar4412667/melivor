import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(ROOT,'.env');
if(fs.existsSync(envFile)) for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z][A-Z_0-9]*)\s*=\s*(.*?)\s*$/);
  if(m && !(m[1] in process.env)) process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
}
const PORT=Number(process.env.PORT||3000), HOST=process.env.HOST||'127.0.0.1';
const PUBLIC=path.join(ROOT,'public'), DBFILE=path.join(ROOT,'data','melivor.sqlite');
fs.mkdirSync(path.dirname(DBFILE),{recursive:true});fs.mkdirSync(path.join(PUBLIC,'uploads'),{recursive:true});
const db=new DatabaseSync(DBFILE);db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID();
const money=n=>Math.round(Number(n||0));
const sane=(v,max=250)=>String(v??'').trim().slice(0,max);
const slug=s=>sane(s,120).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const hash=(v)=>crypto.createHash('sha256').update(v).digest('hex');
function pwHash(pw){const salt=crypto.randomBytes(16).toString('hex');return `${salt}:${crypto.scryptSync(pw,salt,64).toString('hex')}`;}
function pwCheck(pw,stored){try{const [salt,h]=stored.split(':');return crypto.timingSafeEqual(crypto.scryptSync(pw,salt,64),Buffer.from(h,'hex'));}catch{return false;}}
function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}
function query(sql,...args){return db.prepare(sql).all(...args);}
function one(sql,...args){return db.prepare(sql).get(...args);}
function run(sql,...args){return db.prepare(sql).run(...args);}
function setting(key,defaultValue=''){return one('SELECT value FROM settings WHERE key=?',key)?.value??defaultValue;}
const json=v=>JSON.stringify(v);
function logAction(actor,action,details){run('INSERT INTO audit_log(user_id,action,details,created_at) VALUES(?,?,?,?)',actor||null,action,json(details||{}),now());}

// Durable storage is SQLite, not a browser-only mockup.
db.exec(`
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,description TEXT NOT NULL DEFAULT '',image TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,description TEXT NOT NULL DEFAULT '',category TEXT NOT NULL,collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,price_cents INTEGER NOT NULL,compare_at_cents INTEGER DEFAULT 0,cost_cents INTEGER DEFAULT 0,image TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',featured INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS variants(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,sku TEXT UNIQUE,size TEXT NOT NULL DEFAULT 'One Size',color TEXT NOT NULL DEFAULT 'Blush',price_cents INTEGER DEFAULT NULL,stock INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,user_id TEXT REFERENCES users(id) ON DELETE SET NULL,email TEXT NOT NULL,customer_name TEXT NOT NULL,phone TEXT NOT NULL,address_json TEXT NOT NULL,subtotal_cents INTEGER NOT NULL,discount_cents INTEGER NOT NULL DEFAULT 0,shipping_cents INTEGER NOT NULL DEFAULT 0,tax_cents INTEGER NOT NULL DEFAULT 0,total_cents INTEGER NOT NULL,payment_method TEXT NOT NULL,payment_status TEXT NOT NULL DEFAULT 'pending',fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled',status TEXT NOT NULL DEFAULT 'open',discount_code TEXT DEFAULT '',notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS order_items(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,product_id TEXT REFERENCES products(id) ON DELETE SET NULL,variant_id TEXT REFERENCES variants(id) ON DELETE SET NULL,title TEXT NOT NULL,sku TEXT,size TEXT,color TEXT,quantity INTEGER NOT NULL,unit_price_cents INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS discounts(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,type TEXT NOT NULL,value INTEGER NOT NULL,minimum_cents INTEGER NOT NULL DEFAULT 0,usage_limit INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,ends_at TEXT DEFAULT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS pages(id TEXT PRIMARY KEY,title TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,body TEXT NOT NULL,published INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS subscribers(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,details TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category,status);
 CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
 CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
`);
function seed(){
 if(!one('SELECT id FROM collections LIMIT 1')){
  for(const [name,s] of [['Everyday Essentials','everyday-essentials'],['Romantic Lace','romantic-lace'],['The Comfort Edit','comfort-edit']]) run('INSERT INTO collections VALUES(?,?,?,?,?,?,?)',uid(),name,s,'Thoughtfully designed for comfort and confidence.','',1,now());
 }
 if(!one('SELECT id FROM products LIMIT 1')){
  const all=[
   ['Lace Balcony Bra','bras',3200,'/assets/product-rose-bra.png','A delicate floral lace balcony bra with a softly supportive fit.','romantic-lace',1],
   ['Smooth Push-Up Bra','bras',3400,'/assets/product-black-bra.png','Beautifully sculpted everyday support in timeless black.','everyday-essentials',1],
   ['Lace Brief Panty','panties',1600,'/assets/product-rose-panty.png','Soft lace, breathable lining and a comfortable everyday feel.','romantic-lace',1],
   ['Everyday T-Shirt Bra','bras',2800,'/assets/product-cream-bra.png','A smooth silhouette under your favorite outfits.','comfort-edit',1],
   ['Rosé Lace Bra','bras',3800,'/assets/product-rose-bra.png','Intricate rose lace for elegant everyday moments.','romantic-lace',0],
   ['Midnight Lace Bra','bras',3600,'/assets/product-black-bra.png','An essential with subtle floral details.','romantic-lace',0],
   ['Blush Comfort Brief','panties',1800,'/assets/product-rose-panty.png','Lightweight and delicately detailed.','comfort-edit',0],
   ['Soft Contour Bra','bras',3000,'/assets/product-cream-bra.png','Gentle shaping with effortless comfort.','everyday-essentials',0],
   ['Blush Lingerie Set','lingerie sets',5400,'/assets/category-sets.png','A coordinated lace set for special moments.','romantic-lace',0],
   ['Everyday Shapewear','shapewear',4800,'/assets/category-shapewear.png','A smooth base layer designed to move with you.','comfort-edit',0]
  ];
  for(const [name,category,price,img,description,colslug,featured] of all){
   const id=uid(),cid=one('SELECT id FROM collections WHERE slug=?',colslug)?.id;
   run('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,name,slug(name),description,category,cid,price,0,Math.round(price*.45),img,'active',featured,now(),now());
   let sizes=category==='bras'||category==='lingerie sets'?['32A','32B','32C','34A','34B','34C','34D','36B','36C','36D','38C']:['XS','S','M','L','XL'];
   for(const size of sizes)run('INSERT INTO variants VALUES(?,?,?,?,?,?,?)',uid(),id,`${slug(name).slice(0,12).toUpperCase()}-${size}`,size,img.includes('black')?'Black':img.includes('cream')?'Ivory':'Dusty Rose',null,10+Math.floor(Math.random()*18));
  }
 }
 const defaults={store_name:'Melivor',currency:'USD',shipping_threshold_cents:'5000',shipping_rate_cents:'500',tax_rate:'0',contact_email:'hello@melivor.example',hero_heading:'Everyday Comfort, Effortless Confidence',hero_subtitle:'Thoughtfully designed lingerie for your everyday, from comfort to special moments.',announcement:'Free Shipping on Orders Over $50',footer_description:'Intimate essentials crafted for comfort, confidence, and everyday elegance.',bank_transfer_instructions:'Bank transfer details are supplied after your order is reviewed.',store_address:'',return_policy:'Returns accepted within 30 days on eligible unworn items.',enable_cod:'true',enable_bank_transfer:'true'};
 for(const [key,value] of Object.entries(defaults))run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)',key,value);
 if(!one('SELECT id FROM pages LIMIT 1')){
  for(const [title,s,body] of [
   ['Our Story','our-story','Melivor is built around everyday comfort, thoughtful details, and effortless confidence.'],
   ['Shipping & Returns','shipping-returns','We carefully prepare every order. Shipping and returns are subject to our published store policies.'],
   ['Privacy Policy','privacy-policy','We respect your privacy. Your period tracker information stays in your own browser and is not sent to our servers.'],
   ['Size Guide','size-guide','Use our bra size calculator for an estimated starting size. Fit varies by style and brand.']
  ]) run('INSERT INTO pages VALUES(?,?,?,?,?,?)',uid(),title,s,body,1,now());
 }
}
seed();
const setupToken=process.env.SETUP_TOKEN||crypto.randomBytes(16).toString('hex');
if(!one("SELECT id FROM users WHERE role='admin' LIMIT 1")){
 console.log('\nMELIVOR FIRST RUN SETUP');
 console.log('Open http://localhost:'+PORT+'/admin and use the one-time setup token:');
 console.log(setupToken+'\n');
}
function send(res,status,data,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(json(data));}
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(c=>{const i=c.indexOf('=');return [c.slice(0,i).trim(),decodeURIComponent(c.slice(i+1))]}));}
function currentUser(req){const token=cookies(req).melivor_session;if(!token||token.length>128)return null;return one('SELECT u.id,u.name,u.email,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',hash(token),now())||null;}
function requireAdmin(u){if(u?.role!=='admin')fail(403,'Administrator access required.');}
function requireUser(u){if(!u)fail(401,'Please sign in first.');}
function loginCookie(res,userId){const token=crypto.randomBytes(32).toString('hex');run('INSERT INTO sessions VALUES(?,?,?)',hash(token),userId,new Date(Date.now()+1000*60*60*24*14).toISOString());return `melivor_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600${process.env.NODE_ENV==='production'?'; Secure':''}`;}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>5_000_000)fail(413,'Request body too large.');}try{return JSON.parse(data||'{}');}catch{fail(400,'Invalid JSON.');}}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=200;}
function resultProduct(row,withVariants=false){if(!row)return null;const {collection_name,...rest}=row;const p={...rest,featured:!!row.featured,collection_name:collection_name||'',price:row.price_cents/100,compare_at:row.compare_at_cents/100};if(withVariants)p.variants=query('SELECT * FROM variants WHERE product_id=? ORDER BY size,color',p.id);return p;}
const productSelect=`SELECT p.*,c.name AS collection_name FROM products p LEFT JOIN collections c ON c.id=p.collection_id`;
function pricedCart(items,discountCode=''){
 if(!Array.isArray(items)||items.length<1||items.length>50)fail(400,'Your bag is empty or too large.');
 let subtotal=0;const lines=[];
 for(const item of items){
  const variant=one('SELECT v.*,p.name,p.image,p.price_cents AS base_price_cents,p.status FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?',sane(item.variantId,100));
  const qty=Number(item.quantity);
  if(!variant||variant.status!=='active')fail(400,'One of your selected items is no longer available.');
  if(!Number.isSafeInteger(qty)||qty<1||qty>25)fail(400,'Choose a quantity between 1 and 25.');
  if(qty>variant.stock)fail(409,`Only ${variant.stock} left for ${variant.name} (${variant.size}).`);
  const actual=variant.price_cents===null?variant.base_price_cents:variant.price_cents;
  subtotal+=actual*qty;
  lines.push({variantId:variant.id,productId:variant.product_id,name:variant.name,image:variant.image,sku:variant.sku,size:variant.size,color:variant.color,quantity:qty,price_cents:actual,stock:variant.stock});
 }
 let discount=0,discountApplied=null;
 if(discountCode){const d=one('SELECT * FROM discounts WHERE code=? AND active=1',sane(discountCode,80).toUpperCase());
  if(!d||d.ends_at&&d.ends_at<now()||d.usage_limit>0&&d.used>=d.usage_limit||subtotal<d.minimum_cents)fail(400,'This discount is invalid, expired, or does not meet the minimum order value.');
  discount=d.type==='percent'?Math.min(subtotal,Math.round(subtotal*d.value/100)):Math.min(subtotal,d.value);
  discountApplied=d;
 }
 const rate=Number(setting('shipping_rate_cents','500')),threshold=Number(setting('shipping_threshold_cents','5000'));
 const shipping=subtotal-discount>=threshold?0:rate;
 const tax=Math.round((subtotal-discount)*Number(setting('tax_rate','0'))/100);
 return {lines,subtotal_cents:subtotal,discount_cents:discount,shipping_cents:shipping,tax_cents:tax,total_cents:Math.max(0,subtotal-discount+shipping+tax),discount:discountApplied?.code||''};
}
// Avoid price column name collision when joining variants+products.
function correctedCart(items,discountCode=''){
 const combined=new Map();for(const x of (Array.isArray(items)?items:[])){const id=sane(x.variantId,100);const prev=combined.get(id)||0;combined.set(id,prev+Number(x.quantity));}return pricedCart([...combined].map(([variantId,quantity])=>({variantId,quantity})),discountCode);
}
function publicSettings(){const keys=['store_name','currency','shipping_threshold_cents','shipping_rate_cents','tax_rate','hero_heading','hero_subtitle','announcement','footer_description','contact_email','bank_transfer_instructions','enable_cod','enable_bank_transfer'];return Object.fromEntries(keys.map(k=>[k,setting(k)]));}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon'};
function staticFile(req,res,pathname){
 let file;
 if(pathname==='/admin'||pathname.startsWith('/admin/'))file=path.join(PUBLIC,'admin.html');
 else if(['/','/shop','/cart','/checkout','/account','/tools'].includes(pathname)||/^\/(product|pages|collections)\//.test(pathname))file=path.join(PUBLIC,'index.html');
 else file=path.resolve(PUBLIC,'.'+pathname);
 if(!file.startsWith(PUBLIC+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,404,{error:'Not found.'});
 const ext=path.extname(file),type=mime[ext]||'application/octet-stream';
 res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':ext==='.html'?'no-store':'public, max-age=3600'});
 fs.createReadStream(file).pipe(res);
}
let attempts=new Map();
async function api(req,res,url,user){
 const p=url.pathname,m=req.method;
 if(m==='GET'&&p==='/api/health')return send(res,200,{ok:true,app:'Melivor',time:now()});
 if(m==='GET'&&p==='/api/store')return send(res,200,{settings:publicSettings(),categories:['Bras','Panties','Lingerie Sets','Shapewear'],collections:query('SELECT * FROM collections WHERE active=1 ORDER BY name'),featured:query(`${productSelect} WHERE p.status='active' AND p.featured=1 ORDER BY p.created_at LIMIT 8`).map(x=>resultProduct(x,true))});
 if(m==='GET'&&p==='/api/products'){
  const q=sane(url.searchParams.get('q'),120),cat=sane(url.searchParams.get('category'),60).toLowerCase(),collection=sane(url.searchParams.get('collection'),120),sort=sane(url.searchParams.get('sort'),40);
  const clauses=["p.status='active'"],params=[];
  if(q){clauses.push('(LOWER(p.name) LIKE ? OR LOWER(p.description) LIKE ?)');params.push(`%${q.toLowerCase()}%`,`%${q.toLowerCase()}%`);}
  if(cat){clauses.push('p.category=?');params.push(cat);}
  if(collection){clauses.push('c.slug=?');params.push(collection);}
  const order=({'price-asc':'p.price_cents ASC','price-desc':'p.price_cents DESC','newest':'p.created_at DESC','name':'p.name ASC'}[sort]||'p.featured DESC,p.created_at DESC');
  const page=Math.max(1,Math.min(1000,Number(url.searchParams.get('page'))||1)),limit=12;
  const where=clauses.join(' AND ');
  const total=one(`SELECT count(*) AS n FROM products p LEFT JOIN collections c ON c.id=p.collection_id WHERE ${where}`,...params).n;
  return send(res,200,{products:query(`${productSelect} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,...params,limit,(page-1)*limit).map(x=>resultProduct(x,true)),page,total,pages:Math.ceil(total/limit)});
 }
 if(m==='GET'&&p.startsWith('/api/products/')){const item=one(`${productSelect} WHERE p.slug=? AND p.status='active'`,decodeURIComponent(p.slice('/api/products/'.length)));if(!item)fail(404,'Product not found.');return send(res,200,{product:resultProduct(item,true)});}
 if(m==='GET'&&p==='/api/pages'){return send(res,200,{pages:query('SELECT title,slug FROM pages WHERE published=1 ORDER BY title')});}
 if(m==='GET'&&p.startsWith('/api/pages/')){const page=one('SELECT title,slug,body FROM pages WHERE slug=? AND published=1',p.slice('/api/pages/'.length));if(!page)fail(404,'Page not found.');return send(res,200,{page});}
 if(m==='POST'&&p==='/api/quote'){const b=await body(req);return send(res,200,{quote:correctedCart(b.items,b.discountCode)});}
 if(m==='POST'&&p==='/api/orders'){
  const b=await body(req);const email=sane(b.email,200).toLowerCase(),name=sane(b.name,150),phone=sane(b.phone,40);if(!validEmail(email)||name.length<2||phone.length<6)fail(400,'Enter a valid name, email, and phone number.');
  const adr=b.address||{};for(const k of ['line1','city','country'])if(!sane(adr[k],150))fail(400,`Shipping ${k} is required.`);
  const method=sane(b.paymentMethod,50);if(!['cod','bank_transfer'].includes(method)||setting('enable_'+method)!=='true')fail(400,'Selected payment method is not available.');
  let order;
  transaction(()=>{
   const cart=correctedCart(b.items,b.discountCode),id=uid();
   const number='MV-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase();
   run('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,number,user?.id||null,email,name,phone,json({line1:sane(adr.line1,180),line2:sane(adr.line2,180),city:sane(adr.city,100),province:sane(adr.province,100),postal:sane(adr.postal,30),country:sane(adr.country,100)}),cart.subtotal_cents,cart.discount_cents,cart.shipping_cents,cart.tax_cents,cart.total_cents,method,'pending','unfulfilled','open',cart.discount,sane(b.notes,1000),now(),now());
   for(const line of cart.lines){
    const updated=run('UPDATE variants SET stock=stock-? WHERE id=? AND stock>=?',line.quantity,line.variantId,line.quantity);
    if(updated.changes!==1)fail(409,`Insufficient stock for ${line.name}.`);
    run('INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),id,line.productId,line.variantId,line.name,line.sku,line.size,line.color,line.quantity,line.price_cents);
   }
   if(cart.discount)run('UPDATE discounts SET used=used+1 WHERE code=?',cart.discount);
   order={id,number,...cart,paymentMethod:method};logAction(user?.id,'order.created',{number,total:cart.total_cents});
  });
  return send(res,201,{order,message:'Your order has been placed successfully.'});
 }
 if(m==='POST'&&p==='/api/newsletter'){const b=await body(req),email=sane(b.email,200).toLowerCase();if(!validEmail(email))fail(400,'Please enter a valid email.');run('INSERT OR IGNORE INTO subscribers VALUES(?,?,?)',uid(),email,now());return send(res,200,{ok:true,message:'Thank you for joining Melivor.'});}
 if(m==='GET'&&p==='/api/me')return send(res,200,{user:user||null});
 if(m==='GET'&&p==='/api/me/orders'){requireUser(user);return send(res,200,{orders:query('SELECT number,total_cents,status,fulfillment_status,payment_status,created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100',user.id)});}
 if(m==='POST'&&p==='/api/auth/register'){
  const b=await body(req),email=sane(b.email,200).toLowerCase(),name=sane(b.name,120),password=String(b.password||'');
  if(!validEmail(email)||name.length<2||password.length<10||password.length>200)fail(400,'Use a valid name, email, and password (at least 10 characters).');
  if(one('SELECT id FROM users WHERE email=?',email))fail(409,'An account with this email already exists.');
  const id=uid();run('INSERT INTO users VALUES(?,?,?,?,?,?,?)',id,name,email,pwHash(password),'customer',1,now());
  return send(res,201,{user:{id,name,email,role:'customer'}},{'Set-Cookie':loginCookie(res,id)});
 }
 if(m==='POST'&&p==='/api/auth/login'){
  const b=await body(req),email=sane(b.email,200).toLowerCase(),pw=String(b.password||''),key=req.socket.remoteAddress+'|'+email;
  const stat=attempts.get(key)||{n:0,until:0};if(stat.until>Date.now())fail(429,'Too many attempts. Try again shortly.');
  const u=one('SELECT * FROM users WHERE email=? AND active=1',email);
  if(!u||!pwCheck(pw,u.password_hash)){stat.n++;stat.until=stat.n>=6?Date.now()+60000:0;attempts.set(key,stat);fail(401,'Invalid email or password.');}
  attempts.delete(key);return send(res,200,{user:{id:u.id,name:u.name,email:u.email,role:u.role}},{'Set-Cookie':loginCookie(res,u.id)});
 }
 if(m==='POST'&&p==='/api/auth/logout'){const token=cookies(req).melivor_session;if(token)run('DELETE FROM sessions WHERE token_hash=?',hash(token));return send(res,200,{ok:true},{'Set-Cookie':'melivor_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'});}
 if(m==='GET'&&p==='/api/admin/setup-status')return send(res,200,{needsSetup:!one("SELECT id FROM users WHERE role='admin' LIMIT 1")});
 if(m==='POST'&&p==='/api/admin/setup'){
  if(one("SELECT id FROM users WHERE role='admin' LIMIT 1"))fail(403,'Setup is already complete.');
  const b=await body(req),email=sane(b.email,200).toLowerCase(),password=String(b.password||''),name=sane(b.name,100)||'Store Owner';
  if(!crypto.timingSafeEqual(Buffer.from(hash(String(b.token||''))),Buffer.from(hash(setupToken))))fail(403,'Incorrect setup token.');
  if(!validEmail(email)||password.length<12||password.length>200)fail(400,'Enter a valid email and password of at least 12 characters.');
  const id=uid();run('INSERT INTO users VALUES(?,?,?,?,?,?,?)',id,name,email,pwHash(password),'admin',1,now());logAction(id,'store.setup',{});
  return send(res,201,{user:{id,name,email,role:'admin'}},{'Set-Cookie':loginCookie(res,id)});
 }
 // Everything beyond this point requires an authenticated admin session.
 if(!p.startsWith('/api/admin/'))fail(404,'API endpoint not found.');
 requireAdmin(user);
 if(m==='GET'&&p==='/api/admin/overview'){
  const rev=one("SELECT COALESCE(SUM(total_cents),0) AS total, COUNT(*) AS count FROM orders WHERE status!='cancelled'");
  const month=one("SELECT COALESCE(SUM(total_cents),0) AS total FROM orders WHERE status!='cancelled' AND created_at>=?",new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString());
  return send(res,200,{revenue_cents:rev.total,order_count:rev.count,month_revenue_cents:month.total,product_count:one("SELECT count(*) AS n FROM products WHERE status='active'").n,customer_count:one("SELECT count(*) AS n FROM users WHERE role='customer'").n,subscriber_count:one('SELECT count(*) AS n FROM subscribers').n,low_stock:query('SELECT p.name,v.size,v.color,v.stock,v.id FROM variants v JOIN products p ON p.id=v.product_id WHERE stock<6 ORDER BY stock LIMIT 12'),recent_orders:query('SELECT id,number,customer_name,total_cents,payment_status,fulfillment_status,status,created_at FROM orders ORDER BY created_at DESC LIMIT 8')});
 }
 if(m==='GET'&&p==='/api/admin/analytics'){
  const sales=query("SELECT substr(created_at,1,10) AS day,count(*) AS orders,COALESCE(sum(total_cents),0) AS revenue_cents FROM orders WHERE status!='cancelled' GROUP BY day ORDER BY day DESC LIMIT 30").reverse();
  const top=query("SELECT oi.title,SUM(oi.quantity) AS units,SUM(oi.unit_price_cents*oi.quantity) AS revenue_cents FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status!='cancelled' GROUP BY oi.title ORDER BY units DESC LIMIT 10");
  return send(res,200,{sales,top,byStatus:query('SELECT status, count(*) AS count FROM orders GROUP BY status'),byPayment:query('SELECT payment_method, count(*) AS count FROM orders GROUP BY payment_method')});
 }
 if(m==='GET'&&p==='/api/admin/products')return send(res,200,{products:query(`${productSelect} ORDER BY p.updated_at DESC`).map(x=>resultProduct(x,true))});
 if(m==='POST'&&p==='/api/admin/products'){
  const b=await body(req),name=sane(b.name,160),s=slug(b.slug||b.name),category=sane(b.category,70).toLowerCase(),price=Number(b.price_cents);
  if(!name||!s||!category||!Number.isInteger(price)||price<0)fail(400,'Product name, category and valid price are required.');
  const id=uid();transaction(()=>{
   run('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,name,s,sane(b.description,4000),category,b.collection_id||null,price,money(b.compare_at_cents),money(b.cost_cents),sane(b.image,500),['active','draft','archived'].includes(b.status)?b.status:'draft',b.featured?1:0,now(),now());
   saveVariants(id,b.variants,s);
  });logAction(user.id,'product.created',{name,id});return send(res,201,{id});
 }
 const productId=p.match(/^\/api\/admin\/products\/([^/]+)$/)?.[1];
 if(productId&&m==='PATCH'){
  if(!one('SELECT id FROM products WHERE id=?',productId))fail(404,'Product not found.');const b=await body(req),name=sane(b.name,160),s=slug(b.slug||b.name),price=Number(b.price_cents);
  if(!name||!s||!Number.isInteger(price)||price<0)fail(400,'Valid product name and price are required.');
  transaction(()=>{
   run('UPDATE products SET name=?,slug=?,description=?,category=?,collection_id=?,price_cents=?,compare_at_cents=?,cost_cents=?,image=?,status=?,featured=?,updated_at=? WHERE id=?',name,s,sane(b.description,4000),sane(b.category,80).toLowerCase(),b.collection_id||null,price,money(b.compare_at_cents),money(b.cost_cents),sane(b.image,500),['active','draft','archived'].includes(b.status)?b.status:'draft',b.featured?1:0,now(),productId);
   if(Array.isArray(b.variants)){run('DELETE FROM variants WHERE product_id=?',productId);saveVariants(productId,b.variants,s);}
  });logAction(user.id,'product.updated',{id:productId,name});return send(res,200,{ok:true});
 }
 if(productId&&m==='DELETE'){run("UPDATE products SET status='archived',updated_at=? WHERE id=?",now(),productId);logAction(user.id,'product.archived',{id:productId});return send(res,200,{ok:true});}
 if(m==='GET'&&p==='/api/admin/orders')return send(res,200,{orders:query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').map(o=>({...o,address:JSON.parse(o.address_json),items:query('SELECT * FROM order_items WHERE order_id=?',o.id)}))});
 const orderId=p.match(/^\/api\/admin\/orders\/([^/]+)$/)?.[1];
 if(orderId&&m==='PATCH'){
  const o=one('SELECT * FROM orders WHERE id=?',orderId);if(!o)fail(404,'Order not found.');
  const b=await body(req),status=sane(b.status,40)||o.status,fulfillment=sane(b.fulfillment_status,40)||o.fulfillment_status,payment=sane(b.payment_status,40)||o.payment_status;
  if(!['open','completed','cancelled'].includes(status)||!['unfulfilled','partial','fulfilled'].includes(fulfillment)||!['pending','paid','refunded'].includes(payment))fail(400,'Invalid order status.');
  transaction(()=>{
   if(o.status!=='cancelled'&&status==='cancelled')for(const item of query('SELECT * FROM order_items WHERE order_id=?',orderId))if(item.variant_id)run('UPDATE variants SET stock=stock+? WHERE id=?',item.quantity,item.variant_id);
   if(o.status==='cancelled'&&status!=='cancelled')fail(400,'Cancelled orders cannot be reopened. Create a new order instead.');
   run('UPDATE orders SET status=?,fulfillment_status=?,payment_status=?,notes=?,updated_at=? WHERE id=?',status,fulfillment,payment,sane(b.notes??o.notes,1500),now(),orderId);
  });logAction(user.id,'order.updated',{number:o.number,status,fulfillment,payment});return send(res,200,{ok:true});
 }
 if(m==='GET'&&p==='/api/admin/customers')return send(res,200,{customers:query("SELECT id,name,email,active,created_at,(SELECT COUNT(*) FROM orders WHERE user_id=users.id OR lower(orders.email)=lower(users.email)) AS orders_count,(SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE (user_id=users.id OR lower(orders.email)=lower(users.email)) AND status!='cancelled') AS lifetime_cents FROM users WHERE role='customer' ORDER BY created_at DESC"),guests:query("SELECT email,max(customer_name) AS name,count(*) AS orders_count,sum(total_cents) AS lifetime_cents FROM orders WHERE user_id IS NULL GROUP BY email ORDER BY orders_count DESC")});
 const customerId=p.match(/^\/api\/admin\/customers\/([^/]+)$/)?.[1];
 if(customerId&&m==='PATCH'){const b=await body(req);run("UPDATE users SET active=? WHERE id=? AND role='customer'",b.active?1:0,customerId);logAction(user.id,'customer.updated',{id:customerId,active:!!b.active});return send(res,200,{ok:true});}
 if(m==='GET'&&p==='/api/admin/collections')return send(res,200,{collections:query('SELECT * FROM collections ORDER BY name')});
 if(m==='POST'&&p==='/api/admin/collections'){const b=await body(req),id=uid();if(!sane(b.name))fail(400,'Name required.');run('INSERT INTO collections VALUES(?,?,?,?,?,?,?)',id,sane(b.name,120),slug(b.slug||b.name),sane(b.description,800),sane(b.image,500),b.active?1:0,now());logAction(user.id,'collection.created',{id});return send(res,201,{id});}
 const collId=p.match(/^\/api\/admin\/collections\/([^/]+)$/)?.[1];
 if(collId&&m==='PATCH'){const b=await body(req);run('UPDATE collections SET name=?,slug=?,description=?,image=?,active=? WHERE id=?',sane(b.name,120),slug(b.slug||b.name),sane(b.description,800),sane(b.image,500),b.active?1:0,collId);return send(res,200,{ok:true});}
 if(collId&&m==='DELETE'){run('DELETE FROM collections WHERE id=?',collId);return send(res,200,{ok:true});}
 if(m==='GET'&&p==='/api/admin/discounts')return send(res,200,{discounts:query('SELECT * FROM discounts ORDER BY created_at DESC')});
 if(m==='POST'&&p==='/api/admin/discounts'){const b=await body(req),id=uid(),code=sane(b.code,40).toUpperCase(),value=Number(b.value);if(!code||!['percent','fixed'].includes(b.type)||!Number.isInteger(value)||value<=0||b.type==='percent'&&value>100)fail(400,'Invalid discount.');run('INSERT INTO discounts VALUES(?,?,?,?,?,?,?,?,?,?)',id,code,b.type,value,money(b.minimum_cents),money(b.usage_limit),0,b.active?1:0,sane(b.ends_at,40)||null,now());return send(res,201,{id});}
 const disId=p.match(/^\/api\/admin\/discounts\/([^/]+)$/)?.[1];
 if(disId&&m==='PATCH'){const b=await body(req);if(!sane(b.code)||!['percent','fixed'].includes(b.type)||!Number.isInteger(Number(b.value))||Number(b.value)<=0||b.type==='percent'&&Number(b.value)>100||Number(b.minimum_cents)<0||Number(b.usage_limit)<0)fail(400,'Invalid discount values.');run('UPDATE discounts SET code=?,type=?,value=?,minimum_cents=?,usage_limit=?,active=?,ends_at=? WHERE id=?',sane(b.code,40).toUpperCase(),b.type,money(b.value),money(b.minimum_cents),money(b.usage_limit),b.active?1:0,sane(b.ends_at,40)||null,disId);return send(res,200,{ok:true});}
 if(disId&&m==='DELETE'){run('DELETE FROM discounts WHERE id=?',disId);return send(res,200,{ok:true});}
 if(m==='GET'&&p==='/api/admin/pages')return send(res,200,{pages:query('SELECT * FROM pages ORDER BY title')});
 if(m==='POST'&&p==='/api/admin/pages'){const b=await body(req),id=uid();if(!sane(b.title))fail(400,'Title required.');run('INSERT INTO pages VALUES(?,?,?,?,?,?)',id,sane(b.title,150),slug(b.slug||b.title),sane(b.body,50000),b.published?1:0,now());return send(res,201,{id});}
 const pageId=p.match(/^\/api\/admin\/pages\/([^/]+)$/)?.[1];
 if(pageId&&m==='PATCH'){const b=await body(req);run('UPDATE pages SET title=?,slug=?,body=?,published=?,updated_at=? WHERE id=?',sane(b.title,150),slug(b.slug||b.title),sane(b.body,50000),b.published?1:0,now(),pageId);return send(res,200,{ok:true});}
 if(pageId&&m==='DELETE'){run('DELETE FROM pages WHERE id=?',pageId);return send(res,200,{ok:true});}
 if(m==='GET'&&p==='/api/admin/marketing')return send(res,200,{subscribers:query('SELECT * FROM subscribers ORDER BY created_at DESC LIMIT 2000')});
 if(m==='GET'&&p==='/api/admin/inventory')return send(res,200,{inventory:query('SELECT v.*,p.name,p.image,p.status FROM variants v JOIN products p ON p.id=v.product_id ORDER BY p.name,v.size')});
 const variantId=p.match(/^\/api\/admin\/inventory\/([^/]+)$/)?.[1];
 if(variantId&&m==='PATCH'){const b=await body(req),stock=Number(b.stock);if(!Number.isInteger(stock)||stock<0||stock>1000000)fail(400,'Invalid stock amount.');run('UPDATE variants SET stock=? WHERE id=?',stock,variantId);logAction(user.id,'inventory.updated',{variantId,stock});return send(res,200,{ok:true});}
 if(m==='GET'&&p==='/api/admin/settings')return send(res,200,{settings:Object.fromEntries(query('SELECT * FROM settings').map(x=>[x.key,x.value]))});
 if(m==='PATCH'&&p==='/api/admin/settings'){
  const b=await body(req),allowed=['store_name','currency','shipping_threshold_cents','shipping_rate_cents','tax_rate','contact_email','hero_heading','hero_subtitle','announcement','footer_description','bank_transfer_instructions','store_address','return_policy','enable_cod','enable_bank_transfer'];
  for(const key of ['shipping_threshold_cents','shipping_rate_cents'])if(key in b&&(!Number.isInteger(Number(b[key]))||Number(b[key])<0||Number(b[key])>100000000))fail(400,`Invalid ${key}.`);
  if('tax_rate' in b&&(Number(b.tax_rate)<0||Number(b.tax_rate)>100||!Number.isFinite(Number(b.tax_rate))))fail(400,'Tax rate must be between 0 and 100.');
  if('currency' in b&&!/^[A-Z]{3}$/.test(String(b.currency)))fail(400,'Currency must be a three-letter ISO code, such as USD or PKR.');
  if('contact_email' in b&&!validEmail(b.contact_email))fail(400,'Enter a valid store contact email.');
  if((b.enable_cod??setting('enable_cod'))==='false'&&(b.enable_bank_transfer??setting('enable_bank_transfer'))==='false')fail(400,'Keep at least one payment method enabled.');
  for(const key of allowed)if(key in b)run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,sane(b[key],2000));
  logAction(user.id,'settings.updated',{});return send(res,200,{ok:true});
 }
 if(m==='POST'&&p==='/api/admin/upload'){
  const b=await body(req),match=String(b.dataUrl||'').match(/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/);
  if(!match)fail(400,'Upload a PNG, JPEG, or WebP image.');const bytes=Buffer.from(match[2],'base64');if(bytes.length>3_000_000||bytes.length<20)fail(413,'Maximum image size is 3 MB.');
  const ext=match[1]==='jpeg'?'jpg':match[1],signature=ext==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='jpg'?bytes[0]===255&&bytes[1]===216:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!signature)fail(400,'Unsupported image data.');const filename=`${uid()}.${ext}`;fs.writeFileSync(path.join(PUBLIC,'uploads',filename),bytes);return send(res,201,{url:`/uploads/${filename}`});
 }
 if(m==='GET'&&p==='/api/admin/audit')return send(res,200,{events:query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100')});
 fail(404,'Admin endpoint not found.');
}
function saveVariants(productId,variants,baseSlug){
 const list=Array.isArray(variants)&&variants.length?variants:[{size:'One Size',color:'Blush',stock:0,sku:baseSlug.toUpperCase().slice(0,16)+'-OS'}];
 if(list.length>80)fail(400,'Too many product variants.');
 for(const [i,v] of list.entries()){
  const stock=Number(v.stock||0);if(!Number.isSafeInteger(stock)||stock<0||stock>1e6)fail(400,'Invalid variant stock.');
  const price=v.price_cents===''||v.price_cents===null||v.price_cents===undefined?null:Number(v.price_cents);
  if(price!==null&&(!Number.isInteger(price)||price<0))fail(400,'Invalid variant price.');
  run('INSERT INTO variants VALUES(?,?,?,?,?,?,?)',uid(),productId,sane(v.sku,100)||`${baseSlug.toUpperCase().slice(0,15)}-${i+1}-${crypto.randomBytes(2).toString('hex')}`,sane(v.size,70)||'One Size',sane(v.color,70)||'Blush',price,stock);
 }
}
const server=http.createServer(async(req,res)=>{
 try{
  const host=req.headers.host||`localhost:${PORT}`,url=new URL(req.url,`http://${host}`),p=url.pathname;
  if(!['GET','POST','PATCH','DELETE','HEAD'].includes(req.method))fail(405,'Method not allowed.');
  if(!['GET','HEAD'].includes(req.method)){
   const origin=req.headers.origin;
   if(origin && new URL(origin).host!==host && origin!==process.env.APP_ORIGIN)fail(403,'Cross-site request rejected.');
   if(['POST','PATCH'].includes(req.method)&&!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Use application/json.');
  }
  if(p.startsWith('/api/'))return await api(req,res,url,currentUser(req));
  if(req.method!=='GET'&&req.method!=='HEAD')fail(405,'Method not allowed.');
  staticFile(req,res,p);
 }catch(e){
  const code=Number(e.code)||(/UNIQUE constraint/i.test(e.message)?409:500);
  if(code>=500)console.error(e);
  if(!res.headersSent)send(res,code,{error:code>=500?'Server error. Please try again.':e.message});
  else res.end();
 }
});
server.listen(PORT,HOST,()=>console.log(`Melivor is running at http://${HOST}:${PORT}`));
