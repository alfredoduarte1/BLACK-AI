(() => {
'use strict';
const $ = id => document.getElementById(id);
const EMAIL = 'blackcorporation.inf@gmail.com';
const K = { profile: 'blackai_profile_v1', chats: 'blackai_chats_v2', settings: 'blackai_settings_v2', session: 'blackai_session_v1', installDismiss: 'blackai_install_dismiss' };

/* ---------- utilidades ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const sess = {
  get() { try { return sessionStorage.getItem(K.session) === '1'; } catch { return false; } },
  set(v) { try { v ? sessionStorage.setItem(K.session, '1') : sessionStorage.removeItem(K.session); } catch {} }
};
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }

async function hashPin(pin, salt) {
  const data = salt + ':' + pin + ':blackai';
  if (window.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; for (let i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) | 0;
  return 'x' + (h >>> 0).toString(16);
}

/* =====================================================
   LOGIN (local, neste aparelho)
   ===================================================== */
let profile = store.get(K.profile, null);
const L = { nome: $('lgNome'), numero: $('lgNumero'), pin: $('lgPin'), termos: $('lgTermos'), btn: $('loginBtn'), erro: $('loginErro'), dica: $('loginDica') };
let tentativas = 0, bloqueadoAte = 0;

const telefoneOk = v => /^\+?\d{7,15}$/.test(v.replace(/[\s\-().]/g, ''));
const pinOk = () => /^\d{4}$/.test(L.pin.value);
function loginValido() {
  if (profile) return pinOk();
  return L.nome.value.trim().length >= 2 && telefoneOk(L.numero.value) && pinOk() && L.termos.checked;
}
function atualizarLogin() {
  L.btn.disabled = !loginValido();
  L.dica.textContent = '';
  if (!profile && !L.termos.checked && L.nome.value.trim().length >= 2 && telefoneOk(L.numero.value) && pinOk())
    L.dica.textContent = 'Marque «Li e aceito os termos» para poder entrar.';
}
function mostrarLogin() {
  const reg = !profile;
  $('regFields').classList.toggle('hidden', !reg);
  $('termsRow').classList.toggle('hidden', !reg);
  $('unlockHello').classList.toggle('hidden', reg);
  $('resetBtn').classList.toggle('hidden', reg);
  $('loginTitle').textContent = reg ? 'Criar acesso' : 'Bem-vindo de volta';
  $('loginSub').textContent = reg ? 'Preencha os dados e aceite os termos para entrar na BLACK AI.' : 'Digite o seu PIN para continuar.';
  if (!reg) $('unlockHello').textContent = 'Olá, ' + profile.nome;
  L.pin.value = ''; L.erro.textContent = ''; L.termos.checked = false;
  $('appShell').classList.add('hidden'); $('fbFab').classList.add('hidden'); $('fbPanel').classList.add('hidden');
  $('login').classList.remove('hidden');
  atualizarLogin();
}
['input', 'change'].forEach(ev => [L.nome, L.numero, L.pin, L.termos].forEach(el => el.addEventListener(ev, () => {
  if (el === L.pin) L.pin.value = L.pin.value.replace(/\D/g, '').slice(0, 4);
  L.erro.textContent = ''; atualizarLogin();
})));
$('verTermos').addEventListener('click', e => { e.preventDefault(); $('termsDialog').showModal(); });
$('openTerms').addEventListener('click', () => { $('settingsDialog').close(); $('termsDialog').showModal(); });

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!loginValido()) return;
  if (profile) {
    if (Date.now() < bloqueadoAte) { L.erro.textContent = 'Muitas tentativas. Aguarde alguns segundos.'; return; }
    const h = await hashPin(L.pin.value, profile.salt);
    if (h !== profile.pinHash) {
      if (++tentativas >= 5) { bloqueadoAte = Date.now() + 30000; tentativas = 0; }
      L.erro.textContent = 'PIN incorreto.'; L.pin.value = ''; atualizarLogin(); return;
    }
  } else {
    const salt = uid() + uid();
    const novo = { nome: L.nome.value.trim(), numero: L.numero.value.trim(), salt, pinHash: await hashPin(L.pin.value, salt), termosEm: new Date().toISOString() };
    if (!store.set(K.profile, novo)) { L.erro.textContent = 'Não foi possível guardar os dados neste aparelho.'; return; }
    profile = novo;
  }
  tentativas = 0; sess.set(true); entrar();
});
$('resetBtn').addEventListener('click', () => {
  if (!confirm('Isto apaga os seus dados e as conversas deste aparelho. Continuar?')) return;
  store.del(K.profile); store.del(K.chats); sess.set(false);
  profile = null; chats = []; currentId = null; mostrarLogin();
});
$('logoutBtn').addEventListener('click', () => { sess.set(false); $('sidebar').classList.remove('open'); mostrarLogin(); });

