/* Conexão com o Supabase (autenticação e dados compartilhados da plataforma).
   Usa a URL e a chave publicável (anon/publishable) do projeto — essa chave é
   segura para ficar no código do site: ela só funciona dentro do que as regras
   de segurança (RLS) do banco permitirem (ver supabase-schema.sql). */
(function(){
"use strict";

const SUPABASE_URL = "https://abweepruixcyetrzefhk.supabase.co";
const SUPABASE_KEY = "sb_publishable_qf_GkZhp3r8ZWwj9M1ckqQ_XHGm66_k";

/* "Manter conectado": a sessão fica no localStorage (continua após fechar o navegador) ou, se a opção
   estiver desmarcada, no sessionStorage (acaba quando a aba/navegador é fechado).
   A escolha é guardada em CHAVE_MANTER; padrão = ligado, que é o comportamento de sempre. */
const CHAVE_MANTER = "imperium_manter_conectado";
function lerManter(){
  try{ return localStorage.getItem(CHAVE_MANTER) !== "0"; }catch(e){ return true; }
}
function definirManter(v){
  try{ localStorage.setItem(CHAVE_MANTER, v ? "1" : "0"); }catch(e){}
}
const armazenamentoSessao = {
  getItem(k){
    try{ const v = localStorage.getItem(k); return v !== null ? v : sessionStorage.getItem(k); }
    catch(e){ return null; }
  },
  setItem(k, v){
    try{
      const manter = lerManter();
      (manter ? localStorage : sessionStorage).setItem(k, v);
      (manter ? sessionStorage : localStorage).removeItem(k);
    }catch(e){}
  },
  removeItem(k){
    try{ localStorage.removeItem(k); }catch(e){}
    try{ sessionStorage.removeItem(k); }catch(e){}
  }
};

window.Imperium = window.Imperium || {};
window.Imperium.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: armazenamentoSessao }
});
window.Imperium.manterConectado = { ler: lerManter, definir: definirManter };

})();
