// Edge Function "open-finance"
// -------------------------------------------------------------------------------------------
// Ponte entre o Fluxo de Caixa e o Open Finance, via Pluggy (agregador autorizado). O segredo do
// Pluggy (CLIENT_SECRET) fica só aqui, nunca no site. Ações (corpo JSON { acao, ... }):
//   token        -> gera o token do widget "Pluggy Connect" (com itemId, reconecta uma conexão existente)
//   registrar    -> { itemId } guarda a conexão feita no widget e já sincroniza
//   sincronizar  -> { conexaoId? } atualiza saldos e importa movimentações novas como lançamentos
//   desconectar  -> { conexaoId } (só admin) remove a conexão; os lançamentos já importados ficam
// Quem chama precisa estar logado e ter acesso ao módulo "fluxo" (mesma regra do banco, RLS).
//
// Secrets (uma vez): supabase secrets set PLUGGY_CLIENT_ID=... PLUGGY_CLIENT_SECRET=...
// Deploy: supabase functions deploy open-finance

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const PLUGGY = "https://api.pluggy.ai";
const DIAS_PRIMEIRA_CARGA = 90;

async function pluggyKey(): Promise<string> {
  const r = await fetch(`${PLUGGY}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: Deno.env.get("PLUGGY_CLIENT_ID"),
      clientSecret: Deno.env.get("PLUGGY_CLIENT_SECRET"),
    }),
  });
  if (!r.ok) throw new Error("Não foi possível autenticar no Pluggy. Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.");
  return (await r.json()).apiKey;
}

async function pluggy(key: string, caminho: string, init: RequestInit = {}) {
  const r = await fetch(`${PLUGGY}${caminho}`, {
    ...init,
    headers: { "X-API-KEY": key, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Pluggy respondeu ${r.status} em ${caminho.split("?")[0]}.`);
  return r.status === 204 ? null : await r.json();
}

