"use strict";
/* Lav & Lov · Sistema de Rotinas
   Site estático (GitHub Pages) + Supabase. As regras de verdade (perfil, PIN, baixa,
   desfazer) estão no banco; aqui é só a tela. */

const sb = window.supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

/* ---------------- datas (sempre 'AAAA-MM-DD', horário local) ---------------- */
const pad = n => String(n).padStart(2, "0");
const localDate = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => localDate(new Date());
const dnum = s => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const dstr = n => { const d = new Date(n * 864e5); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); };
const addDays = (s, k) => dstr(dnum(s) + k);
const diffDays = (a, b) => dnum(b) - dnum(a);
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dow = s => new Date(dnum(s) * 864e5).getUTCDay();
const fmtD = s => s.slice(8, 10) + "/" + s.slice(5, 7);
const fmtDY = s => fmtD(s) + "/" + s.slice(2, 4);
const fmtWD = s => WD[dow(s)] + " " + fmtD(s);
const isoLocal = iso => iso ? localDate(new Date(iso)) : "";
const fmtTime = iso => { const d = new Date(iso); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const fmtDT = iso => iso ? fmtD(isoLocal(iso)) + " " + fmtTime(iso) : "";
const nowTime = () => { const d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const plural = (n, a, b) => n + " " + (n === 1 ? a : b);

const FREQ = {
  diario:     { n: 1,  u: "dia", modo: "fixo",   label: "Diário" },
  alternado:  { n: 2,  u: "dia", modo: "fixo",   label: "Dia sim, dia não" },
  semanal:    { n: 7,  u: "dia", modo: "ultima", label: "Semanal" },
  quinzenal:  { n: 15, u: "dia", modo: "ultima", label: "Quinzenal" },
  mensal:     { n: 1,  u: "mes", modo: "ultima", label: "Mensal" },
  trimestral: { n: 3,  u: "mes", modo: "ultima", label: "Trimestral" },
  semestral:  { n: 6,  u: "mes", modo: "ultima", label: "Semestral" },
  anual:      { n: 12, u: "mes", modo: "ultima", label: "Anual" }
};
const ESCOPO = { itens: "Itens (checklist)", lavadoras: "Por lavadora", secadoras: "Por secadora", maquinas: "Por máquina (todas)" };

/* ---------------- estado ---------------- */
const S = {
  user: null, isAdmin: false, op: null, token: null,
  d: { unidades: [], maquinas: [], perfis: [], categorias: [], funcionarios: [], rotinas: [], rotina_perfis: [],
       rotina_unidades: [], itens: [], tarefas: [], execucoes: [], corretivas: [], funcionario_unidades: [], missoes: [] },
  idx: {}, loaded: false,
  unit: lsGet("unit"), cat: "todas", view: "hoje", logRange: "24h",
  modalOpen: false, report: null
};
function lsGet(k) { try { return localStorage.getItem("lavlov." + k); } catch (e) { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem("lavlov." + k) : localStorage.setItem("lavlov." + k, v); } catch (e) {} }
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byOrd = (a, b) => (a.ordem || 0) - (b.ordem || 0) || String(a.nome || a.titulo || a.codigo || "").localeCompare(String(b.nome || b.titulo || b.codigo || ""), "pt-BR");

/* ---------------- dados ---------------- */
async function fetchAll(build) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) return out;
  }
}
async function loadAll() {
  const T = today();
  const desde = addDays(T, -70);
  const q = t => sb.from(t).select("*");
  const [unidades, maquinas, perfis, categorias, funcionarios, rotinas, rotina_perfis, rotina_unidades, itens, tarefas, corretivas, execucoes, funcionario_unidades, missoes] = await Promise.all([
    fetchAll(() => q("unidades")), fetchAll(() => q("maquinas")), fetchAll(() => q("perfis")), fetchAll(() => q("categorias")),
    fetchAll(() => sb.from("funcionarios").select("id,nome,perfil_id,ativo,user_id")),
    fetchAll(() => q("rotinas")), fetchAll(() => q("rotina_perfis")), fetchAll(() => q("rotina_unidades")),
    fetchAll(() => q("itens")), fetchAll(() => q("tarefas")),
    fetchAll(() => q("corretivas").order("aberta_em", { ascending: false })),
    fetchAll(() => sb.from("execucoes").select("*").or(`data_ref.gte.${desde},feito_em.gte.${desde}`).order("id")),
    fetchAll(() => q("funcionario_unidades")),
    fetchAll(() => q("missoes").order("criada_em"))
  ]);
  S.d = { unidades, maquinas, perfis, categorias, funcionarios, rotinas, rotina_perfis, rotina_unidades, itens, tarefas, execucoes, corretivas, funcionario_unidades, missoes };
  buildIndex();
  S.loaded = true;
  const us = allowedUnits();
  if (!us.some(u => u.id === S.unit)) S.unit = us.length ? us[0].id : null;
}
/* lavanderias em que o operador pode atuar (e, se o aparelho estiver fixado, só a dele) */
function allowedUnits() {
  let us = units();
  if (!S.op) return [];
  if (!S.op.is_admin) {
    const ok = new Set(S.d.funcionario_unidades.filter(x => x.funcionario_id === S.op.funcionario_id).map(x => x.unidade_id));
    us = us.filter(u => ok.has(u.id));
  }
  const fixo = lsGet("fixo");
  if (fixo && S.idx.unidade && S.idx.unidade.get(fixo)) us = us.filter(u => u.id === fixo);
  return us;
}
const shortUnit = id => { const u = S.idx.unidade && S.idx.unidade.get(id); return u ? u.nome.split("–").pop().trim() : ""; };
function buildIndex() {
  const m = a => new Map(a.map(x => [x.id, x]));
  const I = S.idx = {
    unidade: m(S.d.unidades), maquina: m(S.d.maquinas), perfil: m(S.d.perfis), categoria: m(S.d.categorias),
    func: m(S.d.funcionarios), rotina: m(S.d.rotinas), item: m(S.d.itens), tarefa: m(S.d.tarefas),
    exByTask: new Map(), perfisDe: new Map(), unidadesDe: new Map()
  };
  for (const e of S.d.execucoes) { if (!I.exByTask.has(e.tarefa_id)) I.exByTask.set(e.tarefa_id, []); I.exByTask.get(e.tarefa_id).push(e); }
  for (const rp of S.d.rotina_perfis) { if (!I.perfisDe.has(rp.rotina_id)) I.perfisDe.set(rp.rotina_id, new Set()); I.perfisDe.get(rp.rotina_id).add(rp.perfil_id); }
  for (const ru of S.d.rotina_unidades) { if (!I.unidadesDe.has(ru.rotina_id)) I.unidadesDe.set(ru.rotina_id, new Set()); I.unidadesDe.get(ru.rotina_id).add(ru.unidade_id); }
}
const units = () => S.d.unidades.slice().sort(byOrd);
const funcName = id => (S.idx.func && S.idx.func.get(id) || {}).nome || "—";
function tarefaLabel(t) {
  if (t.item_id) return (S.idx.item.get(t.item_id) || {}).titulo || "Item";
  if (t.maquina_id) return (S.idx.maquina.get(t.maquina_id) || {}).codigo || "Máquina";
  return "—";
}
function tarefaOrdem(t) {
  if (t.item_id) return (S.idx.item.get(t.item_id) || {}).ordem || 0;
  const m = S.idx.maquina.get(t.maquina_id) || {};
  return (m.tipo === "secadora" ? 100 : 0) + (m.ordem || 0);
}
function canSee(r) {
  if (!S.op) return false;
  if (S.op.is_admin) return true;
  const ps = S.idx.perfisDe.get(r.id);
  return !!ps && ps.has(S.op.perfil_id);
}

/* ---------------- situação de cada tarefa ---------------- */
function clsFor(atraso) { return atraso <= 0 ? "hoje" : atraso <= 6 ? "amarelo" : "vermelho"; }
const SEV = { vermelho: 4, amarelo: 3, hoje: 2, feito: 1, futuro: 0 };
function taskState(t) {
  const r = S.idx.rotina.get(t.rotina_id); const f = FREQ[r.freq]; const T = today();
  const ex = S.idx.exByTask.get(t.id) || [];
  const done = ex.filter(e => e.status !== "nao_feita" && e.feito_em).sort((a, b) => b.feito_em.localeCompare(a.feito_em));
  const doneToday = done.find(e => isoLocal(e.feito_em) === T) || null;
  const last = done[0] || null;
  if (f.modo === "fixo") {
    const refs = new Set(ex.map(e => e.data_ref));
    const start = t.inicio > addDays(T, -60) ? t.inicio : addDays(T, -60);
    const k = Math.ceil(diffDays(t.inicio, start) / f.n);
    const pend = [];
    for (let d = addDays(t.inicio, k * f.n); d <= T; d = addDays(d, f.n)) if (!refs.has(d)) pend.push(d);
    if (pend.length) { const atraso = diffDays(pend[0], T); return { modo: "fixo", pend, atraso, cls: clsFor(atraso), doneToday, last }; }
    const next = t.inicio > T ? t.inicio : addDays(t.inicio, (Math.floor(diffDays(t.inicio, T) / f.n) + 1) * f.n);
    return { modo: "fixo", pend, next, cls: doneToday ? "feito" : "futuro", doneToday, last };
  }
  const due = t.proxima_data;
  if (due && due <= T) { const atraso = diffDays(due, T); return { modo: "ultima", pend: [due], atraso, cls: clsFor(atraso), doneToday, last }; }
  return { modo: "ultima", pend: [], next: due, cls: doneToday ? "feito" : "futuro", doneToday, last };
}
function stateText(t, st) {
  if (st.pend.length) {
    if (st.atraso <= 0) return "Para hoje";
    if (st.modo === "fixo") return "Sem baixa há " + plural(st.atraso, "dia", "dias");
    return "Venceu há " + plural(st.atraso, "dia", "dias") + " (" + fmtD(st.pend[0]) + ")";
  }
  if (st.doneToday && st.doneToday.status === "problema") return "Problema registrado " + fmtTime(st.doneToday.feito_em) + " · " + funcName(st.doneToday.funcionario_id);
  if (st.doneToday) return "Feito " + fmtTime(st.doneToday.feito_em) + " · " + funcName(st.doneToday.funcionario_id);
  return st.next ? "Próxima: " + fmtWD(st.next) : "Sem data";
}

