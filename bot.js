import 'dotenv/config';
import { Telegraf, Markup, Scenes, session } from 'telegraf';
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, setDoc, addDoc, collection, getDocs, getDoc, deleteDoc } from "firebase/firestore";
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

// SOPORTE MULTI-ADMIN: Lee ADMIN_ID y ADMIN_IDS
const ADMIN_IDS = [
  Number(process.env.ADMIN_ID),
 ...(process.env.ADMIN_IDS? process.env.ADMIN_IDS.split(',').map(n=>Number(n.trim())) : [])
];
const isAdmin = (id) => ADMIN_IDS.includes(id);

let carritos = {};
const menuPrincipal = () => Markup.inlineKeyboard([
  [Markup.button.callback('🛍️ Tienda','menu_tienda'), Markup.button.callback('🛒 Carrito','ver_carrito')],
  [Markup.button.callback('🤖 Chatbot','menu_chatbot'), Markup.button.callback('📦 Módulos','ver_modulos')]
]);

// --- ESCENA CREAR RESPUESTA AUTOMATICA CON EMOJIS PREMIUM ---
const respuestaScene = new Scenes.WizardScene('crear_respuesta',
  (ctx) => {
    if(!isAdmin(ctx.from.id)) return ctx.reply('⛔ Solo Admins'), ctx.scene.leave();
    ctx.reply('🤖 ¿Cuál será la PALABRA CLAVE?\nEj: hola, precio, info\n/cancelar');
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.trigger = ctx.message.text.toLowerCase();
    ctx.reply(`Perfecto. Ahora escribe la RESPUESTA para "${ctx.wizard.state.trigger}"\nPuedes usar EMOJIS PREMIUM ✨\n/cancelar`);
    return ctx.wizard.next();
  },
  async (ctx) => {
    const texto = ctx.message.text || ctx.message.caption || '';
    const entidades = ctx.message.entities || ctx.message.caption_entities || [];
    await setDoc(doc(db, "respuestas", ctx.wizard.state.trigger), {
      trigger: ctx.wizard.state.trigger,
      texto, entidades, fecha: new Date().toISOString()
    });
    ctx.reply(`✅ Auto-respuesta creada!\nCuando digan "${ctx.wizard.state.trigger}" responderé: ${texto}`, menuPrincipal());
    return ctx.scene.leave();
  }
);

const moduloScene = new Scenes.WizardScene('crear_modulo',
  (ctx) => { if(!isAdmin(ctx.from.id)) return ctx.reply('⛔'), ctx.scene.leave(); ctx.reply('Nombre del módulo:'); return ctx.wizard.next(); },
  (ctx) => { ctx.wizard.state.nombre = ctx.message.text.toLowerCase().replace(/\s/g,'_'); ctx.reply(`Envía el MENSAJE con emojis premium para "${ctx.wizard.state.nombre}"`); return ctx.wizard.next(); },
  async (ctx) => {
    const texto = ctx.message.text || ctx.message.caption || '';
    const entidades = ctx.message.entities || ctx.message.caption_entities || [];
    await setDoc(doc(db, "modulos", ctx.wizard.state.nombre), { nombre: ctx.wizard.state.nombre, texto, entidades, fecha: new Date().toISOString() });
    ctx.reply(`✅ Módulo ${ctx.wizard.state.nombre} guardado!`, menuPrincipal());
    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([respuestaScene, moduloScene]);
bot.use(session());
bot.use(stage.middleware());

bot.start((ctx) => ctx.reply(`Hola! Bot Premium + Chatbot 🤖✨`, menuPrincipal()));

// --- COMANDOS MULTI-ADMIN ---
bot.command('add_admin', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  const newId = ctx.message.text.split(' ')[1];
  if(!newId) return ctx.reply('Uso: /add_admin 123456789\nSaca el ID con @userinfobot');
  await addDoc(collection(db, "admins"), { id: Number(newId), agregadoPor: ctx.from.id, fecha: new Date().toISOString() });
  ctx.reply(`✅ Admin ${newId} agregado! Ahora debe agregar en Render en ADMIN_IDS: ${process.env.ADMIN_ID},${newId}\n\nO dime el ID y te digo como ponerlo.`);
});
bot.command('admins', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  const snap = await getDocs(collection(db, "admins"));
  let txt=`👑 Admins actuales:\n• Principal: ${process.env.ADMIN_ID}\n`;
  snap.forEach(d=> txt+=`• ${d.data().id}\n`);
  ctx.reply(txt);
});

