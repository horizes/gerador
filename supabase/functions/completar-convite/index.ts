// Edge Function "completar-convite"
// -------------------------------------------------------------------------------------------
// O admin cria o convite com o NOME e já com o PAPEL e o NÍVEL que a pessoa vai receber (tela
// "Usuários" > "Criar acesso"), o que gera um link com um token aleatório — sem nenhum e-mail
// guardado ainda, e sem o papel/nível na URL (fica só no banco). A pessoa abre esse link, escolhe o
// PRÓPRIO e-mail numa telinha (ver js/auth.js), e o navegador dela chama esta função.
// O servidor reserva o convite, cria uma conta SEM confirmação e SEM senha, aplica o cargo/papel
// e envia o link de confirmação. A senha é escolhida somente depois de abrir o e-mail.
// Se o cadastro ou envio falhar, a conta recém-criada é removida e o admin emite novo convite.
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

  let limparCadastro: (() => Promise<void>) | null = null;
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) dados recebidos
    const corpo = await req.json().catch(() => null);
    const token = typeof corpo?.token === "string" ? corpo.token.trim() : "";
    const email = typeof corpo?.email === "string" ? corpo.email.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return json({ erro: "Link inválido — confira o endereço completo do convite." }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ erro: "E-mail inválido." }, 400);
    if (email.length > 254) return json({ erro: "E-mail inválido." }, 400);

    // Consumo atômico no banco; falhas nunca reabrem um convite privilegiado.
    const { data: convite, error: erroConvite } = await admin.rpc("reservar_convite", { p_token: token });
    if (erroConvite) {
      // Uma falha de instalação/conexão não significa que o convite foi utilizado.
      const codigo = erroConvite.code || "";
      const conviteIndisponivel = codigo === "P0002" ||
        (codigo === "P0001" && /^Convite inválido, expirado ou já utilizado\./.test(erroConvite.message || ""));
      if (conviteIndisponivel) return json({ erro: "Convite inválido, expirado ou já utilizado. Peça outro ao administrador.", codigo: "CONVITE_INDISPONIVEL" }, 400);
      console.error("Falha ao reservar convite", { codigo }); // Nunca registrar token, e-mail ou senha.
      const configuracao = ["PGRST202", "42883", "42P01", "42703", "42501"].includes(codigo);
      return json({ erro: configuracao
        ? "O cadastro por convite precisa de uma atualização no servidor. Avise o administrador para instalar a correção de convites."
        : "Não foi possível validar o convite agora. Tente novamente mais tarde. Se o problema continuar, avise o administrador.",
        codigo: configuracao ? "CADASTRO_DESCONFIGURADO" : "VALIDACAO_INDISPONIVEL" }, 503);
    }
    if (!convite || typeof convite.nome !== "string" || !["admin", "usuario"].includes(convite.papel)) {
      return json({ erro: "Não foi possível confirmar os dados do convite. Avise o administrador.", codigo: "CONVITE_SEM_DADOS" }, 500);
    }

    // A criação separada impede que um convite altere papel/cargo de uma conta já existente.
    // Não definir senha antes da confirmação: quem digitou o e-mail pode não ser seu dono.
    const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { nome: convite.nome, convite_senha_pendente: true },
    });
    if (erroCriar) {
      const jaExiste = erroCriar.code === "email_exists" || /already.*(registr|exist)/i.test(erroCriar.message || "");
      return json(
        { erro: jaExiste ? "Esse e-mail já tem conta na plataforma. Vá para a tela de login ou peça outro convite ao administrador." : "Não foi possível criar a conta. Peça outro convite ao administrador." },
        400,
      );
    }
    if (!criado?.user?.id) return json({ erro: "Não foi possível preparar o acesso. Peça outro convite ao administrador." }, 500);
    const usuarioId = criado.user.id;
    async function desfazerCadastro() {
      const { error } = await admin.auth.admin.deleteUser(usuarioId);
      if (error) console.error("Cadastro incompleto requer revisão administrativa", usuarioId);
    }
    limparCadastro = desfazerCadastro;
    if (criado.user.email_confirmed_at) {
      await desfazerCadastro();
      return json({ erro: "O servidor não garantiu a confirmação por e-mail. Avise o administrador.", codigo: "CONFIRMACAO_DESCONFIGURADA" }, 503);
    }

    // Exige que o perfil exista e que o papel/cargo tenha sido realmente aplicado.
    const { data: perfil, error: erroPerfil } = await admin.from("perfis")
      .update({ papel: convite.papel, cargo_id: convite.cargo_id })
      .eq("id", usuarioId).select("id").single();
    if (erroPerfil || !perfil) {
      await desfazerCadastro();
      return json({ erro: "Não foi possível concluir a configuração do acesso. O convite foi consumido; peça outro ao administrador." }, 500);
    }

    // O convite nativo confirma o e-mail somente quando seu dono abre o link recebido.
    // Usa o Site URL do projeto; nunca aceita URL de retorno enviada pelo navegador.
    const { data: enviado, error: erroEnvio } = await admin.auth.admin.inviteUserByEmail(email);
    if (erroEnvio || !enviado?.user || enviado.user.id !== usuarioId) {
      await desfazerCadastro();
      const limitado = erroEnvio?.status === 429 || erroEnvio?.code === "over_email_send_rate_limit";
      return json({ erro: limitado
        ? "O envio de e-mails atingiu o limite. Aguarde e peça outro convite ao administrador."
        : "Não foi possível enviar a confirmação. Avise o administrador para conferir o envio de e-mails e gerar outro convite.",
        codigo: limitado ? "ENVIO_LIMITADO" : "CONFIRMACAO_NAO_ENVIADA" }, limitado ? 429 : 503);
    }
    return json({ ok: true, confirmacao_pendente: true });
  } catch (_) {
    // Em uma exceção, remover apenas a conta que esta execução acabou de criar.
    if (limparCadastro) {
      try { await limparCadastro(); }
      catch (_) { console.error("Não foi possível remover o cadastro incompleto"); }
    }
    console.error("Falha inesperada no cadastro por convite");
    return json({ erro: "Não foi possível concluir o cadastro. Avise o administrador e peça outro convite." }, 500);
  }
});
