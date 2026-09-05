import 'dotenv/config';
import { Telegraf, Markup, Scenes, session } from 'telegraf';
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, setDoc, addDoc, collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import express from 'express';

const firebaseConfig = {
  apiKey: "AIzaSyD9fKpBkjz16SVYXudikBSpGzNYx8rqaOQ",
  authDomain: "secretary-bot-12.firebaseapp.com",
  projectId: "secretary-bot-12",
  storageBucket: "secretary-bot-12.firebasestorage.app",
  messagingSenderId: "327812270237",
  appId: "1:327812270237:web:9eab914541c1f0ac0b6c74"
};

const appFb = getApps().length === 0? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(appFb);

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);

let carritos = {};
const PRODUCTOS = [
  { id: 'prod1', nombre: 'Curso Python', precio: 10, estado: 'Activo' },
  { id: 'prod2', nombre: 'Plantilla Bot', precio: 5, estado: 'Activo' },
  { id: 'prod3', nombre: 'Ebook Marketing', precio: 7, estado: 'Activo' },
];

const menuPrincipal = () => Markup.inlineKeyboard([
  [Markup.button.callback('🛍️ Tienda','menu_tienda'), Markup.button.callback('🛒 Carrito','ver_carrito')],
  [Markup.button.callback('📩 Contacto','menu_contacto'), Markup.button.callback('🗂️ Temas','menu_temas')]
]);
const menuTienda = () => Markup.inlineKeyboard([
...PRODUCTOS.filter(p=>p.estado==='Activo').map(p=>[Markup.button.callback(`${p.nombre} - $${p.precio}`, `add_${p.id}`)]),
  [Markup.button.callback('⬅️ Principal','menu_principal')]
]);
const menuTemas = () => Markup.inlineKeyboard([
  [Markup.button.callback('💻 Tech','tema_tech'), Markup.button.callback('💼 Negocios','tema_neg')],
  [Markup.button.callback('⬅️ Principal','menu_principal')]
]);

const contactoScene = new Scenes.WizardScene('contacto',
  (ctx) => { ctx.reply('¿Cuál es tu nombre? Escribe /cancelar para cancelar'); return ctx.wizard.next(); },
  (ctx) => {
    if(ctx.message.text === '/cancelar'){ ctx.reply('Operación cancelada.'); return ctx.scene.leave(); }
    ctx.wizard.state.nombre = ctx.message.text;
    ctx.reply('¿Tu WhatsApp? Escribe /cancelar para salir'); return ctx.wizard.next();
  },
  async (ctx) => {
    if(ctx.message.text === '/cancelar'){ ctx.reply('Operación cancelada.'); return ctx.scene.leave(); }
    await addDoc(collection(db,"leads"), { nombre: ctx.wizard.state.nombre, contacto: ctx.message.text, userId: ctx.from.id, fecha: new Date().toISOString() });
    await ctx.reply(`✅ Gracias ${ctx.wizard.state.nombre}!`, menuPrincipal());
    return ctx.scene.leave();
  }
);
const stage = new Scenes.Stage([contactoScene]);
bot.use(session());
bot.use(stage.middleware());

bot.start(async (ctx) => {
  await setDoc(doc(db,"usuarios", String(ctx.from.id)), { id: ctx.from.id, username: ctx.from.username||"", fecha: new Date().toISOString() }, {merge:true});
  ctx.reply(`Hola! Soy tu asistente. Elige una opción:`, menuPrincipal());
});
bot.command('menu', (ctx) => ctx.reply(`Menú Principal - Elige una opción:`, menuPrincipal()));
bot.command('tienda', (ctx) => ctx.reply(`Productos disponibles:`, menuTienda()));
bot.command('carrito', (ctx) => {
  const c = carritos[ctx.from.id]||[]; if(!c.length) return ctx.reply('Tu carrito está vacío\nTotal: $0');
  let t=0, txt='Tu carrito:\n\n'; c.forEach(p=>{t+=p.precio; txt+=`${p.nombre} $${p.precio}\n`;}); txt+=`\nTotal: $${t}`;
  ctx.reply(txt);
});
bot.command('contacto', (ctx) => ctx.scene.enter('contacto'));
bot.command('post', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1); if(args.length<2) return ctx.reply('Uso: /post tech mensaje');
  await addDoc(collection(db,"posts"), { tema: args[0], mensaje: args.slice(1).join(' '), fecha: new Date().toISOString() });
  ctx.reply(`Publicado en tema '${args[0]}'`);
});
bot.command('admin', async (ctx) => {
  if(ctx.from.id!== ADMIN_ID) return ctx.reply('⛔ Solo Admin');
  const u = await getDocs(collection(db,"usuarios"));
  ctx.reply(`Panel Admin secretary-bot-12:\n👥 Usuarios: ${u.size}`);
});
bot.command('cancelar', async (ctx) => { await ctx.scene.leave().catch(()=>{}); ctx.reply('Operación cancelada.', menuPrincipal()); });

bot.action('menu_principal', (ctx) => { ctx.answerCbQuery().catch(()=>{}); ctx.reply('Menú Principal:', menuPrincipal()); });
bot.action('menu_tienda', (ctx) => { ctx.answerCbQuery().catch(()=>{}); ctx.reply('Productos disponibles:', menuTienda()); });
bot.action('menu_contacto', (ctx) => { ctx.answerCbQuery().catch(()=>{}); ctx.scene.enter('contacto'); });
bot.action('menu_temas', (ctx) => { ctx.answerCbQuery().catch(()=>{}); ctx.reply('Elige tema para ver posts:', menuTemas()); });
bot.action('tema_tech', async (ctx) => {
  const snap = await getDocs(query(collection(db,"posts"), where("tema","==","tech"), orderBy("fecha","desc"), limit(5)));
  if(snap.empty) return ctx.reply('No hay posts en tech');
  let txt='Últimos 5 posts del tema tech:\n\n'; snap.forEach(d=> txt+=`• ${d.data().mensaje}\n\n`); ctx.reply(txt);
});
bot.action('tema_neg', async (ctx) => {
  const snap = await getDocs(query(collection(db,"posts"), where("tema","==","neg"), orderBy("fecha","desc"), limit(5)));
  if(snap.empty) return ctx.reply('No hay posts en neg');
  let txt='Últimos 5 posts del tema neg:\n\n'; snap.forEach(d=> txt+=`• ${d.data().mensaje}\n\n`); ctx.reply(txt);
});
bot.action(/^add_/, (ctx) => {
  const id = ctx.callbackQuery.data.replace('add_',''); const p = PRODUCTOS.find(x=>x.id===id);
  if(!carritos[ctx.from.id]) carritos[ctx.from.id]=[]; carritos[ctx.from.id].push(p);
  ctx.answerCbQuery({text:'Agregado ✅'}).catch(()=>{}); ctx.reply(`✅ ${p.nombre} agregado`);
});
bot.action('ver_carrito', (ctx) => {
  const c=carritos[ctx.from.id]||[]; let t=0; c.forEach(p=>t+=p.precio); ctx.reply(`Tu carrito: ${c.length} productos\nTotal: $${t}`);
});

await bot.telegram.deleteWebhook({drop_pending_updates:true}).catch(()=>{});
bot.launch().then(()=> console.log('✅ secretary-bot-12 ON'));

const app = express();
app.get('/', (req,res) => res.send('secretary-bot-12 ON - Bot Nuevo'));
app.listen(process.env.PORT||3000);
