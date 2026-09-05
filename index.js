const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, addDoc, query, where, orderBy, limit } = require('firebase/firestore');
const fs = require('fs');
const bot = new Telegraf(process.env.BOT_TOKEN);

// CONFIG FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyC6eyDXaTCPgcb_se9vVP4rfwVkdc0ayn0",
  authDomain: "sexomania-links.firebaseapp.com",
  projectId: "sexomania-links"
};
const db = getFirestore(initializeApp(firebaseConfig));
const ADMIN_ID = 8695673050;

// LEE TU CSV Bot_Config_Completo.csv - DINAMICO
// Formato esperado: tu mismo archivo
const PRODUCTOS = [
  { ID_Producto: 'prod1', Nombre: 'Curso Python', Precio: 10, Descripcion: 'Aprende Python desde 0', Estado: 'Activo' },
  { ID_Producto: 'prod2', Nombre: 'Plantilla Bot', Precio: 5, Descripcion: 'Código base para bots', Estado: 'Activo' },
  { ID_Producto: 'prod3', Nombre: 'Ebook Marketing', Precio: 7, Descripcion: 'Guía de marketing digital', Estado: 'Activo' }
];

let carritos = {};
function getMenuPrincipal(){ return Markup.inlineKeyboard([[Markup.button.callback('🛍️ Tienda','menu_tienda'), Markup.button.callback('🛒 Carrito','ver_carrito')],[Markup.button.callback('📩 Contacto','menu_contacto'), Markup.button.callback('🗂️ Temas','menu_temas')],[Markup.button.callback('🏠 Principal','menu_principal')]]); }
function getMenuTienda(){ let b = PRODUCTOS.filter(p=>p.Estado==='Activo').map(p=>[Markup.button.callback(`${p.Nombre} - $${p.Precio}` , `add_${p.ID_Producto}`)]); b.push([Markup.button.callback('🛒 Ver Carrito','ver_carrito')]); b.push([Markup.button.callback('⬅️ Principal','menu_principal')]); return Markup.inlineKeyboard(b); }
function getMenuTemas(){ return Markup.inlineKeyboard([[Markup.button.callback('💻 Tech','tema_tech'), Markup.button.callback('💼 Negocios','tema_neg')],[Markup.button.callback('⬅️ Principal','menu_principal')]]); }

// SCENE CONTACTO
const contactoScene = new Scenes.WizardScene('contacto',
  (ctx)=>{ ctx.reply('¿Cuál es tu nombre? Escribe /cancelar para cancelar'); return ctx.wizard.next(); },
  (ctx)=>{ if(ctx.message.text==='/cancelar') { ctx.reply('Operación cancelada.'); return ctx.scene.leave(); } ctx.wizard.state.nombre=ctx.message.text; ctx.reply('¿Tu contacto? /cancelar para cancelar'); return ctx.wizard.next(); },
  async (ctx)=>{ if(ctx.message.text==='/cancelar') { ctx.reply('Operación cancelada.'); return ctx.scene.leave(); } await addDoc(collection(db,"leads"),{nombre:ctx.wizard.state.nombre, contacto:ctx.message.text, userId:ctx.from.id, fecha:new Date().toISOString()}); await ctx.reply(`✅ Gracias ${ctx.wizard.state.nombre}`, getMenuPrincipal()); return ctx.scene.leave(); }
);
const stage = new Scenes.Stage([contactoScene]); bot.use(session()); bot.use(stage.middleware());

