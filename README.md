# Imperium — Gerador de Propostas

Site estático (HTML + CSS + JS puro). Não precisa de build, Node, banco de dados ou servidor próprio.

## Estrutura

```
index.html          página principal
css/style.css       estilos (tela e impressão)
js/app.js           lógica, geração da proposta e exportação .docx
assets/logo.jpg     logo da Imperium
assets/clientes/    fotos/logos dos clientes da seção "Clientes e parceiros"
robots.txt          bloqueia indexação por buscadores
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

## Observações

- **Privacidade:** a ferramenta contém valores e margens internos. O site está com `noindex` (meta tag + robots.txt), mas isso não impede acesso por quem tiver o link. Se for de uso interno, proteja com senha (Cloudflare Access, Netlify Password Protection, ou `.htaccess` no cPanel). Para liberar a indexação, remova a meta `robots` do `index.html` e apague o `robots.txt`.
- **Rascunhos:** os dados preenchidos ficam salvos no `localStorage` do navegador de cada usuário (não vão para o servidor). Trocar de navegador/computador ou de domínio começa do zero.
- **Fontes:** Oswald e Barlow vêm do Google Fonts (precisa de internet).
- **Fotos de clientes padrão:** para trocar, substitua os arquivos em `assets/clientes/` mantendo o nome, ou edite `CLIENTES_PADRAO` no início de `js/app.js`.
- **HTTPS:** ative o certificado SSL na hospedagem.
