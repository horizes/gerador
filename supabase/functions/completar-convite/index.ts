// Edge Function "completar-convite"
// -------------------------------------------------------------------------------------------
// O admin cria o convite com o NOME e já com o PAPEL e o NÍVEL que a pessoa vai receber (tela
// "Usuários" > "Criar acesso"), o que gera um link com um token aleatório — sem nenhum e-mail
// guardado ainda, e sem o papel/nível na URL (fica só no banco). A pessoa abre esse link, escolhe o
// PRÓPRIO e-mail e a própria senha numa telinha (ver js/auth.js), e o navegador dela chama esta
// função. Ela confere se o token existe e ainda não foi usado, cria a conta de verdade no Supabase
// Auth (usando o nome que o admin digitou), aplica o papel/nível escolhido no convite ao perfil
// recém-criado, e marca o convite como usado, para o link não poder ser reaproveitado. Assim o
// acesso já vale desde o primeiro login — não precisa mais voltar na tela "Usuários" para liberar
// nada.
//
// Por que uma Edge Function e não algo direto no navegador? Criar contas só é possível com a
// "service role key" do Supabase — uma chave que dá acesso total ao banco e por isso NUNCA pode
// ir para o código do site. Ela fica só aqui, guardada pelo próprio Supabase como variável de
// ambiente da função.
//
// Segurança: diferente da tela de login normal, quem chama esta função ainda NÃO tem conta —
// então ela não exige estar logado. Em vez disso, o próprio token (aleatório, gerado pelo banco,
// só existe se um admin criou o convite) é quem garante que só quem recebeu o link consegue criar
// uma conta. Um convite só pode ser usado uma vez e expira em 7 dias.
//
// Deploy (uma vez, veja o README.md): supabase functions deploy completar-convite

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1) dados recebidos
    const corpo = await req.json().catch(() => ({}));
    const token = String(corpo.token || "").trim();
    const email = String(corpo.email || "").trim().toLowerCase();
    const senha = String(corpo.senha || "");
    if (!token) return json({ erro: "Link inválido — falta o código do convite." }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ erro: "E-mail inválido." }, 400);
    if (senha.length < 6) return json({ erro: "A senha precisa ter pelo menos 6 caracteres." }, 400);

    // 2) o convite existe, ainda não foi usado e não expirou?
    const { data: convite } = await admin
      .from("convites_pendentes")
      .select("token,nome,papel,nivel_id,criado_em,usado_em")
      .eq("token", token)
      .maybeSingle();

    if (!convite) return json({ erro: "Link inválido ou já cancelado pelo administrador." }, 400);
    if (convite.usado_em) return json({ erro: "Este link já foi usado. Peça um novo convite ao administrador." }, 400);
    if (Date.now() - new Date(convite.criado_em).getTime() > SETE_DIAS_MS) {
      return json({ erro: "Este link expirou (vale por 7 dias). Peça um novo convite ao administrador." }, 400);
    }

    // 3) cria a conta de verdade, já com e-mail confirmado (a pessoa acabou de escolher o próprio
    //    e-mail e senha, então não precisa confirmar por e-mail de novo)
    const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome: convite.nome },
    });
    if (erroCriar) {
      const jaExiste = /already.*(registr|exist)/i.test(erroCriar.message || "");
      return json(
        { erro: jaExiste ? "Esse e-mail já tem conta na plataforma. Use outro e-mail ou vá para a tela de login." : erroCriar.message },
        400,
      );
    }

    // 4) aplica ao perfil o papel/nível que o admin escolheu ao gerar o convite — o gatilho
    //    on_auth_user_created_perfil já criou a linha em "perfis" (só com o nome) no passo acima,
    //    então aqui é só atualizar. Se o admin não escolheu nível nenhum, isso é um "no-op" (fica
    //    como usuário comum sem nível, igual era antes), então não precisa condicional nenhuma.
    await admin.from("perfis").update({ papel: convite.papel, nivel_id: convite.nivel_id }).eq("id", criado.user.id);

    // 5) marca o convite como usado, para o link não poder ser reaproveitado
    await admin.from("convites_pendentes").update({ usado_em: new Date().toISOString() }).eq("token", token);

    return json({ ok: true });
  } catch (e) {
    return json({ erro: String((e && (e as Error).message) || e) }, 500);
  }
});
