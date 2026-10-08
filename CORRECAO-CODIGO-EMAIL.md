# Correção do cadastro por código — Imperium

> O pacote atual é `imperium-plataforma-categorias.zip`. Ao publicar o HTML deste pacote, publique também os arquivos de categorias e módulos listados em `PAGINAS-POR-CATEGORIAS.md`.

Versão de 7 de outubro de 2026. Este é o guia atual desta entrega; os outros documentos de autenticação descrevem versões anteriores.

## O que mudou

O cadastro segue três etapas: informar o e-mail → confirmar o código → criar a senha. Depois, a pessoa recebe a tela para instalar o aplicativo ou continuar no navegador. Veja também `INSTALACAO-APOS-CADASTRO.md`.

- A primeira confirmação usa explicitamente `type: "invite"`, correspondente ao envio da função `completar-convite`. O reenvio e a recuperação usam `type: "recovery"`. O tipo é mantido ao recarregar a página. Para códigos digitados em outro navegador, mantém-se a compatibilidade nativa com `type: "email"`.
- O campo aceita o código completo, com 6 a 10 números. A versão anterior limitava o campo a 6 e cortava códigos maiores. Espaços e hífens ao colar são removidos, sem perder zeros iniciais.
- Depois do envio, o endereço fica preenchido e protegido contra mudanças acidentais. O usuário não precisa digitá-lo novamente. A aba guarda o endereço e a etapa por até 24 horas; isso não aumenta a validade do código no Supabase.
- A confirmação bem-sucedida registra imediatamente a etapa da senha. Se a conexão falhar na consulta seguinte, o usuário pode tentar salvar a senha novamente, sem reutilizar um código já consumido.
- O reenvio tem espera de 60 segundos e bloqueia pedidos duplicados. Um reenvio bem-sucedido passa a validar o código de recuperação, sem cadastrar a mesma conta outra vez.
- O botão **Já recebi um código** permite continuar pelo link inicial quando o e-mail chegou, mas a resposta do envio se perdeu.
- Os modelos de e-mail mostram o endereço da conta e orientam a copiar o código inteiro. O cache do aplicativo foi atualizado.

Estas são correções no código fornecido. Sem acesso administrativo ao projeto e sem um e-mail real de teste, não foi possível identificar qual delas corresponde exatamente ao erro observado na publicação atual, nem verificar os modelos e a validade configurados no painel.

## Aplicar na plataforma publicada

1. Faça uma cópia da versão publicada e extraia o ZIP. Na pasta que sua hospedagem publica, substitua os arquivos abaixo, preservando os caminhos. Não coloque uma pasta `imperium-plataforma` extra dentro da pasta publicada.

   - `index.html`
   - `js/auth.js`
   - `js/pwa.js`
   - `css/auth.css`
   - `sw.js`

2. No Supabase, abra **Edge Functions → completar-convite** e publique o conteúdo atualizado de `supabase/functions/completar-convite/index.ts`. Mantenha **Verify JWT** desativado para esta função: ela valida o convite no servidor. A mudança informa o tipo de verificação ao site. O novo site também aceita a resposta da função anterior, que já enviava convites.

   Alternativa pelo CLI, dentro da pasta do projeto:

   ```powershell
   npx supabase login
   npx supabase link --project-ref abweepruixcyetrzefhk
   npx supabase functions deploy completar-convite --no-verify-jwt
   ```

3. Em **Authentication → Email Templates**, atualize os dois modelos com os arquivos deste pacote:

   | Modelo | Arquivo | Assunto sugerido |
   | --- | --- | --- |
   | Invite user | `supabase/templates/convite-email.html` | Seu código de confirmação — Imperium |
   | Reset password | `supabase/templates/redefinir-senha.html` | Seu código para escolher a senha — Imperium |

   Preserve `{{ .Token }}` e `{{ .Email }}`. O Supabase preenche essas variáveis. Não acrescente links nativos de confirmação a esses modelos: abrir tais links pode consumir o mesmo código antes de digitá-lo.

4. Mantenha a confirmação de e-mail habilitada. Confira a configuração **Email OTP expiration** do provedor de e-mail. O código precisa ser usado dentro da validade configurada; solicitar outro não recupera um código expirado. Não é necessário desativar a confirmação nem confirmar contas manualmente para esta correção.

5. Se sua instalação já faz login normal e consulta o estado da senha, nenhum SQL novo é necessário. Se aparecer um erro sobre a etapa da senha, instale apenas o arquivo existente `supabase-schema-estado-senha.sql` no SQL Editor. Ele cria consultas de leitura, sem alterar contas ou papéis. Se o cadastro acusa falta de `reservar_convite`, siga `supabase-schema-correcao-convites.sql`, observando os pré-requisitos que o próprio script verifica. Não reaplique todos os scripts do pacote numa instalação que já funciona.

6. Aguarde a publicação. Feche o aplicativo instalado, abra o site com internet e reabra o aplicativo. As versões novas são `auth.js?v=15`, `pwa.js?v=2`, `auth.css?v=8` e cache `imperium-v44`.

O ZIP contém toda a plataforma. Os arquivos SQL, `supabase`, `tests` e documentos servem à administração; não precisam ser publicados na hospedagem estática.

## Conferir com um e-mail real

1. Gere um convite para um endereço de teste sob seu controle e que ainda não tenha conta.
2. Abra o link em uma janela privada. Informe o endereço e toque em **Receber código**.
3. Digite o código completo da primeira mensagem, sem pedir outro antes desse teste. A próxima tela deve ser **Crie sua senha**.
4. Salve a senha. Confira a tela de instalação e escolha instalar ou continuar no navegador. Confirme que o usuário entra com o cargo e papel escolhidos no convite.
5. Confira também o reenvio, após a espera, e **Esqueci minha senha**. Após pedir um novo código, use a mensagem nova.

Para uma conta criada anteriormente e que ficou pendente, use **Usar código do e-mail** no login. Informe o e-mail e solicite um novo código, se o antigo já expirou. Isso permite concluir a senha sem gerar outra conta. O convite inicial consumido continua consumido; não é reaberto.

Se o primeiro código ainda falhar após a atualização, confira se o site e o Supabase usam o mesmo projeto, se o modelo mostra `{{ .Token }}` completo e se nenhum link da mesma mensagem foi aberto. A validade e a entrega reais precisam ser verificadas no Supabase.

## Validação desta entrega

Os testes automatizados executam o `js/auth.js` real com DOM e respostas simuladas do Supabase. Execute `node --test tests/auth-flow.test.cjs` com Node.js instalado. Cobrem primeiro acesso, códigos completos, reenvio, retomada, conexão, senha, recuperação e bloqueio de acesso antes da conclusão.

Também foi conferido no Chrome o formulário real em tamanhos de celular e computador, incluindo código de 8 dígitos colado, código incorreto e nova tentativa, recarregamento e criação de senha. As respostas do Supabase foram simuladas; não foram enviados e-mails, criadas contas ou aplicadas alterações no projeto real.

Referências oficiais: [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp), [modelos de e-mail](https://supabase.com/docs/guides/auth/auth-email-templates), [configuração de OTP](https://supabase.com/docs/guides/local-development/cli/config#auth.email.otp_length).