// --- COMANDOS CHATBOT ---
bot.command('crear_respuesta', (ctx) => { if(!isAdmin(ctx.from.id)) return; ctx.scene.enter('crear_respuesta'); });
bot.command('crear_modulo', (ctx) => { if(!isAdmin(ctx.from.id)) return; ctx.scene.enter('crear_modulo'); });
bot.command('respuestas', async (ctx) => {
  const snap = await getDocs(collection(db, "respuestas"));
  if(snap.empty) return ctx.reply('No hay auto-respuestas');
  let txt='🤖 Auto-respuestas:\n\n'; snap.forEach(d=> txt+=`• ${d.id} -> ${d.data().texto.substring(0,30)}...\n`);
  txt+='\n/borrar_respuesta palabra para borrar';
  ctx.reply(txt);
});
bot.command('borrar_respuesta', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  const trig = ctx.message.text.split(' ')[1]?.toLowerCase();
  if(!trig) return ctx.reply('Uso: /borrar_respuesta hola');
  await deleteDoc(doc(db, "respuestas", trig));
  ctx.reply(`🗑️ Respuesta "${trig}" borrada`);
});
bot.command('modulos', async (ctx) => {
  const snap = await getDocs(collection(db, "modulos"));
  if(snap.empty) return ctx.reply('No hay módulos');
  let txt='📦 Módulos:\n'; snap.forEach(d=> txt+=`• ${d.id}\n`); ctx.reply(txt);
});
bot.command('enviar_modulo', async (ctx) => {
  const nombre = ctx.message.text.split(' ')[1]?.toLowerCase();
  const snap = await getDoc(doc(db, "modulos", nombre));
  if(!snap.exists()) return ctx.reply('No existe');
  const data=snap.data(); await ctx.reply(data.texto, {entities: data.entidades});
});

// --- MENU CHATBOT ---
bot.action('menu_chatbot', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return ctx.reply('⛔ Solo Admins');
  ctx.reply('🤖 Panel Chatbot:', Markup.inlineKeyboard([
    [Markup.button.callback('➕ Crear Respuesta','crear_resp'), Markup.button.callback('📋 Ver Respuestas','list_resp')],
    [Markup.button.callback('⬅️ Principal','menu_principal')]
  ]));
});
bot.action('crear_resp', (ctx) => { ctx.scene.enter('crear_respuesta'); ctx.answerCbQuery(); });
bot.action('list_resp', async (ctx) => {
  const snap = await getDocs(collection(db, "respuestas"));
  let txt='Respuestas:\n'; snap.forEach(d=> txt+=`• ${d.id}\n`); ctx.reply(txt||'Vacío'); ctx.answerCbQuery();
});
bot.action('ver_modulos', async (ctx) => {
  const snap = await getDocs(collection(db, "modulos"));
  const btns=[]; snap.forEach(d=> btns.push([Markup.button.callback(d.id, `sendmod_${d.id}`)]));
  btns.push([Markup.button.callback('⬅️','menu_principal')]);
  ctx.reply('Módulos:', Markup.inlineKeyboard(btns));
});
bot.action(/^sendmod_/, async (ctx) => {
  const snap = await getDoc(doc(db, "modulos", ctx.callbackQuery.data.replace('sendmod_','')));
  if(!snap.exists()) return; const data=snap.data(); await ctx.reply(data.texto, {entities: data.entidades}); ctx.answerCbQuery();
});
bot.action('menu_principal', (ctx) => ctx.reply('Menú:', menuPrincipal()));
bot.action('menu_tienda', (ctx) => ctx.reply('Tienda próximamente'));
bot.action('ver_carrito', (ctx) => ctx.reply('Carrito vacío'));

// --- AUTO-RESPUESTAS (CHATBOT) FUNCIONA EN GRUPOS Y PRIVADO ---
bot.on('text', async (ctx, next) => {
  // Ignorar comandos
  if(ctx.message.text.startsWith('/')) return next();
  const texto = ctx.message.text.toLowerCase();
  const snap = await getDocs(collection(db, "respuestas"));
  for(const d of snap.docs){
    const data=d.data();
    if(texto.includes(data.trigger.toLowerCase())){
      await ctx.reply(data.texto, {entities: data.entidades, reply_to_message_id: ctx.message.message_id}).catch(()=>{});
      break; // Solo responde una vez por mensaje
    }
  }
  return next();
});

bot.command('cancelar', (ctx) => { ctx.scene.leave().catch(()=>{}); ctx.reply('Cancelado', menuPrincipal()); });

await bot.telegram.deleteWebhook({drop_pending_updates:true}).catch(()=>{});
bot.launch().then(()=> console.log('✅ BOT PREMIUM + CHATBOT MULTI-ADMIN ON'));
const app = express();
app.get('/', (req,res) => res.send('PREMIUM CHATBOT MULTI-ADMIN ON'));
app.listen(process.env.PORT||3000);
