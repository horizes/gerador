# Agenda Imperium

A agenda usa o funcionamento do modelo enviado, com as cores, tipografia, categorias, permissões e Supabase da Imperium. O restante da plataforma foi preservado. Os e-mails usam prioritariamente o Resend e o remetente já configurados nas notificações do sistema, com o padrão visual das confirmações atuais. Instalações que usam somente SMTP continuam compatíveis.

## O que está incluído

- Painel em **Administração → Agenda**, com as categorias **Calendário**, **Disponibilidade** e **Configurações**.
- Agenda por perfil: horários, link público, reuniões e conexão Google independentes. Administradores podem selecionar e gerenciar as agendas dos outros perfis.
- Rotina semanal permanente, até quatro faixas por dia, intervalo entre reuniões, formatos online e presencial, horários extras, reservas internas e fechamento de um dia inteiro.
- Link público `agenda.html`, formulário no computador/celular, protocolo, confirmação por e-mail, recuperação da mesma tentativa quando a conexão falha e prevenção de duas reservas no mesmo horário.
- Google Agenda e uma sala Meet exclusiva por reserva online quando a integração estiver conectada e o Meet automático estiver ativado.
- Nome do participante e empresa/condomínio no título e nos detalhes do evento Google.
- Página pública com logo Imperium em PNG transparente, centralizada no topo, sem moldura e sem textos ao lado.
- Botão **Adicionar ao Google Agenda** para o participante, além do arquivo `.ics` no site e no e-mail.
- Cancelamento com histórico e remoção do evento criado pela agenda no Google. Uma reunião concluída permanece no histórico.

Os horários são de Brasília. O painel permite organizar até um ano adiante; a página pública oferece os próximos 90 dias. Reservas antigas preservam duração, atendente e local mesmo depois de alterar as configurações.

## 1. Instalar o banco

Use o mesmo projeto Supabase da plataforma. Esta atualização pressupõe que os scripts de usuários, perfis e cargos unificados da versão atual já foram aplicados.

No **SQL Editor**, execute `supabase-schema-agenda.sql` e, em seguida, `supabase-schema-agenda-perfis.sql`. Em uma instalação nova, as agendas começam pausadas e sem rotina publicada. As tabelas da agenda são privadas: visitantes consultam somente os horários disponíveis por meio da função; os contatos e a autorização Google ficam protegidos no servidor.

### Atualização de uma agenda já instalada

1. Execute **somente `supabase-schema-agenda-perfis.sql`** no SQL Editor do mesmo projeto. O script preserva os agendamentos e pode ser reaplicado.
2. Na pasta atualizada `imperium-plataforma`, publique a função:

```powershell
npx.cmd supabase functions deploy agenda --project-ref abweepruixcyetrzefhk
```

3. Publique os arquivos do site. Se a alteração já foi publicada no GitHub, recarregue a plataforma após atualizar o Supabase.

Mantenha os segredos atuais. Não gere outra chave `AGENDA_DATA_KEY`, não reconfigure o SMTP e não recrie o processamento da fila para esta atualização. Se o comando pedir autenticação, execute `npx.cmd supabase login` antes de publicar a função.

A agenda anterior é atribuída ao perfil que conectou a conta Google; se não houver um responsável elegível, usa o primeiro administrador ativo, depois um perfil com permissão de Agenda. Sem perfis elegíveis, o histórico é preservado e o link fica pausado. O link antigo `agenda.html` continua apontando para essa agenda. As novas agendas começam pausadas, e a migração não duplica reservas nem eventos. Confira o perfil responsável no seletor após instalar.

O código do site, sozinho, não altera o banco nem publica a Edge Function. A agenda por perfil e os novos detalhes dos eventos dependem dos passos 1 e 2 no Supabase. Durante a atualização, o site mantém compatibilidade com a função anterior e continua mostrando a agenda única até a função nova estar disponível.

Não execute novamente os scripts de outros módulos para instalar esta atualização.

## 2. Configurar a função e o serviço de e-mail atual

Se o projeto já tem `RESEND_API_KEY` e `RESEND_FROM_EMAIL`, a agenda passa a usá-los automaticamente. Preserve esses segredos: não é necessário revelar a chave, copiá-la para o site, contratar outro serviço ou preencher SMTP. A correção precisa da versão atual dos arquivos `index.ts`, `mail.ts` e `service.ts` da função `agenda`.

As instruções de SMTP abaixo são uma alternativa para instalações que não usam Resend. Em um projeto existente, mantenha as chaves de criptografia e a configuração da fila; não execute o gerador novamente apenas para atualizar a agenda.

