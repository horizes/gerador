# Plataforma Imperium

Site estático (HTML + CSS + JS puro) — não precisa de build nem de Node. Agora tem **login** (e-mail/senha)
e um **banco de dados compartilhado** (Supabase): os lançamentos do Fluxo de Caixa não ficam mais presos a
um navegador, qualquer pessoa da equipe que fizer login vê e edita os mesmos dados.

Hoje a plataforma tem quatro ferramentas (o grupo **Uniformes** tem duas, veja a seção **Uniformes**, abaixo): o **Gerador de propostas** (como antes, com o rascunho salvo só no
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
3. **Rode o SQL da hierarquia de acesso:** ainda no SQL Editor, cole o conteúdo de
   `supabase-schema-permissoes.sql` e clique em **Run**. Isso cria os "níveis de permissão" e a tabela de
   perfis (veja a seção **Hierarquia de acesso**, abaixo). Depois de rodar, torne a si mesmo admin: no
   final do arquivo há uma linha comentada `update perfis set papel = 'admin' where id = ...` — troque o
   e-mail e rode só essa linha (você precisa fazer isso manualmente uma vez; depois, tudo o resto — criar
   níveis, promover outras pessoas a admin — é feito pela tela **Usuários** dentro do site).
   Por fim, rode também o `supabase-schema-usuarios.sql` (mesmo lugar: **SQL Editor > New query > Run**): ele
   cria as permissões **por pessoa** e a listagem completa da tela **Usuários** (último acesso, e-mail
   confirmado, suspensa etc.). Pode rodar mais de uma vez sem problema.
4. **Crie uma conta para cada pessoa da equipe:** em **Authentication > Users > Add user**, informe e-mail
   e senha e marque **Auto Confirm User** (assim a pessoa já entra sem precisar confirmar e-mail). Não há
   cadastro público no site — só o administrador cria contas por aqui. A pessoa aparece sozinha na tela
   **Usuários** do site, sem acesso a nada até você configurar o nível dela.
5. **Uniformes (só se for usar):** rode também o `supabase-schema-uniformes.sql` (SQL Editor > New query > Run, depois dos
   três scripts acima) e libere as ferramentas na tela **Usuários** — veja a seção **Uniformes**, abaixo.
6. As chaves do projeto (URL e chave publicável) já estão em `js/supabase.js`. Se um dia você trocar de
   projeto Supabase, atualize as duas constantes no topo desse arquivo.

## Hierarquia de acesso

Existe uma tela **Usuários** (só aparece para quem é admin) para configurar quem vê o quê. As alterações
são salvas na hora, sem botão "Salvar":

- **Pessoas:** lista todas as contas que existem em Authentication > Users do Supabase (elas aparecem
  sozinhas, sem você precisar cadastrar nada no site). Cada pessoa mostra se **pode logar de verdade** —
  isso depende de três coisas: e-mail confirmado, conta não suspensa no Supabase e o interruptor **Acesso ao
  site** ligado. Quando algo impede o login, aparece uma etiqueta explicando o motivo. Os quadrinhos do topo
  (Contas, Podem logar, Sem acesso ao site, Admins) funcionam como filtros, e há busca por nome ou e-mail.
- **Ferramentas por pessoa:** em cada pessoa há um interruptor por ferramenta (Gerador de propostas, Fluxo de
  caixa…). Ligar/desligar vale na hora. Se a pessoa recebe a ferramenta pelo **nível** ou por ser **admin**, o
  interruptor aparece travado com essa indicação — para tirar, mude o nível ou o papel dela.
- **Papel, nível e acesso ao site:** admin vê todas as ferramentas (inclusive a tela Usuários) e não depende
  de nível; desligar **Acesso ao site** bloqueia o login e o acesso aos dados na hora, sem apagar a conta no
  Supabase. Você não consegue alterar o seu próprio papel nem desativar a si mesmo.
- **Níveis de permissão (opcional):** grupos que você nomeia (ex.: "Financeiro", "Comercial") e para os quais
  marca quais ferramentas liberam. Mudar as ferramentas de um nível vale para todas as pessoas dele.
- **Acesso final** a uma ferramenta = admin **ou** o nível libera **ou** permissão direta da pessoa.
  A pessoa vê o menu novo ao recarregar a página (ou no próximo login).
- A restrição não é só visual: as regras de segurança do banco (RLS) também checam o acesso antes de
  deixar ler ou gravar os dados do Fluxo de Caixa — então mesmo alguém tentando acessar direto pela URL
  ou pela API não vê dados de um módulo que ela não pode usar.
- **Limitação atual:** o Gerador de propostas não usa banco de dados (o rascunho fica só no navegador de
  quem está editando), então a permissão dele controla apenas se a ferramenta aparece no menu daquela
  pessoa — não há dado compartilhado nesse módulo para proteger.
- **Se a lista de pessoas aparecer com um aviso amarelo** (ou não carregar), é porque falta rodar o
  `supabase-schema-usuarios.sql`. Detalhes técnicos: tabelas `perfis`, `niveis`, `nivel_modulos` e
  `perfil_modulos`, e a função `admin_listar_perfis()`.

Pronto — publicando os arquivos normalmente (veja "Como publicar" abaixo), a tela de login aparece antes
da plataforma.

## Uniformes

Duas ferramentas ligadas pelo mesmo banco, no grupo **Uniformes** do menu:

- **Solicitar uniforme** (id `uniforme_solicitar`): a pessoa monta o pedido (tipo, tamanho, quantidade e observação de
  cada item, quantos itens quiser) e acompanha o andamento em **Meus pedidos**. Quando o pedido fica pronto, ela
  toca em **Recebi o uniforme**, marca o que recebeu (ou tudo) e assina com uma foto.
- **Solicitações de uniforme** (id `uniforme_gestao`): é a tela do responsável. Mostra quem pediu, o que pediu
  (tipo, tamanho, quantidade), permite **marcar como pronto para retirada** (com mensagem opcional, ex.: "retirar no RH")
  ou **recusar** (com motivo), mostra as assinaturas de recebimento e tem a aba **Tipos de uniforme**, onde quem tem
  acesso à tela cria, renomeia, define os tamanhos, desativa ou apaga tipos (salva na hora). Também tem um resumo
  "O que separar", somando os itens dos pedidos aguardando.

**Configurar (uma vez):** rode `supabase-schema-uniformes.sql` no SQL Editor (depois dos outros scripts; pode rodar de
novo sem problema). Ele cria as tabelas, as regras de segurança, o bucket **privado** `uniforme-assinaturas` (não precisa
criar à mão) e os tipos iniciais (Camiseta, Calça, Sapato, Bata, Jaqueta e Boné). Depois, na tela **Usuários**, libere
**Solicitar uniforme** para os colaboradores (dica: crie um nível "Colaborador" com essa ferramenta marcada) e
**Solicitações de uniforme** para a pessoa responsável. Admin tem as duas automaticamente.

**Avisos:** quando alguém faz um pedido, o responsável vê na hora um aviso no canto da tela e um número no item do
menu (pedidos aguardando). Quando o pedido fica pronto, quem pediu recebe o aviso e o número no menu dele. Usa o
Realtime do Supabase; se o projeto não tiver Realtime, o número do menu se atualiza sozinho a cada 2 minutos e ao voltar
para a aba.

**Andamento do pedido:** Aguardando → Pronto para retirada → (Entrega parcial) → Concluído. Também pode ficar Recusado
(pelo responsável) ou Cancelado (por quem pediu, só enquanto está aguardando). "Recebi o uniforme" só aparece depois
que o responsável marca como pronto. Se a pessoa marcar só parte dos itens, o pedido vira "Entrega parcial" e ela
confirma o restante depois, com outra assinatura. O pedido só fica Concluído quando todos os itens foram recebidos.

**Assinatura digital (foto):** a janela abre a câmera frontal e pede a localização. A foto sai com uma faixa gravada na
própria imagem: pedido, nome, data, hora e local (endereço e coordenadas). Detalhes:

- A câmera e a localização só funcionam em **https** (a hospedagem precisa estar com o certificado ativo) e a pessoa
  precisa permitir os dois acessos no navegador. Sem a localização não dá para assinar.
- Se o navegador não abrir a câmera (ex.: navegador dentro de outro aplicativo), aparece o botão "Tirar foto pelo
  aparelho". Nesse caso o sistema registra que a foto veio do seletor de arquivos e a tela do responsável mostra um
  aviso, porque esse caminho não garante que a foto foi tirada na hora.
- O **endereço** vem do serviço gratuito Nominatim (OpenStreetMap), consultado pelo navegador. Se ele estiver fora do ar,
  a faixa mostra só as coordenadas. A data e a hora que **valem** são as do servidor, gravadas no banco (a do aparelho
  aparece só na foto e é informativa).
- As fotos ficam no bucket privado, em `<id da pessoa>/arquivo.jpg`. Só a própria pessoa e quem tem acesso à tela de
  solicitações conseguem ver, por links temporários de 1 hora. Não há botão nem regra para apagar ou trocar uma
  assinatura já enviada.
- **LGPD:** foto do rosto e localização são dados pessoais. A janela traz o texto de autorização que a pessoa marca
  antes de confirmar, mas vale avisar a equipe sobre essa coleta e definir por quanto tempo as fotos ficam guardadas.

**Segurança:** as regras (RLS) valem no banco, não só na tela. Cada pessoa só enxerga os próprios pedidos; o
responsável enxerga todos; quem pediu só consegue cancelar (e só enquanto aguarda). Criar pedido e confirmar recebimento
passam por funções do banco que conferem tipo, tamanho, quantidade, dono do pedido, itens ainda não recebidos e se a
foto realmente foi enviada.

**Limites atuais:** a lista mostra os 300 pedidos mais recentes; não existe exclusão de pedidos pela tela (para limpar
pedidos de teste, use **Table Editor** do Supabase); o solicitante é sempre a própria pessoa logada (ninguém pede em nome
de outra).

## Estrutura

```
index.html                 casca da plataforma (tela de login + barra lateral + área da ferramenta)
supabase-schema.sql        script para rodar uma vez no SQL Editor do Supabase (tabelas, segurança, categorias)
supabase-schema-permissoes.sql  script da hierarquia de acesso (perfis, níveis de permissão, RLS por módulo)
supabase-schema-usuarios.sql    permissões por pessoa (perfil_modulos) e listagem completa da tela Usuários
supabase-schema-uniformes.sql   uniformes: tabelas, segurança (RLS), funções, bucket privado das assinaturas e tipos iniciais
css/base.css               cores, tipografia, campos e botões compartilhados
css/auth.css                tela de login
css/platform.css           barra lateral, menu do celular e tela inicial
css/propostas.css          Gerador de propostas (painel, prévia A4 e impressão)
css/fluxo.css              Fluxo de caixa (planilha editável, resumo e categorias)
css/dashboard.css          painel (dashboard) da tela inicial
css/usuarios.css           tela "Usuários" (pessoas, permissões por ferramenta e níveis)
css/uniformes.css          "Solicitar uniforme" e "Solicitações de uniforme" (formulário, pedidos, janela de recebimento)
js/supabase.js              conexão com o Supabase (URL + chave do projeto)
js/perfil.js                carrega o papel/nível/módulos permitidos da pessoa logada
js/auth.js                  login por e-mail/senha; libera a plataforma só depois de autenticado e com perfil ativo
js/platform.js             barra lateral (com grupos), navegação, tela inicial, registro de módulos e filtro por permissão
js/dashboard.js            painel da tela inicial: lê a tabela do Fluxo de Caixa no Supabase e monta o resumo/gráfico
js/modules/propostas.js    Gerador de propostas (lógica, páginas e exportação .docx) — rascunho salvo só no navegador
js/modules/fluxo.js        Fluxo de caixa (lançamentos, anexo de nota fiscal/foto, planilha, exportação .csv e backup .json) — dados no Supabase
js/modules/usuarios.js     tela "Usuários" (só para admin): lista as contas, mostra quem pode logar e libera ferramentas por pessoa/nível
js/modules/uniformes.js    as duas ferramentas de uniforme (pedido, atendimento, tipos, assinatura por foto) e os avisos do menu
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

- **Computador, tela inicial:** o menu fica sempre aberto e não tem botão de recolher.
- **Computador, dentro de uma ferramenta:** o botão "Recolher menu" (embaixo) deixa só os ícones, e a escolha fica salva no navegador. Recolhida, ela abre por cima do conteúdo quando o mouse passa por ela.
- **Telas médias (até ~1500 px), dentro do gerador:** o menu fica sempre recolhido, para a folha A4 caber ao lado do painel.
- **Celular e tablet:** o menu vira uma gaveta, aberta pelo botão de três linhas no topo (fecha ao escolher uma opção, tocar fora ou apertar Esc).

## Como adicionar uma nova ferramenta no futuro

1. Crie `js/modules/nova-ferramenta.js` e registre o módulo:

   ```js
   Platform.register({
     id: "nova",                 // vira o endereço #/nova
     menu: "Nova",               // texto na barra lateral
     nome: "Nome da ferramenta", // título na tela inicial
     categoria: "geradores",     // em qual grupo do menu ela fica (veja "Grupos do menu", abaixo)
     descricao: "Uma frase dizendo o que ela faz.",
     icone: '<path d="..."/>',   // conteúdo de um SVG 24x24 (traço)
     mount(el){ el.innerHTML = "..."; },
     unmount(){ /* remove listeners, se houver */ }
   });
   ```
2. Adicione `<script src="js/modules/nova-ferramenta.js"></script>` no `index.html`, depois do `propostas.js`.

A ferramenta aparece sozinha na barra lateral e na tela inicial, dentro do grupo da `categoria` escolhida.

## Grupos do menu

O menu lateral e a tela inicial separam as ferramentas por classificação, cada uma com um título pequeno:

| Grupo | `categoria` | Ferramentas hoje |
| --- | --- | --- |
| Geradores | `geradores` | Gerador de propostas |
| Financeiro | `financeiro` | Fluxo de caixa |
| Uniformes | `uniformes` | Solicitar uniforme, Solicitações de uniforme |
| Configurações | `configuracoes` | Usuários |

- A lista e a ordem dos grupos ficam em `CATEGORIAS`, no início de `js/platform.js`. Para criar um grupo novo
  (ex.: "Comercial"), acrescente uma linha ali e use o `id` dele em `categoria:` na ferramenta.
- Para mudar uma ferramenta de grupo, troque só o `categoria:` no `Platform.register(...)` dela
  (`js/modules/*.js`).
- Grupo sem nenhuma ferramenta visível para a pessoa não aparece (quem só tem o Gerador de propostas vê só
  "Geradores"). Ferramenta sem `categoria` cai em "Outras ferramentas".
- Com o menu recolhido (só ícones) o título do grupo some e fica apenas a linha separadora; ao passar o mouse
  o título volta. No celular, a gaveta mostra os grupos normalmente.
- Quem ainda não tem nenhuma ferramenta liberada vê, na tela inicial, um aviso para falar com o administrador.

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
administrador no painel do Supabase (**Authentication > Users**), uma por pessoa da equipe. Depois do login,
a pessoa só vê as ferramentas que o nível dela libera (veja **Hierarquia de acesso**, acima) — quem tem
acesso ao Fluxo de Caixa vê os mesmos dados que os outros com acesso a ele, já que continua sendo uma
ferramenta compartilhada pela equipe (não há separação "por usuário" dentro de cada ferramenta).

**Manter conectado:** a caixa na tela de login (ligada por padrão) decide onde a sessão fica guardada. Ligada, a
pessoa continua logada mesmo depois de fechar o navegador. Desligada, a sessão vale só enquanto o navegador/aba
estiver aberto — indicado para computadores compartilhados. A escolha fica em `js/supabase.js`
(`imperium_manter_conectado`). Para o padrão ser desligado, tire o `checked` do checkbox `#loginManter` no
`index.html` e troque `!== "0"` por `=== "1"` em `lerManter()`.
