# Atualização da Plataforma Imperium

## WhatsApp dos responsáveis e avisos no aparelho

Clientes e postos ganhou “Chamar no WhatsApp” no contato do responsável/síndico. Use telefone com DDD; números brasileiros recebem o prefixo 55 automaticamente. Para números internacionais, informe `+` e código do país. O atalho abre a conversa, sem enviar mensagens automaticamente.

O menu “Notificações” permite ativar exclusivamente avisos de uniforme/EPI no aparelho, mesmo com o site fechado. Requer configuração do servidor e autorização de cada aparelho. Siga `NOTIFICACOES-PUSH.md`; no iPhone, primeiro instale a plataforma na Tela de Início.

## Endereço dos postos no mapa

Em Clientes e postos, cada endereço preenchido agora tem o botão “Abrir no mapa”, com área de toque de pelo menos 44px. Ele usa Mapas da Apple no iPhone/iPad e Google Maps nos demais dispositivos; o navegador pode abrir a versão web conforme os aplicativos instalados e suas configurações. Preencha rua, número, cidade e estado para facilitar a localização.

Para aplicar esta mudança, publique `index.html`, `js/modules/clientes-relatorios.js`, `css/clientes-relatorios.css` e `sw.js`. Não exige SQL, chave de mapa ou configuração no Supabase.

## Tela inicial repaginada

Esta versão inclui uma nova home com saudação e data, atalhos conforme as permissões, cartões de ferramentas, avisos reais de pedidos de uniformes/EPI e visão financeira para quem tem acesso. O restante das ferramentas foi preservado.

O bloco “Precisa da sua atenção” aparece apenas quando existe pelo menos uma pendência. Sem pendências, o bloco inteiro fica oculto, sem mensagem vazia ou espaço reservado; ele reaparece quando uma nova pendência é identificada.

Se as correções anteriores já foram publicadas, esta repaginação exige apenas substituir `index.html`, `js/platform.js`, `js/dashboard.js`, `sw.js` e adicionar `css/home.css` na hospedagem. Não há nova alteração de banco para a home. Se ainda não publicou as correções anteriores, siga as etapas abaixo.

A home foi conferida no navegador com dados simulados: computador (1440px), tablet (768px), celulares (390px e 320px), permissões de administrador/colaborador, pendências e usuário sem ferramentas. Não foram identificados erros JavaScript ou rolagem horizontal nesses cenários.

As sete correções estão nos arquivos deste pacote. A proposta continua apenas na memória da aba; foi alterada somente sua data inicial para usar o dia local.

## Aplicar no ambiente da empresa

1. Exporte uma cópia do banco e preserve os arquivos atuais da hospedagem. Faça a atualização em uma janela sem uso da plataforma, pois o código antigo abre anexos públicos e cancela pedidos diretamente.
2. No SQL Editor do mesmo projeto Supabase, rode **supabase-schema-melhorias.sql** por último. Ele requer os scripts anteriores de permissões, usuários, convites, uniformes, cargos unificados e Open Finance. A execução é transacional e pode ser repetida. Não basta atualizar somente o site.
3. Na pasta deste pacote, com o Supabase CLI autenticado, publique as duas funções atualizadas:

```powershell
npx supabase link --project-ref abweepruixcyetrzefhk
npx supabase functions deploy completar-convite
npx supabase functions deploy open-finance
```

O arquivo `supabase/config.toml` configura a autorização para essas funções. `completar-convite` aceita pessoas sem sessão e valida o convite; `open-finance` valida o token do usuário e a permissão financeira dentro da própria função. Essa configuração segue a [documentação oficial do Supabase](https://supabase.com/docs/guides/functions/function-configuration).

4. Substitua na hospedagem `index.html`, a pasta `js`, `sw.js` e os demais arquivos públicos do site conforme necessário. **Não envie a pasta supabase, arquivos SQL, README ou este guia para a pasta pública da hospedagem.** Os arquivos CSS e assets existentes foram preservados.
5. Reabra a plataforma e confira: acesso a um anexo com login autorizado, bloqueio do antigo link público sem login, cadastro por convite, cancelamento de pedido próprio e uma sincronização bancária. Gere um backup e restaure-o em um ambiente de teste, pois a importação adiciona lançamentos.

## O que mudou

- Anexos financeiros: bucket privado, miniaturas com links temporários e novo link de cinco minutos a cada abertura.
- Open Finance: o registro de deduplicação e o lançamento são gravados na mesma transação. Se uma gravação falhar, nenhuma marca daquela transação fica registrada. A data de sincronização não avança em caso de erro.
- Convites: consumo atômico antes da criação da conta; verificação da gravação do perfil e tentativa de remoção de uma conta incompleta. Uma falha de cadastro consome o convite: o administrador deve emitir outro. Não há liberação automática do token após falhas ou interrupções, evitando reaproveitamento concorrente.
- Leitura financeira: paginação completa com ordenação determinística, sem assumir que o servidor devolverá 1.000 registros. Erros de página não são apresentados como lista vazia ou dados completos.
- Totais: o painel recebe valores agregados pelo banco; o fluxo valida seu resumo pelo banco após salvar e mudar filtros. Durante a edição, o resumo imediato usa os dados completos carregados.
- Backup JSON versão 2: inclui o conteúdo de cada foto/PDF, sem depender de links do bucket original. A restauração verifica gravações e informa a quantidade confirmada em caso de interrupção. Backups antigos com apenas caminhos só podem recuperar documentos ainda existentes no bucket de origem.
- Pedidos: cancelamento por função que altera apenas o status do pedido próprio pendente. A policy que permitia alterações arbitrárias junto ao cancelamento foi removida.
- Datas: o dia inicial usa o fuso local do aparelho, em vez de UTC. O comportamento de salvamento das propostas foi preservado.

## Validação realizada

Passaram 14 verificações locais de sintaxe e comportamento, incluindo 1.503 registros com limite simulado de 55 registros por resposta, data às 21h30 de Brasília, backup/restauração de PDF, falha parcial de importação, concorrência de cadastro com banco simulado e falha de importação bancária sem avanço da sincronização.

Não houve acesso ao Supabase ou à hospedagem da empresa. As funções SQL, as regras RLS e a concorrência real do PostgreSQL precisam ser homologadas no projeto antes de colocar esta versão em produção.

A atualização previne novas falhas de importação. Ela não recria automaticamente movimentações antigas já marcadas sem lançamento, pois não é possível distinguir essas falhas de exclusões intencionais sem conferir o histórico.

Se os scripts antigos forem reaplicados, rode `supabase-schema-melhorias.sql` novamente por último para restabelecer as correções.


## Módulo de ponto em homologação

Esta versão inclui Meu ponto e Gestão de ponto. Instalação e limites em `PONTO-INSTALACAO.md`. Execute a nova migração apenas em ambiente de testes: não substitui o ponto oficial. Permissões são configuradas em Usuários.


## Clientes e relatórios mensais

Consulte `CLIENTES-RELATORIOS-INSTALACAO.md`. A nova migração exige alocação do colaborador no posto antes de confirmar novos recebimentos de uniformes/EPI. Cadastre clientes, postos e alocações antes de liberar o uso.

## Correção de convites

Para falhas ao completar cadastro por link, consulte `CONVITES-CORRECAO.md`. Execute `supabase-schema-correcao-convites.sql`, publique a função `completar-convite` e atualize os arquivos públicos do site. A correção diferencia erros técnicos de convite indisponível e encaminha à tela de login quando a conta foi criada, mas o login automático falhou.
