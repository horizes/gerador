// Edge Function "notificar-pedido-uniforme"
// -------------------------------------------------------------------------------------------
// Chamada pela tela "Solicitar uniforme e EPI" (js/modules/uniformes.js) logo depois que o pedido
// é criado no banco (uniforme_criar_pedido). A função busca o pedido e os itens com a service role
// key e manda um e-mail para o endereço da empresa avisando que chegou um pedido novo — só para
// facilitar (o aviso na tela e o número no menu continuam funcionando do mesmo jeito, com ou sem
// e-mail). Se o e-mail falhar por qualquer motivo, o pedido já foi criado normalmente; a pessoa que
// pediu não percebe nada.
//
// Usa o Resend (resend.com) para enviar o e-mail — é o jeito mais simples de mandar e-mail a partir
// de uma Edge Function, sem precisar configurar um servidor de e-mail (SMTP) próprio. Tem plano
// gratuito. Passo a passo completo no README.md, seção "Uniformes e EPI: aviso por e-mail".
//
// Segurança: exige estar logado. Só manda o e-mail se quem chamou for o próprio solicitante do
// pedido ou alguém com acesso à tela "Solicitações de uniforme e EPI" (o responsável) — confere no
// banco com a service role key, não confia em nada que vier pronto do navegador.
//
// Deploy (uma vez, veja o README.md):
//   supabase secrets set RESEND_API_KEY=... RESEND_FROM_EMAIL=... EMAIL_DESTINO=...
//   supabase functions deploy notificar-pedido-uniforme

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

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL");
    const EMAIL_DESTINO = Deno.env.get("EMAIL_DESTINO");
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (!RESEND_API_KEY || !RESEND_FROM_EMAIL || !EMAIL_DESTINO) {
      // Não configurado ainda: não é erro do pedido, só não manda o e-mail.
      return json({ aviso: "E-mail não configurado (faltam variáveis RESEND_API_KEY / RESEND_FROM_EMAIL / EMAIL_DESTINO)." }, 200);
    }

    // 1) quem está chamando precisa estar logado...
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ erro: "Sessão não encontrada." }, 401);

    const { data: quemChama, error: erroToken } = await admin.auth.getUser(jwt);
    if (erroToken || !quemChama?.user) return json({ erro: "Sessão inválida ou expirada." }, 401);

    // 2) o pedido
    const corpo = await req.json().catch(() => ({}));
    const pedidoId = String(corpo.pedido_id || "").trim();
    if (!pedidoId) return json({ erro: "Falta o pedido_id." }, 400);

    const { data: pedido, error: erroPedido } = await admin
      .from("uniforme_pedidos")
      .select("*, itens:uniforme_itens(*)")
      .eq("id", pedidoId)
      .maybeSingle();
    if (erroPedido || !pedido) return json({ erro: "Pedido não encontrado." }, 404);

    // 3) ...e precisa ser o dono do pedido ou o responsável (acesso a "uniforme_gestao", inclusive
    //    admin, que já tem as duas ferramentas automaticamente — mesma regra de sempre, ver
    //    tem_acesso_modulo em supabase-schema-cargos-unificados.sql). Chama a função existente como
    //    o próprio usuário (com o JWT dele), para valer auth.uid() nela.
    const souDono = pedido.solicitante_id === quemChama.user.id;
    let souResponsavel = false;
    if (!souDono) {
      const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: acesso } = await asUser.rpc("tem_acesso_modulo", { mod: "uniforme_gestao" });
      souResponsavel = !!acesso;
    }
    if (!souDono && !souResponsavel) return json({ erro: "Sem permissão." }, 403);

    // 4) monta e manda o e-mail
    const itens = (pedido.itens || []) as Array<{ tipo_nome: string; tamanho: string; quantidade: number; categoria: string }>;
    const linhasItens = itens
      .map((i) => `<li>${esc(i.quantidade)}x ${esc(i.tipo_nome)}${i.tamanho && i.tamanho !== "Único" ? ` — tamanho ${esc(i.tamanho)}` : ""} <i>(${i.categoria === "epi" ? "EPI" : "Uniforme"})</i></li>`)
      .join("");
    const html = `
      <h2>Novo pedido de uniforme / EPI</h2>
      <p><b>Solicitante:</b> ${esc(pedido.solicitante_nome)}<br>
         <b>Cargo:</b> ${esc(pedido.cargo_nome)}<br>
         <b>Data:</b> ${esc(new Date(pedido.criado_em).toLocaleString("pt-BR"))}</p>
      <p><b>Itens pedidos:</b></p>
      <ul>${linhasItens}</ul>
      ${pedido.observacao ? `<p><b>Observação:</b> ${esc(pedido.observacao)}</p>` : ""}
      <p>Acesse a plataforma, em "Solicitações de uniforme e EPI", para atender esse pedido.</p>
    `;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: EMAIL_DESTINO.split(",").map((e) => e.trim()).filter(Boolean),
        subject: `Novo pedido de uniforme/EPI — ${pedido.solicitante_nome}`,
        html,
      }),
    });
    if (!resp.ok) {
      const detalhe = await resp.text().catch(() => "");
      return json({ erro: `Falha ao enviar e-mail (Resend): ${detalhe}` }, 502);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