/* =====================================================
   CHAT
   ===================================================== */
const els = {
  history: $('historyList'), welcome: $('welcome'), messages: $('messages'), typing: $('typing'),
  form: $('chatForm'), prompt: $('prompt'), connection: $('connectionState'), language: $('language'),
  saveHistory: $('saveHistory'), dialog: $('settingsDialog'), sidebar: $('sidebar'), scroll: $('chatScroll')
};
let settings = { saveHistory: true, ...store.get(K.settings, {}) };
els.saveHistory.checked = settings.saveHistory;
let chats = [], currentId = null, busy = false, sugVisible = false;

const current = () => chats.find(c => c.id === currentId);
function saveChats() { if (settings.saveHistory && !store.set(K.chats, chats)) toast('Armazenamento cheio; não foi possível guardar o histórico.'); }
const titleFor = t => (t || 'Nova conversa').replace(/\s+/g, ' ').trim().slice(0, 38) || 'Nova conversa';

function newChat() {
  const c = { id: uid(), title: 'Nova conversa', updated: Date.now(), messages: [] };
  chats.unshift(c); currentId = c.id; sugVisible = false; saveChats(); renderAll(); els.sidebar.classList.remove('open');
}
function initChats() {
  chats = settings.saveHistory ? store.get(K.chats, []) : [];
  if (!Array.isArray(chats)) chats = [];
  if (!chats.length) chats = [{ id: uid(), title: 'Nova conversa', updated: Date.now(), messages: [] }];
  currentId = chats[0].id; sugVisible = false;
}

function renderText(text) {
  let s = esc(text);
  s = s.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, l, code) => '<pre><code>' + code.trim() + '</code></pre>');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|\n)#{1,3} (.+)/g, '$1<strong>$2</strong>');
  return s.replace(/\n/g, '<br>');
}

function renderHistory() {
  els.history.replaceChildren();
  for (const c of chats) {
    const b = document.createElement('button');
    b.className = 'history-item' + (c.id === currentId ? ' active' : '');
    const i = document.createElement('span'); i.textContent = '▤';
    const t = document.createElement('span'); t.textContent = c.title;
    b.append(i, t); b.title = c.title;
    b.onclick = () => { currentId = c.id; sugVisible = false; renderAll(); els.sidebar.classList.remove('open'); };
    els.history.append(b);
  }
}

