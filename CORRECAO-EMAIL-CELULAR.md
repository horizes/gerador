# Confirmação de e-mail no celular e no aplicativo — Imperium

Esta correção mantém o cadastro atual, os papéis/cargos e o gerador de propostas. Atualiza a autenticação, os modelos de convite/recuperação e a lista de usuários. A lista passa a mostrar **Senha pendente** quando o e-mail já foi confirmado, mas a senha ainda não existe. **Pode logar** exige e-mail confirmado, senha existente, conta ativa e não suspensa.

O link novo abre a própria plataforma e apresenta o botão **Confirmar e criar senha**. A plataforma verifica o token no Supabase, valida o usuário confirmado e pede a senha antes de liberar o acesso. O e-mail inclui um código de 6 números para concluir o mesmo processo diretamente no aplicativo, mesmo quando o navegador usado para abrir o e-mail tem outra sessão.

## 1. Instalar as consultas no Supabase

Abra **SQL Editor → New query**, cole todo o arquivo `supabase-schema-estado-senha.sql` do ZIP e clique em **Run**. Faça isso antes de publicar os arquivos novos do site. O SQL cria duas funções de leitura: uma informa se a própria conta já tem senha, e outra permite ao administrador ver esse estado na lista. Nenhuma delas devolve senhas ou hashes, nem altera contas ou papéis.

O cadastro sem senha continua aparecendo na plataforma, mas com o estado correto. A tela de autenticação consulta a existência real da senha no banco; se ela estiver ausente, exige sua criação mesmo sem os parâmetros do link ou o marcador de primeiro acesso.

## 2. Atualizar o GitHub

Extraia `imperium-correcao-email-celular.zip` e substitua, na pasta realmente publicada pelo GitHub Pages, estes seis arquivos:

- `index.html`
- `js/auth.js`
- `js/perfil.js`
- `js/modules/usuarios.js`
- `css/auth.css`
- `sw.js`

Mantenha os caminhos: não crie uma pasta adicional no site. Aguarde a publicação do GitHub Pages terminar. Depois, feche completamente o aplicativo, abra o site conectado à internet e reabra o aplicativo. A nova versão é `js/auth.js?v=12`, `js/perfil.js?v=4`, `js/modules/usuarios.js?v=7`, `css/auth.css?v=6`, com cache `imperium-v40`.

## 3. Conferir o endereço no Supabase

No mesmo projeto utilizado pela plataforma, vá a **Authentication → URL Configuration**. Defina **Site URL** como:

`https://horizes.github.io/gerador/`

Inclua esse mesmo endereço na lista de Redirect URLs se ainda não estiver. O Site URL deve incluir `/gerador/`, a barra final e não deve conter uma rota como `#/usuarios`.

## 4. Atualizar dois modelos de e-mail

Em **Authentication → Email → Templates** (ou **Email Templates**):

| Modelo | Assunto | Arquivo para colar inteiro no conteúdo HTML |
| --- | --- | --- |
| Invite user | Confirme seu acesso — Imperium | `supabase/templates/convite-email.html` |
| Reset password | Escolha sua senha — Imperium | `supabase/templates/redefinir-senha.html` |

Os arquivos estão dentro do ZIP. Preserve as variáveis `{{ .SiteURL }}`, `{{ .TokenHash }}` e `{{ .Token }}`. Elas são preenchidas pelo Supabase. Os novos botões usam `?token_hash=...&type=invite` ou `type=recovery`, em vez do redirecionamento de `{{ .ConfirmationURL }}`. **Publique os seis arquivos do site antes de salvar os novos modelos**, para que os links novos encontrem a tela atualizada.

O envio continua pelo SMTP já configurado. A Edge Function `completar-convite` e as tabelas permanecem as mesmas; esta atualização usa somente as duas consultas do SQL instalado no passo 1 e não precisa de um novo deploy da Edge Function.

## 5. Testar o primeiro acesso

1. Gere um convite na plataforma para uma conta nova sob seu controle.
2. Informe o e-mail. Abra a mensagem no celular.
3. Toque no botão do e-mail, depois em **Confirmar e criar senha**. Deve aparecer **Crie sua senha**. Na lista de usuários, ao atualizar, essa conta deve estar com **Senha pendente** até salvar a senha.
4. Para testar diretamente no aplicativo, use outro convite/e-mail: no aplicativo, escolha **Usar código do e-mail**, digite o e-mail e os 6 números recebidos. Também deve aparecer **Crie sua senha**.
5. O mesmo link/código não deve funcionar novamente depois de usado. Use convites separados para testar cada caminho.

O navegador e o aplicativo podem ter sessões separadas, especialmente no iPhone. Depois de criar a senha no navegador, você pode entrar normalmente no aplicativo com e-mail e senha. Para criar a senha dentro do aplicativo, digite nele o código recebido.

## Quem já ficou parado na tela de login

Após atualizar o site e os dois modelos, escolha **Usar código do e-mail**, informe seu e-mail e toque em **Receber novo código**. Digite os números do último e-mail recebido e defina a senha. Essa opção usa a recuperação nativa do Supabase para uma conta existente; não cria outro usuário nem altera papéis/cargos.

Se uma mensagem antiga não tiver código, use **Receber novo código**. Se receber limite de tentativas, aguarde antes de pedir novamente. Links antigos continuam aceitos pelo fluxo anterior enquanto forem válidos, mas a robustez nova exige o modelo novo.

## Validação e limites

Os testes locais simulam links sem sessão anterior, código digitado em outra sessão, token vencido, conta antiga já conectada, validação da confirmação no servidor, ausência real de senha, criação de senha e os estados da lista de usuários. As consultas SQL foram revisadas, mas não executadas no projeto de produção. A autenticação real em Android/iPhone depende de publicar a atualização e testar com uma mensagem nova. Nenhum e-mail real ou senha de produção foi alterado durante a preparação.

Referências: [Modelos de e-mail do Supabase](https://supabase.com/docs/guides/auth/auth-email-templates), [Verificação de código ou token](https://supabase.com/docs/reference/javascript/auth-verifyotp), [Retorno de sessão por fragmento](https://supabase.com/docs/guides/auth/sessions/implicit-flow).
