# Plataforma Imperium

Site estático (HTML + CSS + JS puro) — não precisa de build nem de Node. Agora tem **login** (e-mail/senha)
e um **banco de dados compartilhado** (Supabase): os lançamentos do Fluxo de Caixa não ficam mais presos a
um navegador, qualquer pessoa da equipe que fizer login vê e edita os mesmos dados.

Hoje a plataforma tem duas ferramentas: o **Gerador de propostas** (como antes, com o rascunho salvo só no
navegador de quem está editando) e o **Fluxo de caixa**, para lançar entradas e saídas, acompanhar o saldo
por período e exportar para planilha — agora com os dados no banco. A tela inicial também mostra um
**painel (dashboard)** com o resumo do Fluxo de Caixa.

## Configuração do Supabase (fazer uma vez)

1. **Rode o SQL:** no painel do Supabase, abra **SQL Editor > New query**, cole o conteúdo de
   `supabase-schema.sql` e clique em **Run**. Isso cria as tabelas do Fluxo de Caixa, protege o acesso
   (só quem estiver logado consegue ler/gravar) e já cadastra as categorias padrão.
2. **Crie o bucket de anexos:** em **Storage**, clique em **New bucket**, nomeie exatamente `anexos` e
   marque **Public bucket** (as notas fiscais/fotos ficam acessíveis por link direto, só para quem tiver
   o link — não aparecem em nenhuma lista pública). Depois disso, rode de novo só a parte final do
   `supabase-schema.sql` (as 3 políticas de `storage.objects`), caso o bucket ainda não existisse na
   primeira vez que você rodou o script.
3. **Crie uma conta para cada pessoa da equipe:** em **Authentication > Users > Add user**, informe e-mail
   e senha e marque **Auto Confirm User** (assim a pessoa já entra sem precisar confirmar e-mail). Não há
   cadastro público no site — só o administrador cria contas por aqui.
4. As chaves do projeto (URL e chave publicável) já estão em `js/supabase.js`. Se um dia você trocar de
   projeto Supabase, atualize as duas constantes no topo desse arquivo.

Pronto — publicando os arquivos normalmente (veja "Como publicar" abaixo), a tela de login aparece antes
da plataforma.

## Estrutura

```
index.html                 casca da plataforma (tela de login + barra lateral + área da ferramenta)
supabase-schema.sql        script para rodar uma vez no SQL Editor do Supabase (tabelas, segurança, categorias)
css/base.css               cores, tipografia, campos e botões compartilhados
css/auth.css                tela de login
css/platform.css           barra lateral, menu do celular e tela inicial
css/propostas.css          Gerador de propostas (painel, prévia A4 e impressão)
css/fluxo.css              Fluxo de caixa (planilha editável, resumo e categorias)
css/dashboard.css          painel (dashboard) da tela inicial
js/supabase.js              conexão com o Supabase (URL + chave do projeto)
js/auth.js                  login por e-mail/senha; libera a plataforma só depois de autenticado
js/platform.js             barra lateral, navegação (#/ e #/propostas), tela inicial e registro de módulos
js/dashboard.js            painel da tela inicial: lê a tabela do Fluxo de Caixa no Supabase e monta o resumo/gráfico
js/modules/propostas.js    Gerador de propostas (lógica, páginas e exportação .docx) — rascunho salvo só no navegador
js/modules/fluxo.js        Fluxo de caixa (lançamentos, anexo de nota fiscal/foto, planilha, exportação .csv e backup .json) — dados no Supabase
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

Os lançamentos e as categorias ficam num banco de dados central (Supabase) — qualquer pessoa da equipe que
fizer login vê e edita os **mesmos** dados, de qualquer computador ou celular. Na prática:

- Cada alteração (novo lançamento, edição, exclusão, categoria) é salva direto no banco assim que você a faz.
- Os anexos (nota fiscal/foto) ficam no Storage do Supabase (bucket `anexos`), não mais embutidos no navegador.
- **"Salvar backup (.json)"** continua útil como cópia de segurança pessoal de vez em quando.
- **"Importar backup (.json)"** agora *adiciona* os lançamentos do arquivo aos dados atuais (em vez de
  substituir tudo), já que os dados passaram a ser de todo mundo — importar não apaga o que já está lá.
- **"Apagar todos os lançamentos"** apaga os dados da empresa inteira (não só os "deste navegador" como antes)
  — o aviso de confirmação deixa isso claro.
- Não há sincronização automática em tempo real: se duas pessoas estiverem com a planilha aberta ao mesmo
  tempo, cada uma vê as mudanças da outra ao navegar de novo até a tela (ou recarregar a página).

## Login

A tela de login aparece antes de qualquer ferramenta. Não existe cadastro público: contas são criadas pelo
administrador no painel do Supabase (**Authentication > Users**), uma por pessoa da equipe. Qualquer pessoa
com login válido vê os mesmos dados do Fluxo de Caixa — não há separação "por usuário".
