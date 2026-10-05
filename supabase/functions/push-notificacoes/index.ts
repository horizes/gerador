// Web Push padrão (VAPID), sem depender do site aberto ou da chave do Resend.
// Endpoints de navegador nunca são retornados nem aceitos como destino arbitrário de um envio.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const uuid = (value: unknown) => typeof value === "string" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
function endpointValido(value: unknown): boolean {
 try {
  if (typeof value !== "string" || value.length > 2048) return false;
  const u = new URL(value), h = u.hostname;
  return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash &&
   (h === "fcm.googleapis.com" || h === "updates.push.services.mozilla.com" || h === "push.services.mozilla.com" || h === "web.push.apple.com" || h.endsWith(".notify.windows.com"));
 } catch { return false; }
}
function chaveValida(value: unknown, bytes: number) {
 if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
 try { return atob(value.replace(/-/g,"+").replace(/_/g,"/")).length === bytes; } catch { return false; }
}
async function segredoIgual(a: string, b: string) {
 const enc = new TextEncoder();
 const [x,y] = await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(a)),crypto.subtle.digest("SHA-256",enc.encode(b))]);
 const aa=new Uint8Array(x),bb=new Uint8Array(y);let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;
}
function falha(error: unknown): string {
 return error instanceof Error && error.message === "timeout" ? "timeout" : "envio_falhou";
}
async function enviar(aparelho: {endpoint:string;p256dh:string;auth:string}, payload: unknown, vapid: {subject:string;publicKey:string;privateKey:string}) {
 if (!endpointValido(aparelho.endpoint)) return 410;
 const details=webpush.generateRequestDetails({endpoint:aparelho.endpoint,keys:{p256dh:aparelho.p256dh,auth:aparelho.auth}},JSON.stringify(payload),{vapidDetails:vapid,TTL:3600,urgency:"normal"});
 const resp=await fetch(details.endpoint,{method:"POST",headers:details.headers,body:new Uint8Array(details.body),signal:AbortSignal.timeout(8000),redirect:"error"});
 return resp.status;
}
Deno.serve(async req => {
 if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
 if(req.method!=="POST")return json({erro:"Método não permitido."},405);
 try {
  const texto=await req.text();if(texto.length>16384)return json({erro:"Dados muito grandes."},413);
  let corpo;try{corpo=JSON.parse(texto);}catch{return json({erro:"Dados inválidos."},400);}
  if(!corpo||typeof corpo!=="object")return json({erro:"Dados inválidos."},400);
  const url=Deno.env.get("SUPABASE_URL")!,role=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const publico=Deno.env.get("VAPID_PUBLIC_KEY")||"",privado=Deno.env.get("VAPID_PRIVATE_KEY")||"",segredo=Deno.env.get("PUSH_DISPATCH_SECRET")||"";
  const vapid={publicKey:publico,privateKey:privado,subject:Deno.env.get("VAPID_SUBJECT")||"mailto:wilson.cyriaco@imperiumservicos.com"};
  const admin=createClient(url,role,{auth:{persistSession:false}});
  if(corpo.acao==="despachar"){
   if(segredo.length<32||!await segredoIgual(req.headers.get("x-push-secret")||"",segredo))return json({erro:"Sem autorização."},401);
   if(!chaveValida(publico,65)||!chaveValida(privado,32))return json({erro:"VAPID não configurado."},503);
   const {data:jobs,error}=await admin.rpc("push_reservar",{p_limite:20});if(error)throw error;
   const processar=async(job: {id:string;aparelho_id:string;usuario_id:string;modulo:string;titulo:string;mensagem:string;tentativas:number})=>{
    let estado="ignorado",codigo:string|null=null;
    try{
     const {data:a,error:e}=await admin.from("push_aparelhos").select("*").eq("id",job.aparelho_id).maybeSingle();if(e)throw e;
     const {data:permitido,error:ep}=await admin.rpc("push_pode_ver",{p_usuario:job.usuario_id,p_modulo:job.modulo});if(ep)throw ep;
     if(a&&a.usuario_id===job.usuario_id&&a.vapid_publica===publico&&permitido&&['uniforme_solicitar','uniforme_gestao'].includes(job.modulo)){
      const status=await enviar(a,{title:job.titulo,body:job.mensagem,route:job.modulo,tag:job.id},vapid);
      if(status>=200&&status<300)estado="enviado";
      else if(status===404||status===410){const {error:del}=await admin.from("push_aparelhos").delete().eq("id",a.id);if(del)throw del;}
      else{estado=job.tentativas>=5?"falhou":"pendente";codigo="http_"+status;}
     }
    }catch(e){estado=job.tentativas>=5?"falhou":"pendente";codigo=falha(e);}
    const {error:gravacao}=await admin.from("push_fila").update({estado,erro_codigo:codigo,proxima_tentativa:new Date(Date.now()+Math.min(60,2**job.tentativas)*60000).toISOString()}).eq("id",job.id).eq("tentativas",job.tentativas);
    if(gravacao)throw gravacao;
   };
   for(let i=0;i<(jobs||[]).length;i+=4)await Promise.all(jobs.slice(i,i+4).map(processar));
   return json({ok:true,processados:jobs?.length||0});
  }
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return json({erro:"Entre na plataforma para configurar as notificações."},401);
  const {data:auth,error:authError}=await admin.auth.getUser(token);if(authError||!auth?.user)return json({erro:"Sessão inválida."},401);
  const usuario=auth.user.id;
  const {data:perfil,error:perfilError}=await admin.from("perfis").select("ativo").eq("id",usuario).maybeSingle();
  if(perfilError||!perfil?.ativo)return json({erro:"Acesso inativo."},403);
  if(['config','ativar','testar'].includes(corpo.acao)){
   const acessos=await Promise.all(['uniforme_solicitar','uniforme_gestao'].map(p_modulo=>admin.rpc('push_pode_ver',{p_usuario:usuario,p_modulo})));
   if(acessos.some(r=>r.error))throw Error('Permissões não configuradas.');
   if(!acessos.some(r=>r.data))return json({erro:"Sem acesso às notificações de uniforme/EPI."},403);
   if(!chaveValida(publico,65)||!chaveValida(privado,32)||segredo.length<32)return json({erro:"Notificações ainda não configuradas pela administração."},503);
  }
  if(corpo.acao==="config"){
   const {error}=await admin.from("push_aparelhos").select("id").limit(1);
   if(error||!chaveValida(publico,65)||!chaveValida(privado,32)||segredo.length<32)return json({erro:"Notificações ainda não configuradas pela administração. Consulte NOTIFICACOES-PUSH.md."},503);
   return json({publicKey:publico});
  }
  if(corpo.acao==="desativar"){
   if(!endpointValido(corpo.endpoint))return json({erro:"Aparelho inválido."},400);
   const {error}=await admin.from("push_aparelhos").delete().eq("usuario_id",usuario).eq("endpoint",corpo.endpoint);if(error)throw error;
   return json({ok:true});
  }
  if(corpo.acao==="ativar"){
   const s=corpo.subscription;
   if(!endpointValido(s?.endpoint)||!chaveValida(s?.keys?.p256dh,65)||!chaveValida(s?.keys?.auth,16)||corpo.publicKey!==publico)return json({erro:"Inscrição inválida. Atualize a página e tente novamente."},400);
   const {data:anterior,error:leitura}=await admin.from("push_aparelhos").select("usuario_id,p256dh,auth").eq("endpoint",s.endpoint).maybeSingle();if(leitura)throw leitura;
   if(anterior&&anterior.usuario_id!==usuario&&(anterior.p256dh!==s.keys.p256dh||anterior.auth!==s.keys.auth))return json({erro:"Aparelho vinculado a outra conta."},409);
   const {data,error}=await admin.from("push_aparelhos").upsert({usuario_id:usuario,endpoint:s.endpoint,p256dh:s.keys.p256dh,auth:s.keys.auth,vapid_publica:publico,atualizado_em:new Date().toISOString()},{onConflict:"endpoint"}).select("id").single();if(error)throw error;
   return json({ok:true,id:data.id});
  }
  if(corpo.acao==="testar"){
   if(!uuid(corpo.id))return json({erro:"Aparelho inválido."},400);
   const {data:a,error}=await admin.from("push_aparelhos").select("*").eq("id",corpo.id).eq("usuario_id",usuario).maybeSingle();if(error)throw error;
   if(!a)return json({erro:"Ative as notificações neste aparelho primeiro."},404);
   const status=await enviar(a,{title:"Imperium — notificações ativadas",body:"Este aparelho pode receber avisos mesmo com o site fechado.",route:"",tag:"imperium-teste"},vapid);
   if(status===404||status===410){await admin.from("push_aparelhos").delete().eq("id",a.id);return json({erro:"Inscrição expirada. Desative e ative novamente."},410);}
   return status>=200&&status<300?json({ok:true}):json({erro:"O serviço de notificações não aceitou o envio. Tente novamente."},502);
  }
  return json({erro:"Ação inválida."},400);
 }catch{console.error("push-notificacoes: falha de processamento (sem dados do usuário)");return json({erro:"Não foi possível concluir. Confira a instalação ou tente novamente."},500);}
});