Instale Node.js caso ainda não esteja disponível. Na pasta `imperium-plataforma`, execute, substituindo o domínio pelo endereço real da pasta que contém o `index.html`:

```powershell
node scripts/configurar-agenda.cjs https://seu-dominio.com/
```

Se o site estiver em uma subpasta, informe-a, por exemplo `https://seu-dominio.com/plataforma/`. O endereço deve usar HTTPS.

O script cria `agenda.env` e `agenda-agendamento.sql` na pasta privada `%LOCALAPPDATA%\Imperium\configuracao-agenda`. Abra **agenda.env** e preencha:

| Campo | Valor |
|---|---|
| `SMTP_HOST` | Mesmo servidor SMTP usado pelo sistema |
| `SMTP_PORT` | Porta TLS 465 do mesmo servidor |
| `SMTP_USER` | Mesmo usuário SMTP |
| `SMTP_PASS` | Mesma senha SMTP |
| `SMTP_FROM` | Mesmo e-mail remetente autorizado |

As configurações SMTP do Supabase Auth não são expostas automaticamente à Edge Function. É preciso informar os mesmos dados nesses segredos. Os convites, códigos de acesso e recuperação de senha existentes continuam com as configurações atuais; seus templates não foram alterados. Não é necessário contratar outro serviço de e-mail.

