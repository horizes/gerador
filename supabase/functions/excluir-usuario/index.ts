// Edge Function "excluir-usuario"
// -------------------------------------------------------------------------------------------
// Chamada pela tela "Usuários" (cartão "Pessoas" > botão "Excluir conta") quando um admin quer
// apagar de vez o login de alguém — diferente de "Bloquear", que só impede a pessoa de entrar mas
// mantém a conta (e dá pra desbloquear depois). Excluir é definitivo: some o login do Supabase Auth
// e, por causa do "on delete cascade" das tabelas (ver supabase-schema-permissoes.sql e
// supabase-schema-usuarios.sql), some junto o perfil, as permissões diretas por ferramenta e os
// convites que essa pessoa tiver criado. O que ela já lançou no Fluxo de Caixa e já pediu no
// Uniformes/EPI continua no histórico — só o "quem fez" fica em branco (ver
// supabase-schema-excluir-usuario.sql).
//
// Por que uma Edge Function e não algo direto no navegador? Excluir um login (não só o perfil) só é
// possível com a "service role key" do Supabase — a mesma chave usada por completar-convite — que
// nunca pode ir para o código do site. Diferente de completar-convite, aqui quem chama JÁ tem
// conta: por isso a função exige estar logado E ser admin ativo, conferindo isso ela mesma (com a
// service role key, não dá pra confiar em nada que vier pronto do navegador).
//
// Deploy (uma vez, veja o README.md): supabase functions deploy excluir-usuario

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

    // 1) quem está chamando precisa estar logado...
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ erro: "Sessão não encontrada. Faça login de novo e tente outra vez." }, 401);

    const { data: quemChama, error: erroToken } = await admin.auth.getUser(jwt);
    if (erroToken || !quemChama?.user) {
      return json({ erro: "Sessão inválida ou expirada. Faça login de novo e tente outra vez." }, 401);
    }

    // ...e precisa ser admin ativo (confere no banco, não no que o navegador diz que é)
    const { data: perfilChamador } = await admin
      .from("perfis")
      .select("papel,ativo")
      .eq("id", quemChama.user.id)
      .maybeSingle();
    if (!perfilChamador || perfilChamador.papel !== "admin" || !perfilChamador.ativo) {
      return json({ erro: "Só administradores podem excluir contas." }, 403);
    }

    // 2) dados recebidos
    const corpo = await req.json().catch(() => ({}));
    const alvoId = String(corpo.userId || "").trim();
    if (!alvoId) return json({ erro: "Falta dizer qual conta excluir." }, 400);
    if (alvoId === quemChama.user.id) {
      return json({ erro: "Você não pode excluir a própria conta por aqui. Peça para outro admin fazer isso." }, 400);
    }

    // 3) exclui de vez — o "on delete cascade" das tabelas cuida do resto (perfil, permissões
    //    diretas, convites criados por essa pessoa); o que ela lançou no Fluxo de Caixa e pediu no
    //    Uniformes/EPI fica no histórico, só sem o vínculo com a conta (ver supabase-schema-
    //    excluir-usuario.sql)
    const { error: erroExcluir } = await admin.auth.admin.deleteUser(alvoId);
    if (erroExcluir) {
      const naoExiste = /not.*found|does not exist/i.test(erroExcluir.message || "");
      return json(
        {
          erro: naoExiste
            ? "Essa conta já não existe mais (talvez já tenha sido excluída em outra aba)."
            : `Não foi possível excluir: ${erroExcluir.message}`,
        },
        400,
      );
    }

    return json({ ok: true });
  } catch (e) {
    return json({ erro: String((e && (e as Error).message) || e) }, 500);
  }
});
