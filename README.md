# Plataforma Imperium

Site estático (HTML + CSS + JS puro). Não precisa de build, Node, banco de dados ou servidor próprio.

Hoje a plataforma tem uma ferramenta: o **Gerador de propostas**, que funciona como antes.

## Estrutura

```
index.html                 casca da plataforma (barra lateral + área da ferramenta)
css/base.css               cores, tipografia, campos e botões compartilhados
css/platform.css           barra lateral, menu do celular e tela inicial
css/propostas.css          Gerador de propostas (painel, prévia A4 e impressão)
js/platform.js             barra lateral, navegação (#/ e #/propostas), tela inicial e registro de módulos
js/modules/propostas.js    Gerador de propostas (lógica, páginas e exportação .docx)
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
- **Rascunhos:** os dados preenchidos ficam salvos no `localStorage` do navegador de cada usuário (não vão para o servidor). Trocar de navegador/computador ou de domínio começa do zero.
- **Fontes:** Oswald e Barlow vêm do Google Fonts (precisa de internet).
- **Fotos de clientes padrão:** para trocar, substitua os arquivos em `assets/clientes/` mantendo o nome, ou edite `CLIENTES_PADRAO` no início de `js/modules/propostas.js`.
- **HTTPS:** ative o certificado SSL na hospedagem.
