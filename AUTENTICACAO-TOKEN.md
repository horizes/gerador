> Guia atual: siga **CORRECAO-CODIGO-EMAIL.md**. Este documento registra a versão anterior, com limite de seis números e sem persistência da etapa do código.

# Autenticação por token — Imperium

O primeiro acesso e a recuperação de senha usam somente o código de seis números recebido por e-mail. Os dois modelos não contêm links, botões de confirmação ou `{{ .ConfirmationURL }}`/`{{ .TokenHash }}`. O login habitual continua com e-mail e senha.

Fluxo: convite do administrador → informar e-mail → receber código → digitar e-mail e código na plataforma → criar senha → entrar. O link inicial criado pelo administrador permanece: ele abre o formulário para informar o e-mail, sem confirmar nem liberar a conta.

## 1. Supabase: estado da senha

Se ainda não instalou o SQL da correção anterior, abra **SQL Editor → New query**, cole todo o arquivo `supabase-schema-estado-senha.sql` e clique em **Run** antes de publicar o site. É o mesmo SQL da versão anterior: contém duas consultas de leitura e não altera contas, senhas ou papéis.

A lista mantém **E-mail não confirmado**, **Senha pendente** e **Pode logar**. A plataforma consulta a existência real da senha no banco antes de abrir ferramentas. Uma sessão antiga sem senha, que veio de um link, recebe a tela para digitar o código.

## 2. GitHub: arquivos do site

Extraia `imperium-autenticacao-token.zip`. Substitua os sete arquivos abaixo na pasta publicada pelo GitHub Pages, mantendo seus caminhos:

- `index.html`
- `js/auth.js`
- `js/supabase.js`
- `js/perfil.js`
- `js/modules/usuarios.js`
- `css/auth.css`
- `sw.js`

Aguarde a publicação terminar. Feche o aplicativo completamente, abra a plataforma conectado à internet e reabra o aplicativo. Versões: `auth.js?v=13`, `supabase.js?v=3`, `usuarios.js?v=8`, `perfil.js?v=4`, `auth.css?v=6` e cache `imperium-v41`.

O cliente não importa sessões de tokens em URLs (`detectSessionInUrl: false`). Links antigos são direcionados à tela de código. Não existe opção de verificar `token_hash` na interface nova. O token é enviado ao Supabase somente quando a pessoa preenche e-mail e os seis números e toca em **Confirmar código**.

## 3. Supabase: dois modelos de e-mail

Em **Authentication → Email → Templates**, substitua todo o conteúdo HTML dos dois modelos:

| Opção | Assunto | Arquivo dentro do pacote |
| --- | --- | --- |
| Invite user | Seu código de confirmação — Imperium | `supabase/templates/convite-email.html` |
| Reset password | Seu código para escolher a senha — Imperium | `supabase/templates/redefinir-senha.html` |

Preserve `{{ .Token }}`; o Supabase insere o código automaticamente. Publique os arquivos do site antes de trocar os modelos. O envio continua pelo SMTP já configurado. A Edge Function `completar-convite` permanece a mesma.

## 4. Primeiro acesso e recuperação

1. Gere um convite para uma conta nova sob seu controle.
2. A pessoa abre o link inicial do convite e informa o e-mail.
3. A própria plataforma abre **Código do e-mail**, com o endereço preenchido.
4. Digite os seis números da mensagem e toque em **Confirmar código**.
5. A tela **Crie sua senha** aparece antes de liberar as ferramentas. A lista de usuários mostra **Senha pendente** até a senha ser salva.
6. Depois de salvar, a conta pode entrar normalmente com e-mail e senha.

Também é possível digitar o código dentro do aplicativo instalado: escolha **Usar código do e-mail** no login e informe o endereço e os seis números. O código não depende do navegador em que o convite foi aberto.

Para uma conta que ficou parada no login, escolha **Usar código do e-mail**, informe o e-mail e toque em **Receber novo código**. Use o código da mensagem nova. **Esqueci minha senha** envia esse mesmo modelo de recuperação, sem link.

Depois de validar o código, a etapa de senha fica registrada apenas na sessão da aba para permitir recarregar antes de salvar. Esse registro não contém e-mail, senha ou token; a sessão e a confirmação continuam sendo verificadas no servidor. Se o navegador impedir esse armazenamento ou você mudar de navegador, use **Receber novo código** para concluir naquela sessão.

## Validação

Testes locais com Supabase simulado verificam: confirmação por código, código errado/expirado, envio duplicado, conta sem senha, sessão antiga de link, recuperação, atualização dos estados, retomada da etapa de senha e ausência de verificação por URL. O fluxo real no seu projeto precisa ser validado após publicar e receber um novo e-mail. O SQL não foi executado no projeto de produção durante a preparação.

Esta configuração torna o fluxo da plataforma e dos e-mails exclusivamente por código. A API nativa do Supabase continua sendo o serviço de autenticação; não foi alterada a implementação interna dos endpoints dele.

Referências: [Modelos de e-mail e variável Token](https://supabase.com/docs/guides/auth/auth-email-templates), [Verificação de OTP](https://supabase.com/docs/reference/javascript/auth-verifyotp).
