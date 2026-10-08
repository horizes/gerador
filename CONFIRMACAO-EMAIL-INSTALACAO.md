> Guia atual: siga **CORRECAO-CODIGO-EMAIL.md**. Este documento abaixo descreve uma versão anterior.

> Atualização para celular e aplicativo: siga primeiro **CORRECAO-EMAIL-CELULAR.md**, que atualiza os modelos de convite e recuperação com link direto e código.

# Ativar a confirmação de e-mail

O pacote corrige o cadastro por convite. O novo usuário informa o e-mail, recebe um link para confirmar o endereço e só então escolhe a senha e entra. A conta fica pendente enquanto o e-mail não for confirmado.

**Atualizar apenas os arquivos do site não basta. A função do Supabase também precisa ser publicada, e o envio de e-mails precisa estar configurado.** A instalação abaixo não foi executada no projeto publicado.

## 1. Configurar o e-mail e o endereço de retorno

Abra o projeto Supabase `abweepruixcyetrzefhk`:

- Em **Authentication > URL Configuration**, preencha **Site URL** com o endereço HTTPS real da plataforma, incluindo a pasta se houver. Exemplo: `https://seu-dominio.com/plataforma/`. Não use o link de convite, `#/propostas` ou `localhost` como endereço de produção. O link do e-mail volta para esse endereço.
- Nas configurações de autenticação por e-mail, mantenha **Confirm email** habilitado.
- Em **Authentication**, configure **Custom SMTP** com servidor, porta, usuário, senha e remetente do seu provedor. Se já estiver funcionando, mantenha a configuração existente. O serviço padrão do Supabase só envia para membros da equipe do projeto, portanto não serve para os usuários comuns da plataforma. Credenciais SMTP ficam apenas no Supabase.
- Em **Email Templates > Invite user**, mantenha o link nativo `{{ .ConfirmationURL }}`. O pacote inclui um modelo em português em `supabase/templates/convite-email.html`; pode colar esse HTML no modelo **Invite user** e usar o assunto **Confirme seu e-mail — Imperium**. Um link direto para o site não confirma a conta.

Referências: [SMTP no Supabase](https://supabase.com/docs/guides/auth/auth-smtp), [URLs de retorno](https://supabase.com/docs/guides/auth/redirect-urls), [modelos de e-mail](https://supabase.com/docs/guides/auth/auth-email-templates).

## 2. Atualizar a função do servidor

Na pasta `imperium-plataforma` extraída, com o Supabase CLI disponível, execute:

```powershell
npx supabase login
npx supabase link --project-ref abweepruixcyetrzefhk
npx supabase functions deploy completar-convite --no-verify-jwt
```

A função deve manter a verificação automática de JWT desabilitada, pois o convidado ainda não tem sessão. A autorização é feita pelo token de convite, que é validado e consumido uma única vez no banco. O arquivo `supabase/config.toml` já registra essa configuração.

Também pode atualizar pelo painel: **Edge Functions > completar-convite**, abra o editor, substitua o conteúdo pelo arquivo `supabase/functions/completar-convite/index.ts` deste pacote e publique com **Deploy updates**. Confira que **Verify JWT** continua desabilitado para essa função. [Documentação do editor](https://supabase.com/docs/guides/functions/quickstart-dashboard).

Não é necessário alterar tabelas para esta atualização. Se a função SQL `reservar_convite` ainda não estiver instalada, execute `supabase-schema-correcao-convites.sql` no SQL Editor; o script informa se faltam tabelas anteriores. Não reaplique todos os scripts de uma instalação já funcionando.

## 3. Atualizar o site

Publique os arquivos públicos desta versão na hospedagem da plataforma. Foram alterados `index.html`, `css/auth.css`, `js/auth.js`, `js/perfil.js`, `js/modules/usuarios.js` e `sw.js`. O gerador de propostas e as demais ferramentas foram preservados.

Os arquivos SQL, a pasta `supabase` e os documentos de instalação são para administração e não precisam ser publicados na hospedagem estática.

## 4. Conferir o fluxo real

1. Na tela **Usuários**, gere um convite novo com o papel e o cargo desejados.
2. Abra o link em uma janela privada e informe um e-mail que você controla e que ainda não tem conta no projeto.
3. Confira a tela **Confirme seu e-mail**. Nenhuma ferramenta deve abrir nessa etapa.
4. Abra a mensagem recebida e clique em **Confirmar e-mail**. A plataforma deve pedir a criação da senha.
5. Salve a senha. O usuário deve entrar com o papel e o cargo escolhidos. Depois, confira o login normal com essa senha.

Se o envio falhar, o usuário recebe uma mensagem e a função tenta remover somente a conta recém-criada incompleta. O convite inicial permanece consumido; gere outro depois de corrigir o envio. Para uma conta que já existe e está aguardando confirmação, confira a mensagem recebida e trate o reenvio no Supabase; um novo link inicial não modifica uma conta existente.

Convites iniciais continuam válidos por sete dias e não podem ser reutilizados. A validade do link enviado por e-mail segue a configuração de autenticação do Supabase. Contas antigas já confirmadas automaticamente não são alteradas retroativamente por este pacote.

## Verificação realizada

Foram aprovadas 18 verificações locais usando o código real e respostas simuladas do Supabase: envio pendente sem login, bloqueio de e-mail não confirmado, escolha de senha após confirmação, concorrência, erros de envio, conta existente, login normal e recuperação de senha. Nenhuma conta foi criada no projeto real e nenhum e-mail real foi enviado durante esses testes. A entrega real deve ser conferida após os passos acima.