/* monta os cartões da unidade atual */
function cardsModel() {
  const T = today(); const semana = addDays(T, 7);
  const out = [];
  for (const r of S.d.rotinas) {
    if (!r.ativa || !canSee(r)) continue;
    if (S.cat !== "todas" && S.cat !== "corretivas" && r.categoria_id !== S.cat) continue;
    const ts = S.d.tarefas.filter(t => t.rotina_id === r.id && t.unidade_id === S.unit && t.ativa).sort((a, b) => tarefaOrdem(a) - tarefaOrdem(b));
    if (!ts.length) continue;
    const items = ts.map(t => ({ t, st: taskState(t) }));
    const worst = items.reduce((w, x) => SEV[x.st.cls] > SEV[w] ? x.st.cls : w, "futuro");
    const pending = items.filter(x => x.st.pend.length).length;
    const doneT = items.filter(x => !x.st.pend.length && x.st.doneToday).length;
    let group;
    if (worst === "vermelho" || worst === "amarelo") group = "atrasadas";
    else if (worst === "hoje") group = "hoje";
    else if (items.some(x => x.st.next && x.st.next <= semana)) group = "semana";
    else if (doneT) group = "feitas";
    else group = "depois";
    const soonest = items.reduce((m, x) => { const d = x.st.pend[0] || x.st.next || "9999"; return d < m ? d : m; }, "9999");
    out.push({ r, items, worst, pending, doneT, group, soonest });
  }
  return out;
}

/* ---------------- telas ---------------- */
const $app = document.getElementById("app");
const $modal = document.getElementById("modal");

function render() {
  if (!S.user) return renderLogin();
  if (!S.op) return renderPinScreen();
  if (!S.loaded) { $app.innerHTML = '<div class="center-screen"><img src="logo.png" class="logo-big" alt="Lav & Lov"><p class="muted">Carregando…</p></div>'; return; }
  let body = "";
  if (S.view === "hoje") body = hojeHtml();
  else if (S.view === "rotinas") body = rotinasHtml();
  else if (S.view === "equipe") body = equipeHtml();
  else if (S.view === "cadastros") body = cadastrosHtml();
  else if (S.view === "relatorio") body = relatorioHtml();
  $app.innerHTML = topHtml() + body;
}

function topHtml() {
  const nav = S.isAdmin ? '<nav class="admin-nav no-print">' + [["hoje", "Rotinas do dia"], ["rotinas", "Cadastro de rotinas"], ["equipe", "Equipe"], ["cadastros", "Unidades e perfis"], ["relatorio", "Relatório"]]
    .map(([v, l]) => '<button data-act="view" data-v="' + v + '" aria-current="' + (S.view === v) + '">' + l + '</button>').join("") + '</nav>' : "";
  const fixo = lsGet("fixo");
  const pin = S.op.is_admin ? '<button class="btn small" data-act="fixar">📍 ' + (fixo && S.idx.unidade.get(fixo) ? esc(shortUnit(fixo)) : "Aparelho livre") + '</button>' : "";
  const opBtns = pin + (S.isAdmin
    ? '<button class="btn small" data-act="logout">Sair da conta</button>'
    : '<button class="btn" data-act="trocar">Trocar</button><button class="btn" data-act="sair-op">Sair</button>');
  return '<header class="top"><div class="top-row"><img src="logo.png" alt="Lav & Lov" class="logo"><div class="op"><span class="op-chip">' + esc(S.op.nome) + '<small>' + esc(S.op.perfil || "") + '</small></span>' + opBtns + '</div></div>' + nav + '</header>';
}

function unitTabsHtml() {
  return '<div class="unit-tabs" role="tablist">' + allowedUnits().map(u => '<button role="tab" data-act="unit" data-id="' + u.id + '" aria-current="' + (u.id === S.unit) + '">' + esc(u.nome) + '</button>').join("") + '</div>';
}
function catsHtml(openCorr) {
  const cs = S.d.categorias.slice().sort(byOrd);
  let h = '<div class="cats"><button data-act="cat" data-id="todas" aria-pressed="' + (S.cat === "todas") + '">Todas</button>';
  h += cs.map(c => '<button data-act="cat" data-id="' + c.id + '" aria-pressed="' + (S.cat === c.id) + '">' + esc(c.nome) + '</button>').join("");
  if (S.isAdmin) h += '<button data-act="cat" data-id="corretivas" aria-pressed="' + (S.cat === "corretivas") + '">Corretivas' + (openCorr ? '<span class="badge num">' + openCorr + '</span>' : "") + '</button>';
  return h + '</div>';
}

function hojeHtml() {
  if (!S.unit) return '<div class="page"><p class="empty">Você ainda não está liberado para nenhuma lavanderia. Fale com o Oscar.</p></div>';
  const corrs = S.d.corretivas.filter(c => c.status === "aberta" && c.unidade_id === S.unit);
  const cards = cardsModel();
  const G = { atrasadas: [], hoje: [], semana: [], feitas: [] };
  for (const c of cards) if (G[c.group]) G[c.group].push(c);
  G.atrasadas.sort((a, b) => SEV[b.worst] - SEV[a.worst] || a.soonest.localeCompare(b.soonest));
  G.hoje.sort((a, b) => (a.r.ordem || 0) - (b.r.ordem || 0));
  G.semana.sort((a, b) => a.soonest.localeCompare(b.soonest));
  let main = "";
  if (S.isAdmin && (S.cat === "todas" || S.cat === "corretivas") && corrs.length) {
    main += groupHtml("Corretivas abertas", corrs.length, '<div class="cards">' + corrs.map(corrHtml).join("") + '</div>');
  }
  if (S.cat === "todas") main += missoesHtml();
  if (S.cat !== "corretivas") {
    if (G.atrasadas.length) main += groupHtml("Atrasadas", G.atrasadas.length, cardsGrid(G.atrasadas));
    main += groupHtml("Hoje", G.hoje.length, G.hoje.length ? cardsGrid(G.hoje) : '<p class="empty">' + (G.atrasadas.length ? "Nada novo para hoje. Resolva as atrasadas acima." : "Tudo em dia por hoje!") + '</p>');
    if (G.semana.length) main += groupHtml("Esta semana", G.semana.length, cardsGrid(G.semana));
    if (G.feitas.length) main += groupHtml("Concluídas hoje", G.feitas.length, cardsGrid(G.feitas));
  } else if (!corrs.length) main += '<p class="empty">Nenhuma corretiva aberta nesta unidade.</p>';
  return unitTabsHtml() + catsHtml(S.d.corretivas.filter(c => c.status === "aberta" && c.unidade_id === S.unit).length) +
    '<div class="main"><section class="col">' + main + '</section>' + logHtml() + '</div>';
}
function missaoState(m) {
  const T = today();
  if (!m.prazo) return { cls: "hoje", txt: "Sem prazo" };
  if (m.prazo > T) return { cls: "futuro", txt: "Prazo: " + fmtWD(m.prazo) };
  const a = diffDays(m.prazo, T);
  return { cls: clsFor(a), txt: a === 0 ? "Prazo: hoje" : "Prazo venceu há " + plural(a, "dia", "dias") };
}
function missoesHtml() {
  const T = today();
  const abertas = S.d.missoes.filter(m => m.status === "aberta" && (!m.unidade_id || m.unidade_id === S.unit))
    .sort((a, b) => (a.prazo || "9999").localeCompare(b.prazo || "9999"));
  const feitasHoje = S.d.missoes.filter(m => m.status === "concluida" && m.concluida_unidade === S.unit && isoLocal(m.concluida_em) === T);
  if (!abertas.length && !feitasHoje.length && !S.isAdmin) return "";
  const add = S.isAdmin ? '<button class="btn small primary" data-act="mis-new" style="margin-left:auto">+ Nova missão</button>' : "";
  const card = m => {
    const st = m.status === "aberta" ? missaoState(m) : { cls: "feito", txt: (m.problema ? "Problema registrado " : "Concluída ") + fmtTime(m.concluida_em) + " · " + funcName(m.concluida_por) };
    const onde = m.unidade_id ? "" : " · qualquer lavanderia";
    const edit = S.isAdmin && m.status === "aberta" ? '<button class="btn small" data-act="mis-edit" data-id="' + m.id + '">Editar</button>' : "";
    const btns = m.status === "aberta"
      ? '<button class="item-main" data-act="mis-tap" data-id="' + m.id + '"><span class="ic"></span><span class="tx"><span class="nm">Concluir missão</span><span class="sb">' + esc(st.txt) + '</span></span></button><button class="item-more" data-act="mis-more" data-id="' + m.id + '" aria-label="Mais opções">⋯</button>'
      : '<div class="item-main"><span class="ic">✓</span><span class="tx"><span class="sb">' + esc(st.txt) + '</span></span></div>';
    return '<article class="card missao st-' + st.cls + '"><div class="card-h"><div><h3>' + esc(m.titulo) + '</h3><div class="meta">Missão extra' + onde + '</div></div><span style="margin-left:auto">' + edit + '</span></div>' +
      (m.descricao ? '<p class="howto" style="margin:0 14px 8px;white-space:pre-wrap">' + esc(m.descricao) + '</p>' : "") +
      '<ul class="items"><li class="item st-' + st.cls + '">' + btns + '</li></ul></article>';
  };
  const list = abertas.concat(feitasHoje);
  return '<div class="group-h"><h2>Missões extras</h2><span class="count num">' + abertas.length + '</span>' + add + '</div>' +
    (list.length ? '<div class="cards">' + list.map(card).join("") + '</div>' : '<p class="empty">Nenhuma missão aberta.</p>');
}
function groupHtml(title, n, inner) {
  return '<div class="group-h"><h2>' + title + '</h2><span class="count num">' + n + '</span></div>' + inner;
}
const cardsGrid = list => '<div class="cards">' + list.map(cardHtml).join("") + '</div>';
function cardHtml(c) {
  const r = c.r; const cat = S.idx.categoria.get(r.categoria_id);
  const total = c.pending + c.doneT;
  const prog = total > 1 || c.items.length > 1 ? '<span class="prog num">' + c.doneT + "/" + (total || c.items.length) + '</span>' : "";
  const how = r.instrucoes ? '<details class="howto"><summary>Como fazer</summary><p>' + esc(r.instrucoes) + '</p></details>' : "";
  const items = c.items.map(({ t, st }) => {
    const icon = st.cls === "feito" ? "✓" : st.pend.length ? "" : "";
    const single = c.items.length === 1 && tarefaLabel(t) === r.titulo;
    return '<li class="item st-' + st.cls + '"><button class="item-main" data-act="tap" data-id="' + t.id + '"><span class="ic">' + icon + '</span><span class="tx">' +
      (single ? "" : '<span class="nm">' + esc(tarefaLabel(t)) + '</span>') + '<span class="sb">' + esc(stateText(t, st)) + '</span></span></button>' +
      '<button class="item-more" data-act="more" data-id="' + t.id + '" aria-label="Mais opções">⋯</button></li>';
  }).join("");
  return '<article class="card st-' + c.worst + '"><div class="card-h"><div><h3>' + esc(r.titulo) + '</h3><div class="meta">' + esc(cat ? cat.nome : "") + " · " + esc(FREQ[r.freq].label) + '</div></div>' + prog + '</div>' + how + '<ul class="items">' + items + '</ul></article>';
}
function corrHtml(c) {
  const t = S.idx.tarefa.get(c.tarefa_id); const r = t && S.idx.rotina.get(t.rotina_id);
  const mi = c.missao_id && S.d.missoes.find(x => x.id === c.missao_id);
  const origem = mi ? "Missão extra · " + esc(mi.titulo) : esc(r ? r.titulo : "") + (t ? " · " + esc(tarefaLabel(t)) : "");
  return '<article class="corr"><h3>' + esc(c.descricao) + '</h3><div class="muted">' + origem + '</div><div class="muted">Aberta ' + esc(fmtDT(c.aberta_em)) + ' por ' + esc(funcName(c.aberta_por)) + '</div><div class="acts">' +
    (c.foto_path ? '<button class="btn small" data-act="foto" data-path="' + esc(c.foto_path) + '">Ver foto</button>' : "") +
    '<button class="btn small primary" data-act="encerrar" data-id="' + c.id + '">Encerrar</button></div></article>';
}
function logHtml() {
  const lim = { "24h": 1, "7d": 7, "30d": 30 }[S.logRange];
  const since = Date.now() - lim * 864e5;
  const rows = S.d.execucoes.filter(e => e.status !== "nao_feita" && e.feito_em && Date.parse(e.feito_em) >= since)
    .filter(e => { const t = S.idx.tarefa.get(e.tarefa_id); return t && t.unidade_id === S.unit && canSee(S.idx.rotina.get(t.rotina_id)); })
    .map(e => ({ kind: "rot", at: e.feito_em, e }))
    .concat(S.d.missoes.filter(m => m.status === "concluida" && m.concluida_unidade === S.unit && Date.parse(m.concluida_em) >= since).map(m => ({ kind: "mis", at: m.concluida_em, m })))
    .sort((a, b) => b.at.localeCompare(a.at));
  let h = '<aside class="log"><div class="log-h"><h2>Registro</h2><div class="seg">' +
    ["24h", "7d", "30d"].map(k => '<button data-act="range" data-v="' + k + '" aria-pressed="' + (S.logRange === k) + '">' + (k === "24h" ? "24 h" : k === "7d" ? "7 dias" : "30 dias") + '</button>').join("") + '</div></div>';
  if (!rows.length) return h + '<p class="muted">Nenhuma baixa neste período.</p></aside>';
  let lastDay = "";
  for (const row of rows.slice(0, 200)) {
    const day = isoLocal(row.at);
    if (day !== lastDay) { h += '<div class="log-day">' + esc(DIAS[dow(day)].charAt(0).toUpperCase() + DIAS[dow(day)].slice(1) + ", " + Number(day.slice(8)) + " de " + MESES[Number(day.slice(5, 7)) - 1]) + '</div>'; lastDay = day; }
    if (row.kind === "mis") {
      const m = row.m;
      h += '<div class="log-row"><span class="dot' + (m.problema ? ' problema"' : '" style="background:var(--brand)"') + '></span><div><div class="t">Missão: ' + esc(m.titulo) + '</div><div class="s">' + (m.problema ? "Problema · " : "") + esc(funcName(m.concluida_por)) + (m.obs ? " · " + esc(m.obs) : "") + '</div>' +
        (S.isAdmin ? '<div style="display:flex;gap:6px;margin-top:4px">' + (m.foto_path ? '<button class="btn small" data-act="foto" data-path="' + esc(m.foto_path) + '">Foto</button>' : "") + '<button class="btn small" data-act="undo-admin" data-kind="mis" data-id="' + m.id + '">Desfazer</button></div>' : "") +
        '</div><span class="hr num">' + fmtTime(m.concluida_em) + '</span></div>';
      continue;
    }
    const e = row.e;
    const t = S.idx.tarefa.get(e.tarefa_id); const r = S.idx.rotina.get(t.rotina_id);
    const lbl = tarefaLabel(t);
    h += '<div class="log-row"><span class="dot ' + e.status + '"></span><div><div class="t">' + esc(r.titulo) + (lbl !== r.titulo ? " · " + esc(lbl) : "") + '</div><div class="s">' +
      (e.status === "problema" ? "Problema · " : "") + esc(funcName(e.funcionario_id)) + (e.obs ? " · " + esc(e.obs) : "") + '</div>' +
      (S.isAdmin ? '<div style="display:flex;gap:6px;margin-top:4px">' + (e.foto_path ? '<button class="btn small" data-act="foto" data-path="' + esc(e.foto_path) + '">Foto</button>' : "") + '<button class="btn small" data-act="undo-admin" data-id="' + e.id + '">Desfazer</button></div>' : "") +
      '</div><span class="hr num">' + fmtTime(e.feito_em) + '</span></div>';
  }
  return h + '</aside>';
}

