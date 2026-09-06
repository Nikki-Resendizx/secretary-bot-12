import 'dotenv/config';
import { Telegraf, Markup, Scenes, session } from 'telegraf';
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, setDoc, collection, getDocs, getDoc, deleteDoc } from "firebase/firestore";
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

const ADMIN_IDS = [
  Number(process.env.ADMIN_ID),
...(process.env.ADMIN_IDS? process.env.ADMIN_IDS.split(',').map(n=>Number(n.trim())) : [])
];
const isAdmin = (id) => ADMIN_IDS.includes(id);
const LOG_GROUP_ID = process.env.LOG_GROUP_ID; // ej: -1001234567890
const TOPIC_IDS = {
  bienvenida: process.env.TOPIC_BIENVENIDA || null,
  principal: process.env.TOPIC_PRINCIPAL || null,
  cuenta2: process.env.TOPIC_CUENTA2 || null,
  cuenta3: process.env.TOPIC_CUENTA3 || null
};

async function logToGroup(texto, topicId=null){
  if(!LOG_GROUP_ID) return;
  try{
    await bot.telegram.sendMessage(LOG_GROUP_ID, texto, topicId? {message_thread_id: Number(topicId)} : {});
  }catch(e){ console.log('Error log:', e.message)}
}

let carritos = {};
const menuPrincipal = () => Markup.inlineKeyboard([
  [Markup.button.callback('🛍️ Tienda','menu_tienda'), Markup.button.callback('🛒 Carrito','ver_carrito')],
  [Markup.button.callback('🤖 Chatbot','menu_chatbot'), Markup.button.callback('📦 Módulos','ver_modulos')]
]);

// ESCENA BIENVENIDA PERSONALIZADA
const bienvenidaScene = new Scenes.WizardScene('set_bienvenida',
  (ctx) => {
    if(!isAdmin(ctx.from.id)) return ctx.reply('⛔'), ctx.scene.leave();
    ctx.reply('✨ Envía tu NUEVO mensaje de bienvenida\nPuedes usar EMOJIS PREMIUM\nUsa {nombre} para poner el nombre del usuario\n\nEj: Hola {nombre} bienvenida ✨\n\n/cancelar');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const texto = ctx.message.text || '';
    const entidades = ctx.message.entities || [];
    await setDoc(doc(db, "config", "bienvenida"), { texto, entidades, actualizado: new Date().toISOString() });
    ctx.reply(`✅ Bienvenida guardada!\n\nVista previa:`, {reply_markup:{remove_keyboard:true}});
    await ctx.reply(texto.replace('{nombre}', ctx.from.first_name), {entities: entidades});
    logToGroup(`📝 Nueva bienvenida configurada por ${ctx.from.id}:\n${texto}`, TOPIC_IDS.bienvenida);
    return ctx.scene.leave();
  }
);