const formaDe = (d: string) =>
  /pix/i.test(d) ? "Pix" : /boleto/i.test(d) ? "Boleto" : /\b(ted|doc)\b|transf/i.test(d) ? "Transferência" : "Outro";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405);

  try {
    const URL_ = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1) quem chama: logado + com acesso ao Fluxo (a mesma função tem_acesso_modulo das regras do banco)
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ erro: "Sessão não encontrada. Faça login de novo." }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ erro: "Sessão inválida ou expirada. Faça login de novo." }, 401);

    const doUsuario = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: tem } = await doUsuario.rpc("tem_acesso_modulo", { mod: "fluxo" });
    if (!tem) return json({ erro: "Você não tem acesso ao Fluxo de Caixa." }, 403);

    const corpo = await req.json().catch(() => ({}));
    const key = await pluggyKey();

    // ---- token do widget ----
    if (corpo.acao === "token") {
      const body: Record<string, unknown> = { options: { clientUserId: u.user.id } };
      if (corpo.itemId) body.itemId = String(corpo.itemId);
      const r = await pluggy(key, "/connect_token", { method: "POST", body: JSON.stringify(body) });
      return json({ accessToken: r.accessToken });
    }

    // ---- desconectar (admin) ----
    if (corpo.acao === "desconectar") {
      const { data: p } = await admin.from("perfis").select("papel,ativo").eq("id", u.user.id).maybeSingle();
      if (!p || p.papel !== "admin" || !p.ativo) return json({ erro: "Só administradores podem desconectar um banco." }, 403);
      const { data: c } = await admin.from("banco_conexoes").select("id,item_id").eq("id", corpo.conexaoId).maybeSingle();
      if (!c) return json({ erro: "Conexão não encontrada." }, 404);
      await pluggy(key, `/items/${c.item_id}`, { method: "DELETE" }).catch(() => {}); // se já sumiu lá, segue
      await admin.from("banco_conexoes").delete().eq("id", c.id);
      return json({ ok: true });
    }

    // ---- registrar: guarda a conexão criada no widget ----
    if (corpo.acao === "registrar") {
      const itemId = String(corpo.itemId || "").trim();
      if (!itemId) return json({ erro: "Falta o itemId da conexão." }, 400);
      const item = await pluggy(key, `/items/${itemId}`);
      await admin.from("banco_conexoes").upsert(
        { item_id: itemId, instituicao: item.connector?.name || "Banco", status: item.status || "", criado_por: u.user.id },
        { onConflict: "item_id" },
      );
    } else if (corpo.acao !== "sincronizar") {
      return json({ erro: "Ação desconhecida." }, 400);
    }

    // ---- sincronizar (também roda depois de registrar) ----
    let q = admin.from("banco_conexoes").select("*");
    if (corpo.acao === "registrar") q = q.eq("item_id", corpo.itemId);
    else if (corpo.conexaoId) q = q.eq("id", corpo.conexaoId);
    const { data: conexoes } = await q;

    let novos = 0;
    const avisos: string[] = [];

    for (const c of conexoes || []) {
      const item = await pluggy(key, `/items/${c.item_id}`);
      await admin.from("banco_conexoes").update({ status: item.status || "", instituicao: item.connector?.name || c.instituicao }).eq("id", c.id);

      if (item.status === "UPDATING" || item.status === "LOGIN_IN_PROGRESS") {
        avisos.push(`${c.instituicao}: o banco ainda está sendo lido. Sincronize de novo em alguns minutos.`);
        continue;
      }
      if (item.status === "LOGIN_ERROR" || item.status === "OUTDATED" || item.status === "WAITING_USER_INPUT") {
        avisos.push(`${c.instituicao}: precisa de nova autorização. Use "Reconectar".`);
        continue;
      }

      const contas = (await pluggy(key, `/accounts?itemId=${c.item_id}`)).results || [];
      if (contas.length) {
        await admin.from("banco_contas").upsert(contas.map((a: any) => ({
          id: a.id, conexao_id: c.id, nome: a.marketingName || a.name || "Conta", tipo: a.type || "",
          saldo: a.balance ?? 0, atualizado_em: new Date().toISOString(),
        })));
      }

      // Só contas correntes/poupança viram lançamentos. Cartão de crédito fica só com o saldo: a fatura
      // paga já aparece como saída na conta, então importar as compras contaria a despesa duas vezes.
      const desde = new Date(c.ultima_sincronizacao ? new Date(c.ultima_sincronizacao).getTime() - 7 * 864e5 : Date.now() - DIAS_PRIMEIRA_CARGA * 864e5)
        .toISOString().slice(0, 10);

      for (const conta of contas.filter((a: any) => a.type === "BANK")) {
        for (let pagina = 1, total = 1; pagina <= total; pagina++) {
          const r = await pluggy(key, `/transactions?accountId=${conta.id}&from=${desde}&pageSize=500&page=${pagina}`);
          total = r.totalPages || 1;
          const movs = (r.results || []).filter((t: any) => t.status !== "PENDING");
          if (!movs.length) continue;

          // registra o que é novo; só o que for novo vira lançamento (apagar o lançamento depois não o traz de volta)
          const { data: inseridas } = await admin.from("banco_transacoes")
            .upsert(movs.map((t: any) => ({ id: t.id, conta_id: conta.id })), { onConflict: "id", ignoreDuplicates: true })
            .select("id");
          const idsNovos = new Set((inseridas || []).map((x: any) => x.id));
          const linhas = movs.filter((t: any) => idsNovos.has(t.id)).map((t: any) => {
            const entrada = t.type === "CREDIT";
            return {
              data: String(t.date).slice(0, 10),
              tipo: entrada ? "entrada" : "saida",
              categoria: entrada ? "Outras receitas" : "Outras despesas",
              descricao: t.description || t.descriptionRaw || "",
              forma: formaDe(`${t.description || ""} ${t.descriptionRaw || ""}`),
              status: "pago",
              valor: Math.abs(Number(t.amount) || 0),
              banco_transacao_id: t.id,
              criado_por: u.user.id,
            };
          });
          if (linhas.length) {
            const { error } = await admin.from("fluxo_lancamentos").insert(linhas);
            if (error) throw new Error("Não foi possível gravar os lançamentos: " + error.message);
            novos += linhas.length;
          }
        }
      }
      await admin.from("banco_conexoes").update({ ultima_sincronizacao: new Date().toISOString() }).eq("id", c.id);
    }

    return json({ ok: true, novos, avisos });
  } catch (e) {
    return json({ erro: String((e && (e as Error).message) || e) }, 500);
  }
});