As Edge Functions bloqueiam as portas SMTP 25 e 587. Use a porta TLS 465 do provedor atual. Se esse provedor não oferecer uma porta permitida, será necessário ajustar o transporte da agenda antes de ativar seus e-mails. Consulte a [documentação de limites do Supabase](https://supabase.com/docs/guides/functions/limits) e a [configuração SMTP do Auth](https://supabase.com/docs/guides/auth/auth-smtp).

Depois de preencher os dados, execute:

```powershell
npx.cmd supabase login
npx.cmd supabase secrets set --env-file "$env:LOCALAPPDATA\Imperium\configuracao-agenda\agenda.env" --project-ref abweepruixcyetrzefhk
npx.cmd supabase functions deploy agenda --project-ref abweepruixcyetrzefhk
```

Os comandos correspondem ao projeto já presente em `js/supabase.js`. Se essa configuração mudar, use o identificador do novo projeto. O arquivo `supabase/config.toml` já inclui `functions.agenda` com `verify_jwt = false`: as ações públicas são abertas e as ações de gestão validam a sessão e a permissão no servidor.

Guarde os arquivos privados. **Não publique `agenda.env`, o SQL preenchido, a chave de serviço nem credenciais Google na hospedagem. Não gere outra `AGENDA_DATA_KEY` ao atualizar:** essa chave é necessária para ler os contatos e tokens já salvos. O gerador recusa sobrescrever arquivos existentes.

## 3. Ativar o processamento automático

Execute no SQL Editor o conteúdo de **agenda-agendamento.sql da pasta privada**, gerado no passo anterior. Ele cadastra a URL e o segredo no Vault e agenda a fila a cada minuto. Reaplicar essa mesma cópia atualiza o agendamento sem duplicá-lo.

Essa fila processa o Google e os e-mails mesmo quando ninguém estiver com a plataforma aberta. O modelo público `supabase-agenda-agendamento.sql` contém marcadores e não deve ser executado sem preenchê-los. A implementação segue o [agendamento de Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) com [Supabase Vault](https://supabase.com/docs/guides/database/vault).

## 4. Publicar os arquivos da agenda

O ZIP completo contém a plataforma atualizada. Para aplicar somente esta atualização sobre a versão que já estava nesta conversa, também há um ZIP apenas da agenda, com:

- `agenda.html`, `agenda-google-callback.html`, `css/agenda.css`, `css/agenda-publica.css` e `assets/logo-agenda-imperium.png`.
- `js/agenda-api.js`, `js/agenda-publica.js`, `js/agenda-google-callback.js`, `js/agenda-weekly.js` e `js/modules/agenda.js`.
- `index.html`, `js/platform.js` e `sw.js`, alterados somente para registrar, carregar e atualizar o cache da agenda.
- `supabase/config.toml`, a função `supabase/functions/agenda/`, os SQLs da agenda, o gerador e este guia.

Publique os arquivos HTML, CSS, JavaScript e o service worker na mesma pasta do site. Os arquivos `supabase/`, SQL, testes e `scripts/` servem à instalação e não precisam ir para a hospedagem pública. Não misture os arquivos de integração com uma versão antiga da plataforma.

## 5. Conectar o Google Agenda

Entre como administrador e abra **Agenda → Configurações → Configurações → Configurar conexão com o Google**.

1. No projeto Google Cloud da empresa, ative a **Google Calendar API** e configure a tela de consentimento OAuth.
2. Crie um cliente OAuth do tipo **Aplicativo da Web**. Cadastre exatamente a URL de retorno mostrada no painel: `https://seu-dominio.com/agenda-google-callback.html`, incluindo a subpasta se houver.
3. Baixe o JSON desse cliente e importe-o pelo painel. Não copie o JSON para os arquivos públicos do site.
4. Selecione sua própria agenda e clique em **Conectar minha conta Google**. Cada perfil conecta sua conta separadamente, usando o mesmo cliente OAuth configurado pelo administrador. Se o Google estiver em modo de teste, inclua essas contas entre os usuários de teste. Para uso permanente, conclua a configuração/publicação exigida pelo Google; autorizações de teste podem expirar.
5. Confira **Conectado: e-mail da conta**. A conexão ativa a opção de criar Meet automaticamente.

A integração usa o calendário principal da conta conectada. A conta precisa poder criar reuniões Meet. A agenda manipula somente os eventos que ela própria criou; os demais compromissos do Google não são importados para bloquear horários no site. Para bloquear um compromisso externo, reserve o intervalo no painel.

Se o link Meet demorar, o horário continua confirmado. Quando o link ficar pronto, ele aparece na confirmação. Se o primeiro e-mail já tiver sido enviado sem o link, a agenda envia um segundo e-mail com o acesso. Se a autorização expirar, reconecte a conta e use **Verificar Google Meet** na reunião afetada. Os eventos antigos estão vinculados à conta usada na criação; mantenha essa conta disponível para cancelar eventos pendentes.

Referências: [OAuth para aplicações Web](https://developers.google.com/identity/protocols/oauth2/web-server), [criação de eventos e conferências](https://developers.google.com/workspace/calendar/api/guides/create-events).

## 6. Publicar os horários e definir os acessos

Em **Disponibilidade**, configure os dias, faixas, formatos e intervalo e salve a rotina. Em **Configurações**, ajuste quem atende, duração, antecedência e local. Ative **Receber novos agendamentos**. Use **Copiar link público** para compartilhar a agenda.

Administradores têm um seletor **Agenda do perfil** e podem consultar e gerenciar as agendas de todos os perfis com acesso ao módulo, incluindo os contatos das reuniões. Para outras pessoas, marque **Agenda** nas permissões do cargo ou do usuário, usando a tela de usuários existente: essa permissão dá acesso somente à própria agenda. Quem não recebe a permissão não vê nem consegue abrir o painel.

Somente o dono de cada perfil conecta ou desconecta sua conta Google, inclusive quando outro administrador está consultando a agenda. A importação da credencial OAuth da aplicação permanece exclusiva dos administradores e vale para todos os perfis. O participante abre o link `agenda.html?agenda=ID` e reserva sem criar conta; use **Copiar link público** na agenda selecionada. Desativar um perfil fecha suas novas reservas, preservando o histórico e os protocolos.

## Conferência após instalar

Faça uma reserva de teste pelo link público de cada perfil, confira o protocolo, o e-mail e o evento/Meet na conta conectada. O título identifica participante e empresa. Tente reservar o mesmo horário no mesmo perfil em outra janela e confirme que ele ficou indisponível; o mesmo horário em outro perfil continua livre. Depois cancele pelo painel e confira a remoção do evento. Verifique também a permissão de um usuário comum e a consulta entre administradores. Os novos eventos já recebem os detalhes completos; para atualizar um evento anterior, use **Atualizar no Google Agenda** no agendamento. O evento e o link Meet são preservados.

O painel mostra o resultado do envio de e-mail e permite reenviar uma confirmação. “Envio aceito pelo servidor” significa que o SMTP aceitou a mensagem, não que ela chegou à caixa de entrada. Se a conexão SMTP cair depois do envio e o resultado ficar incerto, a agenda pede conferência antes de reenviar, para reduzir mensagens duplicadas.

Foram validados o banco e as reservas concorrentes, recuperação de tentativa, permissões, integração e fila com Google/SMTP simulados e a interface no Chrome em computador e celular. Nenhuma conta Google real foi conectada, nenhum e-mail real foi enviado e nenhuma alteração foi publicada no Supabase durante essa validação local.