const respuestaScene = new Scenes.WizardScene('crear_respuesta',
  (ctx) => { if(!isAdmin(ctx.from.id)) return ctx.reply('⛔'), ctx.scene.leave(); ctx.reply('Palabra clave:'); return ctx.wizard.next(); },
  (ctx) => { ctx.wizard.state.trigger = ctx.message.text.toLowerCase(); ctx.reply(`Respuesta para "${ctx.wizard.state.trigger}" con emojis premium:`); return ctx.wizard.next(); },
  async (ctx) => {
    const texto = ctx.message.text || ''; const entidades = ctx.message.entities || [];
    await setDoc(doc(db, "respuestas", ctx.wizard.state.trigger), { trigger: ctx.wizard.state.trigger, texto, entidades });
    ctx.reply(`✅ Respuesta "${ctx.wizard.state.trigger}" creada`); return ctx.scene.leave();
  }
);
const moduloScene = new Scenes.WizardScene('crear_modulo',
  (ctx) => { if(!isAdmin(ctx.from.id)) return; ctx.reply('Nombre módulo:'); return ctx.wizard.next(); },
  (ctx) => { ctx.wizard.state.nombre = ctx.message.text.toLowerCase().replace(/\s/g,'_'); ctx.reply(`Mensaje para "${ctx.wizard.state.nombre}" con premium:`); return ctx.wizard.next(); },
  async (ctx) => {
    const texto = ctx.message.text || ''; const entidades = ctx.message.entities || [];
    await setDoc(doc(db, "modulos", ctx.wizard.state.nombre), { nombre: ctx.wizard.state.nombre, texto, entidades });
    ctx.reply(`✅ Módulo ${ctx.wizard.state.nombre} guardado!`); return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([respuestaScene, moduloScene, bienvenidaScene]);
bot.use(session());
bot.use(stage.middleware());

// BIENVENIDA PERSONALIZADA
bot.start(async (ctx) => {
  let textoBienvenida = `Hola {nombre}! Soy tu asistente Premium ✨`;
  let entidades = [];
  try{
    const snap = await getDoc(doc(db, "config", "bienvenida"));
    if(snap.exists()){ textoBienvenida = snap.data().texto; entidades = snap.data().entidades || []; }
  }catch{}
  const finalText = textoBienvenida.replace('{nombre}', ctx.from.first_name);
  await ctx.reply(finalText, {entities: entidades,...menuPrincipal()});
  logToGroup(`👋 Nuevo /start\n👤 ${ctx.from.first_name} (@${ctx.from.username||'sin user'}) ID: ${ctx.from.id}\n📝 ${ctx.from.id}`, TOPIC_IDS.bienvenida);
});

bot.command('admins', (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  ctx.reply(`👑 ADMINS: ${ADMIN_IDS.join(', ')}\nTú: ${ctx.from.id} ${isAdmin(ctx.from.id)?'✅':''}\n\nLOG GROUP: ${LOG_GROUP_ID||'No configurado'}`);
});
bot.command('set_bienvenida', (ctx) => { if(!isAdmin(ctx.from.id)) return; ctx.scene.enter('set_bienvenida'); });
bot.command('ver_bienvenida', async (ctx) => {
  const snap = await getDoc(doc(db, "config", "bienvenida"));
  if(!snap.exists()) return ctx.reply('No hay bienvenida personalizada, usando la default');
  const d=snap.data(); await ctx.reply(`Actual:\n${d.texto}`, {entities: d.entidades});
});
bot.command('crear_respuesta', (ctx) => { if(isAdmin(ctx.from.id)) ctx.scene.enter('crear_respuesta'); });
bot.command('crear_modulo', (ctx) => { if(isAdmin(ctx.from.id)) ctx.scene.enter('crear_modulo'); });
bot.command('respuestas', async (ctx) => {
  const snap = await getDocs(collection(db, "respuestas"));
  let txt='🤖 Respuestas:\n'; snap.forEach(d=> txt+=`• ${d.id}\n`); ctx.reply(txt||'Vacío');
});
bot.command('borrar_respuesta', async (ctx) => {
  const trig = ctx.message.text.split(' ')[1]?.toLowerCase(); if(!trig) return ctx.reply('Uso: /borrar_respuesta hola');
  await deleteDoc(doc(db, "respuestas", trig)); ctx.reply(`Borrada ${trig}`);
});

// LOG DE CHATS
bot.on('text', async (ctx, next) => {
  if(ctx.message.text.startsWith('/')) return next();
  // Log de chat de usuarios
  if(!isAdmin(ctx.from.id)){
    logToGroup(`💬 Mensaje de ${ctx.from.first_name} (@${ctx.from.username||'no user'}) ID:${ctx.from.id}\n\n${ctx.message.text}`, TOPIC_IDS.bienvenida);
  }
  const texto = ctx.message.text.toLowerCase();
  const snap = await getDocs(collection(db, "respuestas"));
  for(const d of snap.docs){
    const data=d.data();
    if(texto.includes(data.trigger.toLowerCase())){
      await ctx.reply(data.texto, {entities: data.entidades, reply_to_message_id: ctx.message.message_id}).catch(()=>{});
      logToGroup(`🤖 Auto-respuesta a ${ctx.from.id} por trigger "${data.trigger}"\nUsuario dijo: ${ctx.message.text}\nBot respondió: ${data.texto}`, TOPIC_IDS.bienvenida);
      break;
    }
  }
  return next();
});

bot.command('cancelar', (ctx) => { ctx.scene.leave().catch(()=>{}); ctx.reply('Cancelado', menuPrincipal()); });
bot.action('menu_principal', (ctx) => ctx.reply('Menú:', menuPrincipal()));
bot.action('menu_chatbot', (ctx) => ctx.reply('🤖 Chatbot', Markup.inlineKeyboard([[Markup.button.callback('Crear','crear_resp')],[Markup.button.callback('Bienvenida','set_bien')]])));
bot.action('crear_resp', (ctx) => { ctx.scene.enter('crear_respuesta'); ctx.answerCbQuery(); });
bot.action('set_bien', (ctx) => { ctx.scene.enter('set_bienvenida'); ctx.answerCbQuery(); });
bot.action('ver_modulos', async (ctx) => {
  const snap = await getDocs(collection(db, "modulos")); const btns=[]; snap.forEach(d=> btns.push([Markup.button.callback(d.id, `sendmod_${d.id}`)])); btns.push([Markup.button.callback('⬅️','menu_principal')]); ctx.reply('Módulos:', Markup.inlineKeyboard(btns));
});
bot.action(/^sendmod_/, async (ctx) => {
  const snap = await getDoc(doc(db, "modulos", ctx.callbackQuery.data.replace('sendmod_',''))); if(!snap.exists()) return; const data=snap.data(); await ctx.reply(data.texto, {entities: data.entidades}); ctx.answerCbQuery();
});
bot.action('menu_tienda', (ctx) => ctx.reply('Tienda'));
bot.action('ver_carrito', (ctx) => ctx.reply('Carrito'));

await bot.telegram.deleteWebhook({drop_pending_updates:true}).catch(()=>{});
bot.launch().then(()=> console.log('✅ V4 BIENVENIDA + LOGS'));
const app = express();
app.get('/', (req,res) => res.send('V4 ON'));
app.listen(process.env.PORT||3000);