function renderMessages() {
  els.messages.replaceChildren();
  const c = current(); if (!c) return;
  els.welcome.classList.toggle('hidden', c.messages.length > 0);
  for (const m of c.messages) {
    const article = document.createElement('article');
    article.className = 'message ' + (m.role === 'user' ? 'user' : 'assistant');
    const avatar = document.createElement('div'); avatar.className = 'avatar';
    if (m.role === 'user') avatar.textContent = (profile?.nome || 'U').trim().charAt(0).toUpperCase();
    else { const im = document.createElement('img'); im.src = 'logo.svg'; im.alt = ''; avatar.append(im); }
    const wrap = document.createElement('div'); wrap.className = 'message-content';
    const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.innerHTML = renderText(m.content || '');
    wrap.append(bubble);
    if (m.fontes?.length) {
      const f = document.createElement('div'); f.className = 'fontes';
      const sm = document.createElement('small'); sm.textContent = 'Fontes (Wikipédia):'; f.append(sm);
      m.fontes.forEach(x => { const a = document.createElement('a'); a.href = x.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = x.titulo; f.append(a); });
      wrap.append(f);
    }
    if (m.role === 'assistant') {
      const tools = document.createElement('div'); tools.className = 'message-tools';
      const copy = document.createElement('button'); copy.textContent = 'Copiar resposta';
      copy.onclick = async () => { try { await navigator.clipboard.writeText(m.content); toast('Resposta copiada.'); } catch { toast('Não foi possível copiar automaticamente.'); } };
      tools.append(copy); wrap.append(tools);
    }
    article.append(avatar, wrap); els.messages.append(article);
  }
  const ultima = c.messages[c.messages.length - 1];
  if (sugVisible && ultima?.role === 'assistant') els.messages.append(montarSugestoes());
  els.scroll.scrollTop = els.scroll.scrollHeight;
}
const renderAll = () => { renderHistory(); renderMessages(); };

function setBusy(v) {
  busy = v; $('sendBtn').disabled = v; $('sendBtn').textContent = v ? '…' : '↑';
  els.typing.classList.toggle('hidden', !v);
  els.connection.textContent = v ? 'A responder…' : (navigator.onLine ? 'Ligação disponível' : 'Sem Internet');
  if (v) els.scroll.scrollTop = els.scroll.scrollHeight;
}

/* ---------- IA ---------- */
function regras() {
  const en = els.language.value === 'en';
  return 'És a BLACK AI, uma assistente de informação e aprendizagem desenvolvida pela empresa BLACK CORPORATION. ' +
    'O fundador da BLACK CORPORATION é Alfredo Duarte. O e-mail da empresa é ' + EMAIL + '. ' +
    'Se perguntarem quem te criou, quem te desenvolveu, quem fundou a empresa ou quem é o dono, responde com estes factos. ' +
    'Se perguntarem por outros cargos ou detalhes da empresa que não conheces, diz com honestidade que não tens essa informação. ' +
    'Se perguntarem especificamente que tecnologia ou modelo de IA funciona por baixo, diz com honestidade que a BLACK AI usa modelos de IA de terceiros. ' +
    'Ajudas com educação, matemática, ciências, programação, escrita e conhecimentos gerais. ' +
    'Responde em ' + (en ? 'English' : 'Português claro') + ', salvo se o utilizador pedir outro idioma. ' +
    'Em exercícios, mostra método, passos e resposta final; verifica contas e declara incerteza quando necessário. ' +
    'Se receberes um CONTEXTO da Wikipédia, usa-o como base quando for relevante e ignora-o quando não for. ' +
    'Não afirmes ter acesso à Internet em tempo real. Se não souberes, sê honesta. Formata com Markdown simples. Não peças palavras-passe nem dados pessoais.';
}

