# Organização das páginas por categorias

Versão de 8 de outubro de 2026. O pacote `imperium-plataforma-categorias.zip` contém a plataforma completa, incluindo a correção do cadastro por código e a tela de instalação após criar a senha.

## Páginas organizadas

| Página | Categorias |
| --- | --- |
| Usuários | Pessoas, Convites, Cargos |
| Meu ponto | Registrar ponto, Batidas, Ajustes, Registros tratados |
| Gestão de ponto | Batidas, Ajustes, Registros tratados, Vínculos e jornadas |
| Resumo mensal | Resumo e exportação, Recebimentos por posto, Pendências |

A página de Usuários abre em **Pessoas**. Os filtros de contas e a busca ficam nessa categoria; gerar e acompanhar links fica em **Convites**; as ferramentas liberadas por cargo ficam em **Cargos**.

Meu ponto abre no registro da batida. Gestão de ponto abre nas batidas. Os filtros de período e a exportação ficam disponíveis nas categorias de histórico. Pedir um ajuste ou informar um horário esquecido abre diretamente a categoria **Ajustes**.

No Resumo mensal, os controles de PDF ficam em **Resumo e exportação**. O atalho de recebimentos sem posto abre **Pendências**. Associar um registro atualiza os contadores e mantém a categoria selecionada. A seleção de competência continua disponível em todas as categorias.

As abas seguem o padrão dourado já usado em Clientes e Uniformes. Trocar de aba preserva os campos preenchidos e as seções abertas. Há contadores e navegação por teclado com setas, Home e End. No celular, as categorias se acomodam à largura da tela.

Clientes e postos e as duas páginas de Uniformes já tinham categorias. Propostas e Fluxo de caixa já separavam configuração, lançamento, visualização e seus grupos internos. Essas organizações foram mantidas.

## Publicar a atualização

Extraia o ZIP. Se já publicou a versão com cadastro corrigido e instalação, substitua estes oito arquivos na pasta publicada, mantendo os caminhos:

- `index.html`
- `js/categorias.js` — novo
- `css/categorias.css` — novo
- `js/modules/usuarios.js`
- `css/usuarios.css`
- `js/modules/ponto.js`
- `js/modules/clientes-relatorios.js`
- `sw.js`

Publique os dois arquivos novos junto com os módulos e o HTML. O cache é `imperium-v44`; as versões são `usuarios.js?v=9`, `usuarios.css?v=6`, `ponto.js?v=3`, `clientes-relatorios.js?v=8` e `categorias.js`/`categorias.css?v=1`.

Esta organização não exige alterações no Supabase. Para atualizar diretamente a versão original, publique também `js/auth.js`, `js/pwa.js` e `css/auth.css`, e siga `CORRECAO-CODIGO-EMAIL.md` para a função e os modelos de e-mail. Os arquivos SQL e documentos do pacote servem à administração e não precisam ir à hospedagem estática.

Após publicar, abra o site com internet e recarregue. Reabra também o aplicativo instalado para carregar a atualização.

## Conferência

1. Em Usuários, alterne entre Pessoas, Convites e Cargos. Preencha um convite, troque de categoria e confira que os campos continuam preenchidos.
2. Em Meu ponto, abra Batidas e peça um ajuste. Confira a abertura de Ajustes. Na Gestão de ponto, confira Vínculos e jornadas.
3. No Resumo mensal, confira as três categorias e o atalho para registros pendentes. Os PDFs gerais continuam exigindo que os recebimentos estejam associados a postos.
4. Confira as mesmas páginas no celular e a troca de abas pelo teclado no computador.

Passaram 73 verificações no Chrome com telas de 1280 e 390 pixels: visibilidade de uma categoria por vez, contadores, busca, preservação de campos, atalhos, teclado, atualização das listas, associação de pendências, controles de exportação e ausência de transbordamento horizontal da página. Foram usadas as folhas de estilo e os módulos reais com dados e chamadas do Supabase simulados.

Os 33 testes locais de cadastro e instalação também passaram. A publicação de produção e um envio real de e-mail não foram executados nesta preparação.