/* ---------- entrada ---------- */
function renderLogin() {
  $app.innerHTML = '<div class="center-screen"><img src="logo.png" alt="Lav & Lov" class="logo-big"><form class="login-box" id="f-login"><h2>Entrar</h2>' +
    '<div class="field"><label for="l-email">E-mail</label><input type="email" id="l-email" autocomplete="username" required></div>' +
    '<div class="field"><label for="l-pass">Senha</label><input type="password" id="l-pass" autocomplete="current-password" required></div>' +
    '<p class="err" id="l-err"></p><button class="btn primary" type="submit">Entrar</button>' +
    '<p class="hint">No monitor da loja, use a conta da lavanderia. Ela fica conectada.</p></form></div>';
}
let pinBuf = "";
function renderPinScreen() {
  $app.innerHTML = '<div class="center-screen"><img src="logo.png" alt="Lav & Lov" class="logo-big"><button class="big-enter" data-act="pin-open">Toque para entrar</button>' +
    '<button class="foot-link" data-act="logout">Desconectar este aparelho</button></div>';
}
function pinModal(err) {
  openModal('<div class="modal-bg" data-act="close-bg"><div class="modal" style="max-width:380px;align-items:center;text-align:center" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">Digite seu PIN</h2>' +
    '<div class="pin-dots">' + [0, 1, 2, 3, 4, 5].map(i => '<i class="' + (i < pinBuf.length ? "on" : "") + '"' + (i >= Math.max(4, pinBuf.length) ? " hidden" : "") + '></i>').join("") + '</div>' +
    '<div class="pin-err">' + esc(err || "") + '</div><div class="keypad">' +
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => '<button data-act="pin-key" data-k="' + n + '">' + n + '</button>').join("") +
    '<button class="k-del" data-act="pin-del">Apagar</button><button data-act="pin-key" data-k="0">0</button><button class="k-ok" data-act="pin-ok">Entrar</button></div>' +
    '<button class="btn" data-act="close">Cancelar</button></div></div>');
}
async function pinSubmit() {
  if (pinBuf.length < 4) return pinModal("O PIN tem de 4 a 6 números.");
  const pin = pinBuf; pinBuf = "";
  const { data, error } = await sb.rpc("entrar_pin", { p_pin: pin });
  if (error) return pinModal(cleanErr(error));
  S.token = data.token; S.op = data; lsSet("op", JSON.stringify(data));
  closeModal();
  await refresh(true);
}

/* ---------- baixa ---------- */
let undoTimer = null;
function showUndo(text, execId, kind) {
  const el = document.getElementById("toast");
  clearInterval(undoTimer);
  let left = 10;
  const draw = () => { el.innerHTML = '<span>✓ ' + esc(text) + '</span><button data-act="undo" data-kind="' + (kind || "rot") + '" data-id="' + execId + '">Desfazer (' + left + ')</button>'; };
  draw(); el.hidden = false;
  undoTimer = setInterval(() => { left--; if (left <= 0) { clearInterval(undoTimer); el.hidden = true; } else draw(); }, 1000);
}
function toast(msg, ms) {
  const el = document.getElementById("toast");
  clearInterval(undoTimer);
  el.innerHTML = '<span>' + esc(msg) + '</span>'; el.hidden = false;
  undoTimer = setTimeout(() => { el.hidden = true; }, ms || 3500);
}
function cleanErr(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/SESSAO_INVALIDA/.test(m)) { dropOp(); return "Sua sessão terminou. Entre de novo com o PIN."; }
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sem internet. Tente de novo.";
  return m.replace(/^.*?ERROR:\s*/, "");
}
function dropOp() { S.op = null; S.token = null; lsSet("op", null); }
let busy = false;
async function tapBaixa(tid) {
  if (busy) return;
  const t = S.idx.tarefa.get(tid); const st = taskState(t);
  if (!st.pend.length) {
    toast(st.doneToday ? "Já tem baixa hoje." : "Ainda não está na hora. Para lançar antes, use o botão ⋯.");
    return;
  }
  busy = true;
  const { data, error } = await sb.rpc("registrar_baixa", { p_token: S.token, p_tarefa: tid });
  busy = false;
  if (error) { toast(cleanErr(error), 5000); if (!S.op) render(); return; }
  await refresh();
  showUndo(tarefaLabel(t) + " · " + shortUnit(t.unidade_id), data.execucao_id);
}
async function undo(execId, kind) {
  const { error } = kind === "mis"
    ? await sb.rpc("desfazer_missao", { p_token: S.token, p_missao: execId })
    : await sb.rpc("desfazer_baixa", { p_token: S.token, p_execucao: execId });
  if (error) return toast(cleanErr(error), 5000);
  document.getElementById("toast").hidden = true;
  await refresh();
  toast("Baixa desfeita.");
}

