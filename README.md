# Plataforma Imperium

Site estático (HTML + CSS + JS puro). Não precisa de build, Node, banco de dados ou servidor próprio.

Hoje a plataforma tem duas ferramentas: o **Gerador de propostas** (como antes) e o **Fluxo de caixa**,
para lançar entradas e saídas, acompanhar o saldo por período e exportar para planilha. A tela inicial
também mostra um **painel (dashboard)** com o resumo do Fluxo de Caixa.

## Estrutura

```
index.html                 casca da plataforma (barra lateral + área da ferramenta)
css/base.css               cores, tipografia, campos e botões compartilhados
css/platform.css           barra lateral, menu do celular e tela inicial
css/propostas.css          Gerador de propostas (painel, prévia A4 e impressão)
css/fluxo.css              Fluxo de caixa (planilha editável, resumo e categorias)
css/dashboard.css          painel (dashboard) da tela inicial
js/platform.js             barra lateral, navegação (#/ e #/propostas), tela inicial e registro de módulos
js/dashboard.js            painel da tela inicial: lê o localStorage do Fluxo de Caixa e monta o resumo/gráfico
js/modules/propostas.js    Gerador de propostas (lógica, páginas e exportação .docx)
js/modules/fluxo.js        Fluxo de caixa (lançamentos, anexo de nota fiscal/foto, planilha, exportação .csv e backup .json)
assets/logo.jpg            logo da Imperium
assets/clientes/           fotos/logos dos clientes da seção "Clientes e parceiros"
robots.txt                 bloqueia indexação por buscadores
```

## Como publicar

Envie **o conteúdo desta pasta** (com `index.html` na raiz) para qualquer hospedagem estática:

- **Hospedagem tradicional (cPanel, Hostinger, Locaweb etc.):** envie tudo para `public_html/` (ou a pasta do subdomínio) via Gerenciador de Arquivos/FTP.
- **Netlify:** arraste a pasta em https://app.netlify.com/drop
- **Cloudflare Pages / GitHub Pages / Vercel:** aponte para o repositório ou faça upload da pasta; sem comando de build, diretório de saída = raiz.

Precisa ser servido por **http(s)** (não abra via `file://` em produção). Para testar localmente:

```
python3 -m http.server 8000
# abra http://localhost:8000
```

A navegação usa o hash da URL (`#/propostas`), então não é preciso configurar redirecionamentos na hospedagem.

## Barra lateral

- **Computador:** fica aberta na tela inicial. O botão "Recolher menu" (embaixo) deixa só os ícones, e a escolha fica salva no navegador. Recolhida, ela abre por cima do conteúdo quando o mouse passa por ela.
- **Telas médias (até ~1500 px), dentro do gerador:** o menu fica sempre recolhido, para a folha A4 caber ao lado do painel.
- **Celular e tablet:** o menu vira uma gaveta, aberta pelo botão de três linhas no topo (fecha ao escolher uma opção, tocar fora ou apertar Esc).

## Como adicionar uma nova ferramenta no futuro

1. Crie `js/modules/nova-ferramenta.js` e registre o módulo:

   ```js
   Platform.register({
     id: "nova",                 // vira o endereço #/nova
     menu: "Nova",               // texto na barra lateral
     nome: "Nome da ferramenta", // título na tela inicial
     descricao: "Uma frase dizendo o que ela faz.",
     icone: '<path d="..."/>',   // conteúdo de um SVG 24x24 (traço)
     mount(el){ el.innerHTML = "..."; },
     unmount(){ /* remove listeners, se houver */ }
   });
   ```
2. Adicione `<script src="js/modules/nova-ferramenta.js"></script>` no `index.html`, depois do `propostas.js`.

A ferramenta aparece sozinha na barra lateral e na tela inicial.

## Observações