// COMANDOS DE TU HOJA
bot.start(async(ctx)=>{ await setDoc(doc(db,"usuarios",String(ctx.from.id)),{id:ctx.from.id, username:ctx.from.username||"", fecha:new Date().toISOString()},{merge:true}); ctx.reply(`Hola! Soy tu asistente. Elige una opción:`, getMenuPrincipal()); });
bot.command('menu', (ctx)=>ctx.reply(`Menú Principal - Elige una opción:`, getMenuPrincipal()));
bot.command('tienda', (ctx)=>ctx.reply(`Productos disponibles:`, getMenuTienda()));
bot.command('carrito', (ctx)=>{ const c=carritos[ctx.from.id]||[]; if(!c.length) return ctx.reply('Tu carrito: ... Total: $0 - Vacío'); let t=0, txt='Tu carrito:\n'; c.forEach(p=>{t+=Number(p.Precio); txt+=`• ${p.Nombre} $${p.Precio}\n`;}); txt+=`\nTotal: $${t}`; ctx.reply(txt); });
bot.command('contacto', (ctx)=>ctx.scene.enter('contacto'));
bot.command('post', async(ctx)=>{ const a=ctx.message.text.split(' ').slice(1); if(a.length<2) return ctx.reply('Uso: /post tech mensaje'); const tema=a[0], msg=a.slice(1).join(' '); await addDoc(collection(db,"posts"),{tema, mensaje:msg, fecha:new Date().toISOString()}); ctx.reply(`Publicado en tema '${tema}'`); });
bot.command('admin', async(ctx)=>{ if(ctx.from.id!=ADMIN_ID) return ctx.reply('Solo Admin'); const u=await getDocs(collection(db,"usuarios")); ctx.reply(`Panel Admin:\nUsuarios: ${u.size}`, Markup.inlineKeyboard([[Markup.button.callback('📊 Stats','admin_stats')]])); });
bot.command('cancelar', async(ctx)=>{ await ctx.scene.leave().catch(()=>{}); ctx.reply('Operación cancelada.', getMenuPrincipal()); });

// CALLBACKS DE TU HOJA
bot.action('menu_principal', async(ctx)=>{ await ctx.answerCbQuery().catch(()=>{}); ctx.reply('Menú Principal - Elige una opción:', getMenuPrincipal()); });
bot.action('menu_tienda', async(ctx)=>{ await ctx.answerCbQuery().catch(()=>{}); ctx.reply('Productos disponibles:', getMenuTienda()); });
bot.action('menu_contacto', async(ctx)=>{ await ctx.answerCbQuery().catch(()=>{}); ctx.scene.enter('contacto'); });
bot.action('menu_temas', async(ctx)=>{ await ctx.answerCbQuery().catch(()=>{}); ctx.reply('Elige tema para ver posts:', getMenuTemas()); });
bot.action('tema_tech', async(ctx)=>{ await ctx.answerCbQuery().catch(()=>{}); const q=query(collection(db,"posts"), where("tema","==","tech"), orderBy("fecha","desc"), limit(5)); const s=await getDocs(q); if(s.empty) return ctx.reply('No hay posts en tech'); let txt='Últimos 5 posts del tema tech:\n\n'; s.forEach(d=>txt+=`• ${d.data().mensaje}\n\n`); ctx.reply(txt); });
bot.action('tema_neg', async(ctx)=>{ await ctx.answerCbQuery().catch(()=>{}); const q=query(collection(db,"posts"), where("tema","==","neg"), orderBy("fecha","desc"), limit(5)); const s=await getDocs(q); if(s.empty) return ctx.reply('No hay posts en neg'); let txt='Últimos 5 posts del tema neg:\n\n'; s.forEach(d=>txt+=`• ${d.data().mensaje}\n\n`); ctx.reply(txt); });
bot.action(/^add_/, async(ctx)=>{ const id=ctx.callbackQuery.data.replace('add_',''); const p=PRODUCTOS.find(x=>x.ID_Producto===id); if(!p) return; if(!carritos[ctx.from.id]) carritos[ctx.from.id]=[]; carritos[ctx.from.id].push(p); await ctx.answerCbQuery({text:'Agregado'}).catch(()=>{}); ctx.reply(`✅ ${p.Nombre} agregado`); });
bot.action('ver_carrito', async(ctx)=>{ const c=carritos[ctx.from.id]||[]; let t=0,txt='Tu carrito:\n'; c.forEach(p=>{t+=Number(p.Precio)}); txt+=`Total: $${t}`; await ctx.answerCbQuery().catch(()=>{}); ctx.reply(txt); });
bot.action('admin_stats', async(ctx)=>{ const u=await getDocs(collection(db,"usuarios")); await ctx.answerCbQuery().catch(()=>{}); ctx.reply(`📊 Usuarios: ${u.size}\nCarritos: ${Object.keys(carritos).length}`); });

bot.launch(); require('express')().get('/',(r,s)=>s.send('ON')).listen(process.env.PORT||3000);
console.log('BOT CONFIG COMPLETO ON');