let moreState = null;
function moreModal(tid) {
  const t = S.idx.tarefa.get(tid); const r = S.idx.rotina.get(t.rotina_id); const st = taskState(t);
  if (st.modo === "fixo" && !st.pend.length) return toast(st.doneToday ? "Já tem baixa hoje." : "Nada pendente para lançar.");
  moreState = { tid, status: "feita", file: null, preview: null };
  const T = today();
  const dateField = st.modo === "fixo"
    ? '<div class="field"><label for="m-ref">Qual dia</label><select id="m-ref">' + st.pend.slice().reverse().map((d, i) => '<option value="' + d + '"' + (i === 0 ? " selected" : "") + '>' + (d === T ? "Hoje" : esc(DIAS[dow(d)])) + " (" + fmtD(d) + ')</option>').join("") + '</select>' +
      (st.pend.length > 1 ? '<p class="hint">Escolhendo o dia mais recente, os dias anteriores ficam como não feitos. Escolhendo um dia anterior, os outros continuam pendentes.</p>' : "") + '</div>'
    : '<div class="field"><label for="m-date">Dia em que foi feito</label><input type="date" id="m-date" value="' + T + '" max="' + T + '"></div>';
  openModal('<div class="modal-bg"><form class="modal" id="f-more" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">' + esc(r.titulo) + '</h2>' +
    '<p class="muted" style="margin:0">' + esc(tarefaLabel(t)) + " · " + esc(stateText(t, st)) + '</p>' +
    '<div class="row2">' + dateField + '<div class="field"><label for="m-time">Hora</label><input type="time" id="m-time" value="' + nowTime() + '"></div></div>' +
    '<div class="field"><span class="lbl">Como ficou</span><div class="choice"><button type="button" class="ok" data-act="m-status" data-v="feita" aria-pressed="true">✓ Tudo certo</button><button type="button" class="bad" data-act="m-status" data-v="problema" aria-pressed="false">⚠ Problema</button></div></div>' +
    '<div class="field"><label for="m-obs" id="m-obs-l">Observação (opcional)</label><textarea id="m-obs" maxlength="600"></textarea></div>' +
    '<div class="field"><span class="lbl" id="m-foto-l">Foto (opcional)</span><label class="photo-btn" for="m-foto">📷 Tirar foto ou escolher da galeria</label><input type="file" id="m-foto" accept="image/*" hidden><img id="m-prev" class="photo-prev" alt="" hidden></div>' +
    '<p class="err" id="m-err"></p><div class="acts"><button type="button" class="btn" data-act="close">Cancelar</button><button type="submit" class="btn primary">Salvar</button></div></form></div>');
}
function setMoreStatus(v) {
  moreState.status = v;
  $modal.querySelectorAll('[data-act="m-status"]').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
  document.getElementById("m-obs-l").textContent = v === "problema" ? "Descreva o problema (obrigatório)" : "Observação (opcional)";
  document.getElementById("m-foto-l").textContent = v === "problema" ? "Foto (obrigatória)" : "Foto (opcional)";
}
async function compressImage(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const max = 1280; const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return await new Promise(res => c.toBlob(res, "image/jpeg", 0.72));
}
async function uploadPhoto(blob, unidadeId) {
  const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
  const path = unidadeId + "/" + today().slice(0, 7) + "/" + id + ".jpg";
  const { error } = await sb.storage.from("fotos").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}
async function submitMore(form) {
  const err = document.getElementById("m-err"); err.textContent = "";
  const t = S.idx.tarefa.get(moreState.tid); const st = taskState(t);
  const obs = form.querySelector("#m-obs").value.trim();
  const time = form.querySelector("#m-time").value || nowTime();
  let ref = null, day;
  if (st.modo === "fixo") { ref = form.querySelector("#m-ref").value; day = ref; } else { day = form.querySelector("#m-date").value || today(); }
  if (day > today()) { err.textContent = "A data não pode ser no futuro."; return; }
  let when = new Date(day + "T" + time + ":00");
  if (when > new Date()) when = new Date();
  if (moreState.status === "problema" && (!obs || !moreState.file)) { err.textContent = "Para registrar problema, descreva e tire uma foto."; return; }
  const btns = form.querySelectorAll("button"); btns.forEach(b => b.disabled = true);
  try {
    let foto = null;
    if (moreState.file) { const blob = await compressImage(moreState.file); foto = await uploadPhoto(blob, t.unidade_id); }
    const { data, error } = await sb.rpc("registrar_baixa", { p_token: S.token, p_tarefa: t.id, p_data_ref: ref, p_feito_em: when.toISOString(), p_status: moreState.status, p_obs: obs || null, p_foto: foto });
    if (error) throw error;
    closeModal();
    await refresh();
    showUndo(tarefaLabel(t) + " · " + shortUnit(t.unidade_id) + (moreState && moreState.status === "problema" ? " (problema enviado)" : ""), data.execucao_id);
  } catch (e) {
    err.textContent = cleanErr(e); btns.forEach(b => b.disabled = false);
    if (!S.op) { closeModal(); render(); }
  }
}

/* ---------- fotos e corretivas (admin) ---------- */
async function verFoto(path) {
  const { data, error } = await sb.storage.from("fotos").createSignedUrl(path, 600);
  if (error) return toast(cleanErr(error));
  openModal('<div class="modal-bg" data-act="close-bg"><div class="modal" role="dialog" aria-modal="true"><img src="' + esc(data.signedUrl) + '" alt="Foto do registro" style="max-width:100%;border-radius:12px"><div class="acts"><button class="btn" data-act="close">Fechar</button></div></div></div>');
}
function encerrarModal(id) {
  const c = S.d.corretivas.find(x => x.id === id);
  openModal('<div class="modal-bg"><form class="modal" id="f-enc" data-id="' + id + '" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">Encerrar corretiva</h2><p>' + esc(c.descricao) + '</p>' +
    '<div class="field"><label for="e-obs">O que foi feito</label><textarea id="e-obs"></textarea></div>' +
    '<div class="field"><span class="lbl">Foto do conserto (opcional)</span><label class="photo-btn" for="e-foto">📷 Tirar foto ou escolher da galeria</label><input type="file" id="e-foto" accept="image/*" hidden><img id="e-prev" class="photo-prev" alt="" hidden></div><p class="err" id="e-err"></p>' +
    '<div class="acts"><button type="button" class="btn" data-act="close">Cancelar</button><button class="btn primary" type="submit">Encerrar</button></div></form></div>');
}

/* ---------- missões extras ---------- */
async function misTap(id) {
  if (busy) return;
  const m = S.d.missoes.find(x => x.id === id); if (!m) return;
  busy = true;
  const { error } = await sb.rpc("concluir_missao", { p_token: S.token, p_missao: id, p_unidade: S.unit });
  busy = false;
  if (error) { toast(cleanErr(error), 5000); if (!S.op) render(); return; }
  await refresh();
  showUndo(m.titulo + " · " + shortUnit(S.unit), id, "mis");
}
let misMore = null;
function misMoreModal(id) {
  const m = S.d.missoes.find(x => x.id === id); const T = today();
  misMore = { id, file: null, status: "feita" };
  openModal('<div class="modal-bg"><form class="modal" id="f-mis-more" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">' + esc(m.titulo) + '</h2>' +
    '<p class="muted" style="margin:0">Missão extra · ' + esc(shortUnit(S.unit)) + '</p>' +
    '<div class="row2"><div class="field"><label for="mm-date">Dia em que foi feita</label><input type="date" id="mm-date" value="' + T + '" max="' + T + '"></div><div class="field"><label for="mm-time">Hora</label><input type="time" id="mm-time" value="' + nowTime() + '"></div></div>' +
    '<div class="field"><span class="lbl">Como ficou</span><div class="choice"><button type="button" class="ok" data-act="mm-status" data-v="feita" aria-pressed="true">✓ Tudo certo</button><button type="button" class="bad" data-act="mm-status" data-v="problema" aria-pressed="false">⚠ Problema</button></div></div>' +
    '<div class="field"><label for="mm-obs" id="mm-obs-l">Observação (opcional)</label><textarea id="mm-obs" maxlength="600"></textarea></div>' +
    '<div class="field"><span class="lbl" id="mm-foto-l">Foto (opcional)</span><label class="photo-btn" for="mm-foto">📷 Tirar foto ou escolher da galeria</label><input type="file" id="mm-foto" accept="image/*" hidden><img id="mm-prev" class="photo-prev" alt="" hidden></div>' +
    '<p class="err" id="mm-err"></p><div class="acts"><button type="button" class="btn" data-act="close">Cancelar</button><button type="submit" class="btn primary">Concluir missão</button></div></form></div>');
}
function setMisStatus(v) {
  misMore.status = v;
  $modal.querySelectorAll('[data-act="mm-status"]').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
  document.getElementById("mm-obs-l").textContent = v === "problema" ? "Descreva o problema (obrigatório)" : "Observação (opcional)";
  document.getElementById("mm-foto-l").textContent = v === "problema" ? "Foto (obrigatória)" : "Foto (opcional)";
}
async function submitMisMore(f) {
  const err = f.querySelector("#mm-err"); err.textContent = "";
  const m = S.d.missoes.find(x => x.id === misMore.id);
  const day = f.querySelector("#mm-date").value || today();
  if (day > today()) { err.textContent = "A data não pode ser no futuro."; return; }
  let when = new Date(day + "T" + (f.querySelector("#mm-time").value || nowTime()) + ":00"); if (when > new Date()) when = new Date();
  const obsTxt = f.querySelector("#mm-obs").value.trim();
  if (misMore.status === "problema" && (!obsTxt || !misMore.file)) { err.textContent = "Para registrar problema, descreva e tire uma foto."; return; }
  const btns = f.querySelectorAll("button"); btns.forEach(b => b.disabled = true);
  try {
    let foto = null;
    if (misMore.file) foto = await uploadPhoto(await compressImage(misMore.file), S.unit);
    const { error } = await sb.rpc("concluir_missao", { p_token: S.token, p_missao: m.id, p_unidade: S.unit, p_obs: f.querySelector("#mm-obs").value.trim() || null, p_foto: foto, p_feito_em: when.toISOString(), p_status: misMore.status });
    if (error) throw error;
    const prob = misMore.status === "problema";
    closeModal(); await refresh(); showUndo(m.titulo + " · " + shortUnit(S.unit) + (prob ? " (problema enviado)" : ""), m.id, "mis");
  } catch (e) { err.textContent = cleanErr(e); btns.forEach(b => b.disabled = false); if (!S.op) { closeModal(); render(); } }
}
function misAdminModal(id) {
  const m = id ? S.d.missoes.find(x => x.id === id) : { titulo: "", descricao: "", unidade_id: S.unit, prazo: null };
  const opt = (v, l) => '<option value="' + esc(v) + '"' + ((m.unidade_id || "") === v ? " selected" : "") + '>' + esc(l) + '</option>';
  openModal('<div class="modal-bg"><form class="modal" id="f-mis" data-id="' + esc(id || "") + '" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">' + (id ? "Editar missão" : "Nova missão extra") + '</h2>' +
    '<div class="field"><label for="mi-tit">O que precisa ser feito</label><input type="text" id="mi-tit" maxlength="120" value="' + esc(m.titulo) + '" placeholder="Ex.: Trocar a lâmpada do banheiro"></div>' +
    '<div class="field"><label for="mi-desc">Detalhes (opcional)</label><textarea id="mi-desc" maxlength="1000">' + esc(m.descricao) + '</textarea></div>' +
    '<div class="row2"><div class="field"><label for="mi-un">Lavanderia</label><select id="mi-un">' + opt("", "Qualquer lavanderia") + units().map(u => opt(u.id, u.nome)).join("") + '</select></div>' +
    '<div class="field"><label for="mi-prazo">Prazo (opcional)</label><input type="date" id="mi-prazo" value="' + esc(m.prazo || "") + '"></div></div>' +
    '<p class="hint">Qualquer pessoa liberada na lavanderia pode concluir, seja qual for o perfil.</p><p class="err" id="mi-err"></p>' +
    '<div class="acts">' + (id ? '<button type="button" class="btn danger" data-act="mis-del" data-id="' + id + '" style="margin-right:auto">Excluir</button>' : "") + '<button type="button" class="btn" data-act="close">Cancelar</button><button type="submit" class="btn primary">Salvar</button></div></form></div>');
}
async function saveMissao(f) {
  const err = f.querySelector("#mi-err");
  const row = { titulo: f.querySelector("#mi-tit").value.trim(), descricao: f.querySelector("#mi-desc").value.trim(), unidade_id: f.querySelector("#mi-un").value || null, prazo: f.querySelector("#mi-prazo").value || null };
  if (!row.titulo) { err.textContent = "Escreva o que precisa ser feito."; return; }
  const r = f.dataset.id ? await sb.from("missoes").update(row).eq("id", f.dataset.id) : await sb.from("missoes").insert(row);
  if (r.error) { err.textContent = cleanErr(r.error); return; }
  closeModal(); await refresh(); toast("Missão salva.");
}
function fixarModal() {
  const fixo = lsGet("fixo") || "";
  openModal('<div class="modal-bg" data-act="close-bg"><div class="modal" style="max-width:480px" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">Fixar este aparelho</h2>' +
    '<p class="hint">Num monitor de loja, fixe a lavanderia dele. Assim quem entrar aqui só vê e só dá baixa nesta unidade, mesmo que esteja liberado nas duas.</p>' +
    units().map(u => '<button class="btn' + (fixo === u.id ? " primary" : "") + '" data-act="fixar-set" data-id="' + u.id + '">' + esc(u.nome) + '</button>').join("") +
    '<button class="btn' + (!fixo ? " primary" : "") + '" data-act="fixar-set" data-id="">Livre (todas as lavanderias)</button><div class="acts"><button class="btn" data-act="close">Fechar</button></div></div></div>');
}

