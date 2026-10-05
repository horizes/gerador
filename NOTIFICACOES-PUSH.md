# Avisos com a plataforma fechada

O envio usa Web Push (VAPID), independente do Resend. Ele precisa de configuração no Supabase e autorização de cada aparelho. A atualização dos arquivos do site sozinha não ativa o envio.

## O que gera aviso

- Uniforme/EPI: novo pedido para a gestão; pedido reaberto ou cancelado; retirada liberada, entrega parcial ou recusa para o solicitante; recebimento confirmado para a gestão. Quem acaba de executar uma ação não recebe o aviso de gestão correspondente.

Os avisos são exclusivos de uniformes/EPI. Nenhum aviso é enviado por ponto, financeiro, simples abertura de tela, cadastro de cliente, clique em WhatsApp ou exportação de PDF. Não existe central nova de notificações dentro do site.

## Configurar uma vez

1. Na pasta do projeto descompactado, execute:

```powershell
node scripts/configurar-push.cjs
```

O gerador cria `push.env` e `push-agendamento.sql` em `%LOCALAPPDATA%\Imperium\configuracao-push` no Windows, fora da pasta do site. Não publique, anexe ou compartilhe esses arquivos: contêm chaves privadas. Se já existem, reutilize-os; gerar outras chaves exige reativar os aparelhos.

2. No **SQL Editor do Supabase**, execute `supabase-schema-push.sql`. Requer os scripts de permissões, cargos unificados e uniformes já instalados. É repetível e não apaga dados de negócio.

3. Execute os comandos que o gerador mostrou: login no Supabase, cadastro dos quatro segredos a partir de `push.env` e publicação da função `push-notificacoes`. Exemplo de publicação:

```powershell
npx supabase functions deploy push-notificacoes --project-ref abweepruixcyetrzefhk
```

Use o `supabase/config.toml` deste pacote: a função valida a sessão do usuário por conta própria e o worker exige um segredo exclusivo. Não exige configurar Firebase nem autenticar a caixa de e-mail.

4. Abra a cópia **gerada** de `push-agendamento.sql` na pasta acima e execute seu conteúdo no SQL Editor. Ela guarda o segredo do cron no Vault e cria um único agendamento `imperium-push`, a cada minuto. Reexecutar atualiza o mesmo agendamento. O arquivo `supabase-push-agendamento.sql` do pacote é apenas um modelo e recusa execução sem preencher o segredo.

5. Publique o site atualizado. Os arquivos desta alteração são `index.html`, `sw.js`, `js/push.js`, `css/push.css`, `js/platform.js`, `js/auth.js`, `js/modules/clientes-relatorios.js` e `css/clientes-relatorios.css`.

## Ativar no aparelho

Entre na plataforma e abra **Notificações** no menu lateral. Toque em **Ativar notificações** e autorize. O botão **Testar notificação** envia um teste para esse aparelho. O site não pede permissão automaticamente ao abrir.

No iPhone/iPad, use iOS/iPadOS 16.4 ou posterior. No Safari, escolha **Compartilhar → Adicionar à Tela de Início**, abra pelo ícone instalado, entre e ative as notificações. Uma aba comum no iPhone não recebe esse tipo de aviso. [Orientação do WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

No Android, utilize um navegador com suporte a Push API e autorize as notificações. A plataforma precisa estar publicada em HTTPS. As configurações do sistema, modo Foco, economia de bateria e conexão podem afetar a entrega.

**Desativar neste aparelho** cancela a inscrição. **Sair** também cancela as notificações deste aparelho antes de encerrar a sessão. Cada aparelho é ativado separadamente. Inscrições expiradas são removidas quando o serviço responde 404/410; mudanças de VAPID são detectadas na próxima abertura, exigindo nova ativação.

## Conferir o envio

1. Ative um aparelho de colaborador e outro de gestor, com permissões corretas.
2. Faça uma solicitação de uniforme. O gestor deve receber o aviso, mesmo com o site fechado. Marque o pedido como pronto e confira o aviso do colaborador.
3. Confirme o recebimento e confira o aviso da gestão.
4. Consulte **Integrations → Cron → imperium-push** e os logs da função `push-notificacoes`. O aviso costuma começar a ser enviado na próxima execução do cron; a entrega ao aparelho depende do serviço de push.
5. A tabela privada `push_fila` mostra `enviado`, `ignorado`, `pendente` ou `falhou`. `enviado` significa aceito pelo serviço de push, não que o usuário leu a notificação.

Sem a instalação completa, o menu informa que o push ainda não foi configurado; as demais funções da plataforma seguem funcionando.

## Funcionamento e acesso

Eventos são registrados no servidor, mesmo sem usuários conectados ao site. A fila é por aparelho, com reserva atômica, até cinco tentativas, expiração de um dia e limpeza após 30 dias. Envio bem-sucedido não é repetido ao tentar outro aparelho; interrupção entre envio e confirmação pode gerar repetição, agrupada pela mesma identificação no aparelho.

O destinatário precisa estar ativo e ter acesso ao módulo tanto na criação do evento quanto no despacho. A troca de usuário do aparelho não transfere eventos da conta anterior. Tabelas e RPCs do worker são privadas; usuários comuns não escolhem destinatários ou mensagens. Endpoints de push aceitos ficam restritos aos serviços de Apple, Google, Mozilla e Microsoft.

Os avisos não incluem fotos, CPF ou outras informações pessoais. O toque abre a ferramenta de uniformes e a plataforma continua exigindo login e permissões.

Referências técnicas: [Web Push](https://github.com/web-push-libs/web-push), [Supabase Cron e Vault](https://supabase.com/docs/guides/functions/schedule-functions).
