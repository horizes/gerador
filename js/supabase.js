/* Conexão com o Supabase (autenticação e dados compartilhados da plataforma).
   Usa a URL e a chave publicável (anon/publishable) do projeto — essa chave é
   segura para ficar no código do site: ela só funciona dentro do que as regras
   de segurança (RLS) do banco permitirem (ver supabase-schema.sql). */
(function(){
"use strict";

const SUPABASE_URL = "https://abweepruixcyetrzefhk.supabase.co";
const SUPABASE_KEY = "sb_publishable_qf_GkZhp3r8ZWwj9M1ckqQ_XHGm66_k";

window.Imperium = window.Imperium || {};
window.Imperium.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

})();