/* ---------- admin: cadastro de rotinas ---------- */
function perfisNomes(rid) { const s = S.idx.perfisDe.get(rid) || new Set(); return S.d.perfis.filter(p => s.has(p.id)).sort(byOrd).map(p => p.nome).join(", ") || "—"; }
function unidadesNomes(rid) { const s = S.idx.unidadesDe.get(rid) || new Set(); return units().filter(u => s.has(u.id)).map(u => u.nome.split("–").pop().trim()).join(", ") || "—"; }
function rotinasHtml() {
  const cs = S.d.categorias.slice().sort(byOrd);
  let h = '<div class="page"><div class="page-h"><h1>Cadastro de rotinas</h1><button class="btn primary" data-act="rot-new">Nova rotina</button></div>';
  const groups = cs.map(c => [c, S.d.rotinas.filter(r => r.categoria_id === c.id)]).concat([[{ nome: "Sem categoria" }, S.d.rotinas.filter(r => !S.idx.categoria.get(r.categoria_id))]]);
  for (const [c, rs] of groups) {
    if (!rs.length) continue;
    h += '<div class="panel"><h2>' + esc(c.nome) + '</h2><div class="tablewrap" style="border:0"><table><thead><tr><th>Rotina</th><th>Frequência</th><th>Itens</th><th>Perfis</th><th>Unidades</th><th></th></tr></thead><tbody>';
    for (const r of rs.sort(byOrd)) {
      const its = r.escopo === "itens" ? S.d.itens.filter(i => i.rotina_id === r.id && i.ativo).length + " itens" : ESCOPO[r.escopo];
      h += '<tr><td><strong>' + esc(r.titulo) + '</strong>' + (r.ativa ? "" : ' <span class="tag off">desativada</span>') + '</td><td>' + esc(FREQ[r.freq].label) + '</td><td>' + esc(its) + '</td><td>' + esc(perfisNomes(r.id)) + '</td><td>' + esc(unidadesNomes(r.id)) + '</td><td><button class="btn small" data-act="rot-edit" data-id="' + r.id + '">Editar</button></td></tr>';
    }
    h += '</tbody></table></div></div>';
  }
  return h + '</div>';
}
let rotEdit = null;
function rotModal(id) {
  const r = id ? S.idx.rotina.get(id) : { titulo: "", categoria_id: (S.d.categorias.slice().sort(byOrd)[0] || {}).id, freq: "semanal", escopo: "itens", instrucoes: "", ativa: true };
  const ps = id ? (S.idx.perfisDe.get(id) || new Set()) : new Set();
  const us = id ? (S.idx.unidadesDe.get(id) || new Set()) : new Set(units().map(u => u.id));
  const its = id ? S.d.itens.filter(i => i.rotina_id === id && i.ativo).sort(byOrd) : [];
  rotEdit = { id, freqOld: r.freq };
  const opt = (v, l, cur) => '<option value="' + v + '"' + (v === cur ? " selected" : "") + '>' + esc(l) + '</option>';
  let datas = "";
  if (id) {
    const modo = FREQ[r.freq].modo;
    const ts = S.d.tarefas.filter(t => t.rotina_id === id && t.ativa).sort((a, b) => (S.idx.unidade.get(a.unidade_id).ordem - S.idx.unidade.get(b.unidade_id).ordem) || tarefaOrdem(a) - tarefaOrdem(b));
    datas = '<div class="field"><span class="lbl">' + (modo === "fixo" ? "Começa em (calendário fixo)" : "Próxima data de cada item") + '</span><p class="hint">Mude uma data para acertar a próxima cobrança (ex.: validade do extintor).</p><div class="tablewrap"><table><tbody>' +
      ts.map(t => '<tr><td>' + esc(S.idx.unidade.get(t.unidade_id).nome.split("–").pop().trim()) + '</td><td>' + esc(tarefaLabel(t)) + '</td><td><input type="date" class="t-date" data-id="' + t.id + '" data-old="' + esc(modo === "fixo" ? t.inicio : (t.proxima_data || "")) + '" value="' + esc(modo === "fixo" ? t.inicio : (t.proxima_data || "")) + '"></td></tr>').join("") +
      '</tbody></table></div></div>';
  }
  openModal('<div class="modal-bg"><form class="modal wide" id="f-rot" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">' + (id ? "Editar rotina" : "Nova rotina") + '</h2>' +
    '<div class="field"><label for="r-tit">Nome do cartão</label><input type="text" id="r-tit" maxlength="120" value="' + esc(r.titulo) + '" required></div>' +
    '<div class="row2"><div class="field"><label for="r-cat">Categoria</label><select id="r-cat">' + S.d.categorias.slice().sort(byOrd).map(c => opt(c.id, c.nome, r.categoria_id)).join("") + '</select></div>' +
    '<div class="field"><label for="r-freq">Frequência</label><select id="r-freq">' + Object.keys(FREQ).map(k => opt(k, FREQ[k].label, r.freq)).join("") + '</select><p class="hint">Diário e dia sim/dia não seguem o calendário. As demais contam a partir da última baixa.</p></div></div>' +
    '<div class="field"><label for="r-esc">O que é cobrado</label><select id="r-esc">' + Object.keys(ESCOPO).map(k => opt(k, ESCOPO[k], r.escopo)).join("") + '</select></div>' +
    '<div class="field" id="r-itens-f"' + (r.escopo === "itens" ? "" : " hidden") + '><span class="lbl">Itens do checklist</span><div id="r-itens">' +
    (its.length ? its : [{ id: "", titulo: r.titulo || "" }]).map(itemRow).join("") + '</div><div><button type="button" class="btn small" data-act="item-add">+ Item</button></div></div>' +
    '<div class="field"><span class="lbl">Unidades</span><div class="checks">' + units().map(u => '<label><input type="checkbox" name="r-un" value="' + u.id + '"' + (us.has(u.id) ? " checked" : "") + '> ' + esc(u.nome) + '</label>').join("") + '</div></div>' +
    '<div class="field"><span class="lbl">Perfis que veem e dão baixa</span><div class="checks">' + S.d.perfis.slice().sort(byOrd).filter(p => !p.is_admin).map(p => '<label><input type="checkbox" name="r-pf" value="' + p.id + '"' + (ps.has(p.id) ? " checked" : "") + '> ' + esc(p.nome) + '</label>').join("") + '</div><p class="hint">O Adm sempre vê todas.</p></div>' +
    '<div class="field"><label for="r-ins">Como fazer (opcional)</label><textarea id="r-ins" maxlength="2000">' + esc(r.instrucoes) + '</textarea></div>' +
    '<label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="r-ativa"' + (r.ativa ? " checked" : "") + '> Ativa (desmarque para pausar sem perder o histórico)</label>' +
    datas + '<p class="err" id="r-err"></p><div class="acts"><button type="button" class="btn" data-act="close">Cancelar</button><button class="btn primary" type="submit">Salvar</button></div></form></div>');
}
const itemRow = i => '<div class="item-edit" style="margin-bottom:6px"><input type="text" class="it-t" data-id="' + esc(i.id || "") + '" value="' + esc(i.titulo) + '" maxlength="120" style="padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg)"><button type="button" class="btn small" data-act="item-up" aria-label="Subir">↑</button><button type="button" class="btn small danger" data-act="item-del" aria-label="Remover">✕</button></div>';