- **Privacidade:** a ferramenta contém valores e margens internos. O site está com `noindex` (meta tag + robots.txt), mas isso não impede acesso por quem tiver o link. Se for de uso interno, proteja com senha (Cloudflare Access, Netlify Password Protection, ou `.htaccess` no cPanel). Para liberar a indexação, remova a meta `robots` do `index.html` e apague o `robots.txt`.
- **Rascunhos e lançamentos:** os dados preenchidos (inclusive os lançamentos do Fluxo de caixa) ficam salvos no `localStorage` do navegador de cada usuário (não vão para o servidor). Trocar de navegador/computador ou de domínio começa do zero — no Fluxo de caixa, use "Salvar backup (.json)" e "Importar backup (.json)" para levar os dados de um lugar para o outro, ou para não perder nada ao limpar o navegador.
- **Painel da tela inicial:** o dashboard (`js/dashboard.js`) lê o mesmo `localStorage` do Fluxo de Caixa, então mostra os lançamentos daquele navegador/computador — a mesma limitação de "por navegador" descrita abaixo. Sem nenhum lançamento ainda, ele mostra uma mensagem convidando a lançar o primeiro.
- **Anexo de nota fiscal/foto:** cada lançamento pode ter uma foto ou PDF anexado, escolhido no formulário "Novo lançamento" (à esquerda) antes de adicionar. Na planilha, a coluna Anexo mostra a miniatura (clique para abrir) e o "×" para remover; lançamentos sem anexo mostram um traço. Fotos são reduzidas automaticamente antes de salvar; ainda assim, como tudo fica no `localStorage` do navegador (que costuma ter uns 5–10 MB de limite no total), anexar muitas fotos ao longo do tempo pode aproximar desse limite. Exportar backups (.json) com frequência também serve para não perder os anexos.
- **Fontes:** Oswald e Barlow vêm do Google Fonts (precisa de internet).
- **Imagens do Connect e do Flash:** ficam embutidas em `js/modules/propostas.js` (constantes `LOGO_CONNECT_PADRAO` e `LOGO_FLASH_PADRAO`), então aparecem mesmo sem a pasta `assets/`. Dentro da ferramenta dá para enviar outra imagem por proposta.
- **Fotos de clientes padrão:** para trocar, substitua os arquivos em `assets/clientes/` mantendo o nome, ou edite `CLIENTES_PADRAO` no início de `js/modules/propostas.js`.
- **HTTPS:** ative o certificado SSL na hospedagem.

## Fluxo de caixa: como a tela é organizada

- **Esquerda:** só o formulário "Novo lançamento" (data, tipo, status, categoria, descrição, forma, valor, anexo e o botão "Adicionar lançamento").
- **Direita (a planilha):** tudo o que controla a planilha fica junto dela — resumo do período, botões de exportar
  planilha (.csv) e salvar/importar backup (.json), filtros (período, tipo e categoria), os painéis recolhíveis
  "Categorias" (adicionar e remover) e "Dados salvos" (avisos e "Apagar todos os lançamentos"), a tabela editável
  e os totais por categoria. A tabela não tem botão de adicionar: novos lançamentos entram só pelo formulário da esquerda.
- **Celular e tablet:** as abas "Lançar" e "Planilha" no topo alternam entre as duas metades.

## Fluxo de caixa: sobre salvar os dados

Por ser um site estático (sem servidor/banco de dados), os lançamentos ficam gravados no `localStorage`
do navegador — ou seja, **por navegador/computador**, não em um lugar central que todo mundo acessa. Na prática:

- Cada pessoa que usa o Fluxo de caixa em um computador diferente vê os próprios lançamentos, não os dos outros.
- Limpar o cache do navegador, trocar de navegador ou reinstalar o computador apaga os dados salvos ali.
- Por isso a ferramenta tem os botões **"Salvar backup (.json)"** e **"Importar backup (.json)"**: use o primeiro
  de vez em quando (ex.: no fim do dia) para guardar um arquivo com tudo, e o segundo para recarregar esse arquivo
  no mesmo navegador ou em outro. O botão **"Exportar para planilha (.csv)"** é para abrir os lançamentos no
  Excel/Google Sheets/LibreOffice — é uma cópia para consulta, não volta a ser importada na ferramenta.

Se no futuro for necessário que **várias pessoas lancem no mesmo fluxo de caixa e vejam os mesmos dados em tempo
real** (de qualquer computador), isso exige um lugar central para guardar as informações — o que essa ferramenta,
sendo um site estático, não tem hoje. As opções mais simples para isso, caso vire necessidade, seriam:

- **Google Planilhas como "banco de dados":** o site passaria a ler e gravar em uma planilha do Google (via
  Google Sheets API), então todo mundo enxergaria os mesmos lançamentos. Exige uma conta Google e uma chave de
  acesso configurada.
- **Um serviço de banco de dados gratuito na nuvem** (ex.: Firebase ou Supabase): dados compartilhados e em tempo
  real entre todos os usuários, com plano gratuito suficiente para o volume de uma empresa pequena. Exige criar
  uma conta no serviço escolhido e um pouco mais de configuração inicial.
- **Um pequeno servidor próprio:** mais controle, mas sai do modelo "site estático sem manutenção" que a
  plataforma usa hoje.

Qualquer uma dessas é viável de adicionar depois, sem precisar refazer a tela — me avise se quiser seguir por
esse caminho e eu integro.
