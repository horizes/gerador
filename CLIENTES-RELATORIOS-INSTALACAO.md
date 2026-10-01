# Clientes, postos e resumo mensal de uniforme/EPI

## Instalação

1. Faça backup e teste em um projeto Supabase separado.
2. Execute UMA VEZ `supabase-schema-clientes-relatorios.sql`, após os scripts de uniformes, permissões e cargos unificados. Não é necessário instalar ponto nem o script de visitas, que permanece incompleto.
3. Publique os arquivos do site, incluindo `js/vendor/pdf-lib.min.js`, `js/modules/clientes-relatorios.js` e `css/clientes-relatorios.css`. Não publique SQL e documentos internos.
4. Em Usuários, libere **Clientes e postos** a quem administra os cadastros e **Resumo mensal** a quem faz o fechamento. Administradores acessam ambos automaticamente. Acesso não é concedido automaticamente aos cargos.
5. Cadastre clientes (condomínios/empresas), postos e alocações dos colaboradores ANTES de voltar a confirmar novos recebimentos. A migração exige uma alocação vigente para cada confirmação nova. Escolha a data correta de início da alocação.

## Uso

- Cadastros permitem edição e inativação, preservando os históricos. Para trocar o cliente de um posto, crie outro posto em vez de alterar o vínculo.
- Transferências de colaboradores começam em uma data e encerram a alocação anterior no dia anterior. Esta versão admite um posto por colaborador por dia; múltiplos postos simultâneos precisam de outra regra de identificação do recebimento.
- O cliente e o posto são copiados no recebimento. Uma transferência posterior não move documentos antigos.
- Registros anteriores à instalação ficam SEM POSTO. Na tela Resumo mensal, selecione o posto da época e justifique a associação. Não foi feito preenchimento automático retroativo. A associação histórica é registrada em auditoria.
- Consulte a competência desejada. O período usa a hora do SERVIDOR em Brasília: de 00:00 do primeiro dia até, sem incluir, 00:00 do mês seguinte. O mês do pedido e a hora do aparelho não determinam o fechamento.
- Apenas os itens efetivamente vinculados a cada confirmação entram no documento, inclusive recebimentos parciais feitos em meses diferentes. Pedidos pendentes ficam fora.
- **Baixar PDF do posto** gera resumo e páginas de comprovação com as fotos já registradas, nomes, cargos, horários e identificadores. A foto é a confirmação utilizada pelo sistema atual; o relatório não cria uma assinatura ICP-Brasil.
- **Baixar pacote para o contador** reúne os PDFs em um ZIP, organizado por cliente, com índice CSV. Registros sem posto bloqueiam o pacote geral para evitar fechamento incompleto; PDFs individuais dos postos identificados continuam disponíveis.
- Postos/clientes ativos sem entregas recebem PDF indicando ausência de recebimentos. Postos inativos com recebimentos no mês também aparecem.
- O PDF incorpora a imagem, não o link temporário: continua legível após o link expirar. Se a foto não puder ser acessada, a exportação falha com mensagem explícita.
- Não há envio automático, integração contábil ou contato com clientes. Você baixa os documentos e encaminha externamente.

## Privacidade e validação

As fotos permanecem em bucket privado, com acesso adicional apenas ao módulo de relatórios. Os PDFs contêm nomes e fotos; entregue cada documento ao destinatário correto. O PDF conserva a foto original carimbada pelo módulo existente, que pode conter informações de local. Não são incluídas colunas extras com coordenadas.

Testes locais verificaram formulários, agrupamento por posto, PDF com foto, ZIP por cliente, funcionamento em quatro larguras e bibliotecas. A migração e as políticas SQL precisam ser homologadas no Supabase real: não houve acesso administrativo ao banco publicado nesta entrega.