async function saveRotina(f) {
  const err = f.querySelector("#r-err"); err.textContent = "";
  const titulo = f.querySelector("#r-tit").value.trim();
  const escopo = f.querySelector("#r-esc").value;
  const freq = f.querySelector("#r-freq").value;
  const uns = [...f.querySelectorAll('input[name="r-un"]:checked')].map(i => i.value);
  const pfs = [...f.querySelectorAll('input[name="r-pf"]:checked')].map(i => i.value);
  const its = [...f.querySelectorAll(".it-t")].map((i, k) => ({ id: i.dataset.id, titulo: i.value.trim(), ordem: k + 1 })).filter(i => i.titulo);
  if (!titulo) { err.textContent = "Dê um nome ao cartão."; return; }
  if (escopo === "itens" && !its.length) { err.textContent = "Coloque pelo menos um item."; return; }
  if (!uns.length) { err.textContent = "Marque pelo menos uma unidade."; return; }
  const row = { titulo, categoria_id: f.querySelector("#r-cat").value, freq, escopo, instrucoes: f.querySelector("#r-ins").value.trim(), ativa: f.querySelector("#r-ativa").checked };
  const btns = f.querySelectorAll("button"); btns.forEach(b => b.disabled = true);
  try {
    let id = rotEdit.id;
    if (id) { const { error } = await sb.from("rotinas").update(row).eq("id", id); if (error) throw error; }
    else {
      row.ordem = S.d.rotinas.reduce((m, r) => Math.max(m, r.ordem || 0), 0) + 1;
      const { data, error } = await sb.from("rotinas").insert(row).select("id").single(); if (error) throw error; id = data.id;
    }
    let r1 = await sb.from("rotina_perfis").delete().eq("rotina_id", id); if (r1.error) throw r1.error;
    if (pfs.length) { r1 = await sb.from("rotina_perfis").insert(pfs.map(p => ({ rotina_id: id, perfil_id: p }))); if (r1.error) throw r1.error; }
    r1 = await sb.from("rotina_unidades").delete().eq("rotina_id", id); if (r1.error) throw r1.error;
    r1 = await sb.from("rotina_unidades").insert(uns.map(u => ({ rotina_id: id, unidade_id: u }))); if (r1.error) throw r1.error;
    if (escopo === "itens") {
      const keep = new Set();
      for (const it of its) {
        if (it.id) { keep.add(it.id); r1 = await sb.from("itens").update({ titulo: it.titulo, ordem: it.ordem, ativo: true }).eq("id", it.id); }
        else r1 = await sb.from("itens").insert({ rotina_id: id, titulo: it.titulo, ordem: it.ordem });
        if (r1.error) throw r1.error;
      }
      const gone = S.d.itens.filter(i => i.rotina_id === id && i.ativo && !keep.has(i.id)).map(i => i.id);
      if (gone.length) { r1 = await sb.from("itens").update({ ativo: false }).in("id", gone); if (r1.error) throw r1.error; }
    }
    // mudou de calendário fixo <-> última baixa: reinicia as datas
    if (rotEdit.id && FREQ[rotEdit.freqOld].modo !== FREQ[freq].modo) {
      const patch = FREQ[freq].modo === "fixo" ? { inicio: today() } : { proxima_data: null };
      r1 = await sb.from("tarefas").update(patch).eq("rotina_id", id); if (r1.error) throw r1.error;
    } else {
      for (const inp of f.querySelectorAll(".t-date")) {
        if (inp.value && inp.value !== inp.dataset.old) {
          const patch = FREQ[freq].modo === "fixo" ? { inicio: inp.value } : { proxima_data: inp.value };
          r1 = await sb.from("tarefas").update(patch).eq("id", inp.dataset.id); if (r1.error) throw r1.error;
        }
      }
    }
    r1 = await sb.rpc("sincronizar_tarefas"); if (r1.error) throw r1.error;
    closeModal(); await refresh(); toast("Rotina salva.");
  } catch (e) { err.textContent = cleanErr(e); btns.forEach(b => b.disabled = false); }
}

/* ---------- admin: equipe ---------- */
function equipeHtml() {
  const fs = S.d.funcionarios.slice().sort((a, b) => (b.ativo - a.ativo) || a.nome.localeCompare(b.nome, "pt-BR"));
  const pOpts = cur => S.d.perfis.slice().sort(byOrd).map(p => '<option value="' + p.id + '"' + (p.id === cur ? " selected" : "") + '>' + esc(p.nome) + '</option>').join("");
  return '<div class="page"><div class="page-h"><h1>Equipe</h1><button class="btn primary" data-act="func-new">Novo funcionário</button></div><div class="panel">' +
    '<p class="hint">Cada pessoa tem um PIN de 4 a 6 números, um perfil e as lavanderias em que pode dar baixa. O perfil define quais rotinas ela vê.</p>' +
    fs.map(f => '<div class="list-row" data-id="' + f.id + '"' + (f.ativo ? "" : ' style="opacity:.55"') + '><input type="text" class="grow f-nome" value="' + esc(f.nome) + '" aria-label="Nome"><select class="f-perfil" aria-label="Perfil">' + pOpts(f.perfil_id) + '</select>' +
      '<label style="display:flex;gap:6px;align-items:center;font-weight:700"><input type="checkbox" class="f-ativo"' + (f.ativo ? " checked" : "") + '> Ativo</label>' +
      (isAdmPerfil(f.perfil_id) ? '<span class="tag">todas as lavanderias</span>' : '<span class="checks">' + units().map(u => '<label><input type="checkbox" class="f-un" value="' + u.id + '"' + (funcUnits(f.id).has(u.id) ? " checked" : "") + '> ' + esc(shortUnit(u.id)) + '</label>').join("") + '</span>' + (funcUnits(f.id).size ? "" : '<span class="tag bad">nenhuma lavanderia</span>')) +
      (f.user_id ? '<span class="tag">sua conta</span>' : "") +
      '<button class="btn small" data-act="func-pin" data-id="' + f.id + '">Definir PIN</button><button class="btn small primary" data-act="func-save" data-id="' + f.id + '">Salvar</button>' +
      (f.user_id ? "" : '<button class="btn small danger" data-act="func-del" data-id="' + f.id + '">Excluir</button>') + '</div>').join("") +
    '</div></div>';
}
const isAdmPerfil = pid => !!(S.idx.perfil.get(pid) || {}).is_admin;
const funcUnits = fid => new Set(S.d.funcionario_unidades.filter(x => x.funcionario_id === fid).map(x => x.unidade_id));
function pinAdminModal(id) {
  const f = S.idx.func.get(id);
  openModal('<div class="modal-bg"><form class="modal" id="f-pin" data-id="' + id + '" style="max-width:420px" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">PIN de ' + esc(f.nome) + '</h2>' +
    '<div class="field"><label for="p-pin">Novo PIN (4 a 6 números)</label><input type="password" inputmode="numeric" pattern="[0-9]*" id="p-pin" maxlength="6" autocomplete="new-password"></div>' +
    '<p class="hint">Trocar o PIN desconecta a pessoa dos aparelhos.</p><p class="err" id="p-err"></p><div class="acts"><button type="button" class="btn" data-act="close">Cancelar</button><button class="btn primary" type="submit">Salvar PIN</button></div></form></div>');
}

/* ---------- admin: unidades, máquinas, perfis, categorias ---------- */
function cadastrosHtml() {
  const simple = (tabela, titulo, rows, extra) => '<div class="panel"><h2>' + titulo + '</h2>' + rows.map(x => '<div class="list-row"><input type="text" class="grow" data-tab="' + tabela + '" data-id="' + x.id + '" value="' + esc(x.nome) + '" aria-label="Nome">' + (extra ? extra(x) : "") + '</div>').join("") +
    '<div class="list-row"><input type="text" class="grow" data-tab="' + tabela + '" data-id="" placeholder="Novo…" aria-label="Novo"></div><div><button class="btn primary small" data-act="cad-save" data-tab="' + tabela + '">Salvar ' + titulo.toLowerCase() + '</button></div></div>';
  let maq = '<div class="panel"><h2>Máquinas</h2><p class="hint">Uma máquina nova entra sozinha nas rotinas por máquina. Desativar não apaga o histórico.</p>';
  for (const u of units()) {
    maq += '<h3 style="font-size:1rem;margin-top:6px">' + esc(u.nome) + '</h3>' + S.d.maquinas.filter(m => m.unidade_id === u.id).sort(byOrd).map(m =>
      '<div class="list-row"><input type="text" data-maq="' + m.id + '" data-un="' + u.id + '" value="' + esc(m.codigo) + '" aria-label="Código" style="width:110px"><select data-maq-tipo="' + m.id + '" aria-label="Tipo"><option value="lavadora"' + (m.tipo === "lavadora" ? " selected" : "") + '>Lavadora</option><option value="secadora"' + (m.tipo === "secadora" ? " selected" : "") + '>Secadora</option></select><label style="display:flex;gap:6px;align-items:center;font-weight:700"><input type="checkbox" data-maq-ativa="' + m.id + '"' + (m.ativa ? " checked" : "") + '> Ativa</label></div>').join("") +
      '<div class="list-row"><input type="text" data-maq="" data-un="' + u.id + '" placeholder="Nova (ex.: Lav4)" aria-label="Nova máquina" style="width:150px"><select data-maq-tipo-new="' + u.id + '" aria-label="Tipo"><option value="lavadora">Lavadora</option><option value="secadora">Secadora</option></select></div>';
  }
  maq += '<div><button class="btn primary small" data-act="maq-save">Salvar máquinas</button></div></div>';
  return '<div class="page"><div class="page-h"><h1>Unidades e perfis</h1></div>' +
    simple("unidades", "Unidades", units(), null) + maq +
    simple("perfis", "Perfis", S.d.perfis.slice().sort(byOrd), p => p.is_admin ? '<span class="tag">administrador</span>' : "") +
    simple("categorias", "Categorias", S.d.categorias.slice().sort(byOrd), null) + '</div>';
}
async function saveSimple(tab) {
  const inputs = [...$app.querySelectorAll('input[data-tab="' + tab + '"]')];
  const list = S.d[tab];
  try {
    let ordem = list.reduce((m, x) => Math.max(m, x.ordem || 0), 0);
    for (const i of inputs) {
      const v = i.value.trim();
      if (i.dataset.id) { const old = list.find(x => x.id === i.dataset.id); if (v && v !== old.nome) { const { error } = await sb.from(tab).update({ nome: v }).eq("id", i.dataset.id); if (error) throw error; } }
      else if (v) { const { error } = await sb.from(tab).insert({ nome: v, ordem: ++ordem }); if (error) throw error; }
    }
    await refresh(); toast("Salvo." + (tab === "unidades" ? " Marque a unidade nova nas rotinas que ela deve ter." : ""), 5000);
  } catch (e) { toast(cleanErr(e), 5000); }
}
async function saveMaquinas() {
  try {
    for (const i of $app.querySelectorAll("input[data-maq]")) {
      const v = i.value.trim();
      if (i.dataset.maq) {
        const m = S.idx.maquina.get(i.dataset.maq);
        const tipo = $app.querySelector('[data-maq-tipo="' + m.id + '"]').value;
        const ativa = $app.querySelector('[data-maq-ativa="' + m.id + '"]').checked;
        if ((v && v !== m.codigo) || tipo !== m.tipo || ativa !== m.ativa) {
          const { error } = await sb.from("maquinas").update({ codigo: v || m.codigo, tipo, ativa }).eq("id", m.id); if (error) throw error;
        }
      } else if (v) {
        const tipo = $app.querySelector('[data-maq-tipo-new="' + i.dataset.un + '"]').value;
        const ordem = S.d.maquinas.filter(m => m.unidade_id === i.dataset.un).reduce((x, m) => Math.max(x, m.ordem || 0), 0) + 1;
        const { error } = await sb.from("maquinas").insert({ unidade_id: i.dataset.un, codigo: v, tipo, ordem }); if (error) throw error;
      }
    }
    const { error } = await sb.rpc("sincronizar_tarefas"); if (error) throw error;
    await refresh(); toast("Máquinas salvas.");
  } catch (e) { toast(cleanErr(e), 5000); }
}

