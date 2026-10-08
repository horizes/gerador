# Central de pendências — Imperium

Atualização de 8 de outubro de 2026. O pacote `imperium-plataforma-central-pendencias.zip` contém a plataforma completa com a nova central, mantendo o cadastro corrigido, a tela de instalação e a organização das páginas por categorias.

## O que a central reúne

A opção **Central de pendências** aparece no menu em **Minha rotina**. A tela inicial também mostra um resumo por categoria quando existem pendências. A central está disponível para quem estiver autenticado; seus dados dependem das ferramentas que a pessoa já pode acessar.

| Categoria | Pendências exibidas | Quem pode ver |
| --- | --- | --- |
| Uniformes e EPI | Pedidos aguardando atendimento, itens prontos para retirada e entregas aguardando confirmação | Gestão vê solicitações da equipe; colaborador vê apenas os próprios pedidos |
| Ponto | Pedidos de ajuste que ainda não têm decisão | Gestão vê pedidos para analisar; colaborador acompanha apenas os próprios |
| Acessos | Convites não utilizados, convites expirados e contas ativas sem confirmação de e-mail ou sem senha | Administradores |
| Financeiro | Entradas e saídas com status pendente | Quem já tem acesso ao Fluxo de caixa |

Há duas situações: **Para resolver** e **Aguardando retorno**. O número no menu conta apenas os itens para resolver; os contadores das categorias e o total da página incluem também os itens aguardando retorno. Convites ainda válidos ficam em acompanhamento; convites expirados indicam a necessidade de gerar outro. Contas bloqueadas não são tratadas como cadastros incompletos.

O financeiro utiliza o status do lançamento. A data do lançamento não é uma data de vencimento, e esta atualização não cria alertas de atraso ou vencimento.

## Como usar

- Alterne entre **Todas**, **Uniformes e EPI**, **Ponto**, **Acessos** e **Financeiro**. Categorias sem permissão ficam ocultas.
- Busque pelo nome, descrição ou tipo de pendência e filtre a situação. Os filtros permanecem ao trocar de categoria ou atualizar a lista.
- Abra o botão do item para ir à ferramenta correspondente. Pedidos de uniforme, ajustes de ponto, pessoas e lançamentos são destacados. Convites abrem diretamente a categoria Convites de Usuários.
- No financeiro, o atalho seleciona o mês e o tipo do lançamento e abre a Planilha, inclusive no celular. Isso não substitui a preferência de filtros salva anteriormente pelo usuário.
- Os pedidos de uniformes acessados por um atalho continuam sendo encontrados quando são anteriores aos 300 pedidos mais recentes da página original.

A central apenas consulta os dados. As aprovações, confirmações, alterações e cancelamentos continuam nas ferramentas existentes. Um item resolvido deixa de aparecer na consulta seguinte.

Os dados são consultados ao entrar na plataforma, abrir a central, voltar à tela inicial e retornar à aba do navegador, além de uma consulta a cada dois minutos enquanto a aba estiver visível. O botão **Atualizar** permite consultar imediatamente. Se uma fonte falhar, a página identifica a área que não pôde consultar e mantém as outras disponíveis, sem afirmar que tudo está em dia.

## Publicar a atualização

Esta melhoria usa as tabelas, funções de leitura e permissões existentes. **Não há SQL novo nem nova Edge Function para publicar.** A central não precisa de liberação adicional por cargo: cada categoria segue a permissão da ferramenta de origem.

Se já publicou o pacote com categorias, extraia o ZIP e substitua estes nove arquivos na pasta publicada do site, mantendo os caminhos:

- `index.html`
- `js/platform.js`
- `js/modules/pendencias.js` — novo
- `css/pendencias.css` — novo
- `js/modules/uniformes.js`
- `js/modules/ponto.js`
- `js/modules/usuarios.js`
- `js/modules/fluxo.js`
- `sw.js`

Publique o HTML, os dois arquivos novos e os demais scripts juntos. Mantenha `js/categorias.js` e `css/categorias.css`, que já fazem parte da versão anterior. O cache foi atualizado para `imperium-v45`; as versões são `platform.js?v=18`, `pendencias.js`/`pendencias.css?v=1`, `uniformes.js?v=17`, `ponto.js?v=4`, `usuarios.js?v=10` e `fluxo.js?v=11`.

Caso esteja atualizando diretamente a versão original, publique também os arquivos das correções anteriores conforme `PAGINAS-POR-CATEGORIAS.md`, `CORRECAO-CODIGO-EMAIL.md` e `INSTALACAO-APOS-CADASTRO.md`. Os documentos, testes, scripts SQL e a pasta `supabase` são materiais administrativos e não precisam ir à hospedagem estática.

Após a publicação, abra o site com internet e recarregue. Reabra também o aplicativo instalado para carregar a nova versão.

## Conferência após publicar

1. Com um administrador, confira a central e as categorias compatíveis com os módulos instalados. Compare os itens com as páginas de origem.
2. Com um colaborador, confira que apenas os próprios pedidos e ajustes aparecem e que não há dados financeiros ou administrativos sem permissão.
3. Abra um item, resolva-o na ferramenta correspondente e volte à central. Confira que a pendência desapareceu após a consulta.
4. Teste busca, filtro de situação, troca de categoria e atualização no computador e celular.

Passaram 47 testes automatizados locais: 14 da central e 33 do cadastro e instalação. Os testes da central verificam permissões, pedidos próprios, decisões de ponto, cadastros incompletos, convites expirados, leituras acima de 500 registros, falhas parciais, atualização após resolução, consultas simultâneas e descarte de respostas antigas após troca de usuário.

Também passaram 26 cenários no Chrome com o HTML, estilos, navegação e módulos reais, em computador e celulares de 390 e 320 pixels. Foram conferidos os atalhos, destaque dos registros, filtros, permissões, resolução de um lançamento, erros de consulta, listas longas, teclado e pedidos de uniforme anteriores aos 300 mais recentes. As 73 verificações locais das categorias anteriores também passaram.

As consultas e gravações usadas nesses testes foram simuladas. A hospedagem e o banco de produção não foram alterados nesta preparação.
