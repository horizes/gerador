// Edge Function "completar-convite"
// -------------------------------------------------------------------------------------------
// O admin cria o convite com o NOME e já com o PAPEL e o NÍVEL que a pessoa vai receber (tela
// "Usuários" > "Criar acesso"), o que gera um link com um token aleatório — sem nenhum e-mail
// guardado ainda, e sem o papel/nível na URL (fica só no banco). A pessoa abre esse link, escolhe o
// PRÓPRIO e-mail e a própria senha numa telinha (ver js/auth.js), e o navegador dela chama esta
// função. O servidor consome o convite atomicamente ANTES de criar a conta e só devolve sucesso
// depois de confirmar a gravação do cargo/papel. Se o cadastro falhar, o admin emite novo convite.
// Isso impede reutilização concorrente, inclusive para convites de administrador.
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

    // Consumo atômico no banco; falhas nunca reabrem um convite privilegiado.
    const { data: convite, error: erroConvite } = await admin.rpc("reservar_convite", { p_token: token });
    if (erroConvite || !convite) return json({ erro: "Convite inválido, expirado ou já utilizado. Peça outro ao administrador." }, 400);

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
        { erro: jaExiste ? "Esse e-mail já tem conta na plataforma. Vá para a tela de login ou peça outro convite ao administrador." : "Não foi possível criar a conta. Peça outro convite ao administrador." },
        400,
      );
    }

    // Exige que o perfil exista e que o papel/cargo tenha sido realmente aplicado.
    const { data: perfil, error: erroPerfil } = await admin.from("perfis")
      .update({ papel: convite.papel, cargo_id: convite.cargo_id })
      .eq("id", criado.user.id).select("id").single();
    if (erroPerfil || !perfil) {
      const { error: erroExcluir } = await admin.auth.admin.deleteUser(criado.user.id);
      if (erroExcluir) console.error("Cadastro incompleto requer revisão administrativa", criado.user.id);
      return json({ erro: "Não foi possível concluir a configuração do acesso. O convite foi consumido; peça outro ao administrador." }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ erro: String((e && (e as Error).message) || e) }, 500);
  }
});