/* ---------- admin: relatório ---------- */
function relatorioHtml() {
  const R = S.report || { de: addDays(today(), -30), ate: today(), un: "", cat: "", rot: "", sit: "" };
  S.report = R;
  const opt = (v, l, cur) => '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + '>' + esc(l) + '</option>';
  let h = '<div class="page" id="relatorio"><div class="page-h"><h1>Relatório</h1><button class="btn no-print" data-act="rep-csv"' + (R.rows ? "" : " disabled") + '>Baixar planilha (CSV)</button><button class="btn no-print" data-act="rep-print"' + (R.rows ? "" : " disabled") + '>Imprimir / PDF</button></div>' +
    '<div class="panel no-print"><div class="filters">' +
    '<div class="field"><label for="q-de">De</label><input type="date" id="q-de" value="' + R.de + '"></div>' +
    '<div class="field"><label for="q-ate">Até</label><input type="date" id="q-ate" value="' + R.ate + '"></div>' +
    '<div class="field"><label for="q-un">Unidade</label><select id="q-un">' + opt("", "Todas", R.un) + units().map(u => opt(u.id, u.nome, R.un)).join("") + '</select></div>' +
    '<div class="field"><label for="q-cat">Categoria</label><select id="q-cat">' + opt("", "Todas", R.cat) + S.d.categorias.slice().sort(byOrd).map(c => opt(c.id, c.nome, R.cat)).join("") + '</select></div>' +
    '<div class="field"><label for="q-rot">Rotina</label><select id="q-rot">' + opt("", "Todas", R.rot) + S.d.rotinas.slice().sort(byOrd).map(r => opt(r.id, r.titulo, R.rot)).join("") + '</select></div>' +
    '<div class="field"><label for="q-sit">Situação</label><select id="q-sit">' + [["", "Todas"], ["prazo", "Feita no dia"], ["atraso", "Feita com atraso"], ["nao_feita", "Não feita"], ["problema", "Problema"]].map(([v, l]) => opt(v, l, R.sit)).join("") + '</select></div>' +
    '<div><button class="btn primary" data-act="rep-run">Gerar</button></div></div></div>';
  if (!R.rows) return h + '<p class="empty no-print">Escolha os filtros e toque em Gerar.</p></div>';
  const c = { prazo: 0, atraso: 0, nao_feita: 0, problema: 0 };
  R.rows.forEach(x => c[x.sit]++);
  const agora = S.d.tarefas.filter(t => t.ativa && (!R.un || t.unidade_id === R.un)).map(t => taskState(t)).filter(s => s.pend.length && s.atraso > 0).length;
  h += '<p class="muted" style="margin:0">Período ' + fmtDY(R.de) + ' a ' + fmtDY(R.ate) + (R.un ? " · " + esc(S.idx.unidade.get(R.un).nome) : " · todas as unidades") + '</p>' +
    '<div class="tiles"><div class="tile ok"><div class="v num">' + c.prazo + '</div><div class="l">feitas no dia</div></div><div class="tile warn"><div class="v num">' + c.atraso + '</div><div class="l">feitas com atraso</div></div><div class="tile"><div class="v num">' + c.nao_feita + '</div><div class="l">não feitas</div></div><div class="tile bad"><div class="v num">' + c.problema + '</div><div class="l">com problema</div></div><div class="tile bad"><div class="v num">' + agora + '</div><div class="l">atrasadas agora</div></div></div>';
  const SIT = { prazo: ["Feita", "ok"], atraso: ["Com atraso", "warn"], nao_feita: ["Não feita", "off"], problema: ["Problema", "bad"] };
  h += '<div class="tablewrap"><table><thead><tr><th>Previsto</th><th>Unidade</th><th>Rotina</th><th>Item</th><th>Situação</th><th>Feito em</th><th>Quem</th><th>Observação</th><th class="no-print">Foto</th></tr></thead><tbody>' +
    R.rows.slice(0, 3000).map(x => '<tr><td class="num">' + fmtDY(x.e.data_ref) + '</td><td>' + esc(x.un) + '</td><td>' + esc(x.rot) + '</td><td>' + esc(x.item) + '</td><td><span class="tag ' + SIT[x.sit][1] + '">' + SIT[x.sit][0] + '</span></td><td class="num">' + esc(fmtDT(x.e.feito_em)) + '</td><td>' + esc(x.e.funcionario_id ? funcName(x.e.funcionario_id) : "") + '</td><td>' + esc(x.e.obs || "") + '</td><td class="no-print">' + (x.e.foto_path ? '<button class="btn small" data-act="foto" data-path="' + esc(x.e.foto_path) + '">Ver</button>' : "") + '</td></tr>').join("") +
    '</tbody></table></div>' + (R.rows.length > 3000 ? '<p class="hint">Mostrando 3000 de ' + R.rows.length + ' linhas. A planilha tem todas.</p>' : "") + '</div>';
  return h;
}
async function runReport() {
  const g = id => $app.querySelector(id).value;
  const R = S.report = { de: g("#q-de"), ate: g("#q-ate"), un: g("#q-un"), cat: g("#q-cat"), rot: g("#q-rot"), sit: g("#q-sit") };
  if (!R.de || !R.ate || R.de > R.ate) return toast("Confira as datas.");
  toast("Gerando…");
  try {
    const ex = await fetchAll(() => sb.from("execucoes").select("*").gte("data_ref", R.de).lte("data_ref", R.ate).order("data_ref", { ascending: false }).order("id"));
    R.rows = ex.map(e => {
      const t = S.idx.tarefa.get(e.tarefa_id); if (!t) return null;
      const r = S.idx.rotina.get(t.rotina_id);
      if (R.un && t.unidade_id !== R.un) return null;
      if (R.cat && r.categoria_id !== R.cat) return null;
      if (R.rot && r.id !== R.rot) return null;
      const sit = e.status === "nao_feita" ? "nao_feita" : e.status === "problema" ? "problema" : (isoLocal(e.feito_em) > e.data_ref ? "atraso" : "prazo");
      if (R.sit && R.sit !== sit) return null;
      return { e, t, sit, un: S.idx.unidade.get(t.unidade_id).nome, rot: r.titulo, item: tarefaLabel(t), cat: (S.idx.categoria.get(r.categoria_id) || {}).nome || "" };
    }).filter(Boolean);
    if (!R.cat && !R.rot) {
      for (const m of S.d.missoes) {
        const ref = m.prazo || (m.concluida_em ? isoLocal(m.concluida_em) : isoLocal(m.criada_em));
        if (ref < R.de || ref > R.ate) continue;
        const un = m.concluida_unidade || m.unidade_id;
        if (R.un && un !== R.un) continue;
        const T = today();
        let sit;
        if (m.status === "concluida") sit = m.problema ? "problema" : m.prazo && isoLocal(m.concluida_em) > m.prazo ? "atraso" : "prazo";
        else if (m.prazo && m.prazo < T) sit = "nao_feita"; else continue;
        if (R.sit && R.sit !== sit) continue;
        R.rows.push({ e: { data_ref: ref, feito_em: m.concluida_em, funcionario_id: m.concluida_por, obs: m.obs, foto_path: m.foto_path }, sit, un: un ? S.idx.unidade.get(un).nome : "Qualquer", rot: "Missão extra", item: m.titulo, cat: "Missão extra" });
      }
      R.rows.sort((a, b) => b.e.data_ref.localeCompare(a.e.data_ref));
    }
    document.getElementById("toast").hidden = true;
    render();
  } catch (e) { toast(cleanErr(e), 5000); }
}
function downloadCsv() {
  const R = S.report; if (!R || !R.rows) return;
  const SIT = { prazo: "Feita no dia", atraso: "Feita com atraso", nao_feita: "Não feita", problema: "Problema" };
  const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const lines = [["Data prevista", "Unidade", "Categoria", "Rotina", "Item/Máquina", "Situação", "Feito em", "Quem", "Observação", "Tem foto"].map(q).join(";")];
  for (const x of R.rows) lines.push([fmtDY(x.e.data_ref), x.un, x.cat, x.rot, x.item, SIT[x.sit], fmtDT(x.e.feito_em), x.e.funcionario_id ? funcName(x.e.funcionario_id) : "", x.e.obs || "", x.e.foto_path ? "sim" : ""].map(q).join(";"));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "rotinas-" + R.de + "-a-" + R.ate + ".csv";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------------- modal ---------------- */
function openModal(html) { $modal.innerHTML = html; S.modalOpen = true; const f = $modal.querySelector("input:not([type=hidden]):not([hidden]),select,textarea"); if (f && f.type !== "date" && f.type !== "time") f.focus(); }
function closeModal() { $modal.innerHTML = ""; S.modalOpen = false; moreState = null; misMore = null; pinBuf = ""; }

/* ---------------- eventos ---------------- */
document.addEventListener("click", async ev => {
  const el = ev.target.closest("[data-act]"); if (!el) return;
  const a = el.dataset.act;
  switch (a) {
    case "close-bg": if (ev.target === el) closeModal(); return;
    case "close": closeModal(); return;
    case "view": S.view = el.dataset.v; render(); window.scrollTo(0, 0); return;
    case "unit": S.unit = el.dataset.id; lsSet("unit", S.unit); render(); return;
    case "cat": S.cat = el.dataset.id; render(); return;
    case "range": S.logRange = el.dataset.v; render(); return;
    case "tap": return tapBaixa(el.dataset.id);
    case "more": return moreModal(el.dataset.id);
    case "m-status": return setMoreStatus(el.dataset.v);
    case "undo": return undo(el.dataset.id, el.dataset.kind);
    case "undo-admin":
      if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.textContent = "Confirmar"; return; }
      return undo(el.dataset.id, el.dataset.kind);
    case "mis-tap": return misTap(el.dataset.id);
    case "mm-status": return setMisStatus(el.dataset.v);
    case "mis-more": return misMoreModal(el.dataset.id);
    case "mis-new": return misAdminModal(null);
    case "mis-edit": return misAdminModal(el.dataset.id);
    case "mis-del": {
      if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.textContent = "Toque de novo para excluir"; return; }
      const { error } = await sb.from("missoes").delete().eq("id", el.dataset.id);
      if (error) return toast(cleanErr(error));
      closeModal(); await refresh(); return toast("Missão excluída.");
    }
    case "fixar": return fixarModal();
    case "fixar-set": lsSet("fixo", el.dataset.id || null); closeModal(); if (el.dataset.id) S.unit = el.dataset.id; await refresh(); return toast(el.dataset.id ? "Aparelho fixado em " + shortUnit(el.dataset.id) + "." : "Aparelho livre.");
    case "foto": return verFoto(el.dataset.path);
    case "encerrar": return encerrarModal(el.dataset.id);
    case "pin-open": pinBuf = ""; return pinModal();
    case "pin-key": if (pinBuf.length < 6) pinBuf += el.dataset.k; return pinModal();
    case "pin-del": pinBuf = pinBuf.slice(0, -1); return pinModal();
    case "pin-ok": return pinSubmit();
    case "trocar": if (S.token) sb.rpc("sair", { p_token: S.token }); dropOp(); render(); pinBuf = ""; return pinModal();
    case "sair-op": if (S.token) await sb.rpc("sair", { p_token: S.token }); dropOp(); return render();
    case "logout": dropOp(); await sb.auth.signOut(); S.user = null; S.isAdmin = false; S.loaded = false; return render();
    case "rot-new": return rotModal(null);
    case "rot-edit": return rotModal(el.dataset.id);
    case "item-add": document.getElementById("r-itens").insertAdjacentHTML("beforeend", itemRow({ id: "", titulo: "" })); return;
    case "item-del": el.closest(".item-edit").remove(); return;
    case "item-up": { const row = el.closest(".item-edit"); if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); return; }
    case "func-new": {
      const pl = S.d.perfis.find(p => !p.is_admin);
      const { error } = await sb.from("funcionarios").insert({ nome: "Novo funcionário", perfil_id: pl ? pl.id : null }).select("id").single();
      if (error) return toast(cleanErr(error));
      await refresh(); return toast("Criado. Ajuste o nome, salve e defina o PIN.", 5000);
    }
    case "func-save": {
      const row = el.closest(".list-row");
      const { error } = await sb.from("funcionarios").update({ nome: row.querySelector(".f-nome").value.trim(), perfil_id: row.querySelector(".f-perfil").value, ativo: row.querySelector(".f-ativo").checked }).eq("id", el.dataset.id).select("id");
      if (error) return toast(cleanErr(error));
      const marcadas = [...row.querySelectorAll(".f-un:checked")].map(i => i.value);
      if (row.querySelector(".f-un")) {
        let r2 = await sb.from("funcionario_unidades").delete().eq("funcionario_id", el.dataset.id);
        if (!r2.error && marcadas.length) r2 = await sb.from("funcionario_unidades").insert(marcadas.map(u => ({ funcionario_id: el.dataset.id, unidade_id: u })));
        if (r2.error) return toast(cleanErr(r2.error));
      }
      await refresh(); return toast("Salvo.");
    }
    case "func-pin": return pinAdminModal(el.dataset.id);
    case "func-del": {
      if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.textContent = "Confirmar exclusão"; return; }
      const { error } = await sb.rpc("excluir_funcionario", { p_id: el.dataset.id });
      if (error) { el.dataset.confirm = ""; el.textContent = "Excluir"; return toast(cleanErr(error), 7000); }
      await refresh(); return toast("Funcionário excluído.");
    }
    case "cad-save": return saveSimple(el.dataset.tab);
    case "maq-save": return saveMaquinas();
    case "rep-run": return runReport();
    case "rep-csv": return downloadCsv();
    case "rep-print": return window.print();
  }
});
document.addEventListener("change", ev => {
  if (ev.target.id === "r-esc") document.getElementById("r-itens-f").hidden = ev.target.value !== "itens";
  if (ev.target.id === "e-foto") {
    const file = ev.target.files && ev.target.files[0]; const img = document.getElementById("e-prev");
    if (file) { img.src = URL.createObjectURL(file); img.hidden = false; } else img.hidden = true;
  }
  if (ev.target.id === "mm-foto" && misMore) {
    const file = ev.target.files && ev.target.files[0]; misMore.file = file || null;
    const img = document.getElementById("mm-prev");
    if (file) { img.src = URL.createObjectURL(file); img.hidden = false; } else img.hidden = true;
  }
  if (ev.target.id === "m-foto" && moreState) {
    const file = ev.target.files && ev.target.files[0]; moreState.file = file || null;
    const img = document.getElementById("m-prev");
    if (file) { img.src = URL.createObjectURL(file); img.hidden = false; } else img.hidden = true;
  }
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && S.modalOpen) closeModal();
  if ($modal.querySelector(".keypad")) {
    if (/^[0-9]$/.test(ev.key) && pinBuf.length < 6) { pinBuf += ev.key; pinModal(); }
    else if (ev.key === "Backspace") { pinBuf = pinBuf.slice(0, -1); pinModal(); }
    else if (ev.key === "Enter") pinSubmit();
  }
});
document.addEventListener("submit", async ev => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id === "f-login") {
    const { data, error } = await sb.auth.signInWithPassword({ email: f.querySelector("#l-email").value.trim(), password: f.querySelector("#l-pass").value });
    if (error) { f.querySelector("#l-err").textContent = "E-mail ou senha incorretos."; return; }
    S.user = data.user; return start();
  }
  if (f.id === "f-more") return submitMore(f);
  if (f.id === "f-mis-more") return submitMisMore(f);
  if (f.id === "f-mis") return saveMissao(f);
  if (f.id === "f-rot") return saveRotina(f);
  if (f.id === "f-enc") {
    const btns = f.querySelectorAll("button"); btns.forEach(b => b.disabled = true);
    try {
      const file = f.querySelector("#e-foto").files[0];
      const c = S.d.corretivas.find(x => x.id === f.dataset.id);
      const foto = file ? await uploadPhoto(await compressImage(file), c.unidade_id) : null;
      const { error } = await sb.rpc("encerrar_corretiva", { p_id: f.dataset.id, p_obs: f.querySelector("#e-obs").value, p_foto: foto });
      if (error) throw error;
    } catch (e) { f.querySelector("#e-err").textContent = cleanErr(e); btns.forEach(b => b.disabled = false); return; }
    closeModal(); await refresh(); return toast("Corretiva encerrada.");
  }
  if (f.id === "f-pin") {
    const { error } = await sb.rpc("definir_pin", { p_funcionario: f.dataset.id, p_pin: f.querySelector("#p-pin").value.trim() });
    if (error) { f.querySelector("#p-err").textContent = cleanErr(error); return; }
    closeModal(); return toast("PIN salvo.");
  }
});

