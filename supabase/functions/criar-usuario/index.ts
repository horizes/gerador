// Edge Function "criar-usuario"
// -------------------------------------------------------------------------------------------
// Cria uma conta nova (ou, se o e-mail já existir, gera um novo link de redefinição de senha
// para ela) e devolve o LINK pronto — a tela "Usuários" mostra esse link para você copiar e
// mandar por WhatsApp, e-mail, o que for mais fácil. A pessoa abre o link, define a própria
// senha e já entra na plataforma.
//
// Por que uma Edge Function e não algo direto no navegador? Criar contas e gerar esses links só
// é possível com a "service role key" do Supabase — uma chave que dá acesso total ao banco e por
// isso NUNCA pode ir para o código do site (qualquer pessoa poderia abrir o DevTools e roubá-la).
// Ela fica só aqui, guardada pelo próprio Supabase como variável de ambiente da função.
//
// Segurança: o Supabase já exige, por padrão, que quem chama a função esteja logado (verifica o
// token automaticamente antes do código abaixo rodar). Além disso, aqui dentro conferimos que
// quem chamou é um admin ATIVO da plataforma (tabela "perfis") antes de fazer qualquer coisa.
//
// Deploy (uma vez, veja o README.md): supabase functions deploy criar-usuario

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
    const authHeader = req.headers.get("Authorization") || "";

    // 1) quem está chamando? (usa a própria service role, mas só para LER o token do cabeçalho —
    //    o Supabase já validou que o token é genuíno antes de a função rodar)
    const comoChamador = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: quemChamou, error: erroChamador } = await comoChamador.auth.getUser();
    if (erroChamador || !quemChamou?.user) {
      return json({ erro: "Sessão inválida — saia e entre de novo." }, 401);
    }

    // 2) cliente admin (ignora RLS) — só usado DEPOIS de confirmar que quem chamou é admin
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: perfilChamador } = await admin
      .from("perfis")
      .select("papel,ativo")
      .eq("id", quemChamou.user.id)
      .maybeSingle();
    if (!perfilChamador || perfilChamador.papel !== "admin" || !perfilChamador.ativo) {
      return json({ erro: "Só administradores podem criar acessos." }, 403);
    }

    // 3) dados recebidos
    const corpo = await req.json().catch(() => ({}));
    const email = String(corpo.email || "").trim().toLowerCase();
    const nome = String(corpo.nome || "").trim();
    const redirectTo = corpo.redirectTo ? String(corpo.redirectTo) : undefined;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ erro: "E-mail inválido." }, 400);
    }

    // 4) tenta CRIAR um convite novo. Se o e-mail já tiver conta, gera em vez disso um link de
    //    redefinição de senha para essa conta (serve tanto para reenviar o convite de quem nunca
    //    entrou quanto para resetar a senha de quem esqueceu).
    let tipo: "invite" | "recovery" = "invite";
    let resultado = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: nome ? { nome } : undefined, redirectTo },
    });

    if (resultado.error) {
      const jaExiste = /already.*(registr|exist)/i.test(resultado.error.message || "");
      if (!jaExiste) return json({ erro: resultado.error.message }, 400);
      tipo = "recovery";
      resultado = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
      if (resultado.error) return json({ erro: resultado.error.message }, 400);
    }

    const link = resultado.data?.properties?.action_link;
    if (!link) return json({ erro: "O Supabase não devolveu o link." }, 500);

    return json({ link, email, tipo });
  } catch (e) {
    return json({ erro: String((e && (e as Error).message) || e) }, 500);
  }
});