async function lerResposta(res) {
  if (!res.ok) throw new Error('O serviço respondeu com HTTP ' + res.status);
  const raw = await res.text();
  let texto = raw;
  try { const d = JSON.parse(raw); texto = d?.choices?.[0]?.message?.content || d?.text || d?.response || ''; } catch { /* texto simples */ }
  if (!String(texto).trim()) throw new Error('Resposta vazia do serviço.');
  return String(texto).trim();
}
function compactar(msgs) {
  const sys = msgs[0].content;
  const hist = msgs.slice(1).map(m => (m.role === 'assistant' ? 'BLACK AI: ' : 'Utilizador: ') + m.content).join('\n\n');
  return (sys + '\n\n' + hist.slice(-2200) + '\n\nBLACK AI:').slice(0, 3600);
}
async function chamarIA(msgs) {
  const tentativas = [
    s => fetch('https://text.pollinations.ai/openai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'openai', messages: msgs, temperature: 0.4 }), signal: s }),
    s => fetch('https://gen.pollinations.ai/text/' + encodeURIComponent(compactar(msgs)), { signal: s }),
    s => fetch('https://text.pollinations.ai/' + encodeURIComponent(compactar(msgs)) + '?model=openai', { signal: s })
  ];
  let ultimoErro;
  for (const t of tentativas) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45000);
    try { return await lerResposta(await t(ctl.signal)); }
    catch (e) { ultimoErro = e; }
    finally { clearTimeout(timer); }
  }
  throw ultimoErro || new Error('Serviço gratuito indisponível.');
}

/* ---------- Wikipédia (sem chave) ---------- */
function deveBuscar(t) {
  if (t.length < 15) return false;
  if (/^(ol[áa]|oi|bom dia|boa tarde|boa noite|obrigad|ok\b|sim\b|n[ãa]o\b)/i.test(t)) return false;
  return !/^[\d\s+\-*/().=x^,]+$/i.test(t);
}
async function buscarWikipedia(q) {
  const lang = els.language.value === 'en' ? 'en' : 'pt';
  try {
    const url = 'https://' + lang + '.wikipedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: q, gsrlimit: '3', prop: 'extracts',
      exintro: '1', explaintext: '1', exchars: '1000', format: 'json', origin: '*' });
    const d = await (await fetch(url)).json();
    return Object.values(d.query?.pages || {}).sort((a, b) => a.index - b.index)
      .map(p => ({ titulo: p.title, texto: p.extract || '', link: 'https://' + lang + '.wikipedia.org/?curid=' + p.pageid }));
  } catch { return []; }
}

/* ---------- enviar ---------- */
function detectarArquivo(t) {
  t = t.toLowerCase();
  if (!/\b(pdf|txt|arquivo|ficheiro|documento|baixar|descarregar|relat[oó]rio)\b/.test(t)) return null;
  return /\btxt\b|texto simples/.test(t) ? 'txt' : 'pdf';
}
const ultimaResposta = c => [...c.messages].reverse().find(m => m.role === 'assistant');
const ERRO_IA = 'Não consegui ligar ao serviço gratuito de IA neste momento. Ele pode estar indisponível, limitado ou bloqueado pela rede.\n\n**O que podes fazer:**\n1. Confirma a ligação à Internet.\n2. Tenta novamente dentro de alguns minutos.\n\nDetalhe técnico: ';

async function send(text, opts = {}) {
  if (busy) return;
  text = (text || '').trim(); if (!text) return;
  if (!current()) newChat();
  const c = current(); sugVisible = false;

  const fmt = !opts.semBusca && ultimaResposta(c) ? detectarArquivo(text) : null;
  if (fmt) return criarDocumento(text, fmt);

  c.messages.push({ role: 'user', content: text });
  if (c.title === 'Nova conversa') c.title = titleFor(text);
  c.updated = Date.now(); c.messages = c.messages.slice(-80);
  saveChats(); els.prompt.value = ''; resizeInput(); renderAll(); setBusy(true);

  try {
    let fontes = [], contexto = '';
    if (!opts.semBusca && deveBuscar(text)) {
      fontes = (await buscarWikipedia(text)).filter(f => f.texto);
      contexto = fontes.map(f => '# ' + f.titulo + '\n' + f.texto).join('\n\n');
    }
    const conv = c.messages.slice(-12).map(m => ({ role: m.role, content: m.content }));
    if (contexto) conv[conv.length - 1].content = 'CONTEXTO (Wikipédia):\n' + contexto + '\n\nPERGUNTA: ' + text;
    const resposta = await chamarIA([{ role: 'system', content: regras() }, ...conv]);
    c.messages.push({ role: 'assistant', content: resposta, fontes: fontes.map(({ titulo, link }) => ({ titulo, link })) });
    sugVisible = true;
  } catch (err) {
    c.messages.push({ role: 'assistant', content: ERRO_IA + ((err && err.message) || 'erro desconhecido') });
  } finally { c.updated = Date.now(); setBusy(false); saveChats(); renderAll(); els.prompt.focus(); }
}