/* ---------------- início e atualização ---------------- */
async function refresh(full) {
  try { await loadAll(); } catch (e) { toast(cleanErr(e), 5000); }
  render();
}
async function start() {
  const { data } = await sb.auth.getSession();
  S.user = data.session ? data.session.user : null;
  if (!S.user) return render();
  const adm = await sb.from("admins").select("user_id").eq("user_id", S.user.id).maybeSingle();
  S.isAdmin = !!(adm.data);
  if (S.isAdmin) {
    const { data: me, error } = await sb.rpc("quem_sou", { p_token: null });
    if (error) { $app.innerHTML = '<div class="center-screen"><img src="logo.png" class="logo-big" alt=""><p class="err">' + esc(cleanErr(error)) + '</p><button class="btn" data-act="logout">Sair</button></div>'; return; }
    S.op = me; S.token = null;
  } else {
    let saved = null; try { saved = JSON.parse(lsGet("op") || "null"); } catch (e) {}
    if (saved && saved.token) {
      const { data: me, error } = await sb.rpc("quem_sou", { p_token: saved.token });
      if (!error) { S.op = Object.assign({ token: saved.token }, me); S.token = saved.token; }
      else dropOp();
    }
  }
  render();
  if (S.op) await refresh();
}
setInterval(() => { if (S.op && !S.modalOpen && !busy && S.view === "hoje") refresh(); }, 60000);
if (!window.CONFIG || /SEU-PROJETO/.test(window.CONFIG.SUPABASE_URL)) {
  $app.innerHTML = '<div class="center-screen"><img src="logo.png" class="logo-big" alt="Lav & Lov"><p class="err">Falta configurar o arquivo config.js com os dados do Supabase (passo 3 do guia).</p></div>';
} else start();