/* ---------- 5 sugestões de pedidos ---------- */
function montarSugestoes() {
  const itens = [
    ['Você quer que eu explique isso de forma mais simples?', () => send('Explica de forma mais simples a tua última resposta.', { semBusca: true })],
    ['Prefere que eu dê exemplos práticos?', () => send('Dá exemplos práticos sobre o assunto anterior.', { semBusca: true })],
    ['Quer que eu aprofunde com mais detalhes?', () => send('Aprofunda com mais detalhes o assunto anterior.', { semBusca: true })],
    ['Quer que eu crie um PDF com o resumo disso?', () => criarDocumento('Cria um resumo organizado do assunto', 'pdf')],
    ['Prefere que eu monte um arquivo de texto com os pontos principais?', () => criarDocumento('Lista os pontos principais do assunto', 'txt')]
  ];
  const box = document.createElement('div'); box.className = 'sug';
  const s = document.createElement('small'); s.textContent = 'Escolha um próximo passo:'; box.append(s);
  itens.forEach(([label, fn], i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = (i + 1) + '. ' + label; b.onclick = fn; box.append(b); });
  return box;
}

/* ---------- documentos (PDF/TXT) ---------- */
const limpar = t => String(t).replace(/```[\w+-]*\n?/g, '').replace(/\*\*/g, '').replace(/^#{1,3}\s*/gm, '');
function baixarArquivo(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a'); a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function gerarPdf(titulo, corpo) {
  if (!window.jspdf) { toast('A biblioteca de PDF não carregou. Verifique a internet.'); return false; }
  const doc = new window.jspdf.jsPDF(); const margem = 15, largura = 180, altura = 280; let y = 20;
  const escrever = (t, neg = false, tam = 11) => {
    doc.setFont('helvetica', neg ? 'bold' : 'normal'); doc.setFontSize(tam);
    doc.splitTextToSize(t, largura).forEach(l => { if (y > altura) { doc.addPage(); y = 20; } doc.text(l, margem, y); y += 6; });
  };
  escrever(titulo, true, 16); y += 2;
  escrever(new Date().toLocaleString('pt-PT') + '  |  BLACK AI - BLACK CORPORATION', false, 9); y += 4;
  limpar(corpo).split('\n').forEach(l => (l.trim() ? escrever(l) : (y += 3)));
  doc.save('black-ai-documento.pdf'); return true;
}
function textoConversa() {
  const c = current(); if (!c) return '';
  return c.messages.map(m => (m.role === 'user' ? (profile?.nome || 'Você') : 'BLACK AI') + ': ' + limpar(m.content) +
    (m.fontes?.length ? '\n\nFontes:\n' + m.fontes.map(f => '- ' + f.titulo + ' (' + f.link + ')').join('\n') : '')).join('\n\n----------\n\n');
}
async function criarDocumento(pedido, fmt) {
  const c = current(); const base = c && ultimaResposta(c);
  if (!base) return toast('Faça uma pergunta primeiro.');
  if (busy) return;
  sugVisible = false;
  c.messages.push({ role: 'user', content: pedido }); saveChats(); renderAll(); setBusy(true);
  try {
    const corpoIA = await chamarIA([
      { role: 'system', content: 'Escreves documentos em português, em texto puro (sem markdown), com título na primeira linha, parágrafos curtos e lista com "- " quando fizer sentido. Não inventes factos.' },
      { role: 'user', content: 'Pedido: ' + pedido + '\n\nConteúdo base:\n' + base.content }
    ]);
    const linhas = limpar(corpoIA).trim().split('\n');
    const titulo = (linhas[0] || 'Resumo').slice(0, 80);
    let corpo = linhas.slice(1).join('\n').trim() || corpoIA;
    if (base.fontes?.length) corpo += '\n\nFontes:\n' + base.fontes.map(f => '- ' + f.titulo + ' (' + f.link + ')').join('\n');
    let ok = true;
    if (fmt === 'pdf') ok = gerarPdf(titulo, corpo); else baixarArquivo('black-ai-documento.txt', titulo + '\n\n' + corpo, 'text/plain;charset=utf-8');
    c.messages.push({ role: 'assistant', content: ok ? 'Pronto! Baixei **' + titulo + '** em ' + fmt.toUpperCase() + '.' : 'Não consegui gerar o PDF agora. Tente o TXT ou verifique a internet.' });
  } catch (e) { c.messages.push({ role: 'assistant', content: 'Não consegui criar o arquivo. Tente de novo em instantes.' }); }
  finally { setBusy(false); saveChats(); renderAll(); }
}

/* ---------- eventos do chat ---------- */
function resizeInput() { els.prompt.style.height = 'auto'; els.prompt.style.height = Math.min(els.prompt.scrollHeight, 160) + 'px'; }
$('newChat').onclick = newChat;
els.form.addEventListener('submit', e => { e.preventDefault(); send(els.prompt.value); });
els.prompt.addEventListener('input', resizeInput);
els.prompt.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); els.form.requestSubmit(); } });
document.querySelectorAll('.suggestion').forEach(b => b.addEventListener('click', () => send(b.dataset.prompt)));
$('menuBtn').onclick = () => els.sidebar.classList.toggle('open');
$('clearBtn').onclick = () => { const c = current(); if (!c) return; c.messages = []; c.title = 'Nova conversa'; sugVisible = false; saveChats(); renderAll(); toast('Conversa limpa.'); };
$('settingsBtn').onclick = () => els.dialog.showModal();
$('saveSettings').onclick = () => {
  settings = { saveHistory: els.saveHistory.checked }; store.set(K.settings, settings);
  if (!settings.saveHistory) { store.del(K.chats); toast('Histórico local desativado.'); } else saveChats();
  els.dialog.close(); toast('Definições guardadas.');
};
els.language.addEventListener('change', () => toast(els.language.value === 'en' ? 'Language set to English.' : 'Idioma definido para Português.'));
$('btnTxt').onclick = () => { const t = textoConversa(); if (!t) return toast('Faça uma pergunta primeiro.'); baixarArquivo('black-ai-conversa.txt', t, 'text/plain;charset=utf-8'); };
$('btnPdf').onclick = () => { const t = textoConversa(); if (!t) return toast('Faça uma pergunta primeiro.'); gerarPdf('Conversa BLACK AI', t); };
window.addEventListener('online', () => els.connection.textContent = 'Ligação disponível');
window.addEventListener('offline', () => els.connection.textContent = 'Sem Internet');

/* =====================================================
   FEEDBACK (6 estrelas -> e-mail da empresa)
   ===================================================== */
const LABELS = ['Muito insatisfeito', 'Insatisfeito', 'Pouco satisfeito', 'Satisfeito', 'Muito satisfeito', 'Excelente'];
let estrelas = 0;
const starsBox = $('stars');
for (let i = 1; i <= 6; i++) { const b = document.createElement('button'); b.type = 'button'; b.textContent = '☆'; b.setAttribute('aria-label', i + ' estrela' + (i > 1 ? 's' : '')); b.onclick = () => escolherEstrelas(i); starsBox.append(b); }
function pintarEstrelas() { [...starsBox.children].forEach((b, i) => b.textContent = i < estrelas ? '★' : '☆'); }
function escolherEstrelas(n) {
  estrelas = n; pintarEstrelas();
  $('fbLabel').textContent = n + ' de 6 — ' + LABELS[n - 1];
  const assunto = 'Feedback BLACK AI - ' + n + '/6 estrelas';
  const corpo = 'Avaliação: ' + n + ' de 6 estrelas\nNome: ' + (profile?.nome || '') + '\n\nEscreva aqui a sua sugestão, reclamação ou agradecimento:\n\n';
  $('fbMailto').href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(assunto) + '&body=' + encodeURIComponent(corpo);
  $('fbGmail').href = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(EMAIL) + '&su=' + encodeURIComponent(assunto) + '&body=' + encodeURIComponent(corpo);
  $('fbAfter').classList.remove('hidden');
}
$('fbFab').onclick = () => $('fbPanel').classList.toggle('hidden');
$('fbClose').onclick = () => $('fbPanel').classList.add('hidden');


/* =====================================================
   POP-UP PARA INSTALAR NO CELULAR
   ===================================================== */
let installEvt = null;
const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = isIOS || /Android/i.test(navigator.userAgent);
const popVisivel = () => !$('installPop').classList.contains('hidden');

function abrirInstalar(forcar) {
  if (standalone()) return;
  if (!installEvt && !isMobile) { if (forcar) toast('Use o menu do navegador para instalar o app.'); return; }
  const yes = $('installYes');
  if (installEvt) {
    $('installMsg').textContent = 'Tenha a BLACK AI na tela inicial do seu celular, como um app. É grátis e abre em tela cheia.';
    yes.textContent = 'Instalar agora'; yes.dataset.mode = 'prompt';
  } else if (isIOS) {
    $('installMsg').textContent = 'No Safari, toque em Compartilhar (o quadrado com a seta) e depois em «Adicionar à Tela de Início».';
    yes.textContent = 'Entendi'; yes.dataset.mode = 'ok';
  } else {
    $('installMsg').textContent = 'Toque no menu ⋮ do navegador e escolha «Instalar app» ou «Adicionar à tela inicial».';
    yes.textContent = 'Entendi'; yes.dataset.mode = 'ok';
  }
  $('installPop').classList.remove('hidden');
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installEvt = e;
  if (!$('appShell').classList.contains('hidden')) { $('installSide').classList.remove('hidden'); if (popVisivel()) abrirInstalar(false); }
});
window.addEventListener('appinstalled', () => {
  installEvt = null; $('installPop').classList.add('hidden'); $('installSide').classList.add('hidden'); toast('BLACK AI instalada!');
});
$('installYes').onclick = async () => {
  if ($('installYes').dataset.mode === 'prompt' && installEvt) {
    installEvt.prompt();
    try { await installEvt.userChoice; } catch {}
    installEvt = null;
  }
  $('installPop').classList.add('hidden');
};
$('installNo').onclick = () => { $('installPop').classList.add('hidden'); store.set(K.installDismiss, Date.now()); };
$('installSide').onclick = () => { $('sidebar').classList.remove('open'); abrirInstalar(true); };
function talvezMostrarInstalar() {
  if (standalone()) { $('installSide').classList.add('hidden'); return; }
  if (isMobile || installEvt) $('installSide').classList.remove('hidden');
  if (Date.now() - store.get(K.installDismiss, 0) < 3 * 86400000) return; // não insistir por 3 dias
  setTimeout(() => { if (!$('appShell').classList.contains('hidden')) abrirInstalar(false); }, 1800);
}

/* =====================================================
   ENTRAR NO APP
   ===================================================== */
function entrar() {
  $('login').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  $('fbFab').classList.remove('hidden');
  estrelas = 0; pintarEstrelas(); $('fbAfter').classList.add('hidden');
  initChats(); renderAll();
  els.connection.textContent = navigator.onLine ? 'Ligação disponível' : 'Sem Internet';
  talvezMostrarInstalar();
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
if (profile && sess.get()) entrar(); else mostrarLogin();
})();
